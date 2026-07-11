import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "../mocks/supabase";
import { __resetRateLimitState } from "@/lib/rate-limit";

const { resumeWorkflow, getDueWorkflowWaits, claimWorkflowWait, retryWorkflowExecutions, getBackoffEligiblePairs } =
  vi.hoisted(() => ({
    resumeWorkflow: vi.fn(),
    getDueWorkflowWaits: vi.fn(),
    claimWorkflowWait: vi.fn(),
    retryWorkflowExecutions: vi.fn(),
    getBackoffEligiblePairs: vi.fn(),
  }));
const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));
vi.mock("@/lib/workflows/engine", () => ({ resumeWorkflow }));
vi.mock("@/lib/workflows/resume", () => ({ getDueWorkflowWaits, claimWorkflowWait }));
vi.mock("@/lib/workflows/retry", () => ({ retryWorkflowExecutions, getBackoffEligiblePairs }));

import { GET } from "@/app/api/cron/automation-retry/route";

function makeRequest(authHeader: string | null, ip = "203.0.113.2") {
  return new NextRequest("http://localhost/api/cron/automation-retry", {
    headers: {
      "x-forwarded-for": ip,
      ...(authHeader !== null && { authorization: authHeader }),
    },
  });
}

beforeEach(() => {
  resumeWorkflow.mockReset().mockResolvedValue(undefined);
  getDueWorkflowWaits.mockReset().mockResolvedValue([]);
  claimWorkflowWait.mockReset().mockResolvedValue(true);
  retryWorkflowExecutions.mockReset().mockResolvedValue(0);
  getBackoffEligiblePairs.mockReset().mockResolvedValue({ pairs: [], skipStepOrdersByPair: new Map() });
  __resetRateLimitState();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("GET /api/cron/automation-retry — authentication", () => {
  it("rejects a request with no Authorization header", async () => {
    const response = await GET(makeRequest(null));
    expect(response.status).toBe(401);
  });

  it("rejects the wrong bearer token", async () => {
    const response = await GET(makeRequest("Bearer wrong-secret"));
    expect(response.status).toBe(401);
  });

  it("accepts the correct bearer token", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    const response = await GET(makeRequest("Bearer test-cron-secret"));
    expect(response.status).toBe(200);
  });
});

describe("GET /api/cron/automation-retry — rate limiting", () => {
  it("returns 429 with Retry-After once a caller exceeds the limit, before the secret is even checked", async () => {
    const ip = "198.51.100.40";
    let lastResponse;
    for (let i = 0; i < 11; i++) {
      lastResponse = await GET(makeRequest("Bearer wrong-secret", ip));
    }

    expect(lastResponse!.status).toBe(429);
    expect(lastResponse!.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("GET /api/cron/automation-retry — resuming waiting workflows", () => {
  it("loads the workflow and order for a due wait, claims it, and resumes from its resume point with its saved context", async () => {
    const wait = {
      id: 7,
      workflow_id: 1,
      order_id: 100,
      resume_step_id: 2,
      context: { delay: { durationMs: 1000 } },
      resume_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      consumed_at: null,
    };
    getDueWorkflowWaits.mockResolvedValue([wait]);
    const { client } = createMockSupabase({
      responses: {
        workflows: {
          data: [
            {
              id: 1,
              name: "A",
              workflow_steps: [{ id: 2, workflow_id: 1, step_order: 2, module_name: "archive", config: {} }],
            },
          ],
          error: null,
        },
        orders: { data: [{ id: 100 }], error: null },
      },
    });
    holder.client = client;

    const response = await GET(makeRequest("Bearer test-cron-secret"));
    const json = await response.json();

    expect(claimWorkflowWait).toHaveBeenCalledWith(7);
    expect(resumeWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ id: 100 }),
      2,
      { delay: { durationMs: 1000 } }
    );
    expect(json.waits).toEqual({ due: 1, resumed: 1 });
  });

  it("reports 0 resumed (without claiming anything) when loading workflows/orders fails", async () => {
    getDueWorkflowWaits.mockResolvedValue([
      {
        id: 7,
        workflow_id: 1,
        order_id: 100,
        resume_step_id: 2,
        context: {},
        resume_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        consumed_at: null,
      },
    ]);
    const { client } = createMockSupabase({
      responses: { workflows: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    const response = await GET(makeRequest("Bearer test-cron-secret"));
    const json = await response.json();

    expect(claimWorkflowWait).not.toHaveBeenCalled();
    expect(json.waits).toEqual({ due: 1, resumed: 0 });
  });

  it("does not resume when the claim fails (already consumed by a racing invocation)", async () => {
    getDueWorkflowWaits.mockResolvedValue([
      {
        id: 7,
        workflow_id: 1,
        order_id: 100,
        resume_step_id: 2,
        context: {},
        resume_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        consumed_at: null,
      },
    ]);
    claimWorkflowWait.mockResolvedValue(false);
    const { client } = createMockSupabase({
      responses: {
        workflows: {
          data: [
            {
              id: 1,
              name: "A",
              workflow_steps: [{ id: 2, workflow_id: 1, step_order: 2, module_name: "archive", config: {} }],
            },
          ],
          error: null,
        },
        orders: { data: [{ id: 100 }], error: null },
      },
    });
    holder.client = client;

    const response = await GET(makeRequest("Bearer test-cron-secret"));
    const json = await response.json();

    expect(resumeWorkflow).not.toHaveBeenCalled();
    expect(json.waits).toEqual({ due: 1, resumed: 0 });
  });

  it("skips a wait whose workflow no longer exists, without claiming it", async () => {
    getDueWorkflowWaits.mockResolvedValue([
      {
        id: 7,
        workflow_id: 1,
        order_id: 100,
        resume_step_id: 2,
        context: {},
        resume_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        consumed_at: null,
      },
    ]);
    const { client } = createMockSupabase({
      responses: {
        workflows: { data: [], error: null }, // deleted since the wait was created
        orders: { data: [{ id: 100 }], error: null },
      },
    });
    holder.client = client;

    await GET(makeRequest("Bearer test-cron-secret"));

    expect(claimWorkflowWait).not.toHaveBeenCalled();
    expect(resumeWorkflow).not.toHaveBeenCalled();
  });

  // Regression test for the step-identity fix: a wait's target step is
  // looked up by its stable id, not by trusting a step_order snapshot —
  // moveWorkflowStepUp/Down and removeWorkflowStep's renumbering can both
  // reassign step_order while a wait is pending. Here the workflow was
  // edited so much that resume_step_id no longer matches any current step
  // at all (as if that exact step were deleted).
  it("claims but does not resume a wait whose target step no longer exists in the workflow (edited while pending)", async () => {
    getDueWorkflowWaits.mockResolvedValue([
      {
        id: 7,
        workflow_id: 1,
        order_id: 100,
        resume_step_id: 999, // no longer present in workflow_steps below
        context: {},
        resume_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        consumed_at: null,
      },
    ]);
    const { client } = createMockSupabase({
      responses: {
        workflows: {
          data: [
            {
              id: 1,
              name: "A",
              workflow_steps: [{ id: 2, workflow_id: 1, step_order: 1, module_name: "archive", config: {} }],
            },
          ],
          error: null,
        },
        orders: { data: [{ id: 100 }], error: null },
      },
    });
    holder.client = client;

    const response = await GET(makeRequest("Bearer test-cron-secret"));
    const json = await response.json();

    // Still claimed (handled once, never resurfaces), but never resumed.
    expect(claimWorkflowWait).toHaveBeenCalledWith(7);
    expect(resumeWorkflow).not.toHaveBeenCalled();
    expect(json.waits).toEqual({ due: 1, resumed: 0 });
  });

  it("does not let one failing resume stop the others", async () => {
    getDueWorkflowWaits.mockResolvedValue([
      {
        id: 7,
        workflow_id: 1,
        order_id: 100,
        resume_step_id: 2,
        context: {},
        resume_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        consumed_at: null,
      },
      {
        id: 8,
        workflow_id: 2,
        order_id: 200,
        resume_step_id: 3,
        context: {},
        resume_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        consumed_at: null,
      },
    ]);
    resumeWorkflow.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(undefined);
    const { client } = createMockSupabase({
      responses: {
        workflows: {
          data: [
            {
              id: 1,
              name: "A",
              workflow_steps: [{ id: 2, workflow_id: 1, step_order: 1, module_name: "archive", config: {} }],
            },
            {
              id: 2,
              name: "B",
              workflow_steps: [{ id: 3, workflow_id: 2, step_order: 1, module_name: "archive", config: {} }],
            },
          ],
          error: null,
        },
        orders: { data: [{ id: 100 }, { id: 200 }], error: null },
      },
    });
    holder.client = client;

    const response = await GET(makeRequest("Bearer test-cron-secret"));
    const json = await response.json();

    expect(resumeWorkflow).toHaveBeenCalledTimes(2);
    expect(json.waits).toEqual({ due: 2, resumed: 1 });
  });
});

describe("GET /api/cron/automation-retry — retrying failed executions", () => {
  it("retries the backoff-eligible pairs and reports the counts", async () => {
    getBackoffEligiblePairs.mockResolvedValue({
      pairs: [{ workflow_id: 1, order_id: 100 }],
      skipStepOrdersByPair: new Map([["1:100", new Set([2])]]),
    });
    retryWorkflowExecutions.mockResolvedValue(1);
    const { client } = createMockSupabase();
    holder.client = client;

    const response = await GET(makeRequest("Bearer test-cron-secret"));
    const json = await response.json();

    expect(retryWorkflowExecutions).toHaveBeenCalledWith(
      client,
      [{ workflow_id: 1, order_id: 100 }],
      new Map([["1:100", new Set([2])]])
    );
    expect(json.retries).toEqual({ eligible: 1, retried: 1 });
  });
});
