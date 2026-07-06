// Deliberately loose — this only needs to catch obviously-malformed input
// from a non-browser client bypassing the form's type="email" check, not
// fully validate RFC 5322 email addresses.
export function isValidEmail(value: string): boolean {
  return /^\S+@\S+\.\S+$/.test(value);
}

// Single source of truth for the 6 valid order statuses. Used by the
// dashboard's status dropdown/server action AND by the webhook's payload
// validation below, so the database's CHECK constraint (supabase/schema.sql)
// is the only other place this list has to be kept in sync by hand.
export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isValidOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

// Validates the fields POST /api/orders actually needs to safely insert a
// row. No validation library — plain typeof/Number checks are enough for
// this shape. Returns null when valid, or a human-readable reason when not.
export function validateOrderPayload(body: Record<string, unknown>): string | null {
  if (typeof body.customer_name !== "string") {
    return "customer_name must be a string";
  }

  if (typeof body.product !== "string") {
    return "product must be a string";
  }

  if (typeof body.quantity !== "number" || !Number.isFinite(body.quantity) || body.quantity <= 0) {
    return "quantity must be a positive number";
  }

  if (typeof body.price !== "number" || !Number.isFinite(body.price)) {
    return "price must be a valid number";
  }

  if (body.status !== undefined && body.status !== null && !isValidOrderStatus(body.status)) {
    return `status must be one of: ${ORDER_STATUSES.join(", ")}`;
  }

  return null;
}
