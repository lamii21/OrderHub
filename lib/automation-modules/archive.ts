import { supabase } from "@/lib/supabase";
import type { AutomationModule } from "./types";

// The simplest module in the catalog — no configuration, no external call,
// nothing that can meaningfully fail beyond a database write. Kept as the
// reference implementation for anyone writing a new module: this is the
// minimum a module can be and still be correct.
export const archiveModule: AutomationModule = {
  async run(order) {
    const { error } = await supabase
      .from("orders")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", order.id);

    if (error) {
      console.error("archiveModule: failed to archive order:", error);
      return { success: false, message: "Could not archive the order." };
    }

    return { success: true, message: "Order archived." };
  },
};
