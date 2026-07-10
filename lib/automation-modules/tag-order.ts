import { supabase } from "@/lib/supabase";
import type { AutomationModule } from "./types";

// Static tags only for this first version — a tag drawn dynamically from a
// previous step's result (e.g. an AI Agent's classification) is a natural
// extension the catalog anticipates, but isn't built here: it would need a
// small template-resolution pass against `context`, not just plain strings.
type TagOrderConfig = { tags: string[] };

export const tagOrderModule: AutomationModule = {
  validateConfig(config) {
    const { tags } = config as Partial<TagOrderConfig>;

    if (!Array.isArray(tags) || tags.length === 0 || !tags.every((tag) => typeof tag === "string" && tag.trim() !== "")) {
      return "Tag Order requires at least one non-empty tag.";
    }

    return null;
  },

  async run(order, config) {
    const { tags: newTags } = config as TagOrderConfig;

    // Union, not overwrite — a second Tag Order step (or a re-run of the
    // same workflow) should add tags, never silently drop ones already
    // there.
    const mergedTags = Array.from(new Set([...(order.tags ?? []), ...newTags]));

    const { error } = await supabase.from("orders").update({ tags: mergedTags }).eq("id", order.id);

    if (error) {
      console.error("tagOrderModule: failed to update tags:", error);
      return { success: false, message: "Could not save the order's tags." };
    }

    return { success: true, message: `Tagged with: ${newTags.join(", ")}.`, data: { tags: mergedTags } };
  },
};
