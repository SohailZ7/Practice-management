import { describe, expect, it } from "vitest";
import { MODULES, LEVELS, ROLES, canAccess, levelFor, canOpenAdmin, wouldRemoveLastAdmin, DEFAULT_ACCESS, hasLevel, type AccessUser } from "../src/lib/access";

const user = (role: string, module: string | null, level: string | null, active = true): AccessUser => ({
  role, active, access: module && level ? [{ module, level }] : [],
});

describe("every module x every level x every role", () => {
  for (const m of MODULES) {
    for (const lvl of LEVELS) {
      it(`${m}: STAFF/PROVIDER with "${lvl}" gets exactly that`, () => {
        for (const role of ["STAFF", "PROVIDER"]) {
          const u = user(role, m, lvl);
          expect(canAccess(u, m, "view")).toBe(lvl === "view" || lvl === "edit");
          expect(canAccess(u, m, "edit")).toBe(lvl === "edit");
          for (const other of MODULES) if (other !== m) expect(canAccess(u, other, "view")).toBe(false);
        }
      });
    }
    it(`${m}: no row at all means no access`, () => {
      expect(levelFor(user("STAFF", null, null), m)).toBe("none");
    });
    it(`${m}: admin always edits; an inactive admin gets nothing`, () => {
      expect(canAccess(user("ADMIN", null, null), m, "edit")).toBe(true);
      expect(canAccess(user("ADMIN", null, null, false), m, "view")).toBe(false);
    });
    it(`${m}: inactive user with edit gets nothing`, () => {
      expect(canAccess(user("STAFF", m, "edit", false), m, "view")).toBe(false);
    });
  }
  it("garbage levels or roles never grant anything", () => {
    for (const bad of ["EDIT", "admin", "", "owner", "write", "1"]) {
      expect(levelFor(user("STAFF", "billing", bad), "billing")).toBe("none");
    }
    expect(levelFor(user("admin", null, null), "billing")).toBe("none"); // role names are case sensitive
    expect(ROLES).toEqual(["ADMIN", "PROVIDER", "STAFF"]);
  });
  it("the first row for a module wins only if valid; duplicates cannot upgrade a view user silently", () => {
    const u: AccessUser = { role: "STAFF", active: true, access: [{ module: "billing", level: "view" }, { module: "billing", level: "edit" }] };
    expect(levelFor(u, "billing")).toBe("view");
  });
  it("only an active admin opens Administration", () => {
    expect(canOpenAdmin(user("ADMIN", null, null))).toBe(true);
    expect(canOpenAdmin(user("ADMIN", null, null, false))).toBe(false);
    expect(canOpenAdmin(user("PROVIDER", "notes", "edit"))).toBe(false);
  });
  it("new logins cannot see billing, ledger or notes until granted", () => {
    expect(DEFAULT_ACCESS).toMatchObject({ billing: "none", ledger: "none", notes: "none" });
    expect(hasLevel("view", "edit")).toBe(false);
  });
  it("the last active admin cannot be removed, demoted or deactivated", () => {
    expect(wouldRemoveLastAdmin(["a"], "a", { role: "STAFF", active: true })).toBe(true);
    expect(wouldRemoveLastAdmin(["a"], "a", { role: "ADMIN", active: false })).toBe(true);
    expect(wouldRemoveLastAdmin(["a", "b"], "a", { role: "STAFF", active: true })).toBe(false);
    expect(wouldRemoveLastAdmin(["a"], "a", { role: "ADMIN", active: true })).toBe(false);
  });
});
