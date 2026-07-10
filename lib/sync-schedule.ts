// Single source of truth for the 4 selectable sync cadences — reused by the
// <select> on /shops/[id], by the cron endpoint's due-check, and by the
// "Next Sync" display on /shops and /shops/[id]. Keeping it to one list
// means the UI can never offer a frequency the cron doesn't know how to
// schedule, and the displayed "Next Sync" time can never disagree with what
// the cron actually decides.
export const SYNC_FREQUENCIES = [
  { value: "hourly", label: "Every hour", hours: 1 },
  { value: "every_6h", label: "Every 6 hours", hours: 6 },
  { value: "every_12h", label: "Every 12 hours", hours: 12 },
  { value: "daily", label: "Every day", hours: 24 },
] as const;

export type SyncFrequency = (typeof SYNC_FREQUENCIES)[number]["value"];

export function isValidSyncFrequency(value: string): value is SyncFrequency {
  return SYNC_FREQUENCIES.some((f) => f.value === value);
}

function hoursFor(frequency: string): number {
  return SYNC_FREQUENCIES.find((f) => f.value === frequency)?.hours ?? 24;
}

type SyncScheduleShop = {
  sync_frequency: string;
  last_sync_attempt_at: string | null;
};

// null means "never attempted" — treated as due immediately rather than as
// a far-future date, so a newly connected shop gets its first automatic
// sync on the very next cron run instead of waiting a full cycle.
export function computeNextSyncAt(shop: SyncScheduleShop): Date | null {
  if (!shop.last_sync_attempt_at) return null;
  const hours = hoursFor(shop.sync_frequency);
  return new Date(new Date(shop.last_sync_attempt_at).getTime() + hours * 60 * 60 * 1000);
}

export function isSyncDue(shop: SyncScheduleShop): boolean {
  const nextSyncAt = computeNextSyncAt(shop);
  return !nextSyncAt || nextSyncAt.getTime() <= Date.now();
}
