import { supabase } from "@/lib/supabase";
import { createDocument } from "@/lib/agent/rag/repository";
import { indexDocument } from "@/lib/agent/rag/indexing";
import type { EvalDocument } from "./dataset";

export type EphemeralShopResult<T> = {
  result: T;
  // Whether the cleanup delete itself actually succeeded — not assumable
  // from withEphemeralShop merely returning, since a cleanup failure is
  // only logged (see the finally block below), never thrown. Added so the
  // runner (Étape 10.0.d) can honestly report "Temporary shop cleaned:
  // yes/no" instead of assuming success.
  shopCleaned: boolean;
};

// Provisions a throwaway shop, creates and really indexes every fixture
// document in it (real embedding calls — see this phase's own architecture
// analysis on cost), hands the shop id to `run`, and always deletes the
// shop afterward — including when provisioning itself fails partway
// through (one document fails to index, the shop insert fails, `run`
// itself throws). No new business abstraction: shop creation is a plain
// insert (this eval shop needs none of createOrUpdateShop's upsert/dedup
// rules, which exist for real merchant onboarding, not a benchmark
// fixture), and document creation/indexing reuse createDocument/
// indexDocument exactly as every other caller does. Deleting the shop
// relies on the same cascade agent_documents/agent_document_chunks already
// have (supabase/schema.sql) — no explicit chunk/document cleanup needed.
export async function withEphemeralShop<T>(
  documents: EvalDocument[],
  run: (shopId: number) => Promise<T>
): Promise<EphemeralShopResult<T>> {
  let shopId: number | null = null;
  let shopCleaned = true;
  let result: T;

  try {
    const { data, error } = await supabase
      .from("shops")
      .insert({ name: `RAG eval — ${new Date().toISOString()}`, platform: "rag-eval" })
      .select("id")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    // Narrowed into its own const: TypeScript doesn't keep the outer `let
    // shopId`'s narrowing to `number` across the `await`s below, since
    // finally's own read of it means it can't be treated as effectively
    // const for control-flow purposes. `shopId` (the `let`) still gets
    // assigned right after, purely so `finally` knows there's something to
    // clean up.
    const provisionedShopId: number = data.id;
    shopId = provisionedShopId;

    for (const document of documents) {
      const created = await createDocument({
        shop_id: provisionedShopId,
        type: document.type,
        title: document.title,
        content: document.content,
      });
      await indexDocument(created.id);
    }

    result = await run(provisionedShopId);
  } finally {
    // Never masks whatever the try block itself threw (if anything) — a
    // failed cleanup is a real problem (a leftover benchmark shop left in
    // Supabase) but a secondary one, surfaced as a warning rather than
    // thrown from inside finally, which would otherwise silently replace
    // whatever error the try block was already propagating. The final
    // `return` below is only ever reached when the try block completed
    // normally, so shopCleaned always reflects this same run's own cleanup
    // by the time it's read there.
    if (shopId !== null) {
      const { error } = await supabase.from("shops").delete().eq("id", shopId);
      shopCleaned = !error;

      if (error) {
        console.error(`withEphemeralShop: failed to clean up shop ${shopId}:`, error.message);
      }
    }
  }

  return { result, shopCleaned };
}
