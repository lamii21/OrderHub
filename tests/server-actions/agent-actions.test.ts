import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(async () => holder.client),
}));

const { auditLog } = vi.hoisted(() => ({ auditLog: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { audit: auditLog } }));

import { saveAgentSettings } from "@/app/shops/[id]/agent/actions";

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  auditLog.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("saveAgentSettings", () => {
  it("upserts every field, defaulting ai_provider to the one registered chat provider", async () => {
    const { client, builders } = createMockSupabase({
      responses: { ai_agents: [{ data: null, error: null }] },
    });
    holder.client = client;

    await expect(
      saveAgentSettings(
        formData({
          shop_id: "1",
          is_active: "on",
          tone: "professional",
          language_fr: "on",
          language_en: "on",
          tool_get_order_status: "on",
          tool_get_customer: "on",
          rag_enabled: "on",
          rag_top_k: "8",
          system_prompt: "You are a helpful assistant.",
        })
      )
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/agent\?saved=1/);

    expect(builders.ai_agents[0].upsert).toHaveBeenCalledWith(
      {
        shop_id: 1,
        is_active: true,
        ai_provider: "openrouter",
        tone: "professional",
        languages: ["fr", "en"],
        enabled_tools: ["get_order_status", "get_customer"],
        rag_enabled: true,
        rag_top_k: 8,
        system_prompt: "You are a helpful assistant.",
      },
      { onConflict: "shop_id" }
    );
    expect(auditLog).toHaveBeenCalledWith("ai_agent.settings_saved", { shopId: "1", isActive: true });
  });

  it("defaults every unchecked box to false/empty and blank text fields to null", async () => {
    const { client, builders } = createMockSupabase({
      responses: { ai_agents: [{ data: null, error: null }] },
    });
    holder.client = client;

    await expect(saveAgentSettings(formData({ shop_id: "1" }))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/agent\?saved=1/
    );

    expect(builders.ai_agents[0].upsert).toHaveBeenCalledWith(
      {
        shop_id: 1,
        is_active: false,
        ai_provider: "openrouter",
        tone: "friendly",
        languages: [],
        enabled_tools: [],
        rag_enabled: false,
        rag_top_k: null,
        system_prompt: null,
      },
      { onConflict: "shop_id" }
    );
  });

  it("redirects with an error and never logs an audit event when the upsert fails", async () => {
    const { client, builders } = createMockSupabase({
      responses: { ai_agents: [{ data: null, error: { message: "boom" } }] },
    });
    holder.client = client;

    await expect(saveAgentSettings(formData({ shop_id: "1" }))).rejects.toThrow(
      /REDIRECT:\/shops\/1\/agent\?error=/
    );

    expect(builders.ai_agents[0].upsert).toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });
});
