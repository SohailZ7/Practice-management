import { describe, expect, it } from "vitest";
import { canAccess, canOpenAdmin, hasLevel, levelFor, wouldRemoveLastAdmin } from "../src/lib/access";

const staff = (access: { module: string; level: string }[], active = true) => ({
  role: "STAFF",
  active,
  access,
});

describe("levelFor / canAccess", () => {
  it("gives admins edit on everything", () => {
    const admin = { role: "ADMIN", active: true, access: [] };
    expect(levelFor(admin, "schedule")).toBe("edit");
    expect(canAccess(admin, "tasks", "edit")).toBe(true);
    expect(canOpenAdmin(admin)).toBe(true);
  });

  it("defaults to none when no row exists", () => {
    expect(levelFor(staff([]), "schedule")).toBe("none");
  });

  it("respects view vs edit", () => {
    const u = staff([{ module: "tasks", level: "view" }]);
    expect(canAccess(u, "tasks", "view")).toBe(true);
    expect(canAccess(u, "tasks", "edit")).toBe(false);
  });

  it("denies everything to inactive users, even admins", () => {
    const admin = { role: "ADMIN", active: false, access: [] };
    expect(levelFor(admin, "schedule")).toBe("none");
    expect(canOpenAdmin(admin)).toBe(false);
    expect(canAccess(staff([{ module: "tasks", level: "edit" }], false), "tasks", "view")).toBe(false);
  });

  it("ignores unknown level strings", () => {
    expect(levelFor(staff([{ module: "tasks", level: "root" }]), "tasks")).toBe("none");
  });

  it("only admins open the Access module", () => {
    expect(canOpenAdmin(staff([{ module: "schedule", level: "edit" }]))).toBe(false);
  });
});

describe("hasLevel", () => {
  it("orders none < view < edit", () => {
    expect(hasLevel("edit", "view")).toBe(true);
    expect(hasLevel("view", "edit")).toBe(false);
    expect(hasLevel("none", "none")).toBe(true);
  });
});

describe("wouldRemoveLastAdmin", () => {
  it("blocks demoting or deactivating the only admin", () => {
    expect(wouldRemoveLastAdmin(["a"], "a", { role: "STAFF", active: true })).toBe(true);
    expect(wouldRemoveLastAdmin(["a"], "a", { role: "ADMIN", active: false })).toBe(true);
  });

  it("allows it when another admin remains", () => {
    expect(wouldRemoveLastAdmin(["a", "b"], "a", { role: "STAFF", active: true })).toBe(false);
  });

  it("allows changes that keep the user an active admin", () => {
    expect(wouldRemoveLastAdmin(["a"], "a", { role: "ADMIN", active: true })).toBe(false);
  });

  it("does not care about non-admin targets", () => {
    expect(wouldRemoveLastAdmin(["a"], "b", { role: "STAFF", active: false })).toBe(false);
  });
});
