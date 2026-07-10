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
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    delete process.env.GOOGLE_SHEETS_TEMPLATE_ID;

    const result = checkEnvironment();

    expect(result.ok).toBe(true);
    expect(result.missingCore).toEqual([]);
    expect(result.missingOptional).toEqual(
      expect.arrayContaining(["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SHEETS_TEMPLATE_ID"])
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
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "svc@test.iam.gserviceaccount.com",
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "key",
      GOOGLE_SHEETS_TEMPLATE_ID: "id",
    });
    const logSpy = vi.spyOn(console, "log");

    validateEnvironment();

    expect(logSpy).toHaveBeenCalled();
  });
});
