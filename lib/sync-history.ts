import { supabase } from "@/lib/supabase";

type RecordSyncHistoryInput = {
  shopId: number;
  type: "products" | "orders";
  startedAt: Date;
  status: "success" | "failed";
  importedCount?: number;
  message?: string;
};

// Called from app/shops/connect/actions.ts right before it redirects, on
// both the success and failure path. Uses the service-role client — the
// same one the sync actions already use for everything else — since users
// only ever read this table (see the RLS policy in schema.sql), never write
// it. `message` must already be a user-safe string by the time it gets here;
// this function doesn't sanitize it, the caller does (never pass a raw
// caught error or its stack trace).
export async function recordSyncHistory(input: RecordSyncHistoryInput) {
  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - input.startedAt.getTime();

  const { error } = await supabase.from("sync_history").insert({
    shop_id: input.shopId,
    type: input.type,
    status: input.status,
    started_at: input.startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: durationMs,
    imported_count: input.importedCount ?? null,
    message: input.message ?? null,
  });

  if (error) {
    console.error("Failed to record sync history:", error);
  }
}
