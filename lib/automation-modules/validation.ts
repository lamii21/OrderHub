import { checkUrlSafetySync } from "@/lib/net-guard";

// Small, composable validators any module's validateConfig() can build on
// — extracted from patterns already duplicated ad hoc across modules
// (webhook.ts's "must be a non-empty string" checks, delivery.ts's "must
// be one of these known carriers" check, webhook.ts's own URL safety
// check), so a new module doesn't have to reinvent any of them. None of
// the 16 existing modules are refactored to use these by this change —
// each keeps its own inline checks; this is the shared version available
// for modules to adopt going forward. Every function returns a
// human-readable error message, or null when the value is valid — the
// same "string | null" contract as AutomationModule.validateConfig()
// itself, so these compose directly into a module's own validateConfig
// body without any adapting.

export function requireNonEmptyString(value: unknown, fieldLabel: string): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    return `${fieldLabel} is required and must be a non-empty string.`;
  }

  return null;
}

export function requireOneOf(
  value: unknown,
  allowed: readonly string[],
  fieldLabel: string
): string | null {
  if (typeof value !== "string" || !allowed.includes(value)) {
    return `${fieldLabel} must be one of: ${allowed.join(", ")}.`;
  }

  return null;
}

// Reuses lib/net-guard.ts's SSRF check rather than a fourth ad hoc
// reimplementation of "is this a safe URL" — see that file's own
// reasoning. Only the synchronous subset (protocol + a literal private
// IP) runs here, matching validateConfig()'s synchronous contract; a
// hostname that merely resolves to a private address still needs the
// async checkUrlSafetySync-adjacent check at the point a module actually
// makes the request (see webhook.ts's run() for that pattern).
export function requireValidUrl(value: unknown, fieldLabel: string): string | null {
  if (typeof value !== "string") {
    return `${fieldLabel} must be a valid http(s) URL.`;
  }

  const unsafeReason = checkUrlSafetySync(value);
  if (unsafeReason) {
    return `${fieldLabel} is not allowed: ${unsafeReason}`;
  }

  return null;
}

// Generous, not strict — same "catch obviously wrong input, not enforce a
// precise limit" spirit as every other size cap in this app
// (lib/validation.ts's MAX_TEXT_FIELD_LENGTH, the Workflow Builder's own
// step-config size cap in app/shops/[id]/workflows/[workflowId]/actions.ts).
// That Server Action already caps the whole config blob before it's ever
// parsed; this is for a module that wants a tighter limit on one specific
// field within its own config.
export function requireWithinLength(value: string, maxLength: number, fieldLabel: string): string | null {
  if (value.length > maxLength) {
    return `${fieldLabel} is too long (max ${maxLength.toLocaleString()} characters).`;
  }

  return null;
}
