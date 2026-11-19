// Unification, Release B1: the readers switched to Visit, so migration-inserted Visits (backfilledAt set) are now live
// everywhere. The constant stays as the one place a Visit list filter would go; it is empty on purpose. B1 must only run
// on an environment where Release A's backfill has already run (the schedule would otherwise lose those rows).
export const LIVE_VISITS = {} as const;
