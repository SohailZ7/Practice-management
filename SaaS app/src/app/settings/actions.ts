"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { newRefreshToken, sessionExpiry } from "@/lib/desktop/tokens";
import { requireUser } from "@/lib/session";
import { THEMES, normalizeTheme } from "@/lib/theme";
import { audit } from "@/lib/audit";
import { RECORDER_TOKEN_COOKIE } from "@/lib/desktop/tokens";
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

/**
 * Connects a Mac recorder: creates a session and returns its token **once**. Only the token's hash is stored, so it
 * cannot be shown again; if it is lost, connect the recorder again and revoke the old one.
 */
export async function connectRecorder(form: FormData) {
  const user = await requireUser();
  const label = str(form, "label").slice(0, 60) || "Mac";
  const token = newRefreshToken();
  const session = await db.desktopSession.create({
    data: { userId: user.id, tokenHash: token.hash, deviceLabel: label, expiresAt: sessionExpiry() },
  });
  await audit(user.email, "desktop.recorder.connect", `session ${session.id}`);
  revalidatePath("/settings");
  // The token travels in a 60-second HttpOnly cookie, not the redirect URL (URLs end up in request logs).
  cookies().set(RECORDER_TOKEN_COOKIE, `${label}\n${token.token}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/settings", maxAge: 60 });
  flash("/settings", "notice", "Recorder connected. Copy the token below now; it is not shown again.");
}
