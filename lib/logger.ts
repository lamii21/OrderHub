// A structured logging wrapper around console.* — every hosting target this
// project realistically runs on (Vercel, any container platform) already
// captures stdout/stderr as logs, so this is deliberately not a new logging
// service/dependency, just a consistent shape on top of what already works.
// Existing console.error() call sites throughout the app are untouched:
// this is additive, for new and audit-worthy paths, not a wholesale
// migration (that would be a large, low-value diff across ~70 call sites
// for a project this size).
//
// One line per log entry, JSON-encoded, so it stays greppable/parseable by
// whatever the deployment target's log aggregation already does — no new
// infrastructure to stand up.
type LogLevel = "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

// Lets a production deployment wire up Sentry/Bugsnag/whatever it already
// pays for — in one place, at startup (instrumentation.ts is the natural
// call site) — without this project taking on that dependency itself, same
// "no new infrastructure by default" posture as the rest of this file.
// Every logger.error() call below invokes it, if one's been registered;
// with none registered (the default, and every environment this project
// ships to today), this is a no-op and behavior is byte-for-byte the same
// as before this hook existed. Deliberately not wired to logger.warn() —
// warnings are expected, routine conditions (a rate limit, a stale cache
// entry); forwarding every one of those to an error tracker would just be
// noise a real integration would immediately have to filter back out.
type ErrorReporter = (event: string, fields?: LogFields) => void;

let errorReporter: ErrorReporter | null = null;

export function setErrorReporter(reporter: ErrorReporter | null) {
  errorReporter = reporter;
}

function write(level: LogLevel, event: string, fields?: LogFields) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  };

  const line = JSON.stringify(entry);

  if (level === "error") {
    console.error(line);
    try {
      errorReporter?.(event, fields);
    } catch (err) {
      // A broken error reporter must never take down the code path it was
      // observing — same "logging is best-effort, never load-bearing"
      // rule this whole file already follows.
      console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "error", event: "logger.error_reporter_failed", cause: String(err) }));
    }
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info(event: string, fields?: LogFields) {
    write("info", event, fields);
  },
  warn(event: string, fields?: LogFields) {
    write("warn", event, fields);
  },
  error(event: string, fields?: LogFields) {
    write("error", event, fields);
  },
  // A regular info-level log with audit: true — deliberately not a
  // separate table/pipeline. Filtering deployment logs on
  // `"audit":true` is enough to reconstruct "who did what, when" for the
  // security-sensitive actions that call this (shop deletion, credential
  // changes, workflow activation, login) without a new schema or a second
  // place writes can fail independently of the action they're auditing.
  audit(event: string, fields?: LogFields) {
    write("info", event, { ...fields, audit: true });
  },
};
