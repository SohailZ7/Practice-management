import { describe, expect, it } from "vitest";
import {
  AUDIT_PAGE_SIZE,
  auditCsv,
  auditQuery,
  auditWhere,
  buildReviewRows,
  describeFilters,
  flagsFor,
  pageCount,
  parseAuditFilters,
  reviewCsv,
  summarize,
  type ReviewUser,
} from "../src/lib/accessReview";
import { ruleFor } from "../src/lib/security/rateLimit";

const NOW = new Date("2026-10-18T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const user = (over: Partial<ReviewUser> = {}): ReviewUser => ({
  id: "u1",
  name: "ZZ Staff",
  email: "zz@example.test",
  role: "STAFF",
  active: true,
  createdAt: daysAgo(400),
  lastLoginAt: daysAgo(3),
  access: [{ module: "schedule", level: "edit" }, { module: "billing", level: "view" }],
  ...over,
});

describe("flagsFor", () => {
  it("has no flags for a recently active staff user", () => {
    expect(flagsFor(user(), NOW)).toEqual([]);
  });
  it("flags admins", () => {
    expect(flagsFor(user({ role: "ADMIN" }), NOW)).toEqual(["admin"]);
  });
  it("flags no sign-in in 90 days, at the boundary", () => {
    expect(flagsFor(user({ lastLoginAt: daysAgo(89) }), NOW)).toEqual([]);
    expect(flagsFor(user({ lastLoginAt: daysAgo(90) }), NOW)).toEqual(["no sign-in in 90 days"]);
  });
  it("treats an old account that never signed in as stale, a new one as 'never signed in'", () => {
    expect(flagsFor(user({ lastLoginAt: null, createdAt: daysAgo(120) }), NOW)).toEqual(["no sign-in in 90 days"]);
    expect(flagsFor(user({ lastLoginAt: null, createdAt: daysAgo(5) }), NOW)).toEqual(["never signed in"]);
  });
  it("flags inactive users without also calling them stale", () => {
    expect(flagsFor(user({ active: false, lastLoginAt: daysAgo(500) }), NOW)).toEqual(["inactive"]);
  });
  it("combines admin and stale", () => {
    expect(flagsFor(user({ role: "ADMIN", lastLoginAt: daysAgo(200) }), NOW)).toEqual(["admin", "no sign-in in 90 days"]);
  });
});

describe("buildReviewRows / summarize", () => {
  const rows = buildReviewRows(
    [
      user(),
      user({ id: "u2", email: "admin@example.test", name: "ZZ Admin", role: "ADMIN", access: [] }),
      user({ id: "u3", email: "gone@example.test", name: "ZZ Gone", active: false, lastLoginAt: null }),
      user({ id: "u4", email: "old@example.test", name: "ZZ Old", lastLoginAt: daysAgo(100), access: [{ module: "ledger", level: "bogus" }] }),
    ],
    [{ userId: "u1", employeeName: "Beta" }, { userId: "u1", employeeName: "Alpha" }],
    NOW,
  );
  it("shows each module level; admins get edit everywhere; inactive users none; junk levels none", () => {
    expect(rows[0].levels).toMatchObject({ schedule: "edit", billing: "view", tasks: "none", ledger: "none" });
    expect(Object.values(rows[1].levels)).toEqual(["edit", "edit", "edit", "edit", "edit"]);
    expect(Object.values(rows[2].levels).every((l) => l === "none")).toBe(true);
    expect(rows[3].levels.ledger).toBe("none");
  });
  it("lists task-view grants sorted, and formats last sign-in", () => {
    expect(rows[0].taskViewers).toEqual(["Alpha", "Beta"]);
    expect(rows[0].lastLogin).toBe("2026-10-15");
    expect(rows[2].lastLogin).toBe("never");
  });
  it("counts active admins and stale accounts", () => {
    expect(summarize(rows)).toEqual({ total: 4, active: 3, admins: 1, stale: 1 });
  });
  it("exports CSV with a header, quoting and formula protection", () => {
    const csv = reviewCsv(buildReviewRows([user({ name: "=HYPERLINK(1)", email: "a,b@example.test" })], [], NOW));
    const [head, row] = csv.split("\r\n");
    expect(head).toBe("Name,Email,Role,Active,Last sign-in,schedule,tasks,employees,billing,ledger,Can view tasks of,Flags");
    expect(row.startsWith(`'=HYPERLINK(1),"a,b@example.test",STAFF,yes,2026-10-15,edit,none,none,view,none,,`)).toBe(true);
  });
});

describe("parseAuditFilters / auditWhere", () => {
  it("applies defaults and ignores junk", () => {
    expect(parseAuditFilters({})).toEqual({ user: "", action: "", from: "", to: "", page: 1 });
    expect(parseAuditFilters({ from: "2026-13-45", to: "garbage", page: "-4" })).toEqual({ user: "", action: "", from: "", to: "", page: 1 });
    expect(parseAuditFilters({ page: "abc" }).page).toBe(1);
    expect(parseAuditFilters({ page: "3.7" }).page).toBe(3);
  });
  it("rejects dates that roll over (Feb 30)", () => {
    expect(parseAuditFilters({ from: "2026-02-30" }).from).toBe("");
    expect(parseAuditFilters({ from: "2026-02-28" }).from).toBe("2026-02-28");
  });
  it("normalises user, takes the first of repeated params, and limits length", () => {
    const f = parseAuditFilters({ user: ["  ZZ@Example.TEST ", "other"], action: "x".repeat(500) });
    expect(f.user).toBe("zz@example.test");
    expect(f.action).toHaveLength(80);
  });
  it("builds a where clause with inclusive end date", () => {
    const where = auditWhere(parseAuditFilters({ user: "zz", action: "billing.", from: "2026-10-01", to: "2026-10-18" }));
    expect(where.actorEmail).toEqual({ contains: "zz", mode: "insensitive" });
    expect(where.action).toEqual({ startsWith: "billing." });
    expect(where.createdAt?.gte?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(where.createdAt?.lt?.toISOString()).toBe("2026-10-19T00:00:00.000Z");
  });
  it("is empty without filters", () => {
    expect(auditWhere(parseAuditFilters({}))).toEqual({});
  });
  it("describes filters for the audit entry", () => {
    expect(describeFilters(parseAuditFilters({}))).toBe("no filters");
    expect(describeFilters(parseAuditFilters({ user: "zz", from: "2026-10-01" }))).toBe("user~zz, from 2026-10-01");
  });
});

describe("paging and CSV", () => {
  it("computes page counts", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(AUDIT_PAGE_SIZE)).toBe(1);
    expect(pageCount(AUDIT_PAGE_SIZE + 1)).toBe(2);
  });
  it("keeps filters in page links", () => {
    const f = parseAuditFilters({ user: "zz", page: "2" });
    expect(auditQuery(f)).toBe("user=zz&page=2");
    expect(auditQuery(f, 1)).toBe("user=zz");
  });
  it("exports audit rows as CSV", () => {
    const csv = auditCsv([{ createdAt: new Date("2026-10-18T01:02:03Z"), actorEmail: "a@x.test", action: "schedule.view", detail: 'week "x", n=3' }]);
    expect(csv).toBe('When (UTC),Who,Action,Detail\r\n2026-10-18T01:02:03.000Z,a@x.test,schedule.view,"week ""x"", n=3"\r\n');
  });
  it("rate-limits the access review exports like other exports", () => {
    expect(ruleFor("GET", "/admin/access-review/audit.csv", false)?.name).toBe("export");
    expect(ruleFor("GET", "/admin/access-review/users.csv", false)?.name).toBe("export");
    expect(ruleFor("GET", "/admin/access-review", false)).toBeNull();
  });
});
