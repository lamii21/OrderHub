import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { createBrowserClient } = vi.hoisted(() => ({ createBrowserClient: vi.fn(() => ({})) }));
vi.mock("@supabase/ssr", () => ({ createBrowserClient }));

import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  createBrowserClient.mockClear();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("createSupabaseBrowserClient", () => {
  it("returns null when NEXT_PUBLIC_SUPABASE_URL is missing", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "key";

    expect(createSupabaseBrowserClient()).toBeNull();
    expect(createBrowserClient).not.toHaveBeenCalled();
  });

  it("returns null when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    expect(createSupabaseBrowserClient()).toBeNull();
    expect(createBrowserClient).not.toHaveBeenCalled();
  });

  it("builds a client with both env vars present", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "key";

    const client = createSupabaseBrowserClient();

    expect(client).not.toBeNull();
    expect(createBrowserClient).toHaveBeenCalledWith("https://test.supabase.co", "key");
  });
});
