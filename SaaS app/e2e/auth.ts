import { encode } from "next-auth/jwt";
import type { BrowserContext } from "@playwright/test";
import { ADMIN_EMAIL, E2E_PORT, E2E_SECRET } from "./env";

/** Signs the browser in as a synthetic user by minting the same session cookie Auth.js would (no Google involved). */
export async function signIn(context: BrowserContext, email = ADMIN_EMAIL) {
  const now = Date.now();
  const value = await encode({ token: { email, name: "E2E", authAt: now, lastActive: now }, secret: E2E_SECRET, maxAge: 6 * 3600 });
  await context.addCookies([{ name: "next-auth.session-token", value, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax", secure: false }]);
  void E2E_PORT;
}
