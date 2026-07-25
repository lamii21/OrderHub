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

const { invalidateModuleCredentialsCache } = vi.hoisted(() => ({
  invalidateModuleCredentialsCache: vi.fn(),
}));
vi.mock("@/lib/automation-modules/credentials", () => ({ invalidateModuleCredentialsCache }));

import { saveModuleCredentials, deleteModuleCredentials } from "@/app/shops/[id]/integrations/actions";

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  invalidateModuleCredentialsCache.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("saveModuleCredentials", () => {
  it("rejects an unknown module name without touching the database", async () => {
    const { client } = createMockSupabase();
    holder.client = client;

    await expect(
      saveModuleCredentials(formData({ shop_id: "1", module_name: "carrier-pigeon" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/integrations\?error=/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("saves new credentials with both required fields (whatsapp, no existing row)", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        module_credentials: [
          { data: null, error: null }, // no existing row
          { data: null, error: null }, // upsert result
        ],
      },
    });
    holder.client = client;

    await expect(
      saveModuleCredentials(
        formData({
          shop_id: "1",
          module_name: "whatsapp",
          accessToken: "token-123",
          phoneNumberId: "phone-456",
        })
      )
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/integrations\?saved=whatsapp/);

    expect(builders.module_credentials[1].upsert).toHaveBeenCalledWith(
      {
        shop_id: 1,
        module_name: "whatsapp",
        credentials: { accessToken: "token-123", phoneNumberId: "phone-456" },
      },
      { onConflict: "shop_id,module_name" }
    );
    expect(invalidateModuleCredentialsCache).toHaveBeenCalledWith(1, "whatsapp");
  });

  it("rejects when a required field is missing and there is no existing value to fall back on", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        module_credentials: [{ data: null, error: null }],
      },
    });
    holder.client = client;

    await expect(
      saveModuleCredentials(
        formData({ shop_id: "1", module_name: "whatsapp", accessToken: "token-123" })
      )
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/integrations\?error=/);

    expect(builders.module_credentials[0].upsert).not.toHaveBeenCalled();
  });

  it("merges a blank field with the existing stored value instead of clearing it (update flow)", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        module_credentials: [
          { data: { credentials: { accessToken: "old-token", phoneNumberId: "old-phone" } }, error: null },
          { data: null, error: null },
        ],
      },
    });
    holder.client = client;

    // Only phoneNumberId is resubmitted — accessToken left blank should be kept.
    await expect(
      saveModuleCredentials(
        formData({ shop_id: "1", module_name: "whatsapp", accessToken: "", phoneNumberId: "new-phone" })
      )
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/integrations\?saved=whatsapp/);

    expect(builders.module_credentials[1].upsert).toHaveBeenCalledWith(
      {
        shop_id: 1,
        module_name: "whatsapp",
        credentials: { accessToken: "old-token", phoneNumberId: "new-phone" },
      },
      { onConflict: "shop_id,module_name" }
    );
  });

  it("allows an optional field to be omitted entirely (crm, no apiKey)", async () => {
    const { client, builders } = createMockSupabase({
      responses: {
        module_credentials: [
          { data: null, error: null },
          { data: null, error: null },
        ],
      },
    });
    holder.client = client;

    await expect(
      saveModuleCredentials(formData({ shop_id: "1", module_name: "crm" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/integrations\?saved=crm/);

    expect(builders.module_credentials[1].upsert).toHaveBeenCalledWith(
      { shop_id: 1, module_name: "crm", credentials: {} },
      { onConflict: "shop_id,module_name" }
    );
  });
});

describe("deleteModuleCredentials", () => {
  it("deletes the row scoped to shop_id and module_name, then invalidates the cache", async () => {
    const { client, builders } = createMockSupabase({
      responses: { module_credentials: { data: null, error: null } },
    });
    holder.client = client;

    await expect(
      deleteModuleCredentials(formData({ shop_id: "1", module_name: "whatsapp" }))
    ).rejects.toThrow(/REDIRECT:\/shops\/1\/integrations\?removed=whatsapp/);

    expect(builders.module_credentials[0].delete).toHaveBeenCalled();
    expect(builders.module_credentials[0].eq).toHaveBeenCalledWith("shop_id", "1");
    expect(builders.module_credentials[0].eq).toHaveBeenCalledWith("module_name", "whatsapp");
    expect(invalidateModuleCredentialsCache).toHaveBeenCalledWith(1, "whatsapp");
  });
});
