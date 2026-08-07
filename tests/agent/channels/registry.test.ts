import { describe, it, expect } from "vitest";
import { getChannelAdapter } from "@/lib/agent/channels/registry";

describe("getChannelAdapter", () => {
  it("resolves the whatsapp adapter, whose own channel field matches the registry key", () => {
    const adapter = getChannelAdapter("whatsapp");
    expect(adapter.channel).toBe("whatsapp");
  });

  it("throws for an unregistered channel name", () => {
    expect(() => getChannelAdapter("telegram")).toThrow('No channel adapter registered for "telegram"');
  });
});
