// Unification, Release A. Visits that the migration INSERTED from schedule rows (backfilledAt set) are not shown by any
// Visit list yet: the Schedule still reads ScheduleEntry, so showing them would list every such appointment twice, and
// they have no recording or documents. Release B removes this filter when the readers switch to Visit.
export const LIVE_VISITS = { backfilledAt: null } as const;
