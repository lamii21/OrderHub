import { describe, it, expect } from "vitest";
import {
  computeDatabaseHealth,
  computeGoogleSheetsHealth,
  computeCronHealth,
  computePlatformConnectorsHealth,
  computeWorkflowHealth,
} from "@/lib/system-health";

describe("computeDatabaseHealth", () => {
  it("is always healthy (reaching this code already proves the database answered)", () => {
    expect(computeDatabaseHealth()).toBe("healthy");
  });
});

describe("computeGoogleSheetsHealth", () => {
  it("is healthy with no recent syncs", () => {
    expect(computeGoogleSheetsHealth([])).toBe("healthy");
  });

  it("is healthy when every recent sync succeeded", () => {
    expect(
      computeGoogleSheetsHealth([{ status: "success" }, { status: "success" }])
    ).toBe("healthy");
  });

  it("is a warning when some but not all recent syncs failed", () => {
    expect(
      computeGoogleSheetsHealth([{ status: "success" }, { status: "failed" }])
    ).toBe("warning");
  });

  it("is offline when every recent sync failed", () => {
    expect(
      computeGoogleSheetsHealth([{ status: "failed" }, { status: "failed" }])
    ).toBe("offline");
  });
});

describe("computeWorkflowHealth", () => {
  it("is healthy with no recent executions", () => {
    expect(computeWorkflowHealth([])).toBe("healthy");
  });

  it("is a warning when some recent executions failed", () => {
    expect(
      computeWorkflowHealth([{ status: "success" }, { status: "failed" }, { status: "success" }])
    ).toBe("warning");
  });

  it("is offline when every recent execution failed", () => {
    expect(computeWorkflowHealth([{ status: "failed" }, { status: "failed" }])).toBe("offline");
  });

  it("is healthy when every recent execution succeeded", () => {
    expect(computeWorkflowHealth([{ status: "success" }, { status: "success" }])).toBe("healthy");
  });
});

describe("computePlatformConnectorsHealth", () => {
  it("is healthy with no connected shops", () => {
    expect(computePlatformConnectorsHealth([])).toBe("healthy");
  });

  it("ignores disconnected shops entirely", () => {
    expect(
      computePlatformConnectorsHealth([{ store_url: null, last_sync_status: "failed" }])
    ).toBe("healthy");
  });

  it("is offline when every connected shop's last sync failed", () => {
    expect(
      computePlatformConnectorsHealth([
        { store_url: "https://a.myshopify.com", last_sync_status: "failed" },
        { store_url: "https://b.myshopify.com", last_sync_status: "failed" },
      ])
    ).toBe("offline");
  });

  it("is a warning when only some connected shops are failing", () => {
    expect(
      computePlatformConnectorsHealth([
        { store_url: "https://a.myshopify.com", last_sync_status: "failed" },
        { store_url: "https://b.myshopify.com", last_sync_status: "success" },
      ])
    ).toBe("warning");
  });

  it("is healthy when every connected shop's last sync succeeded", () => {
    expect(
      computePlatformConnectorsHealth([
        { store_url: "https://a.myshopify.com", last_sync_status: "success" },
        { store_url: "https://b.myshopify.com", last_sync_status: "success" },
      ])
    ).toBe("healthy");
  });
});

describe("computeCronHealth", () => {
  it("is healthy when no shop is eligible for automatic sync", () => {
    expect(computeCronHealth([{ store_url: null, auto_sync_enabled: true, nextSyncAt: null }])).toBe(
      "healthy"
    );
  });

  it("treats an eligible shop with no computed nextSyncAt as not overdue", () => {
    expect(
      computeCronHealth([
        { store_url: "https://a.myshopify.com", auto_sync_enabled: true, nextSyncAt: null },
      ])
    ).toBe("healthy");
  });

  it("is healthy when nothing is overdue", () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    expect(
      computeCronHealth([
        { store_url: "https://a.myshopify.com", auto_sync_enabled: true, nextSyncAt: future },
      ])
    ).toBe("healthy");
  });

  it("is a warning when a shop is overdue by more than 2 hours", () => {
    const overdue = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(
      computeCronHealth([
        { store_url: "https://a.myshopify.com", auto_sync_enabled: true, nextSyncAt: overdue },
      ])
    ).toBe("warning");
  });

  it("is offline when a shop is overdue by more than 24 hours", () => {
    const overdue = new Date(Date.now() - 25 * 60 * 60 * 1000);
    expect(
      computeCronHealth([
        { store_url: "https://a.myshopify.com", auto_sync_enabled: true, nextSyncAt: overdue },
      ])
    ).toBe("offline");
  });

  it("ignores shops with auto-sync disabled", () => {
    const overdue = new Date(Date.now() - 25 * 60 * 60 * 1000);
    expect(
      computeCronHealth([
        { store_url: "https://a.myshopify.com", auto_sync_enabled: false, nextSyncAt: overdue },
      ])
    ).toBe("healthy");
  });
});
