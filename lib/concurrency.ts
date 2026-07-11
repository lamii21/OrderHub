// A fixed number of items in flight at once — not a queue (nothing is
// persisted or handed to a separate worker/process, everything still
// happens inside this one function call), just bounded local concurrency.
// Originally written once, inline, inside lib/sync.ts to fix a real
// cron-timeout incident: a fully sequential loop over due shops meant
// total wall-clock time was every shop's sync time added together, which
// could run well past a serverless function's time limit under a big
// backlog. Pulled out here, unrelated to sync specifically, so any other
// bounded-fan-out loop (the automation-retry cron's resume/retry loops)
// gets the exact same fix instead of relearning the same lesson with a
// second implementation.
export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    const index = nextIndex++;
    if (index >= items.length) return;
    await worker(items[index]);
    return runNext();
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, runNext));
}
