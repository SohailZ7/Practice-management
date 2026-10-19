// Session cookie naming and flags, shared by Auth.js config and middleware (no Node-only imports).

/** Secure cookies in production, except when running a production build against plain-http localhost. */
export function useSecureCookies(env: Record<string, string | undefined> = process.env): boolean {
  if (env.NEXTAUTH_URL?.startsWith("https://")) return true;
  return env.NODE_ENV === "production" && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(env.NEXTAUTH_URL ?? "");
}

export function sessionCookieName(secure = useSecureCookies()): string {
  return `${secure ? "__Secure-" : ""}next-auth.session-token`;
}

export const SESSION_COOKIE_NAMES = ["next-auth.session-token", "__Secure-next-auth.session-token"];
