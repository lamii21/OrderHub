import type { ChannelAdapter } from "./types";
import { whatsappChannelAdapter } from "./whatsapp";

// Same registry-of-named-modules shape as lib/ai/index.ts's chatProviders
// and lib/platforms/index.ts's connector registry. Throws on an unknown
// channel — unlike tools/registry.ts's getTool() (which returns null,
// because a tool name is untrusted input an LLM supplies), a channel name
// here always comes from a fixed, known routing point (a webhook route
// built for exactly one channel, Étape 7.4), never from user- or
// model-supplied input — the same "throw on an unrecognized name" posture
// already used by lib/ai's getChatProvider() and lib/platforms's
// getConnector().
const channels: Record<string, ChannelAdapter> = {
  whatsapp: whatsappChannelAdapter,
};

export function getChannelAdapter(channel: string): ChannelAdapter {
  const adapter = channels[channel];

  if (!adapter) {
    throw new Error(`No channel adapter registered for "${channel}"`);
  }

  return adapter;
}
