import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { normalizeEmail } from "@/lib/access";
import { ApiError, handle, json, readJson } from "@/lib/desktop/api";
import { verifyGoogleIdToken } from "@/lib/desktop/googleId";
import { ACCESS_TTL_SEC, desktopSecret, newRefreshToken, sessionExpiry, signAccessToken } from "@/lib/desktop/tokens";

export const dynamic = "force-dynamic";

// API-2: exchange a Google ID token (from the desktop sign-in) for an access token and a revocable refresh token.
export const POST = handle(async (req) => {
  const body = await readJson(req);
  const audience = process.env.GOOGLE_DESKTOP_CLIENT_ID ?? "";
  if (!audience) throw new ApiError(503, "not_configured");
  const identity = typeof body.idToken === "string" ? await verifyGoogleIdToken(body.idToken, audience) : null;
  if (!identity) throw new ApiError(401, "unauthorized");

  const email = normalizeEmail(identity.email);
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.active) {
    await audit(email, "desktop.signin.denied", "not on allowlist or inactive");
    throw new ApiError(403, "forbidden");
  }
  const refresh = newRefreshToken();
  const label = typeof body.deviceLabel === "string" ? body.deviceLabel.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 60) : "";
  const session = await db.desktopSession.create({
    data: { userId: user.id, tokenHash: refresh.hash, deviceLabel: label, expiresAt: sessionExpiry() },
  });
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(email, "desktop.signin", `session ${session.id}`);
  const exp = Math.floor(Date.now() / 1000) + ACCESS_TTL_SEC;
  return json({
    accessToken: signAccessToken({ uid: user.id, sid: session.id, exp }, desktopSecret()),
    refreshToken: refresh.token,
    expiresIn: ACCESS_TTL_SEC,
  });
});
