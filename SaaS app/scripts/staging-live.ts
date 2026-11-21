// Signed-in live check against a REAL deployment (staging). No mocks.
//   SMOKE_BASE=https://<staging> SMOKE_TOKENS_FILE=<json from staging-smoke-users.ts create> npx tsx scripts/staging-live.ts
// 1) Permission matrix: every Desktop route x every smoke user, expected 403 vs allowed. 2) Inbox flows with large bodies. Exits 1 on any failure.
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
const base = (process.env.SMOKE_BASE ?? "").replace(/\/$/, "");
const tokens = JSON.parse(readFileSync(process.env.SMOKE_TOKENS_FILE ?? "", "utf8")) as Record<string, string>;
if (!base) { console.error("Set SMOKE_BASE."); process.exit(2); }
const MODS = ["schedule", "tasks", "employees", "billing", "ledger", "notes"];
let pass = 0; const fails: string[] = [];
const ok = (name: string, good: boolean, note = "") => { if (good) pass++; else { fails.push(`${name} ${note}`); console.log(`FAIL  ${name}  ${note}`); } };
const call = async (who: string, method: string, path: string, body?: unknown) => {
  for (let i = 0; i < 7; i++) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30_000);
    try {
      const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${tokens[who]}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
      if (r.status === 429) { await new Promise((s) => setTimeout(s, 2000 * (i + 1))); continue; }
      const text = await r.text(); let j: Record<string, unknown> = {}; try { j = JSON.parse(text); } catch { /* not json */ }
      return { status: r.status, json: j };
    } catch (e) { // aborted or network error: count as a failed call, never crash the whole run
      if (i < 2) { await new Promise((s) => setTimeout(s, 1000)); continue; }
      return { status: 0, json: { error: String((e as Error)?.name ?? e) } as Record<string, unknown> };
    } finally { clearTimeout(t); }
  }
  return { status: 429, json: {} as Record<string, unknown> };
};
const U = randomUUID();
const ROUTES: { m: string; p: string; mod: string | null; lvl: "view" | "edit"; body?: unknown; lvl2?: "edit" }[] = [
  { m: "GET", p: "/api/desktop/v1/schedule?date=2026-01-05", mod: "schedule", lvl: "view" },
  { m: "GET", p: "/api/desktop/v1/providers", mod: "schedule", lvl: "view" },
  { m: "POST", p: "/api/desktop/v1/recordings/check", mod: "schedule", lvl: "view", body: {}, lvl2: "edit" }, // canRecord: recording needs schedule edit
  { m: "GET", p: "/api/desktop/v1/patients/none/consent", mod: "schedule", lvl: "view" },
  { m: "GET", p: "/api/desktop/v1/tasks", mod: "tasks", lvl: "view" },
  { m: "PATCH", p: "/api/desktop/v1/tasks/none", mod: "tasks", lvl: "edit", body: {} },
  { m: "GET", p: "/api/desktop/v1/notes/options", mod: "notes", lvl: "view" },
  { m: "GET", p: "/api/desktop/v1/notes/inbox?linked=false", mod: "notes", lvl: "view" },
  { m: "GET", p: "/api/desktop/v1/notes/visits/search?q=zz", mod: "notes", lvl: "view" },
  { m: "PUT", p: `/api/desktop/v1/notes/inbox/${U}`, mod: "notes", lvl: "edit", body: {} },
  { m: "POST", p: `/api/desktop/v1/notes/inbox/${U}/link`, mod: "notes", lvl: "edit", body: { visitId: "none" } },
  { m: "POST", p: "/api/desktop/v1/notes/visits/bulk-delete", mod: "notes", lvl: "edit", body: { ids: [] } },
  { m: "GET", p: "/api/desktop/v1/feedback", mod: null, lvl: "view" },
];
const rank = { none: 0, view: 1, edit: 2 } as const;
const levelOf = (who: string, mod: string) => who === "admin" ? 2 : who === "none" ? 0 : who === "view" ? 1 : who === "edit" ? 2 : who === `only-${mod}` ? 2 : 0;

async function main() {
  for (const who of Object.keys(tokens)) {
    for (const r of ROUTES) {
      const res = await call(who, r.m, r.p, r.body);
      let allowed = r.mod === null ? true : levelOf(who, r.mod) >= rank[r.lvl];
      if (r.lvl2 && r.mod) allowed = levelOf(who, r.mod) >= rank[r.lvl2];
      const name = `${who} ${r.m} ${r.p.split("?")[0].replace(U, ":uuid")}`;
      if (allowed) ok(name + " allowed", res.status !== 401 && res.status !== 403 && res.status < 500, `got ${res.status}`);
      else ok(name + " denied", res.status === 403 && (r.lvl2 !== undefined || res.json.reason === "no_module_access"), `got ${res.status}`);
    }
  }
  // Inbox flows as the all-edit user, with real sizes.
  const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
  const put = (id: string, seq: number, text: string, extra: object = {}) => call("edit", "PUT", `/api/desktop/v1/notes/inbox/${id}`, { seq, final: false, text, sha256: sha(text), durationSeconds: 3, recordedAt: new Date().toISOString(), ...extra });
  const id = randomUUID(); const big = "SMOKE made-up transcript, no patient. ".repeat(6000).slice(0, 230_000);
  const a = await put(id, 1, "short start"); ok("inbox first checkpoint", a.status === 200 && a.json.seq === 1, `status ${a.status}`);
  const b = await put(id, 2, big); ok("inbox 230 KB checkpoint", b.status === 200 && b.json.sha256 === sha(big), `status ${b.status}`);
  const c = await put(id, 2, big); ok("inbox identical retry", c.status === 200 && JSON.stringify(c.json) === JSON.stringify(b.json), `status ${c.status}`);
  const d = await put(id, 1, "short start"); ok("inbox stale older checkpoint", d.status === 200 && d.json.stale === true, `status ${d.status}`);
  const e = await call("edit", "PUT", `/api/desktop/v1/notes/inbox/${id}`, { seq: 3, final: false, text: "x", sha256: sha("y"), durationSeconds: 1, recordedAt: new Date().toISOString() }); ok("inbox wrong checksum is 422", e.status === 422 && e.json.error === "checksum_mismatch", `status ${e.status}`);
  const f = await put(id, 3, big + " end", { final: true }); ok("inbox final", f.status === 200 && f.json.final === true, `status ${f.status}`);
  const g = await put(id, 4, "late"); ok("inbox after final is 409", g.status === 409, `status ${g.status}`);
  const h = await call("edit", "GET", "/api/desktop/v1/notes/inbox?linked=false"); ok("inbox list shows it unlinked", h.status === 200 && JSON.stringify(h.json).includes(id), `status ${h.status}`);
  const i = await call("edit", "POST", `/api/desktop/v1/notes/inbox/${id}/link`, { visitId: "no-such-visit" }); ok("link to missing visit is 404", i.status === 404, `status ${i.status}`);
  const j = await call("edit", "PUT", `/api/desktop/v1/notes/inbox/not-a-uuid`, {}); ok("bad uuid is 400", j.status === 400, `status ${j.status}`);
  const k = await call("edit", "PUT", `/api/desktop/v1/notes/inbox/${randomUUID()}`, { seq: 1, text: "z".repeat(2_100_000), sha256: "0".repeat(64), recordedAt: new Date().toISOString() }); ok("2.1 MB body is refused plainly (413)", k.status === 413, `status ${k.status}`);
  // Free text with patient-like data is refused in feedback.
  const l = await call("edit", "POST", "/api/desktop/v1/feedback", { title: "SMOKE", description: "Patient SSN 123-45-6789 DOB 01/02/1980" }); ok("feedback refuses patient-like text", l.status >= 400 && l.status < 500, `status ${l.status}`);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error(`${pass} passed, ${fails.length} failed, then crashed: ${String(e).slice(0, 200)}`); process.exit(1); });
