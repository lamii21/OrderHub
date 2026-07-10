import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { matchesAnySecret, requireEnv } from "@/lib/env";
import { validateOrderPayload } from "@/lib/validation";
import { createOrUpdateShop } from "@/lib/shop";
import { handleEvent } from "@/lib/workflows/dispatch";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import type { Order } from "@/types/order";

// API_SECRET_PREVIOUS is optional and only checked if set — lets this
// secret be rotated without an instant cutover. See matchesAnySecret().
function isValidApiKey(provided: string | null): boolean {
  requireEnv("API_SECRET"); // fail fast if the primary secret isn't configured at all
  return matchesAnySecret(provided, "API_SECRET", "API_SECRET_PREVIOUS");
}

// The one API_SECRET is shared by every Apps Script deployment calling
// this endpoint (see the audit that flagged this — a per-shop secret would
// need a bigger provisioning change), so rate limiting keys on the caller's
// IP rather than the secret itself: a single misbehaving/compromised
// caller shouldn't be able to exhaust the limit for every legitimate one.
function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function POST(request: NextRequest) {
  const rateLimit = checkRateLimit(`orders:${clientIp(request)}`, { max: 120, windowMs: 60_000 });
  if (!rateLimit.allowed) {
    logger.warn("webhook.rate_limited", { ip: clientIp(request) });
    return NextResponse.json(
      { success: false, error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rateLimit.retryAfterMs ?? 1000) / 1000)) } }
    );
  }

  if (!isValidApiKey(request.headers.get("x-api-key"))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const validationError = validateOrderPayload(body);
  if (validationError) {
    return NextResponse.json({ success: false, error: validationError }, { status: 400 });
  }

  let shop: { id: number };
  try {
    shop = await createOrUpdateShop({
      name: String(body.shop_name ?? ""),
      platform: String(body.platform ?? ""),
      sheetId: (body.sheet_id as string | undefined) ?? null,
      sheetName: (body.sheet_name as string | undefined) ?? null,
    });
  } catch (err) {
    console.error("Webhook: failed to upsert shop:", err);
    return NextResponse.json(
      { success: false, error: "Could not save the order." },
      { status: 500 }
    );
  }

  // Resolves this order's product_id once, at write time, so its stats stay
  // linked to the correct product row even if that product is renamed
  // later — see the product_id column comment in schema.sql. Best-effort:
  // no match (the product doesn't exist as a row, e.g. a Sheets-only shop)
  // just leaves product_id null, same as before this lookup existed.
  const { data: matchedProduct } = await supabase
    .from("products")
    .select("id")
    .eq("shop_id", shop.id)
    .eq("name", body.product)
    .maybeSingle();

  // status is only included when the caller explicitly provided one. Left
  // out, it defaults to 'pending' on first insert but is never touched on a
  // later duplicate delivery — so a status a merchant has since changed by
  // hand on the dashboard can't be silently reset by a resend.
  const orderRow: Record<string, unknown> = {
    shop_id: shop.id,
    order_id: body.order_id ?? null,
    customer_name: body.customer_name,
    customer_phone: body.customer_phone ?? null,
    customer_city: body.customer_city ?? null,
    customer_address: body.customer_address ?? null,
    product: body.product,
    product_id: matchedProduct?.id ?? null,
    quantity: body.quantity,
    price: body.price,
  };

  if (body.status !== undefined && body.status !== null) {
    orderRow.status = body.status;
  }

  // Determines insert-vs-update ATOMICALLY, from the upsert's own outcome
  // — not from a separate SELECT beforehand. The previous version checked
  // "does a row with this (shop_id, order_id) already exist?" before
  // upserting; two near-simultaneous deliveries of the same brand-new
  // order could both see "no existing row" in that check (neither had
  // committed yet) and both go on to fire order.created, dispatching
  // automation twice for what should be one order.
  //
  // ignoreDuplicates: true makes Postgres run this as
  // "INSERT ... ON CONFLICT (shop_id, order_id) DO NOTHING". A row is only
  // ever returned here for the request whose INSERT actually won — under
  // Postgres's own unique-index locking, concurrent inserts on the same
  // key serialize, so exactly one of two simultaneous requests for the
  // same new order gets a row back and the other gets none, no matter how
  // close together they land. order_id is optional: rows without one
  // (today's Google Sheets flow never sends one) never conflict with each
  // other at all — the unique index treats every NULL order_id as
  // distinct — so this always "wins" for them, preserving the existing
  // "rows without an order_id always insert" behavior with no separate
  // branch needed for it.
  const { data: insertedOrder } = await supabase
    .from("orders")
    .upsert(orderRow, { onConflict: "shop_id,order_id", ignoreDuplicates: true })
    .select("*, shops(name, platform)")
    .maybeSingle();

  let savedOrder = insertedOrder;
  const isNewOrder = !!insertedOrder;

  if (!savedOrder) {
    // No row came back: either this is a genuine duplicate delivery of an
    // order that already existed before this request started, or this
    // request lost the race above. Either way there's now an existing row,
    // and — same contract as before — its data should still be refreshed
    // (status excluded) rather than silently left stale.
    const { data: updatedOrder, error } = await supabase
      .from("orders")
      .upsert(orderRow, { onConflict: "shop_id,order_id" })
      .select("*, shops(name, platform)")
      .single();

    if (error || !updatedOrder) {
      console.error("Webhook: failed to save order:", error);
      return NextResponse.json(
        { success: false, error: "Could not save the order." },
        { status: 500 }
      );
    }

    savedOrder = updatedOrder;
  }

  // Fires after the order is already committed — automation is a
  // downstream effect of the order existing, never a precondition for
  // saving it. Wrapped so a Workflow Engine failure can never turn into a
  // failed webhook response (see dispatch.handleEvent()'s own comment).
  if (isNewOrder) {
    try {
      await handleEvent(shop.id, "order.created", savedOrder as Order);
    } catch (err) {
      console.error("Webhook: order.created dispatch failed:", err);
    }
  }

  return NextResponse.json({ success: true });
}
