import { handle, json } from "@/lib/desktop/api";

export const dynamic = "force-dynamic";

/**
 * What the recorder needs to start a Google sign-in, so the provider only types this app's address.
 *
 * Only the public client id is returned. The client secret stays on this server and is used by auth/google-exchange.
 */
export const GET = handle(async () => {
  const clientId = process.env.GOOGLE_DESKTOP_CLIENT_ID ?? "";
  const secret = process.env.GOOGLE_DESKTOP_CLIENT_SECRET ?? "";
  return json({ googleSignIn: clientId !== "" && secret !== "", clientId });
});
