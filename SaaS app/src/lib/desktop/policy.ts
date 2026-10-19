// Who may do what through the Desktop API (requirements v19, API-3, API-7). Pure.
import { canAccess, type AccessUser } from "../access";

/** Recording needs Schedule edit, or a provider who can at least view the schedule (desktop spec ACC-3). */
export function canRecord(user: AccessUser): boolean {
  if (!user.active) return false;
  if (canAccess(user, "schedule", "edit")) return true;
  return user.role === "PROVIDER" && canAccess(user, "schedule", "view");
}

/** The program shown on the board: the track name, or "Psych Eval" for a Psych Eval row. */
export function programOf(entry: { section: string; trackName: string; timeLabel: string }): string {
  if (entry.section === "TRACK") return entry.trackName || entry.timeLabel;
  return "Psych Eval";
}
