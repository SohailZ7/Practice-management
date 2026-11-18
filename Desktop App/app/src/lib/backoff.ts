// Automatic retry timing for the upload queue: 5 s, doubling, never longer than 5 minutes. Pure, so it is tested.
export const BACKOFF_FIRST_MS = 5_000;
export const BACKOFF_MAX_MS = 300_000;

/** Delay before retry number `attempt` (0 = the first retry). */
export const nextDelay = (attempt: number): number => {
  const n = Number.isFinite(attempt) ? Math.max(0, Math.min(Math.floor(attempt), 20)) : 0; // never NaN: a NaN timer would retry in a tight loop
  return Math.min(BACKOFF_MAX_MS, BACKOFF_FIRST_MS * 2 ** n);
};
