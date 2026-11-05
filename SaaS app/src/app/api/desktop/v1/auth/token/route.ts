import { ApiError, handle, json, readJson } from "@/lib/desktop/api";
import { verifyGoogleIdToken } from "@/lib/desktop/googleId";
import { issueDesktopTokens } from "@/lib/desktop/signin";

export const dynamic = "force-dynamic";

// API-2: exchange a Google ID token (from the desktop sign-in) for an access token and a revocable refresh token.
export const POST = handle(async (req) => {
  const body = await readJson(req);
  const audience = process.env.GOOGLE_DESKTOP_CLIENT_ID ?? "";
  if (!audience) throw new ApiError(503, "not_configured");
  const identity = typeof body.idToken === "string" ? await verifyGoogleIdToken(body.idToken, audience) : null;
  if (!identity) throw new ApiError(401, "unauthorized");
  return json(await issueDesktopTokens(identity.email, body.deviceLabel));
});
