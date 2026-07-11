import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "../mocks/supabase";

// The full real chain from the HTTP boundary down: only createOrUpdateShop
// (a concern of shop provisioning, not automation) and the Supabase client
// are mocked. Dispatch, the Workflow Manager, the Execution Engine, the
// Archive module, and Execution History are all real — this proves a real
// incoming order genuinely triggers real automation, not just that each
// layer individually calls the next one correctly (already covered by
// tests/webhook/orders-route.test.ts's mocked-dispatch version).
const { createOrUpdateShop } = vi.hoisted(() => ({ createOrUpdateShop: vi.fn() }));
const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));
vi.mock("@/lib/shop", () => ({ createOrUpdateShop }));

import { POST } from "@/app/api/orders/route";
import { invalidateWorkflowCache } from "@/lib/workflows/manager";

function insertedRows(builders: ReturnType<typeof createMockSupabase>["builders"], table: string) {
  return builders[table].flatMap((b) => b.insert.mock.calls).map((call) => call[0]);
}

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/orders", {
    method: "POST",
    headers: { "x-api-key": "test-api-secret", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  createOrUpdateShop.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  // resolveWorkflows() (lib/workflows/manager.ts) now caches its result
  // per (shopId, eventType) — reset so each test queries fresh instead of
  // reusing another test's resolved (or empty) workflow list.
  invalidateWorkflowCache();
});

describe("a real incoming order triggers a real Active workflow end to end", () => {
  it("archives the order via the Archive module when an order.created workflow is active for the shop", async () => {
    createOrUpdateShop.mockResolvedValue({ id: 7 });

    const savedOrder = { id: 100, shop_id: 7, status: "pending", tags: [] };
    const { client, builders } = createMockSupabase({
      responses: {
        products: { data: null, error: null },
        orders: [
          { data: savedOrder, error: null }, // the webhook's own upsert
          { data: null, error: null }, // the Archive module's update
        ],
        workflows: {
          data: [
            {
              id: 1,
              shop_id: 7,
              name: "Archive on creation",
              trigger_event: "order.created",
              is_active: true,
              activated_at: "2026-01-01T00:00:00Z",
              created_at: "2026-01-01T00:00:00Z",
              workflow_steps: [{ id: 10, workflow_id: 1, step_order: 1, module_name: "archive", config: {} }],
            },
          ],
          error: null,
        },
        // Interleaved: the circuit breaker's own read, then Execution
        // History's insert. Empty array keeps the circuit closed.
        workflow_executions: [{ data: [], error: null }, { data: null, error: null }],
      },
    });
    holder.client = client;

    const response = await POST(
      makeRequest({
        shop_name: "Acme",
        platform: "Shopify",
        customer_name: "Amina",
        product: "T-Shirt",
        quantity: 1,
        price: 19.99,
      })
    );

    expect(response.status).toBe(200);
    // Second .from("orders") call is the Archive module's write.
    expect(builders.orders[1].update).toHaveBeenCalledWith(
      expect.objectContaining({ archived_at: expect.any(String) })
    );
    expect(insertedRows(builders, "workflow_executions")).toContainEqual(
      expect.objectContaining({ status: "success", module_name: "archive" })
    );
  });

  it("triggers no automation for a shop with no active workflow for order.created", async () => {
    createOrUpdateShop.mockResolvedValue({ id: 7 });
    const savedOrder = { id: 101, shop_id: 7 };
    const { client, builders } = createMockSupabase({
      responses: {
        products: { data: null, error: null },
        orders: { data: savedOrder, error: null },
        workflows: { data: [], error: null },
      },
    });
    holder.client = client;

    const response = await POST(
      makeRequest({
        shop_name: "Acme",
        platform: "Shopify",
        customer_name: "Amina",
        product: "T-Shirt",
        quantity: 1,
        price: 19.99,
      })
    );

    expect(response.status).toBe(200);
    // Only the webhook's own upsert touched "orders" — no second call from
    // a module, since no workflow matched.
    expect(builders.orders).toHaveLength(1);
  });
});
