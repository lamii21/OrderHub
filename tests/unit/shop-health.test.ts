import { describe, it, expect } from "vitest";
import { computeShopHealth } from "@/lib/shop-health";

describe("computeShopHealth", () => {
  it("is disconnected when there is no store_url", () => {
    expect(computeShopHealth({ store_url: null, last_sync_status: null })).toBe("disconnected");
  });

  it("needs attention when connected but the last sync failed", () => {
    expect(
      computeShopHealth({ store_url: "https://shop.myshopify.com", last_sync_status: "failed" })
    ).toBe("needs_attention");
  });

  it("is connected when the last sync succeeded", () => {
    expect(
      computeShopHealth({ store_url: "https://shop.myshopify.com", last_sync_status: "success" })
    ).toBe("connected");
  });

  it("is connected when connected but never synced", () => {
    expect(
      computeShopHealth({ store_url: "https://shop.myshopify.com", last_sync_status: null })
    ).toBe("connected");
  });
});
