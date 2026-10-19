import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { db } from "./db";
import { audit } from "./audit";
import { normalizeEmail } from "./access";
import { sessionPolicy } from "./sessionExpiry";
import { sessionCookieName, useSecureCookies } from "./sessionCookie";

const policy = sessionPolicy();
const secure = useSecureCookies();

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  // The cookie lives at most the absolute limit. The idle limit is enforced by middleware and getCurrentUser
  // from the lastActive stamp, which only real requests refresh (see src/middleware.ts).
  session: { strategy: "jwt", maxAge: Math.floor(policy.maxMs / 1000), updateAge: Math.floor(policy.maxMs / 1000) },
  pages: { signIn: "/login", error: "/login" },
  useSecureCookies: secure,
  cookies: {
    sessionToken: {
      name: sessionCookieName(secure),
      options: { httpOnly: true, sameSite: "lax", path: "/", secure },
    },
  },
  callbacks: {
    // AUTH-2: only active users on the allowlist may sign in.
    async signIn({ user, profile }) {
      const email = normalizeEmail(user.email ?? "");
      const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified;
      if (!email || verified === false) {
        await audit(email || "unknown", "signin.denied", "unverified or missing email");
        return false;
      }
      const record = await db.user.findUnique({ where: { email } });
      if (!record || !record.active) {
        await audit(email, "signin.denied", "not on allowlist or inactive");
        return false;
      }
      await db.user.update({ where: { id: record.id }, data: { lastLoginAt: new Date() } });
      await audit(email, "signin.ok");
      return true;
    },
    // Keep the token minimal and stamp it at sign-in. Nothing here refreshes lastActive afterwards.
    async jwt({ token, user }) {
      if (user) {
        const now = Date.now();
        return { email: normalizeEmail(user.email ?? ""), name: user.name ?? undefined, authAt: now, lastActive: now };
      }
      return token;
    },
    async session({ session, token }) {
      session.authAt = token.authAt;
      session.lastActive = token.lastActive;
      return session;
    },
  },
  events: {
    async signOut({ token }) {
      if (token?.email) await audit(token.email, "signout");
    },
  },
};
