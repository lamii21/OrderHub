export type SyncHistoryEntry = {
  id: number;
  shop_id: number;
  type: "products" | "orders";
  status: "success" | "failed";
  started_at: string;
  finished_at: string;
  duration_ms: number;
  imported_count: number | null;
  message: string | null;
};

export type SyncHistoryWithShop = SyncHistoryEntry & {
  shops: { name: string } | null;
};
