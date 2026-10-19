import { db } from "@/lib/db";
import { ApiError, handle, json, readJson } from "@/lib/desktop/api";
import { ACCESS_TTL_SEC, desktopSecret, hashRefreshToken, newRefreshToken, sessionExpiry, signAccessToken } from "@/lib/desktop/tokens";

export const dynamic = "force-dynamic";

// Rotates the refresh token: the old one stops working as soon as a new one is issued.
export const POST = handle(async (req) => {
  const body = await readJson(req);
  if (typeof body.refreshToken !== "string") throw new ApiError(401, "unauthorized");
  const session = await db.desktopSession.findUnique({ where: { tokenHash: hashRefreshToken(body.refreshToken) } });
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw new ApiError(401, "unauthorized");
  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user || !user.active) throw new ApiError(401, "unauthorized");

  const next = newRefreshToken();
  await db.desktopSession.update({ where: { id: session.id }, data: { tokenHash: next.hash, lastUsedAt: new Date(), expiresAt: sessionExpiry() } });
  const exp = Math.floor(Date.now() / 1000) + ACCESS_TTL_SEC;
  return json({
    accessToken: signAccessToken({ uid: user.id, sid: session.id, exp }, desktopSecret()),
    refreshToken: next.token,
    expiresIn: ACCESS_TTL_SEC,
  });
});
