// Automatic retry timing for the upload queue: 5 s, doubling, never longer than 5 minutes. Pure, so it is tested.
export const BACKOFF_FIRST_MS = 5_000;
export const BACKOFF_MAX_MS = 300_000;

/** Delay before retry number `attempt` (0 = the first retry). */
export const nextDelay = (attempt: number): number => Math.min(BACKOFF_MAX_MS, BACKOFF_FIRST_MS * 2 ** Math.max(0, Math.min(attempt, 20)));
