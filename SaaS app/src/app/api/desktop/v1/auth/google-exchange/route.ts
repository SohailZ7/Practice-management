import { ApiError, handle, json, readJson } from "@/lib/desktop/api";
import { verifyGoogleIdToken } from "@/lib/desktop/googleId";
import { issueDesktopTokens } from "@/lib/desktop/signin";

export const dynamic = "force-dynamic";

/**
 * Finishes the desktop Google sign-in. The app sends the PKCE authorization code; this server swaps it for an ID
 * token using the client secret, which therefore never leaves the server. The rest is the same as auth/token:
 * verify the ID token, check the allowlist, issue the practice app's tokens. Nothing here logs a code or a token.
 */
export const POST = handle(async (req) => {
  const body = await readJson(req);
  const clientId = process.env.GOOGLE_DESKTOP_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_DESKTOP_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) throw new ApiError(503, "not_configured");

  const { code, code_verifier: verifier, redirect_uri: redirect } = body;
  if (typeof code !== "string" || typeof verifier !== "string" || typeof redirect !== "string") throw new ApiError(400, "bad_request");
  if (code.length > 2048 || verifier.length > 256 || redirect.length > 256) throw new ApiError(400, "bad_request");
  // A Desktop-app client only redirects to loopback; refuse anything else before talking to Google.
  if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?\/?$/.test(redirect)) throw new ApiError(400, "bad_request");

  let idToken: unknown;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirect,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    });
    if (!res.ok) throw new ApiError(401, "unauthorized");
    idToken = ((await res.json()) as { id_token?: unknown }).id_token;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(502, "google_unreachable");
  }

  const identity = typeof idToken === "string" ? await verifyGoogleIdToken(idToken, clientId) : null;
  if (!identity) throw new ApiError(401, "unauthorized");
  return json(await issueDesktopTokens(identity.email, body.deviceLabel));
});
