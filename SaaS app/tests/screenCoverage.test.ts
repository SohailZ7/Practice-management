import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { SCREENS, SKIPPED } from "../e2e/screens";

// Every page.tsx in src/app must be in the screen regression list (e2e/screens.ts) or be skipped with a reason.
function pages(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) pages(p, out);
    else if (f === "page.tsx") out.push(p);
  }
  return out;
}

describe("screen regression coverage", () => {
  const root = path.resolve(__dirname, "..");
  const found = pages(path.join(root, "src/app")).map((p) => path.relative(root, p).split(path.sep).join("/"));
  const routeOf = (file: string) => "/" + file.replace("src/app/", "").replace(/\/?page\.tsx$/, "");
  const listed = new Set(SCREENS.map((s) => s.path.split("?")[0].replace(":patientId", "[id]")));

  it("covers every page or documents why it is skipped", () => {
    const missing = found.filter((f) => !listed.has(routeOf(f)) && !(f in SKIPPED));
    expect(missing, "add these pages to e2e/screens.ts (or SKIPPED with a reason)").toEqual([]);
  });
  it("lists no page that no longer exists", () => {
    const routes = new Set(found.map(routeOf));
    expect([...listed].filter((r) => !routes.has(r))).toEqual([]);
  });
});
