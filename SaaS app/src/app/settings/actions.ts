"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { THEMES, normalizeTheme } from "@/lib/theme";
import { audit } from "@/lib/audit";
import { flash, str } from "@/lib/flash";

export async function saveTheme(form: FormData) {
  const user = await requireUser();
  const raw = str(form, "theme");
  if (!(THEMES as readonly string[]).includes(raw)) flash("/settings", "error", "Choose Light, Dark or System.");
  await db.user.update({ where: { id: user.id }, data: { theme: normalizeTheme(raw) } });
  revalidatePath("/", "layout");
  flash("/settings", "notice", "Theme saved.");
}

/** API-9: end one of the user's own Desktop App sessions. */
export async function revokeMyDesktopSession(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  const res = await db.desktopSession.updateMany({ where: { id, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (res.count) await audit(user.email, "desktop.session.revoke", `session ${id}`);
  revalidatePath("/settings");
  flash("/settings", "notice", res.count ? "Signed out of that Mac." : "That session was already ended.");
}
