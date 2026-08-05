// The one import path the AI engine (Phase 5) is meant to use —
// @/lib/agent — instead of reaching into individual files across
// conversation/, memory/, channels/. Deliberately does NOT re-export
// ./conversation/repository: that file is pure Supabase I/O, and this
// barrel exists specifically so the engine never has a path to it, direct
// or otherwise. Every other module here has no such restriction, so their
// full public surface is re-exported as-is.
export * from "./types";
export * from "./events";
export * from "./conversation/service";
export * from "./memory/conversation-memory";
export * from "./channels/types";
