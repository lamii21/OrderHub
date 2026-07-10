import { describe, it, expect, vi, beforeEach } from "vitest";
import { __resetRateLimitState } from "@/lib/rate-limit";

const { signInWithPassword, getUser, signOut } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { signInWithPassword, getUser, signOut },
  })),
}));

const headersMock = vi.hoisted(() => ({ ip: "203.0.113.5" }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => (name === "x-forwarded-for" ? headersMock.ip : null),
  })),
}));

import { login, logout } from "@/app/login/actions";

function formData(email: string, password: string) {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

beforeEach(() => {
  signInWithPassword.mockReset();
  getUser.mockReset().mockResolvedValue({ data: { user: { email: "owner@example.com" } } });
  signOut.mockReset();
  __resetRateLimitState();
  headersMock.ip = "203.0.113.5";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("login — rate limiting", () => {
  it("allows sign-in attempts under the limit", async () => {
    signInWithPassword.mockResolvedValue({ error: null });

    await expect(login(formData("owner@example.com", "correct-password"))).rejects.toThrow(
      "REDIRECT:/dashboard"
    );
  });

  it("blocks further attempts from the same IP once the limit is exceeded, without calling Supabase", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });

    for (let i = 0; i < 10; i++) {
      await expect(
        login(formData("owner@example.com", "wrong-password"))
      ).rejects.toThrow("REDIRECT:/login?error=");
    }

    signInWithPassword.mockClear();
    await expect(login(formData("owner@example.com", "wrong-password"))).rejects.toThrow(
      /REDIRECT:\/login\?error=Too%20many%20attempts/
    );
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("tracks separate IPs independently", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });

    for (let i = 0; i < 10; i++) {
      await expect(login(formData("owner@example.com", "wrong"))).rejects.toThrow();
    }

    headersMock.ip = "198.51.100.7";
    signInWithPassword.mockResolvedValue({ error: null });
    await expect(login(formData("owner@example.com", "correct-password"))).rejects.toThrow(
      "REDIRECT:/dashboard"
    );
  });

  it("still validates presence of email/password after passing the rate limit", async () => {
    await expect(login(formData("", ""))).rejects.toThrow(
      /REDIRECT:\/login\?error=Email%20and%20password/
    );
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("redirects to /login with an error on invalid credentials", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });

    await expect(login(formData("owner@example.com", "wrong"))).rejects.toThrow(
      /REDIRECT:\/login\?error=Invalid%20email/
    );
  });
});

describe("logout", () => {
  it("signs out and redirects to /login", async () => {
    await expect(logout()).rejects.toThrow("REDIRECT:/login");
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
