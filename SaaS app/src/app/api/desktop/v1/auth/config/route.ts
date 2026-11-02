import { handle, json } from "@/lib/desktop/api";

export const dynamic = "force-dynamic";

/**
 * What the recorder needs to start a Google sign-in, so the provider only types this app's address.
 *
 * These values belong to an OAuth client of type "Desktop app". Google states that such a client's secret is not
 * treated as confidential, because it is distributed inside the app; the security comes from PKCE and from the
 * allowlist check this app does afterwards. No sign-in is required to read this, as nothing here is sensitive.
 */
export const GET = handle(async () => {
  const clientId = process.env.GOOGLE_DESKTOP_CLIENT_ID ?? "";
  return json({
    googleSignIn: clientId !== "",
    clientId,
    clientSecret: process.env.GOOGLE_DESKTOP_CLIENT_SECRET ?? "",
  });
});
