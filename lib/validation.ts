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

// Generous, not strict — this exists to catch obviously-wrong input (a
// number where a phone should be, a multi-kilobyte string pasted into an
// address field), not to enforce a real phone/address format per country.
// A single shared cap keeps that one policy in one place instead of a
// different magic number per field.
const MAX_TEXT_FIELD_LENGTH = 500;

function isValidOptionalTextField(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.length <= MAX_TEXT_FIELD_LENGTH);
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

  // Loosely checked (unlike customer_name/product above) because, unlike
  // those two, every caller of this webhook today may leave any of these
  // out entirely — the only thing being guarded against is the wrong
  // *type* or an unreasonably long value, not their absence.
  if (!isValidOptionalTextField(body.customer_phone)) {
    return `customer_phone must be a string of at most ${MAX_TEXT_FIELD_LENGTH} characters`;
  }

  if (!isValidOptionalTextField(body.customer_city)) {
    return `customer_city must be a string of at most ${MAX_TEXT_FIELD_LENGTH} characters`;
  }

  if (!isValidOptionalTextField(body.customer_address)) {
    return `customer_address must be a string of at most ${MAX_TEXT_FIELD_LENGTH} characters`;
  }

  return null;
}

// Server Actions read ids out of FormData as plain strings with no
// framework-level validation — this is the one place that turns "whatever
// the client sent" into either a real positive integer or a clear null,
// so a malformed or negative id produces a clean error message instead of
// NaN/-1 reaching Postgres unchecked. RLS is still what stops a *valid* id
// belonging to someone else; this only rejects ids that were never valid
// to begin with.
export function parsePositiveInt(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
