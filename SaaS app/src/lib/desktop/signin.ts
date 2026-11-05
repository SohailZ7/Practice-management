import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { normalizeEmail } from "@/lib/access";
import { ApiError } from "@/lib/desktop/api";
import { ACCESS_TTL_SEC, desktopSecret, newRefreshToken, sessionExpiry, signAccessToken } from "@/lib/desktop/tokens";

/** Allowlist check plus session creation for a verified Google identity. Shared by auth/token and auth/google-exchange. */
export async function issueDesktopTokens(identityEmail: string, deviceLabel: unknown) {
  const email = normalizeEmail(identityEmail);
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.active) {
    await audit(email, "desktop.signin.denied", "not on allowlist or inactive");
    throw new ApiError(403, "forbidden");
  }
  const refresh = newRefreshToken();
  const label = typeof deviceLabel === "string" ? deviceLabel.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 60) : "";
  const session = await db.desktopSession.create({
    data: { userId: user.id, tokenHash: refresh.hash, deviceLabel: label, expiresAt: sessionExpiry() },
  });
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(email, "desktop.signin", `session ${session.id}`);
  const exp = Math.floor(Date.now() / 1000) + ACCESS_TTL_SEC;
  return {
    accessToken: signAccessToken({ uid: user.id, sid: session.id, exp }, desktopSecret()),
    refreshToken: refresh.token,
    expiresIn: ACCESS_TTL_SEC,
  };
}
