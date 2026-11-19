// "See full names": one shared rule for every screen that shows a patient name (Schedule, Overview, Patients, Billing, Reports).
// Permission comes from the server (User.showFullNames set by an admin, provider/admin roles only); the on/off choice is a
// per-user, per-browser switch (Settings), off by default, exactly like the Desktop app's "Show full names".

/** Server side: may this user be sent full names at all? */
export function canSeeFullNames(user: { role: string; showFullNames: boolean }): boolean {
  return (user.role === "ADMIN" || user.role === "PROVIDER") && user.showFullNames;
}

/** The label to show. Pure, so it is easy to test: initials unless the switch is on and a full name was sent. */
export function nameLabel(n: { initials: string; fullName?: string | null }, showFull: boolean): string {
  return showFull && n.fullName ? n.fullName : n.initials;
}
