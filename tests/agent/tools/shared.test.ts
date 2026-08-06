import { describe, it, expect } from "vitest";
import { escapeLikePattern } from "@/lib/agent/tools/shared";

describe("escapeLikePattern", () => {
  it("leaves ordinary text unchanged", () => {
    expect(escapeLikePattern("veste en jean")).toBe("veste en jean");
  });

  it("escapes %, _, and \\ individually", () => {
    expect(escapeLikePattern("50%")).toBe("50\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });

  it("escapes a mix of all three without double-escaping", () => {
    expect(escapeLikePattern("50% off_deal\\")).toBe("50\\% off\\_deal\\\\");
  });
});
