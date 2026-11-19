// Staging smoke test. Run before every promote:
//   SMOKE_BASE=https://<staging-url> SYNTHETIC_KEY=... [DESKTOP_TOKEN=...] npx tsx scripts/staging-smoke.ts
// No patient data is sent. The synthetic upload uses made-up text. Exits non-zero if any step fails.
const base = (process.env.SMOKE_BASE ?? "").replace(/\/$/, "");
const key = process.env.SYNTHETIC_KEY ?? "";
const token = process.env.DESKTOP_TOKEN ?? "";
if (!base) { console.error("Set SMOKE_BASE to the staging URL."); process.exit(2); }

type Step = { name: string; ok: boolean; note: string };
const steps: Step[] = [];
const rec = (name: string, ok: boolean, note = "") => { steps.push({ name, ok, note }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? "  (" + note + ")" : ""}`); };
const timed = async (url: string, init: RequestInit = {}) => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20_000);
  try { return await fetch(url, { redirect: "manual", ...init, signal: ctl.signal }); } finally { clearTimeout(t); }
};

async function main() {
  // 1. Sign-in page is up and is the staging build.
  try { const r = await timed(base + "/login"); const t = await r.text(); rec("login page loads", r.status === 200 && /sign in/i.test(t), `status ${r.status}`); } catch (e) { rec("login page loads", false, String(e).slice(0, 80)); }

  // 2. Protected screens refuse anonymous visitors (redirect to login), never show data.
  for (const p of ["/", "/schedule", "/tasks", "/employees", "/billing", "/billing/new", "/billing/patients", "/billing/programs", "/ledger", "/ledger/summary", "/ledger/settings", "/feedback", "/admin", "/settings"]) {
    try { const r = await timed(base + p); const loc = r.headers.get("location") ?? ""; rec(`anonymous ${p} is turned away`, [301, 302, 303, 307, 308].includes(r.status) && /login|denied/.test(loc), `status ${r.status}`); }
    catch (e) { rec(`anonymous ${p} is turned away`, false, String(e).slice(0, 80)); }
  }

  // 3. Desktop API refuses anonymous callers with a plain code.
  try { const r = await timed(base + "/api/desktop/v1/schedule?date=2026-01-01"); const j = await r.json().catch(() => ({})) as { error?: string }; rec("desktop API refuses no token", r.status === 401 && j.error === "unauthorized", `status ${r.status}`); } catch (e) { rec("desktop API refuses no token", false, String(e).slice(0, 80)); }

  // 3b. Every Desktop route answers the right method with a plain 401 (never 404/405/500), including the inbox PUT/link routes.
  const U = "3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b";
  for (const [method, path] of [["PUT", `/api/desktop/v1/notes/inbox/${U}`], ["POST", `/api/desktop/v1/notes/inbox/${U}/link`], ["GET", "/api/desktop/v1/notes/inbox?linked=false"], ["GET", "/api/mcp/v1/ledger"]] as const) {
    try { const r = await timed(base + path, { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" }); rec(`${method} ${path.split("?")[0].replace(U, ":uuid")} is routed and refuses anonymous`, r.status === 401, `status ${r.status}`); }
    catch (e) { rec(`${method} inbox route reachable`, false, String(e).slice(0, 80)); }
  }

  // 3c. A 250 KB body reaches the app (no proxy or load balancer cut-off) and gets the app's own 401, not a 413 or 5xx.
  try { const big = JSON.stringify({ seq: 1, text: "a".repeat(250_000) }); const r = await timed(base + `/api/desktop/v1/notes/inbox/${U}`, { method: "PUT", headers: { "content-type": "application/json" }, body: big }); const j = await r.json().catch(() => ({})) as { error?: string }; rec("250 KB PUT reaches the app", r.status === 401 && j.error === "unauthorized", `status ${r.status}`); } catch (e) { rec("250 KB PUT reaches the app", false, String(e).slice(0, 80)); }

  // 3d. No browser CORS grant to other origins (Desktop is not a browser).
  try { const r = await timed(base + "/api/desktop/v1/notes/inbox", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "PUT" } }); rec("no CORS grant to other origins", !r.headers.get("access-control-allow-origin"), `status ${r.status}`); } catch (e) { rec("no CORS grant to other origins", false, String(e).slice(0, 80)); }

  // 3e. Security headers present.
  try { const r = await timed(base + "/login"); const h = r.headers; rec("security headers on pages", !!h.get("strict-transport-security") && !!h.get("content-security-policy") && h.get("x-frame-options") === "DENY"); } catch (e) { rec("security headers on pages", false, String(e).slice(0, 80)); }

  // 3f. Parity with production (set PROD_BASE): every route that answers on staging must exist on prod after promote.
  // Before the promote this lists what the promote will add; after it, any difference is drift.
  const prod = (process.env.PROD_BASE ?? "").replace(/\/$/, "");
  if (prod) {
    for (const path of ["/api/desktop/v1/notes/inbox", `/api/desktop/v1/notes/inbox/${U}`, "/api/mcp/v1/ledger"]) {
      try { const a = await timed(base + path); const b = await timed(prod + path); console.log(`INFO  parity ${path.replace(U, ":uuid")}: staging ${a.status}, prod ${b.status}`); } catch (e) { console.log("INFO  parity probe failed", String(e).slice(0, 60)); }
    }
  }

  // 4. Synthetic upload: PUT checkpoint, final, retry, read back, link check. Made-up text only.
  if (key.length >= 32) {
    try { const r = await timed(base + "/api/internal/synthetic-upload", { headers: { authorization: `Bearer ${key}` } }); const j = await r.json().catch(() => ({})) as { ok?: boolean }; rec("synthetic upload round trip", r.status === 200 && j.ok === true, `status ${r.status}`); } catch (e) { rec("synthetic upload round trip", false, String(e).slice(0, 80)); }
  } else rec("synthetic upload round trip", false, "SYNTHETIC_KEY not set");

  // 5. With a Desktop token: schedule read, inbox list, billing-facing patient list reachable.
  if (token) {
    const h = { authorization: `Bearer ${token}` };
    for (const [name, path] of [["schedule day (desktop)", "/api/desktop/v1/schedule?date=" + new Date().toISOString().slice(0, 10)], ["unlinked inbox list", "/api/desktop/v1/notes/inbox?linked=false"]] as const) {
      try { const r = await timed(base + path, { headers: h }); rec(name, r.status === 200, `status ${r.status}`); } catch (e) { rec(name, false, String(e).slice(0, 80)); }
    }
    try { // upload with a made-up UUID and text, then repeat it (idempotent), then link attempt to a missing visit must be a plain 404
      const { createHash, randomUUID } = await import("node:crypto");
      const id = randomUUID(); const text = "SMOKE TEST made-up text, no patient";
      const body = JSON.stringify({ seq: 1, final: true, text, sha256: createHash("sha256").update(text).digest("hex"), durationSeconds: 1, recordedAt: new Date().toISOString() });
      const put = () => timed(base + `/api/desktop/v1/notes/inbox/${id}`, { method: "PUT", headers: { ...h, "content-type": "application/json" }, body });
      const a = await put(); const b = await put();
      rec("inbox PUT then identical retry", a.status === 200 && b.status === 200 && JSON.stringify(await a.json()) === JSON.stringify(await b.json()), `${a.status}/${b.status}`);
      const l = await timed(base + `/api/desktop/v1/notes/inbox/${id}/link`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ visitId: "does-not-exist" }) });
      rec("link to a missing visit is a plain 404", l.status === 404, `status ${l.status}`);
    } catch (e) { rec("inbox PUT then retry", false, String(e).slice(0, 80)); }
  } else console.log("SKIP  signed-in checks (set DESKTOP_TOKEN to a staging test pairing token)");

  const failed = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - failed.length}/${steps.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main();
