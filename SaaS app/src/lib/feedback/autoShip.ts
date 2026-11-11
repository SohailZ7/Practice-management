// The app marks its own feedback items Shipped, so nobody needs a key to do it. Each item records the Web release it was
// built in (set when it moves to On staging). On PRODUCTION only, an Approved item whose release is at or below the release
// this build runs is Shipped: it is running in production now. Staging never does this, because staging running a
// release says nothing about production, and the promote rule depends on items staying Approved until they are live.
// Audit and history say "system" with ids and words only, never text.
import { db } from "../db";
import { audit } from "../audit";
import { webRelease } from "../buildInfo";

type Env = Record<string, string | undefined>;

/** 16 from "Web 1.16", "1.16", "16" or 16; null for anything else. */
export function releaseNumber(v: unknown): number | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  const m = /^(?:Web\s+)?(?:1\.)?(\d{1,4})$/.exec(s);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const runningReleaseNumber = (env: Env = process.env): number | null => releaseNumber(webRelease(env));

/** Whether this build may mark items Shipped, and the release it would compare against. Pure. */
export function shipLimit(env: Env = process.env): number | null {
  return env.APP_ENV === "production" ? runningReleaseNumber(env) : null;
}

/** Marks every due Approved item Shipped. Returns how many. Safe to call on any page load: one indexed query when nothing is due. */
export async function shipDueItems(env: Env = process.env): Promise<number> {
  const limit = shipLimit(env);
  if (limit === null) return 0;
  try {
    const due = await db.feedbackItem.findMany({ where: { status: "approved", shippedRelease: { not: null, lte: limit } }, select: { id: true } });
    let done = 0;
    for (const { id } of due) {
      const r = await db.$transaction(async (tx) => {
        const u = await tx.feedbackItem.updateMany({ where: { id, status: "approved" }, data: { status: "shipped" } });
        if (u.count) await tx.feedbackEvent.create({ data: { itemId: id, actorName: "system", actorKind: "system", field: "status", fromValue: "approved", toValue: "shipped" } });
        return u.count;
      });
      if (r) { done += 1; await audit("system", "feedback.workflow", `${id} status:approved>shipped via system release<=${limit}`); }
    }
    return done;
  } catch {
    return 0; // a display convenience must never break the page or the API
  }
}
