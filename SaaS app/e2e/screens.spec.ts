import { test, expect, type Page } from "@playwright/test";
import { SCREENS } from "./screens";
import { signIn } from "./auth";
import { PrismaClient } from "@prisma/client";
import { E2E_DATABASE_URL } from "./env";

const VIEWPORTS = [
  { label: "desktop 1440", width: 1440, height: 900 },
  { label: "phone 390", width: 390, height: 844 },
];

async function resolvePath(path: string): Promise<string> {
  if (!path.includes(":patientId")) return path;
  const prisma = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } });
  try { const p = await prisma.patient.findFirstOrThrow({ where: { lastName: "TestAlpha" } }); return path.replace(":patientId", p.id); } finally { await prisma.$disconnect(); }
}

/** Layout facts measured in the browser. Pure DOM reads, nothing is clicked. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const tables = [...document.querySelectorAll("table")].filter(vis).map((t, i) => {
      const rows = [...t.querySelectorAll("tbody tr")].filter(vis);
      const heights = rows.map((r) => Math.round(r.getBoundingClientRect().height));
      const inlineFields = rows.filter((r) => r.querySelector("input[type=date], select, input[type=time]") && [...r.querySelectorAll("input[type=date], select, input[type=time]")].some(vis)).length;
      const blank = rows.filter((r) => !(r.textContent ?? "").trim() && !r.querySelector("input, button, select, img, svg")).length;
      const sorted = [...heights].sort((a, b) => a - b);
      return { index: i, rows: rows.length, heights, median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0, max: sorted.length ? sorted[sorted.length - 1] : 0, min: sorted.length ? sorted[0] : 0, inlineFields, blank };
    });
    const fields = [...document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]), textarea")].map((e) => (e as HTMLInputElement).value).join(" | ") + " | " + [...document.querySelectorAll("select")].map((e) => (e as HTMLSelectElement).selectedOptions[0]?.text ?? "").join(" | ");
    const cw = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("body *")].filter((e) => vis(e) && e.getBoundingClientRect().right > cw + 1).slice(0, 6).map((e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).join(".") : ""}(${Math.round(e.getBoundingClientRect().right)})`);
    return { wide, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, bodyText: document.body.innerText + " " + fields, tables };
  });
}

test.describe("every screen renders cleanly", () => {
  for (const vp of VIEWPORTS) {
    test.describe(vp.label, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });
      for (const s of SCREENS) {
        test(s.name, async ({ page, context }) => {
          const errors: string[] = [];
          page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
          // dnd-kit's aria id mismatch is a dev-server-only React warning (not present in the production build the gate runs).
          page.on("console", (m) => { if (m.type() === "error" && !/DndDescribedBy/.test(m.text())) errors.push("console: " + m.text().slice(0, 300)); });
          page.on("response", (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });
          if (!s.anonymous) await signIn(context);
          const path = await resolvePath(s.path);
          const res = await page.goto(path, { waitUntil: "networkidle" });
          if (s.notFoundOk) { expect(res?.status()).toBe(404); return; }
          expect(res?.status(), "page status").toBeLessThan(400);
          if (!s.anonymous) expect(new URL(page.url()).pathname, "was redirected away (login/denied)").toBe(s.redirectsTo ?? new URL(path, "http://x").pathname);
          const m = await measure(page);
          for (const want of s.expect) {
            if (typeof want === "string") expect(m.bodyText, `expected text "${want}"`).toContain(want);
            else expect(m.bodyText, `expected text ${want}`).toMatch(want);
          }
          expect(m.bodyText, "error page text").not.toMatch(/Application error|Internal Server Error|This page could not be found/i);
          const allowed = vp.width < 600 ? (s.phoneOverflowMax ?? 0) : 0;
          expect(m.scrollWidth, `horizontal overflow (${m.scrollWidth}px content in ${m.clientWidth}px, allowed +${allowed}; widest: ${m.wide.join(" ")})`).toBeLessThanOrEqual(m.clientWidth + 1 + allowed);
          for (const t of m.tables) {
            if (!s.inlineFieldsOk) expect(t.inlineFields, `table ${t.index}: rows showing inline edit fields by default`).toBe(0);
            expect(t.blank, `table ${t.index}: blank rows`).toBe(0);
            if (t.rows >= 3 && !s.unevenRowsOk) {
              expect(t.min, `table ${t.index}: collapsed row (heights ${t.heights.join(",")})`).toBeGreaterThanOrEqual(16);
              expect(t.max, `table ${t.index}: uneven row heights ${t.heights.join(",")}`).toBeLessThanOrEqual(Math.max(t.median * 4, 140));
            }
          }
          if (!s.skipConsole) expect(errors, "console/page errors").toEqual([]);
        });
      }
    });
  }
});
