// Regression guard for the merged Employees page (Sohail 2026-11-20): the old Employees directory and the Admin > People
// logins/access tab are ONE tab, "Employees", under MANAGE. Nothing from either was dropped. Runs under vitest (npm test).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ADMIN_PAGES } from "../src/lib/adminNav";

const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/app/employees/page.tsx");
const people = read("src/components/admin/PeopleSection.tsx");
const shell = read("src/components/AppShell.tsx");

describe("one Employees tab under Manage", () => {
  it("is in the MANAGE group, not OPERATIONS, still gated by the employees module", () => {
    const manage = shell.slice(shell.indexOf("const manage"), shell.indexOf("const commands"));
    expect(manage).toMatch(/href: "\/employees", label: "Employees"[^\n]*levels\.employees === "none"/);
    const ops = shell.slice(shell.indexOf("const operations"), shell.indexOf("const items"));
    expect(ops).not.toContain("/employees");
  });
  it("Admin has no People tab, and /admin lands on the first remaining tab", () => {
    expect(ADMIN_PAGES.map((p) => p.label)).not.toContain("People");
    expect(read("src/app/admin/page.tsx")).toContain('redirect("/admin/task-tabs")');
    expect(read("src/app/admin/access/page.tsx")).toContain("/employees#logins");
  });
  it("keeps every staff-record field and action from the old Employees page", () => {
    for (const f of ['name="name"', 'name="title"', 'name="email"', 'name="phone"', 'name="active"', "giveLogin", "addEmployee", "updateEmployee"]) expect(page).toContain(f);
    expect(page).toContain('requireAccess("employees", "view")');
    expect(page).toContain('canAccess(user, "employees", "edit")');
  });
  it("keeps every login field, flag and permission from the old People tab (admin only)", () => {
    for (const f of ['name="name"', 'name="email"', 'name="role"', 'name="active"', 'name="showFullNames"', 'name="feedbackApprover"', "level_${m}", "MODULES.map", "updatePerson", "deleteUser", "revokeDesktopSessions", "addUser", "<BulkSave>", 'data-bulk="people"']) expect(people).toContain(f);
    expect(people).toContain("admin: all areas");
    expect(page).toMatch(/isAdmin && <PeopleSection/);
  });
  it("the Notes access level is one of the modules shown per person", () => {
    expect(read("src/lib/access.ts")).toMatch(/MODULES = \[[^\]]*"notes"/);
  });
  it("people actions return to the Employees page", () => {
    expect(read("src/app/admin/actions.ts")).toContain('const BACK = "/employees"');
  });
  it("no data model change", () => {
    expect(read("prisma/schema.prisma")).toContain("model Employee");
    expect(read("prisma/schema.prisma")).toContain("model ModuleAccess");
  });
});
