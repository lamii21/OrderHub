import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireEnv } from "@/lib/env";
import { validateOrderPayload } from "@/lib/validation";
import { createOrUpdateShop } from "@/lib/shop";

// Read lazily (not at module scope) so a missing API_SECRET only breaks this
// route when it's actually hit, not the whole app's build/startup.
function isValidApiKey(provided: string | null): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(requireEnv("API_SECRET"));
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
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

  // shop_id + order_id is unique per shop (supabase/schema.sql), so this
  // upsert is what makes receiving the same order twice safe: the second
  // delivery updates the existing row instead of inserting a duplicate.
  // order_id is optional — rows without one (today's Google Sheets flow
  // never sends one) always insert, same as before this change.
  //
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
    quantity: body.quantity,
    price: body.price,
  };

  if (body.status !== undefined && body.status !== null) {
    orderRow.status = body.status;
  }

  const { error } = await supabase
    .from("orders")
    .upsert(orderRow, { onConflict: "shop_id,order_id" });

  if (error) {
    console.error("Webhook: failed to save order:", error);
    return NextResponse.json(
      { success: false, error: "Could not save the order." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
