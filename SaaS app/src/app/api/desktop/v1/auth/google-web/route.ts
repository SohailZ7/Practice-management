import { ApiError, handle, json, readJson } from "@/lib/desktop/api";
import { verifyGoogleIdToken } from "@/lib/desktop/googleId";
import { issueDesktopTokens } from "@/lib/desktop/signin";
import { webPromoteOrigins } from "@/lib/promote/webConfig";

export const dynamic = "force-dynamic";

/**
 * Google sign-in for the staging web page's "Promote to production" button. The page gets a Google ID token for the
 * person pressing the button (Google Identity Services, a Web client id) and trades it here for the usual practice-app
 * tokens. Off (503) unless GOOGLE_WEB_CLIENT_ID is set, and refused unless the request comes from an origin listed in
 * PROMOTE_WEB_ORIGINS. Same allowlist and same audit as every other sign-in. Nothing here logs a token.
 */
export const POST = handle(async (req) => {
  const clientId = (process.env.GOOGLE_WEB_CLIENT_ID ?? "").trim();
  const origins = webPromoteOrigins(process.env);
  if (!clientId || origins.length === 0) throw new ApiError(503, "not_configured");
  const origin = req.headers.get("origin");
  if (!origin || !origins.includes(origin)) throw new ApiError(403, "forbidden");

  const body = await readJson(req);
  const credential = body.credential;
  if (typeof credential !== "string" || credential.length > 4096) throw new ApiError(400, "bad_request");
  const identity = await verifyGoogleIdToken(credential, clientId);
  if (!identity) throw new ApiError(401, "unauthorized");
  return json(await issueDesktopTokens(identity.email, "Web promote"));
});
