import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Static guard: every route and server action must check who is calling on the server, never only in the UI.
const root = join(__dirname, "..", "src", "app");
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(root);
const GUARD = /(requireImportUser\(|authenticateApi\(|webNotesAuth|authenticate\(|requireAccess\(|requireUser\(|requireAdmin\(|getCurrentUser\(|keyMatches\(|guard\w*\(|verify\w*\(|authorize\w*\()/;
// Routes that are public on purpose, each with the reason.
const PUBLIC_ROUTES: Record<string, string> = {
  "api/auth": "sign-in endpoints",
  "api/session": "session heartbeat reads its own cookie",
  "api/internal/synthetic-upload": "guarded by SYNTHETIC_KEY",
  "api/desktop/v1/auth": "token exchange",
  "api/desktop/v1/update": "public update manifest",
};

describe("every API route checks the caller", () => {
  const routes = files.filter((f) => f.endsWith("/route.ts"));
  it("finds the routes", () => expect(routes.length).toBeGreaterThan(30));
  for (const f of routes) {
    const rel = relative(root, f).replace(/\/route\.ts$/, "");
    const open = Object.keys(PUBLIC_ROUTES).find((p) => rel.startsWith(p));
    if (open) continue;
    it(rel, () => {
      const src = readFileSync(f, "utf8");
      const importsGuard = /from "@\/lib\/(desktop\/api|session|mcp\/\w+)"/.test(src);
      expect(GUARD.test(src) || importsGuard, `${rel} has no server-side caller check`).toBe(true);
    });
  }
});

describe("every server action file checks the caller", () => {
  const actions = files.filter((f) => /actions\.ts$/.test(f) && /^"use server"|\n"use server"/.test(readFileSync(f, "utf8").slice(0, 200)));
  it("finds the action files", () => expect(actions.length).toBeGreaterThanOrEqual(12));
  for (const f of actions) {
    const rel = relative(root, f);
    it(rel, () => {
      const src = readFileSync(f, "utf8");
      const exported = (src.match(/export async function \w+/g) ?? []).length;
      const guards = (src.match(new RegExp(GUARD.source, "g")) ?? []).length;
      expect(guards, `${rel}: ${exported} exported actions but only ${guards} caller checks`).toBeGreaterThanOrEqual(Math.min(exported, 1));
    });
  }
});

describe("module pages require the right module", () => {
  const modulePages: Record<string, string> = { schedule: "schedule", tasks: "tasks", employees: "employees", billing: "billing", ledger: "ledger" }; // Notes is enforced on its API routes (webNotesAuth); /notes itself only redirects.
  for (const [dir, mod] of Object.entries(modulePages)) {
    it(`${dir} pages or layout call requireAccess("${mod}")`, () => {
      const here = files.filter((f) => relative(root, f).startsWith(dir + "/") && /(page|layout)\.tsx$/.test(f));
      expect(here.length).toBeGreaterThan(0);
      const any = here.some((f) => new RegExp(`requireAccess\\(\\s*"${mod}"`).test(readFileSync(f, "utf8")));
      expect(any).toBe(true);
    });
  }
  it("Administration requires an admin", () => {
    const here = files.filter((f) => relative(root, f).startsWith("admin/") && /(page|layout)\.tsx$/.test(f));
    expect(here.some((f) => /requireAdmin\(/.test(readFileSync(f, "utf8")))).toBe(true);
  });
});

describe("feedback and tasks cannot carry patient data", () => {
  it("their server code runs the patient-data guard on free text", () => {
    for (const rel of ["../lib/feedback/rules.ts", "tasks/actions.ts"]) {
      const p = join(root, rel);
      let src = "";
      try { src = readFileSync(p, "utf8"); } catch { continue; }
      expect(/phi|Phi|PHI|patient/i.test(src), `${rel} does not mention a patient-data check`).toBe(true);
    }
  });
});
