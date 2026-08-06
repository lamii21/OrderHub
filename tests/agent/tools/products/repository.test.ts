import { describe, it, expect, vi } from "vitest";
import { createMockSupabase } from "../../../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

import { searchProductsByName } from "@/lib/agent/tools/products/repository";

const productRow = {
  name: "Veste en jean",
  price: 350,
  stock_quantity: 12,
  product_variants: [
    { title: "Bleu / M", price: 350, stock_quantity: 3 },
    { title: "Bleu / L", price: 350, stock_quantity: 0 },
  ],
};

describe("searchProductsByName", () => {
  it("scopes by shop_id, searches name case-insensitively, and applies the given limit", async () => {
    const { client, builders } = createMockSupabase({
      responses: { products: { data: [productRow], error: null } },
    });
    holder.client = client;

    const result = await searchProductsByName(15, "veste", 5);

    expect(builders.products[0].select).toHaveBeenCalledWith(
      "name, price, stock_quantity, product_variants(title, price, stock_quantity)"
    );
    expect(builders.products[0].eq).toHaveBeenCalledWith("shop_id", 15);
    expect(builders.products[0].ilike).toHaveBeenCalledWith("name", "%veste%");
    expect(builders.products[0].limit).toHaveBeenCalledWith(5);
    expect(result).toEqual([productRow]);
  });

  it("escapes ILIKE wildcard characters in the customer's own search text", async () => {
    const { client, builders } = createMockSupabase({
      responses: { products: { data: [], error: null } },
    });
    holder.client = client;

    await searchProductsByName(15, "50% off_deal\\", 5);

    expect(builders.products[0].ilike).toHaveBeenCalledWith("name", "%50\\% off\\_deal\\\\%");
  });

  it("returns an empty array, not null, when nothing matches", async () => {
    const { client } = createMockSupabase({ responses: { products: { data: null, error: null } } });
    holder.client = client;

    await expect(searchProductsByName(15, "nonexistent", 5)).resolves.toEqual([]);
  });

  it("throws on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { products: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(searchProductsByName(15, "veste", 5)).rejects.toThrow("db down");
  });
});
