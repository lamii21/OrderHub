import { describe, it, expect, vi, beforeEach } from "vitest";

const { searchProductsForCustomer } = vi.hoisted(() => ({ searchProductsForCustomer: vi.fn() }));

vi.mock("@/lib/agent/tools/products/service", () => ({ searchProductsForCustomer }));

import { searchProductsTool } from "@/lib/agent/tools/products/tool";

const context = { shop_id: 15, conversation_id: 1, customer_id: null };

beforeEach(() => {
  searchProductsForCustomer.mockReset();
});

describe("searchProductsTool", () => {
  it("declares a name and a required query parameter", () => {
    expect(searchProductsTool.name).toBe("search_products");
    expect(searchProductsTool.parameters).toMatchObject({
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    });
  });

  it("passes shop_id from context and the trimmed query to the service", async () => {
    searchProductsForCustomer.mockResolvedValue([]);

    await searchProductsTool.execute({ query: "  veste en jean  " }, context);

    expect(searchProductsForCustomer).toHaveBeenCalledWith(15, "veste en jean");
  });

  it("never requires customer_id — works the same whether or not a customer is identified", async () => {
    searchProductsForCustomer.mockResolvedValue([]);

    await searchProductsTool.execute({ query: "veste" }, { ...context, customer_id: 42 });

    expect(searchProductsForCustomer).toHaveBeenCalledWith(15, "veste");
  });

  it("returns an empty result without calling the service when the query is empty or whitespace-only", async () => {
    const result = await searchProductsTool.execute({ query: "   " }, context);

    expect(result).toEqual({ products: [], reason: "empty_query" });
    expect(searchProductsForCustomer).not.toHaveBeenCalled();
  });

  it("returns an empty result without calling the service when query isn't a string at all", async () => {
    const result = await searchProductsTool.execute({}, context);

    expect(result).toEqual({ products: [], reason: "empty_query" });
    expect(searchProductsForCustomer).not.toHaveBeenCalled();
  });

  it("wraps the service's results under a products key", async () => {
    const products = [{ name: "Veste en jean", price: 350, availability: "in_stock" as const, variants: [] }];
    searchProductsForCustomer.mockResolvedValue(products);

    const result = await searchProductsTool.execute({ query: "veste" }, context);

    expect(result).toEqual({ products });
  });
});
