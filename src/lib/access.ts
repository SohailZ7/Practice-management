// Pure access-control rules. No database or framework imports so they are easy to test.

export const MODULES = ["schedule", "tasks", "employees", "billing"] as const;
export type ModuleName = (typeof MODULES)[number];

export const LEVELS = ["none", "view", "edit"] as const;
export type Level = (typeof LEVELS)[number];

export const ROLES = ["ADMIN", "PROVIDER", "STAFF"] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Level, number> = { none: 0, view: 1, edit: 2 };

export type AccessUser = {
  role: string;
  active: boolean;
  access: { module: string; level: string }[];
};

export function isLevel(value: string): value is Level {
  return (LEVELS as readonly string[]).includes(value);
}

export function isModule(value: string): value is ModuleName {
  return (MODULES as readonly string[]).includes(value);
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function hasLevel(actual: Level, needed: Level): boolean {
  return RANK[actual] >= RANK[needed];
}

/** Effective access level of a user for a module. Admins get edit everywhere. */
export function levelFor(user: AccessUser, module: ModuleName): Level {
  if (!user.active) return "none";
  if (user.role === "ADMIN") return "edit";
  const row = user.access.find((a) => a.module === module);
  return row && isLevel(row.level) ? row.level : "none";
}

export function canAccess(user: AccessUser, module: ModuleName, needed: Level): boolean {
  return hasLevel(levelFor(user, module), needed);
}

export function canOpenAdmin(user: AccessUser): boolean {
  return user.active && user.role === "ADMIN";
}

/**
 * The last active admin must never be deactivated or demoted.
 * `admins` is the list of currently active admins (ids).
 */
export function wouldRemoveLastAdmin(
  admins: string[],
  targetId: string,
  after: { role: string; active: boolean },
): boolean {
  const remains = after.active && after.role === "ADMIN";
  if (remains) return false;
  return admins.filter((id) => id !== targetId).length === 0 && admins.includes(targetId);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
