export type OrderHistoryEntry = {
  id: number;
  order_id: number;
  previous_status: string | null;
  new_status: string;
  changed_by: string | null;
  created_at: string;
};
