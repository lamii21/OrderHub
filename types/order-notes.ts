// One row per note — written by the Notes automation module
// (lib/automation-modules/notes.ts). Read-only for `authenticated` users
// today (schema.sql's order_notes RLS grants select only); no "add a note
// by hand" UI exists yet.
export type OrderNote = {
  id: number;
  order_id: number;
  content: string;
  created_at: string;
};
