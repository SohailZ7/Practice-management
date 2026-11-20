import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ADMIN_PAGES } from "../src/lib/adminNav";
import { formDataFrom, resultFromRedirect, savedMessage } from "../src/lib/adminBulk";

const redirectErr = (url: string) => Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${url};307;` });

describe("redirect results", () => {
  it("reads a notice and an error from the redirect an action ends with", () => {
    expect(resultFromRedirect(redirectErr("/admin?notice=Updated%20a%40b.org."))).toEqual({ ok: true, message: "Updated a@b.org." });
    expect(resultFromRedirect(redirectErr("/admin/timesheets?e=1&m=2026-11&error=Enter%20times"))).toEqual({ ok: false, message: "Enter times" });
    expect(resultFromRedirect(new Error("boom"))).toBeNull();
  });
  it("summarises counts, with failures named", () => {
    expect(savedMessage({ saved: 3, failed: [] })).toBe("3 changes saved.");
    expect(savedMessage({ saved: 1, failed: [{ index: 1, message: "Bad time" }] })).toBe("1 change saved. 1 not saved: Bad time");
  });
  it("rebuilds form data from posted fields", () => {
    expect(formDataFrom([["a", "1"], ["a", "2"]]).getAll("a")).toEqual(["1", "2"]);
  });
});

const calls = vi.hoisted(() => ({ updatePerson: vi.fn(), setTaskViewers: vi.fn(), entry: vi.fn(), pay: vi.fn(), audits: [] as string[] }));
vi.mock("../src/app/admin/actions", () => ({ updatePerson: calls.updatePerson, setTaskViewers: calls.setTaskViewers }));
vi.mock("../src/app/admin/timesheets/actions", () => ({ updateTimesheetEntry: calls.entry, updateTimesheetPayment: calls.pay }));
vi.mock("../src/lib/session", () => ({ requireAdmin: async () => ({ email: "admin@example.org" }) }));
vi.mock("../src/lib/audit", () => ({ audit: async (_a: string, action: string, d: string) => { calls.audits.push(`${action} ${d}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
const { saveAllAction } = await import("../src/app/admin/bulk");

beforeEach(() => { vi.clearAllMocks(); calls.audits = []; });

describe("saveAllAction", () => {
  it("runs each row's own Save action, counts saves and failures, and audits counts only", async () => {
    calls.updatePerson.mockImplementationOnce(async () => { throw redirectErr("/admin?notice=ok"); });
    calls.updatePerson.mockImplementationOnce(async () => { throw redirectErr("/admin?error=Another%20admin%20is%20needed"); });
    calls.entry.mockImplementationOnce(async () => { throw redirectErr("/admin/timesheets?notice=Entry%20saved."); });
    const r = await saveAllAction([
      { kind: "people", fields: [["id", "u1"]] },
      { kind: "people", fields: [["id", "u2"]] },
      { kind: "tsEntry", fields: [["id", "t1"]] },
      { kind: "nope", fields: [] },
    ]);
    expect(r.saved).toBe(2);
    expect(r.failed).toEqual([{ index: 1, message: "Another admin is needed" }, { index: 3, message: "Unknown row." }]);
    expect(calls.audits.at(-1)).toBe("admin.bulk_save rows=4 saved=2 failed=2");
  });
  it("is admin-only", () => {
    expect(readFileSync("src/app/admin/bulk.ts", "utf8")).toContain("await requireAdmin()");
  });
});

describe("Admin navigation", () => {
  it("has one Task tabs tab and no People tab (people moved to Employees)", () => {
    const labels = ADMIN_PAGES.map((p) => p.label);
    expect(labels).not.toContain("People");
    expect(labels).toContain("Task tabs");
    for (const gone of ["Users", "Module access", "Task tab access"]) expect(labels).not.toContain(gone);
  });
  it("old addresses redirect", () => {
    expect(readFileSync("src/app/admin/access/page.tsx", "utf8")).toContain('redirect("/employees#logins")');
    expect(readFileSync("src/app/admin/task-access/page.tsx", "utf8")).toContain('redirect("/admin/task-tabs")');
  });
  it("every Admin tab with row saves uses the shared bar", () => {
    for (const f of ["src/components/admin/PeopleSection.tsx", "src/app/admin/task-tabs/page.tsx", "src/app/admin/timesheets/page.tsx"]) {
      const t = readFileSync(f, "utf8");
      expect(t).toContain("<BulkSave>");
      expect(t).toContain("data-bulk=");
    }
  });
});
