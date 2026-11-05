import { audit } from "@/lib/audit";
import { isISODate } from "@/lib/dates";
import { ApiError, authenticate, handle, json } from "@/lib/desktop/api";
import { normalizeInitials, searchVisits } from "@/lib/notes/visitSearch";

export const dynamic = "force-dynamic";

/**
 * Finds visits by the patient's initials (case-insensitive, exact: "AB" or "A.B.") and/or an exact date.
 * At least one is required. Newest first, 50 at most. Initials and visit fields only, no names.
 */
export const GET = handle(async (req) => {
  const { user } = await authenticate(req, { module: "notes", level: "view" });
  const sp = new URL(req.url).searchParams;
  const initials = sp.get("initials")?.trim() ?? "";
  const date = sp.get("date")?.trim() ?? "";
  if (!initials && !date) throw new ApiError(400, "bad_query");
  if (date && !isISODate(date)) throw new ApiError(400, "bad_date");
  if (initials && !normalizeInitials(initials)) throw new ApiError(400, "bad_query");

  const visits = await searchVisits({ initials: initials || undefined, date: date || undefined });
  await audit(user.email, "desktop.notes.visits.search", `date=${date || "-"} initials=${initials ? "y" : "n"} results=${visits.length}`);
  return json({ visits });
});
