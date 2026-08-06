import { describe, it, expect, vi, beforeEach } from "vitest";

const { searchProductsByName } = vi.hoisted(() => ({ searchProductsByName: vi.fn() }));

vi.mock("@/lib/agent/tools/products/repository", () => ({ searchProductsByName }));

import { searchProductsForCustomer, DEFAULT_SEARCH_RESULT_LIMIT } from "@/lib/agent/tools/products/service";

beforeEach(() => {
  searchProductsByName.mockReset();
});

describe("searchProductsForCustomer", () => {
  it("passes the default result limit down to the repository", async () => {
    searchProductsByName.mockResolvedValue([]);
    await searchProductsForCustomer(15, "veste");
    expect(searchProductsByName).toHaveBeenCalledWith(15, "veste", DEFAULT_SEARCH_RESULT_LIMIT);
  });

  it("buckets stock into in_stock/low_stock/out_of_stock/unknown, never the raw number", async () => {
    searchProductsByName.mockResolvedValue([
      { name: "Plenty in stock", price: 100, stock_quantity: 50, product_variants: [] },
      { name: "Almost gone", price: 100, stock_quantity: 3, product_variants: [] },
      { name: "Gone", price: 100, stock_quantity: 0, product_variants: [] },
      { name: "Not tracked", price: 100, stock_quantity: null, product_variants: [] },
    ]);

    const result = await searchProductsForCustomer(15, "x");

    expect(result.map((p) => p.availability)).toEqual(["in_stock", "low_stock", "out_of_stock", "unknown"]);
    expect(result.every((p) => !("stock_quantity" in p))).toBe(true);
  });

  it("maps each variant with its own availability bucket, independent of the parent product's stock", async () => {
    searchProductsByName.mockResolvedValue([
      {
        name: "Veste en jean",
        price: 350,
        stock_quantity: 12,
        product_variants: [
          { title: "Bleu / M", price: 350, stock_quantity: 3 },
          { title: "Bleu / L", price: 350, stock_quantity: 0 },
        ],
      },
    ]);

    const [product] = await searchProductsForCustomer(15, "veste");

    expect(product.variants).toEqual([
      { title: "Bleu / M", price: 350, availability: "low_stock" },
      { title: "Bleu / L", price: 350, availability: "out_of_stock" },
    ]);
  });

  it("returns an empty variants array for a product with none", async () => {
    searchProductsByName.mockResolvedValue([
      { name: "Solo product", price: 100, stock_quantity: 10, product_variants: [] },
    ]);

    const [product] = await searchProductsForCustomer(15, "solo");
    expect(product.variants).toEqual([]);
  });
});
