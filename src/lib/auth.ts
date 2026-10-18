import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { db } from "./db";
import { audit } from "./audit";
import { normalizeEmail } from "./access";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  session: { strategy: "jwt", maxAge: 60 * 60 * 8, updateAge: 60 * 15 },
  pages: { signIn: "/login", error: "/login" },
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
      await audit(email, "signin.ok");
      return true;
    },
  },
};
