"use server";

import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { provisionShopSpreadsheet, appendOrderRows } from "@/lib/google-sheets";
import {
  testShopifyConnection,
  fetchAllShopifyProducts,
  fetchNewShopifyOrders,
} from "@/lib/shopify";
import { isValidEmail } from "@/lib/validation";
import { createOrUpdateShop } from "@/lib/shop";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function connectShop(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const storeUrl = String(formData.get("store_url") ?? "").trim();
  const accessToken = String(formData.get("access_token") ?? "").trim();
  const ownerEmail = String(formData.get("owner_email") ?? "").trim();

  if (!name || !storeUrl || !accessToken || !ownerEmail) {
    redirect(
      `/shops/connect?error=${encodeURIComponent(
        "Shop name, store URL, access token, and owner email are all required."
      )}`
    );
  }

  if (!isValidEmail(ownerEmail)) {
    redirect(
      `/shops/connect?error=${encodeURIComponent("Please enter a valid Google account email.")}`
    );
  }

  const userSupabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSupabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let shopId: number;

  try {
    const sheet = await provisionShopSpreadsheet(name, "Shopify", ownerEmail);
    const shop = await createOrUpdateShop({
      name,
      platform: "Shopify",
      sheetId: sheet.id,
      sheetName: sheet.name,
      userId: user.id,
      shopifyStoreUrl: storeUrl,
      shopifyAccessToken: accessToken,
    });
    shopId = shop.id;
  } catch (err) {
    console.error("Failed to create shop:", err);
    redirect(
      `/shops/connect?error=${encodeURIComponent(
        "Could not create the shop. Please check the Google integration is configured correctly and try again."
      )}`
    );
  }

  redirect(`/shops/connect?shop_id=${shopId}`);
}

// Fetching the shop's Shopify credentials stays on the service-role client
// (per the "keep service role for Shopify sync" instruction), but the
// ownership check below is what stops one logged-in user from triggering a
// sync against a shop_id that isn't theirs just by submitting a different
// number — without it, this would be exactly the IDOR the RLS policies on
// shops/orders/products exist to prevent everywhere else.
async function getShopifyCredentials(shopId: string) {
  const userSupabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSupabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: shop, error } = await supabase
    .from("shops")
    .select("id, user_id, sheet_id, shopify_store_url, shopify_access_token, shopify_last_synced_at")
    .eq("id", shopId)
    .single();

  if (
    error ||
    !shop ||
    shop.user_id !== user.id ||
    !shop.shopify_store_url ||
    !shop.shopify_access_token
  ) {
    return null;
  }

  return shop;
}

export async function testConnection(formData: FormData) {
  const shopId = String(formData.get("shop_id") ?? "");
  const shop = await getShopifyCredentials(shopId);

  if (!shop) {
    redirect(`/shops/connect?shop_id=${shopId}&error=${encodeURIComponent("Shop not found.")}`);
  }

  const ok = await testShopifyConnection(shop.shopify_store_url!, shop.shopify_access_token!);

  redirect(`/shops/connect?shop_id=${shopId}&test=${ok ? "success" : "failed"}`);
}

export async function syncProducts(formData: FormData) {
  const shopId = String(formData.get("shop_id") ?? "");
  const shop = await getShopifyCredentials(shopId);

  if (!shop) {
    redirect(`/shops/connect?shop_id=${shopId}&error=${encodeURIComponent("Shop not found.")}`);
  }

  let syncedCount: number;

  try {
    const shopifyProducts = await fetchAllShopifyProducts(
      shop.shopify_store_url!,
      shop.shopify_access_token!
    );

    const rows = shopifyProducts.map((product) => {
      const variant = product.variants?.[0];
      return {
        shop_id: Number(shopId),
        shopify_product_id: String(product.id),
        name: product.title,
        sku: variant?.sku ?? null,
        description: product.body_html ? product.body_html.replace(/<[^>]*>/g, "").trim() : null,
        price: variant?.price ? Number(variant.price) : null,
        stock_quantity: variant?.inventory_quantity ?? null,
      };
    });

    if (rows.length > 0) {
      const { error } = await supabase
        .from("products")
        .upsert(rows, { onConflict: "shopify_product_id" });

      if (error) {
        throw error;
      }
    }

    syncedCount = rows.length;
  } catch (err) {
    console.error("syncProducts failed:", err);
    redirect(
      `/shops/connect?shop_id=${shopId}&error=${encodeURIComponent(
        "Could not sync products from Shopify. Check the store URL and access token, then try again."
      )}`
    );
  }

  redirect(`/shops/connect?shop_id=${shopId}&products_synced=${syncedCount}`);
}

export async function syncOrders(formData: FormData) {
  const shopId = String(formData.get("shop_id") ?? "");
  const shop = await getShopifyCredentials(shopId);

  if (!shop) {
    redirect(`/shops/connect?shop_id=${shopId}&error=${encodeURIComponent("Shop not found.")}`);
  }

  let syncedCount: number;

  try {
    const orders = await fetchNewShopifyOrders(
      shop.shopify_store_url!,
      shop.shopify_access_token!,
      shop.shopify_last_synced_at
    );

    const rows = orders.flatMap((order) =>
      order.line_items.map((item) => [
        [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ") ||
          order.shipping_address?.name ||
          "",
        order.customer?.phone ?? order.shipping_address?.phone ?? "",
        order.shipping_address?.city ?? "",
        order.shipping_address?.address1 ?? "",
        item.title,
        item.quantity,
        item.price,
      ])
    );

    if (rows.length > 0 && shop.sheet_id) {
      await appendOrderRows(shop.sheet_id, rows);
    }

    // Cursor = the newest created_at Shopify actually returned, not
    // wall-clock "now" — using "now" could silently drop any order created
    // between the fetch and this update (it would fall after the cursor
    // without ever having been included in a fetched batch). Advance one
    // second past that newest timestamp so the next sync's created_at_min
    // (which Shopify treats as inclusive) doesn't refetch the same order.
    // If Shopify returned nothing new, the cursor is left untouched.
    const newestCreatedAt = orders.reduce<string | null>(
      (latest, order) => (!latest || order.created_at > latest ? order.created_at : latest),
      null
    );

    if (newestCreatedAt) {
      const nextCursor = new Date(new Date(newestCreatedAt).getTime() + 1000).toISOString();

      const { error } = await supabase
        .from("shops")
        .update({ shopify_last_synced_at: nextCursor })
        .eq("id", shopId);

      if (error) {
        throw error;
      }
    }

    syncedCount = rows.length;
  } catch (err) {
    console.error("syncOrders failed:", err);
    redirect(
      `/shops/connect?shop_id=${shopId}&error=${encodeURIComponent(
        "Could not sync orders to the Google Sheet. Check the store credentials and that the sheet still exists, then try again."
      )}`
    );
  }

  redirect(`/shops/connect?shop_id=${shopId}&orders_synced=${syncedCount}`);
}
