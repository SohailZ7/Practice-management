// Verifies a Google ID token sent by the Desktop App (requirements v19, API-2). The key set is injectable for tests.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { normalizeEmail } from "../access";

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
let remote: JWTVerifyGetKey | undefined;
const googleKeys = (): JWTVerifyGetKey => (remote ??= createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs")));

export type GoogleIdentity = { email: string; name: string };

/** Returns the verified, normalized email, or null for any failure. Never throws on a bad token. */
export async function verifyGoogleIdToken(idToken: string, audience: string, keys: JWTVerifyGetKey = googleKeys()): Promise<GoogleIdentity | null> {
  if (!audience || !idToken || idToken.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(idToken, keys, { issuer: GOOGLE_ISSUERS, audience });
    const email = typeof payload.email === "string" ? normalizeEmail(payload.email) : "";
    if (!email || payload.email_verified !== true) return null;
    return { email, name: typeof payload.name === "string" ? payload.name : "" };
  } catch {
    return null;
  }
}
