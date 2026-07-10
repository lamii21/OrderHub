import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const { runSyncForShops, getConnector, runWorkflow } = vi.hoisted(() => ({
  runSyncForShops: vi.fn(),
  getConnector: vi.fn(),
  runWorkflow: vi.fn(),
}));

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(async () => holder.client),
}));
vi.mock("@/lib/sync", () => ({
  runSyncForShops,
  toPlatformCredentials: (shop: { store_url: string; api_key: string }) => ({
    storeUrl: shop.store_url,
    apiKey: shop.api_key,
  }),
}));
vi.mock("@/lib/platforms", () => ({ getConnector }));
vi.mock("@/lib/workflows/engine", () => ({ runWorkflow }));

import { runSyncNow, testAllConnections, retryFailedWorkflowExecutions } from "@/app/admin/actions";

beforeEach(() => {
  runSyncForShops.mockReset();
  getConnector.mockReset();
  runWorkflow.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("runSyncNow", () => {
  it("syncs only shops with both store_url and api_key set, and redirects with the count", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: [{ id: 1 }], error: null } } });
    holder.client = client;
    runSyncForShops.mockResolvedValue([{ shopId: 1, products: 2, orders: 1 }]);

    await expect(runSyncNow()).rejects.toThrow("REDIRECT:/admin?synced=1");

    expect(runSyncForShops).toHaveBeenCalledWith([{ id: 1 }]);
  });

  it("redirects with an error when the shops query fails", async () => {
    const { client } = createMockSupabase({
      responses: { shops: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(runSyncNow()).rejects.toThrow(/REDIRECT:\/admin\?error=/);
    expect(runSyncForShops).not.toHaveBeenCalled();
  });
});

describe("testAllConnections", () => {
  it("counts passed/failed connections and redirects with the summary", async () => {
    const shops = [
      { id: 1, platform: "Shopify", store_url: "https://a.myshopify.com", api_key: "k1" },
      { id: 2, platform: "WooCommerce", store_url: "https://b.example.com", api_key: "k2" },
    ];
    const { client } = createMockSupabase({ responses: { shops: { data: shops, error: null } } });
    holder.client = client;
    getConnector.mockReturnValue({ testConnection: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false) });

    await expect(testAllConnections()).rejects.toThrow(
      "REDIRECT:/admin?tested=2&tests_passed=1&tests_failed=1"
    );
  });

  it("counts a connector that throws as a failure, not a crash", async () => {
    const shops = [{ id: 1, platform: "Shopify", store_url: "https://a.myshopify.com", api_key: "k1" }];
    const { client } = createMockSupabase({ responses: { shops: { data: shops, error: null } } });
    holder.client = client;
    getConnector.mockReturnValue({
      testConnection: vi.fn().mockRejectedValue(new Error("timeout")),
    });

    await expect(testAllConnections()).rejects.toThrow(
      "REDIRECT:/admin?tested=1&tests_passed=0&tests_failed=1"
    );
  });
});

describe("retryFailedWorkflowExecutions", () => {
  it("deduplicates several failed steps from the same (workflow, order) pair into a single retry", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflow_executions: [
          {
            data: [
              { workflow_id: 1, order_id: 100 },
              { workflow_id: 1, order_id: 100 }, // same pair, different failed step
            ],
            error: null,
          },
          { data: [], error: null }, // no steps already succeeded today
        ],
        workflows: {
          data: [
            {
              id: 1,
              name: "A",
              workflow_steps: [{ id: 9, workflow_id: 1, step_order: 1, module_name: "archive", config: {} }],
            },
          ],
          error: null,
        },
        orders: { data: [{ id: 100 }], error: null },
      },
    });
    holder.client = client;
    runWorkflow.mockResolvedValue(undefined);

    await expect(retryFailedWorkflowExecutions()).rejects.toThrow("REDIRECT:/admin?workflow_retried=1");

    expect(runWorkflow).toHaveBeenCalledTimes(1);
  });

  it("redirects with workflow_retried=0 without querying anything else when there are no failures today", async () => {
    const { client, builders } = createMockSupabase({
      responses: { workflow_executions: { data: [], error: null } },
    });
    holder.client = client;

    await expect(retryFailedWorkflowExecutions()).rejects.toThrow("REDIRECT:/admin?workflow_retried=0");
    expect(builders.workflows).toBeUndefined();
    expect(builders.orders).toBeUndefined();
  });

  it("skips a pair when the workflow or order no longer exists", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflow_executions: [{ data: [{ workflow_id: 1, order_id: 100 }], error: null }, { data: [], error: null }],
        workflows: { data: [], error: null }, // workflow was deleted since the failure was recorded
        orders: { data: [{ id: 100 }], error: null },
      },
    });
    holder.client = client;

    await expect(retryFailedWorkflowExecutions()).rejects.toThrow("REDIRECT:/admin?workflow_retried=0");
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  it("does not let one failing retry stop the others", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflow_executions: [
          {
            data: [
              { workflow_id: 1, order_id: 100 },
              { workflow_id: 2, order_id: 200 },
            ],
            error: null,
          },
          { data: [], error: null },
        ],
        workflows: {
          data: [
            { id: 1, name: "A", workflow_steps: [] },
            { id: 2, name: "B", workflow_steps: [] },
          ],
          error: null,
        },
        orders: {
          data: [
            { id: 100 },
            { id: 200 },
          ],
          error: null,
        },
      },
    });
    holder.client = client;
    runWorkflow.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(undefined);

    await expect(retryFailedWorkflowExecutions()).rejects.toThrow("REDIRECT:/admin?workflow_retried=1");
    expect(runWorkflow).toHaveBeenCalledTimes(2);
  });

  it("does exactly one batched lookup per table regardless of how many unique pairs are being retried", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        workflow_executions: [
          {
            data: [
              { workflow_id: 1, order_id: 100 },
              { workflow_id: 2, order_id: 200 },
              { workflow_id: 3, order_id: 300 },
            ],
            error: null,
          },
          { data: [], error: null },
        ],
        workflows: {
          data: [
            { id: 1, name: "A", workflow_steps: [] },
            { id: 2, name: "B", workflow_steps: [] },
            { id: 3, name: "C", workflow_steps: [] },
          ],
          error: null,
        },
        orders: {
          data: [{ id: 100 }, { id: 200 }, { id: 300 }],
          error: null,
        },
      },
    });
    holder.client = client;
    runWorkflow.mockResolvedValue(undefined);

    await expect(retryFailedWorkflowExecutions()).rejects.toThrow("REDIRECT:/admin?workflow_retried=3");

    // Exactly one .from("workflows") call and one .from("orders") call — not
    // one per pair — is what proves the N-queries-per-pair loop is gone.
    expect(builders.workflows).toHaveLength(1);
    expect(builders.orders).toHaveLength(1);
    expect(builders.workflows[0].in).toHaveBeenCalledWith("id", [1, 2, 3]);
    expect(builders.orders[0].in).toHaveBeenCalledWith("id", [100, 200, 300]);
  });

  // Regression test for the retry-resume fix: a step that already succeeded
  // earlier today for this exact (workflow, order) pair must not be
  // re-sent just because a different step in the same run failed.
  it("passes already-succeeded step orders to runWorkflow as skipStepOrders", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflow_executions: [
          { data: [{ workflow_id: 1, order_id: 100 }], error: null },
          {
            data: [
              { workflow_id: 1, order_id: 100, step_order: 1 },
              { workflow_id: 1, order_id: 100, step_order: 2 },
            ],
            error: null,
          },
        ],
        workflows: {
          data: [{ id: 1, name: "A", workflow_steps: [] }],
          error: null,
        },
        orders: { data: [{ id: 100 }], error: null },
      },
    });
    holder.client = client;
    runWorkflow.mockResolvedValue(undefined);

    await expect(retryFailedWorkflowExecutions()).rejects.toThrow("REDIRECT:/admin?workflow_retried=1");

    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ id: 100 }),
      { skipStepOrders: new Set([1, 2]) }
    );
  });

  it("passes an undefined skipStepOrders when nothing has succeeded yet for that pair", async () => {
    const { client } = createMockSupabase({
      responses: {
        workflow_executions: [
          { data: [{ workflow_id: 1, order_id: 100 }], error: null },
          { data: [], error: null },
        ],
        workflows: { data: [{ id: 1, name: "A", workflow_steps: [] }], error: null },
        orders: { data: [{ id: 100 }], error: null },
      },
    });
    holder.client = client;
    runWorkflow.mockResolvedValue(undefined);

    await expect(retryFailedWorkflowExecutions()).rejects.toThrow("REDIRECT:/admin?workflow_retried=1");

    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ id: 100 }),
      { skipStepOrders: undefined }
    );
  });
});
