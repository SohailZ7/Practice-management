import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "./auth";
import { db } from "./db";
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
  const user = await db.user.findUnique({
    where: { email: normalizeEmail(email) },
    include: { access: true },
  });
  if (!user || !user.active) return null;
  return user;
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** AUTH-5: call at the top of every page and server action. */
export async function requireAccess(module: ModuleName, needed: Level): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canAccess(user, module, needed)) redirect("/denied");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canOpenAdmin(user)) redirect("/denied");
  return user;
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
