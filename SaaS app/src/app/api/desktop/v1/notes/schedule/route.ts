import { audit } from "@/lib/audit";
import { isISODate } from "@/lib/dates";
import { ApiError, authenticate, handle, json, readJson } from "@/lib/desktop/api";
import { loadScheduleForDate } from "@/lib/notes/loadSchedule";

export const dynamic = "force-dynamic";

/**
 * The recorder pastes a day's board here. The parsing happens on this side, so the recorder carries no copy of the
 * board's rules and the two cannot drift apart.
 */
export const POST = handle(async (req) => {
  const { user } = await authenticate(req, { module: "notes", level: "edit" });
  const body = await readJson(req);
  const date = typeof body.date === "string" ? body.date : "";
  const pasted = typeof body.pasted === "string" ? body.pasted : "";
  const provider = typeof body.provider === "string" ? body.provider : "";
  if (!isISODate(date)) throw new ApiError(400, "bad_date");
  if (!pasted.trim()) throw new ApiError(400, "empty_paste");

  const r = await loadScheduleForDate(date, pasted, provider, user);
  await audit(user.email, "desktop.notes.schedule", `${date} rows=${r.kept} visits=${r.created}`);
  return json(r);
});
