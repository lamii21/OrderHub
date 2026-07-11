// Next.js's own startup hook (https://nextjs.org/docs/app/guides/instrumentation)
// — runs once when the server starts, before any request is handled. Two
// jobs today: report the environment-variable check so a misconfigured
// deployment is visible in the boot logs instead of surfacing as a
// scattered series of runtime 500s, and register an error-tracking hook if
// one's configured.
export async function register() {
  // instrumentation.ts also loads in the Edge runtime (proxy.ts); both
  // checks below only matter once, on the actual Node server, so they're
  // skipped there rather than running (and logging) twice per boot.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvironment } = await import("@/lib/env-validation");
    validateEnvironment();

    // Wires lib/logger.ts's logger.error() calls to an external error
    // tracker (Sentry, Bugsnag, whatever the deployment already pays for)
    // — deliberately not a dependency of this project itself (matching
    // lib/logger.ts's own "no new infrastructure by default" posture), so
    // nothing here runs unless a deployment opts in. To enable Sentry:
    // `npm install @sentry/nextjs`, call `Sentry.init({...})` above this
    // block, then uncomment:
    //
    //   const { setErrorReporter } = await import("@/lib/logger");
    //   const Sentry = await import("@sentry/nextjs");
    //   setErrorReporter((event, fields) => {
    //     Sentry.captureMessage(event, { level: "error", extra: fields });
    //   });
  }
}
