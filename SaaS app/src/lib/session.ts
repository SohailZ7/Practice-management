import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { authOptions } from "./auth";
import { audit } from "./audit";
import { db } from "./db";
import { checkSession, sessionPolicy } from "./sessionExpiry";
import {
  canAccess,
  canOpenAdmin,
  levelFor,
  normalizeEmail,
  type Level,
  type ModuleName,
} from "./access";

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/** Looks the user up in the database on every call so access changes take effect immediately. */
export async function getCurrentUser() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  // Second line of defence behind middleware: an idle or too-old session is signed out.
  const verdict = checkSession({ authAt: session.authAt, lastActive: session.lastActive }, Date.now(), sessionPolicy());
  if (!verdict.ok) return null;
  const user = await db.user.findUnique({
    where: { email: normalizeEmail(email) },
    include: { access: true },
  });
  if (!user || !user.active) return null;
  return user;
}

/** Idle/absolute deadlines for the browser's countdown. The server enforces them regardless. */
export async function getSessionTiming() {
  const session = await getServerSession(authOptions);
  const policy = sessionPolicy();
  const verdict = checkSession({ authAt: session?.authAt, lastActive: session?.lastActive }, Date.now(), policy);
  if (!verdict.ok) return null;
  return { idleMs: policy.idleMs, absoluteDeadline: verdict.absoluteDeadline, serverNow: Date.now() };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** AUTH-5: call at the top of every page and server action. */
export async function requireAccess(module: ModuleName, needed: Level): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canAccess(user, module, needed)) {
    await auditDenied(user.email, `${module}:${needed}`);
    redirect("/denied");
  }
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canOpenAdmin(user)) {
    await auditDenied(user.email, "admin");
    redirect("/denied");
  }
  return user;
}

/** A signed-in user reached a page or action they may not use. Path only, never the query string. */
export async function auditDenied(email: string, needed: string): Promise<void> {
  let path = "";
  try {
    path = headers().get("x-pathname") ?? "";
  } catch {
    // outside a request
  }
  await audit(email, "access.denied", `needed ${needed}${path ? ` at ${path.slice(0, 120)}` : ""}`);
}

export function levels(user: CurrentUser) {
  return {
    schedule: levelFor(user, "schedule"),
    tasks: levelFor(user, "tasks"),
    employees: levelFor(user, "employees"),
    billing: levelFor(user, "billing"),
    ledger: levelFor(user, "ledger"),
  };
}
