// STAGING ONLY. Creates (or refreshes) fake users for the signed-in smoke test and prints one pairing token each.
// Usage inside a staging job: tsx scripts/staging-smoke-users.ts create | revoke
// Refuses to run anywhere that is not APP_ENV=staging. Users have @bbc.invalid emails (cannot receive mail or sign in with Google).
import { db } from "../src/lib/db";
import { MODULES } from "../src/lib/access";
import { newRefreshToken } from "../src/lib/desktop/tokens";

if (process.env.APP_ENV !== "staging") { console.error("Refusing: APP_ENV is not staging."); process.exit(2); }
const SPECS: { key: string; role: string; levels: Partial<Record<string, string>> }[] = [
  { key: "admin", role: "ADMIN", levels: {} },
  { key: "none", role: "STAFF", levels: {} },
  { key: "view", role: "STAFF", levels: Object.fromEntries(MODULES.map((m) => [m, "view"])) },
  { key: "edit", role: "PROVIDER", levels: Object.fromEntries(MODULES.map((m) => [m, "edit"])) },
  ...MODULES.map((m) => ({ key: `only-${m}`, role: "STAFF", levels: { [m]: "edit" } })),
];
const emailOf = (k: string) => `smoke-${k}@bbc.invalid`;

async function create() {
  const out: Record<string, string> = {};
  for (const s of SPECS) {
    const email = emailOf(s.key);
    const user = await db.user.upsert({ where: { email }, update: { role: s.role, active: true, name: `Smoke ${s.key}` }, create: { email, name: `Smoke ${s.key}`, role: s.role } });
    await db.moduleAccess.deleteMany({ where: { userId: user.id } });
    for (const [module, level] of Object.entries(s.levels)) await db.moduleAccess.create({ data: { userId: user.id, module, level } });
    await db.desktopSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    const t = newRefreshToken();
    await db.desktopSession.create({ data: { userId: user.id, tokenHash: t.hash, deviceLabel: "smoke test", expiresAt: new Date(Date.now() + 6 * 3600_000) } });
    out[s.key] = t.token;
  }
  console.log("SMOKE_TOKENS " + (process.argv[3] ?? "norun") + " " + JSON.stringify(out)); // run id lets the gate match THIS run, not an older revoked one
}
async function revoke() {
  const users = await db.user.findMany({ where: { email: { startsWith: "smoke-", endsWith: "@bbc.invalid" } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const r = await db.desktopSession.updateMany({ where: { userId: { in: ids }, revokedAt: null }, data: { revokedAt: new Date() } });
  await db.user.updateMany({ where: { id: { in: ids } }, data: { active: false } });
  console.log(`revoked ${r.count} session(s), deactivated ${ids.length} smoke user(s)`);
}
(process.argv[2] === "revoke" ? revoke() : create()).then(() => process.exit(0), (e) => { console.error("failed", String(e?.message ?? e).slice(0, 200)); process.exit(1); });
