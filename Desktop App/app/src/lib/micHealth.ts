import type { MicHealth } from "./engine";

/** The words shown while recording when the microphone stopped delivering audio, or null when it is fine. */
export function micWarning(h: MicHealth | null): string | null {
  if (!h) return null;
  if (h.lost) return "The microphone disconnected or was blocked. Everything said so far is saved on this Mac. Reconnect it, then stop and record again.";
  if (h.silent) return "No sound from the microphone for 10 seconds. Check that it is plugged in and allowed. Everything said so far is saved on this Mac.";
  return null;
}
