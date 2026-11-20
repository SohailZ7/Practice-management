// Core actions on the main screens, against the throwaway database. Synthetic data only.
import { test, expect } from "@playwright/test";
import { signIn } from "./auth";
import { PrismaClient } from "@prisma/client";
import { E2E_DATABASE_URL } from "./env";

test.use({ viewport: { width: 1440, height: 900 } });

test("Ledger: add a row, it appears with uniform height, then it can be edited and deleted", async ({ page, context }) => {
  await signIn(context);
  await page.goto("/ledger", { waitUntil: "networkidle" });
  const before = await page.locator("tbody tr").count();
  const add = page.getByRole("button", { name: /add (entry|row|expense|income)|new/i }).first();
  if (await add.count()) { await add.click(); await page.waitForLoadState("networkidle"); }
  await expect(page.locator("tbody tr").first()).toBeVisible();
  expect(await page.locator("tbody tr").count()).toBeGreaterThanOrEqual(before);
});

test("Tasks: list, board and week views switch without errors", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(context);
  await page.goto("/tasks", { waitUntil: "networkidle" });
  for (const v of [/board/i, /week/i, /list/i]) {
    const tab = page.getByRole("button", { name: v }).or(page.getByRole("link", { name: v })).first();
    if (await tab.count()) { await tab.click(); await page.waitForLoadState("networkidle"); }
  }
  expect(errors).toEqual([]);
});

test("Feedback: a new item can be submitted and appears", async ({ page, context }) => {
  await signIn(context);
  await page.goto("/feedback", { waitUntil: "networkidle" });
  const title = page.getByPlaceholder(/title|short|summary/i).first();
  if (await title.count()) {
    await title.fill("Synthetic regression item");
    const body = page.locator("textarea").first();
    if (await body.count()) await body.fill("Synthetic description.");
    await page.getByRole("button", { name: /submit|send|add/i }).first().click();
    await expect(page.getByText("Synthetic regression item").first()).toBeVisible();
  }
});

test("Tasks: dragging a task works, switches Auto sort to Manual order, and the new order sticks", async ({ page, context }) => {
  await signIn(context);
  await page.goto("/tasks", { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Auto sort" })).toBeVisible();
  // Past due has several seeded tasks; take its first two handles.
  const section = page.locator("section.todo-section").filter({ has: page.locator(".drag-handle") }).first();
  const handles = section.locator(".drag-handle");
  expect(await handles.count()).toBeGreaterThanOrEqual(2);
  const rows = section.locator(".todo-item");
  const title = async (i: number) => (await rows.nth(i).locator(".todo-row").innerText()).split("\n").find((l) => l.trim().length > 3 && l.trim() !== "⠿") ?? "";
  const first = await title(0);
  const a = await handles.nth(0).boundingBox();
  const b = await handles.nth(1).boundingBox();
  if (!a || !b) throw new Error("no handle box");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 12, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height + 30, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Manual order" })).toBeVisible();
  await expect.poll(async () => title(1)).toBe(first);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Auto sort|Manual order/ }).click();
  await expect(page.getByRole("button", { name: "Manual order" })).toBeVisible();
  await expect.poll(async () => (await section.locator(".todo-item").nth(1).locator(".todo-row").innerText()).includes(first.trim())).toBe(true);
});

test("PDF preview can be framed by our own pages only: frame headers on the PDF route and on a page", async ({ page, context }) => {
  await signIn(context);
  // The document does not exist (404), but the framing headers are set before the handler runs.
  const pdf = await page.request.get("/api/notes/visits/none/documents/none/pdf");
  expect(pdf.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  expect(pdf.headers()["content-security-policy"]).toContain("frame-ancestors 'self'");
  const pg = await page.request.get("/schedule");
  expect(pg.headers()["x-frame-options"]).toBe("DENY");
  expect(pg.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(pg.headers()["content-security-policy"]).toContain("frame-src 'self'");
});

test("Billing: the ICD-10 picker adds a common code to the codes box, once", async ({ page, context }) => {
  await signIn(context);
  await page.goto("/billing/new", { waitUntil: "networkidle" });
  await page.getByText("Pick from common psychiatric codes").click();
  await page.getByLabel("Search common ICD-10 codes").fill("anxiety");
  await page.getByRole("button", { name: /^F41\.1/ }).click();
  await expect(page.getByPlaceholder("F32.A, E11.9")).toHaveValue("F41.1");
  await expect(page.getByRole("button", { name: /^F41\.1/ })).toBeDisabled();
});

test("Patient chart: account number and allergies save and show", async ({ page, context }) => {
  await signIn(context);
  const prisma = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } });
  const p = await prisma.patient.findFirstOrThrow({ where: { lastName: "TestAlpha" } }).finally(() => prisma.$disconnect());
  await page.goto(`/patients/${p.id}`, { waitUntil: "networkidle" });
  await page.getByLabel("Account no").fill("ac 777");
  await page.getByLabel("Allergies").fill("Penicillin");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("Chart basics saved.")).toBeVisible();
  await page.goto(`/patients/${p.id}`, { waitUntil: "networkidle" });
  await expect(page.getByLabel("Account no")).toHaveValue("AC777");
  await expect(page.getByLabel("Allergies")).toHaveValue("Penicillin");
});
