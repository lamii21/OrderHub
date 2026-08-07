import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../../mocks/supabase";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));
const { getModuleCredentials } = vi.hoisted(() => ({ getModuleCredentials: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return holder.client;
  },
}));

vi.mock("@/lib/automation-modules/credentials", () => ({ getModuleCredentials }));

import { getShopContext, getCustomerContext, getAgentConfig, getAgentCredentials } from "@/lib/agent/context/repository";

describe("getShopContext", () => {
  it("returns the mapped shop context", async () => {
    const { client, builders } = createMockSupabase({
      responses: { shops: { data: { id: 15, name: "AYLA", currency: "USD", timezone: "UTC" }, error: null } },
    });
    holder.client = client;

    const result = await getShopContext(15);

    expect(result).toEqual({ id: 15, name: "AYLA", currency: "USD", timezone: "UTC" });
    expect(builders.shops[0].eq).toHaveBeenCalledWith("id", 15);
  });

  it("returns null when the shop does not exist", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: null, error: null } } });
    holder.client = client;

    await expect(getShopContext(999)).resolves.toBeNull();
  });

  it("throws on a query error", async () => {
    const { client } = createMockSupabase({ responses: { shops: { data: null, error: { message: "db down" } } } });
    holder.client = client;

    await expect(getShopContext(15)).rejects.toThrow("db down");
  });
});

describe("getCustomerContext", () => {
  it("returns the mapped customer context", async () => {
    const { client } = createMockSupabase({
      responses: {
        customers: { data: { id: 1, name: "lamiae", phone: "212600000000", email: "a@b.com" }, error: null },
      },
    });
    holder.client = client;

    await expect(getCustomerContext(1)).resolves.toEqual({
      id: 1,
      name: "lamiae",
      phone: "212600000000",
      email: "a@b.com",
    });
  });

  it("returns null when the customer does not exist", async () => {
    const { client } = createMockSupabase({ responses: { customers: { data: null, error: null } } });
    holder.client = client;

    await expect(getCustomerContext(999)).resolves.toBeNull();
  });

  it("throws on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { customers: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(getCustomerContext(1)).rejects.toThrow("db down");
  });
});

describe("getAgentConfig", () => {
  it("returns the mapped agent config", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        ai_agents: {
          data: {
            shop_id: 15,
            is_active: true,
            system_prompt: "You are a helpful sales agent.",
            tone: "friendly",
            languages: ["fr", "en", "ar-ma"],
            ai_provider: "openrouter",
            ai_model: "test-model",
            enabled_tools: [],
            rag_enabled: true,
            rag_top_k: 8,
          },
          error: null,
        },
      },
    });
    holder.client = client;

    const result = await getAgentConfig(15);

    expect(result?.ai_provider).toBe("openrouter");
    expect(result?.rag_enabled).toBe(true);
    expect(result?.rag_top_k).toBe(8);
    expect(builders.ai_agents[0].select).toHaveBeenCalledWith(
      "shop_id, is_active, system_prompt, tone, languages, ai_provider, ai_model, enabled_tools, rag_enabled, rag_top_k"
    );
    expect(builders.ai_agents[0].eq).toHaveBeenCalledWith("shop_id", 15);
  });

  it("returns null when no agent is configured for the shop", async () => {
    const { client } = createMockSupabase({ responses: { ai_agents: { data: null, error: null } } });
    holder.client = client;

    await expect(getAgentConfig(15)).resolves.toBeNull();
  });

  it("throws on a query error", async () => {
    const { client } = createMockSupabase({
      responses: { ai_agents: { data: null, error: { message: "db down" } } },
    });
    holder.client = client;

    await expect(getAgentConfig(15)).rejects.toThrow("db down");
  });
});

describe("getAgentCredentials", () => {
  beforeEach(() => {
    getModuleCredentials.mockReset();
  });

  it("looks up module_credentials under module_name 'ai-sales-agent', not the existing 'ai-agent' module", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "sk-or-test", model: "test-model" });

    await getAgentCredentials(15);

    expect(getModuleCredentials).toHaveBeenCalledWith(15, "ai-sales-agent");
  });

  it("maps a valid stored credential into AiCredentials", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "sk-or-test", model: "test-model" });

    await expect(getAgentCredentials(15)).resolves.toEqual({ apiKey: "sk-or-test", model: "test-model" });
  });

  it("returns null when nothing is configured", async () => {
    getModuleCredentials.mockResolvedValue(null);

    await expect(getAgentCredentials(15)).resolves.toBeNull();
  });

  it("returns null rather than a malformed value when the stored credential is missing apiKey or model", async () => {
    getModuleCredentials.mockResolvedValue({ apiKey: "sk-or-test" });
    await expect(getAgentCredentials(15)).resolves.toBeNull();

    getModuleCredentials.mockResolvedValue({ model: "test-model" });
    await expect(getAgentCredentials(15)).resolves.toBeNull();
  });
});
