import { supabase } from "@/lib/supabase";
import { renderTemplate } from "./template";
import type { AutomationModule } from "./types";

type NotesConfig = { content: string };

// Attaches a human-readable internal note — a dedicated order_notes table,
// not a reuse of workflow_executions.message: a note is meant for a person
// to read on the order's detail page, not a technical execution log.
export const notesModule: AutomationModule = {
  validateConfig(config) {
    const { content } = config as Partial<NotesConfig>;

    if (typeof content !== "string" || content.trim() === "") {
      return "Notes requires non-empty content.";
    }

    return null;
  },

  async run(order, config) {
    const { content } = config as NotesConfig;

    const { data, error } = await supabase
      .from("order_notes")
      .insert({ order_id: order.id, content: renderTemplate(content, order) })
      .select("id")
      .single();

    if (error || !data) {
      console.error("notesModule: failed to insert note:", error);
      return { success: false, message: "Could not save the note." };
    }

    return { success: true, message: "Note added.", data: { noteId: data.id } };
  },
};
