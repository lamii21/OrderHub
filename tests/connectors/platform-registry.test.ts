import { describe, it, expect } from "vitest";
import { getConnector, SUPPORTED_PLATFORMS } from "@/lib/platforms";

describe("platform registry", () => {
  it("lists exactly the 3 supported platforms", () => {
    expect(SUPPORTED_PLATFORMS.sort()).toEqual(["Shopify", "WooCommerce", "YouCan"].sort());
  });

  it.each(SUPPORTED_PLATFORMS)("resolves a connector for %s implementing the full contract", (platform) => {
    const connector = getConnector(platform);
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.fetchProducts).toBe("function");
    expect(typeof connector.fetchOrders).toBe("function");
  });

  it("throws a descriptive error for an unregistered platform", () => {
    expect(() => getConnector("Magento")).toThrow(/No connector registered for platform "Magento"/);
  });
});
