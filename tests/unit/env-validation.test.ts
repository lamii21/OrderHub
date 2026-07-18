import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkEnvironment, validateEnvironment } from "@/lib/env-validation";

const ORIGINAL_ENV = { ...process.env };

const ALL_CORE = {
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "key",
  SUPABASE_ANON_KEY: "key",
  API_SECRET: "secret",
  CRON_SECRET: "secret",
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("checkEnvironment", () => {
  it("is ok with every core var set (optional vars may still be missing)", () => {
    Object.assign(process.env, ALL_CORE);
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    delete process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY;
    delete process.env.GOOGLE_SHEETS_TEMPLATE_ID;

    const result = checkEnvironment();

    expect(result.ok).toBe(true);
    expect(result.missingCore).toEqual([]);
    expect(result.missingOptional).toEqual(
      expect.arrayContaining(["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_SHEETS_TEMPLATE_ID"])
    );
  });

  it("reports every missing core var by name", () => {
    Object.assign(process.env, ALL_CORE);
    delete process.env.API_SECRET;
    delete process.env.CRON_SECRET;

    const result = checkEnvironment();

    expect(result.ok).toBe(false);
    expect(result.missingCore).toEqual(["API_SECRET", "CRON_SECRET"]);
  });
});

describe("validateEnvironment", () => {
  it("logs an error (via console.error) when a core var is missing", () => {
    Object.assign(process.env, ALL_CORE);
    delete process.env.SUPABASE_URL;
    const errorSpy = vi.spyOn(console, "error");

    validateEnvironment();

    expect(errorSpy).toHaveBeenCalled();
  });

  it("never throws, even with everything missing", () => {
    for (const key of Object.keys(ALL_CORE)) delete process.env[key];

    expect(() => validateEnvironment()).not.toThrow();
  });

  it("logs a plain success line when everything (core + optional) is present", () => {
    Object.assign(process.env, ALL_CORE, {
      GOOGLE_OAUTH_CLIENT_ID: "client-id.apps.googleusercontent.com",
      GOOGLE_OAUTH_CLIENT_SECRET: "secret",
      GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:3000/api/google/callback",
      GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY: "aeWymEULXLMYZBA9saGFA2FiNuEo8qBBrEoLXpqXQTg=",
      GOOGLE_SHEETS_TEMPLATE_ID: "id",
    });
    const logSpy = vi.spyOn(console, "log");

    validateEnvironment();

    expect(logSpy).toHaveBeenCalled();
  });
});
