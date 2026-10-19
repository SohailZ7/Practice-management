// Pure helpers for the Admin access review: flags, rows, audit-log filters and CSV. No database imports.

import { LEVELS, MODULES, type ModuleName } from "./access";
import { csvField } from "./ledger/validate";

export const STALE_DAYS = 90;
export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_EXPORT_MAX = 50000;
const DAY = 86_400_000;

export type ReviewUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  access: { module: string; level: string }[];
};

export type ReviewRow = {
  name: string;
  email: string;
  role: string;
  active: boolean;
  lastLogin: string; // ISO date, or "never"
  levels: Record<ModuleName, string>;
  taskViewers: string[]; // names of employees whose tasks this user may view
  flags: string[];
};

export function daysSince(date: Date, now: Date): number {
  return Math.floor((now.getTime() - date.getTime()) / DAY);
}

/** "admin", "no sign-in in 90 days" (or never, for accounts older than 90 days), "inactive". */
export function flagsFor(u: ReviewUser, now: Date): string[] {
  const flags: string[] = [];
  if (u.role === "ADMIN") flags.push("admin");
  if (!u.active) flags.push("inactive");
  else if (u.lastLoginAt) {
    if (daysSince(u.lastLoginAt, now) >= STALE_DAYS) flags.push(`no sign-in in ${STALE_DAYS} days`);
  } else if (daysSince(u.createdAt, now) >= STALE_DAYS) {
    flags.push(`no sign-in in ${STALE_DAYS} days`);
  } else {
    flags.push("never signed in");
  }
  return flags;
}

export function buildReviewRows(
  users: ReviewUser[],
  viewers: { userId: string; employeeName: string }[],
  now: Date,
): ReviewRow[] {
  return users.map((u) => ({
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    lastLogin: u.lastLoginAt ? u.lastLoginAt.toISOString().slice(0, 10) : "never",
    // Admins have edit on everything whatever their rows say.
    levels: Object.fromEntries(
      MODULES.map((m) => {
        const level = u.access.find((a) => a.module === m)?.level;
        return [m, !u.active ? "none" : u.role === "ADMIN" ? "edit" : level && (LEVELS as readonly string[]).includes(level) ? level : "none"];
      }),
    ) as Record<ModuleName, string>,
    taskViewers: viewers.filter((v) => v.userId === u.id).map((v) => v.employeeName).sort(),
    flags: flagsFor(u, now),
  }));
}

export function summarize(rows: ReviewRow[]) {
  const active = rows.filter((r) => r.active);
  return {
    total: rows.length,
    active: active.length,
    admins: active.filter((r) => r.role === "ADMIN").length,
    stale: rows.filter((r) => r.flags.some((f) => f.startsWith("no sign-in"))).length,
  };
}

const line = (cells: string[]) => cells.map((c) => csvField(c)).join(",");

export function reviewCsv(rows: ReviewRow[]): string {
  const head = ["Name", "Email", "Role", "Active", "Last sign-in", ...MODULES, "Can view tasks of", "Flags"];
  const body = rows.map((r) =>
    line([r.name, r.email, r.role, r.active ? "yes" : "no", r.lastLogin, ...MODULES.map((m) => r.levels[m]), r.taskViewers.join("; "), r.flags.join("; ")]),
  );
  return [line(head), ...body].join("\r\n") + "\r\n";
}

// ---- Audit-log viewer ----

export type AuditFilters = { user: string; action: string; from: string; to: string; page: number };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (s: string) => ISO.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

export function parseAuditFilters(q: Record<string, string | string[] | undefined>): AuditFilters {
  const one = (k: string) => {
    const v = q[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const page = Math.floor(Number(one("page")));
  return {
    user: one("user").trim().toLowerCase().slice(0, 200),
    action: one("action").trim().slice(0, 80),
    from: validDay(one("from")) ? one("from") : "",
    to: validDay(one("to")) ? one("to") : "",
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 100000) : 1,
  };
}

/** Prisma `where` for the filters. Dates are UTC days; `to` is inclusive. Action matches by prefix ("billing." finds all billing). */
export function auditWhere(f: AuditFilters) {
  const where: {
    actorEmail?: { contains: string; mode: "insensitive" };
    action?: { startsWith: string };
    createdAt?: { gte?: Date; lt?: Date };
  } = {};
  if (f.user) where.actorEmail = { contains: f.user, mode: "insensitive" };
  if (f.action) where.action = { startsWith: f.action };
  if (f.from || f.to) {
    where.createdAt = {};
    if (f.from) where.createdAt.gte = new Date(`${f.from}T00:00:00Z`);
    if (f.to) where.createdAt.lt = new Date(new Date(`${f.to}T00:00:00Z`).getTime() + DAY);
  }
  return where;
}

/** A short description of the filters for the audit entry (no free text beyond what the Admin typed into filters). */
export function describeFilters(f: AuditFilters): string {
  const parts = [f.user && `user~${f.user}`, f.action && `action=${f.action}*`, f.from && `from ${f.from}`, f.to && `to ${f.to}`].filter(Boolean);
  return parts.length ? parts.join(", ") : "no filters";
}

export type AuditRow = { createdAt: Date; actorEmail: string; action: string; detail: string };

export function auditCsv(rows: AuditRow[]): string {
  const head = line(["When (UTC)", "Who", "Action", "Detail"]);
  return [head, ...rows.map((r) => line([r.createdAt.toISOString(), r.actorEmail, r.action, r.detail]))].join("\r\n") + "\r\n";
}

export function pageCount(total: number, size = AUDIT_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

/** Query string for a link, keeping the filters. */
export function auditQuery(f: AuditFilters, page = f.page): string {
  const p = new URLSearchParams();
  if (f.user) p.set("user", f.user);
  if (f.action) p.set("action", f.action);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (page > 1) p.set("page", String(page));
  return p.toString();
}
