// Staging side of "Promote to production": reads the chosen items, refuses anything not promotable, posts each to
// production with the service key, and records the marker. Only runs when APP_ENV=staging. The key and item text are never
// logged or audited; audit details hold ids, kinds and counts.
import { db } from "../db";
import { audit } from "../audit";
import { logError } from "../safeLog";
import { MAX_BULK, isStaging, validTarget, whyNotPromotable, type PromoteKind } from "./rules";

export type ItemOutcome = { id: string; ok: boolean; status?: "created" | "exists"; error?: string };

export class PromoteConfigError extends Error {}

function config() {
  if (!isStaging()) throw new PromoteConfigError("Promote to production is only available on staging.");
  const key = process.env.PROMOTE_SERVICE_KEY;
  const origin = validTarget(process.env.PROMOTE_TARGET_URL);
  if (!key || !origin) throw new PromoteConfigError("Promotion is not configured (PROMOTE_SERVICE_KEY and an https PROMOTE_TARGET_URL are required).");
  return { key, origin };
}

async function post(cfg: { key: string; origin: string }, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${cfg.origin}/api/internal/promote`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function load(kind: PromoteKind, id: string) {
  if (kind === "task") {
    const t = await db.task.findUnique({ where: { id }, include: { assignee: true, category: true } });
    if (!t) return null;
    return {
      row: t,
      payload: { title: t.title, notes: t.notes, dueDate: t.dueDate, expiresAt: t.expiresAt, completed: t.completed, categoryName: t.category?.name ?? null, assigneeEmail: t.assignee?.email ?? null },
    };
  }
  const f = await db.feedbackItem.findUnique({ where: { id }, include: { author: true } });
  if (!f) return null;
  return { row: f, payload: { kind: f.kind, title: f.title, description: f.description, authorEmail: f.author.email } };
}

/** Promotes the given ids one at a time. Each result is reported separately; one failure does not stop the rest. */
export async function promoteItems(actorEmail: string, kind: PromoteKind, ids: string[]): Promise<ItemOutcome[]> {
  const cfg = config();
  const unique = Array.from(new Set(ids)).slice(0, MAX_BULK);
  if (unique.length === 0) return [];
  const out: ItemOutcome[] = [];
  for (const id of unique) {
    try {
      const loaded = await load(kind, id);
      if (!loaded) {
        out.push({ id, ok: false, error: "not_found" });
        continue;
      }
      const why = whyNotPromotable(kind, loaded.row);
      if (why) {
        out.push({ id, ok: false, error: why });
        continue;
      }
      const r = await post(cfg, { kind, sourceId: id, item: loaded.payload });
      if (r.status !== 200 && r.status !== 201) {
        out.push({ id, ok: false, error: typeof r.json.error === "string" ? r.json.error : `http_${r.status}` });
        continue;
      }
      const targetId = String(r.json.targetId ?? "");
      const data = { promotedAt: new Date(), promotedProdId: targetId };
      if (kind === "task") await db.task.update({ where: { id }, data });
      else await db.feedbackItem.update({ where: { id }, data });
      out.push({ id, ok: true, status: r.json.status === "exists" ? "exists" : "created" });
    } catch (e) {
      logError("promote send failed", e);
      out.push({ id, ok: false, error: "unreachable" });
    }
  }
  const sent = out.filter((o) => o.ok).length;
  await audit(actorEmail, "promote.send", `${kind} requested=${unique.length} promoted=${sent} failed=${unique.length - sent} ids=${unique.join(",").slice(0, 600)}`);
  return out;
}

/** Marks or unmarks an item as a test item (staging only). Test items can never be promoted. */
export async function setTestFlag(actorEmail: string, kind: PromoteKind, id: string, isTest: boolean): Promise<void> {
  if (!isStaging()) throw new PromoteConfigError("Only available on staging.");
  if (kind === "task") await db.task.update({ where: { id }, data: { isTest } });
  else await db.feedbackItem.update({ where: { id }, data: { isTest } });
  await audit(actorEmail, "promote.test-flag", `${kind} ${id} isTest=${isTest}`);
}
