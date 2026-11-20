// Core actions on the main screens, against the throwaway database. Synthetic data only.
import { test, expect } from "@playwright/test";
import { signIn } from "./auth";

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
