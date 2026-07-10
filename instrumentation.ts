// Next.js's own startup hook (https://nextjs.org/docs/app/guides/instrumentation)
// — runs once when the server starts, before any request is handled. The
// only thing it does today is report the environment-variable check so a
// misconfigured deployment is visible in the boot logs instead of surfacing
// as a scattered series of runtime 500s.
export async function register() {
  // instrumentation.ts also loads in the Edge runtime (proxy.ts); this
  // check matters only once, on the actual Node server, so it's skipped
  // there rather than running (and logging) it twice per boot.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvironment } = await import("@/lib/env-validation");
    validateEnvironment();
  }
}
