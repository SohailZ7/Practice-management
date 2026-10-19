import { assertKeyConfigured } from "./lib/crypto/phi";

// In production, refuse to start without a valid PHI encryption key rather than discover the problem on the first write.
if (process.env.NODE_ENV === "production") {
  assertKeyConfigured();
  if (!process.env.NEXTAUTH_SECRET) throw new Error("NEXTAUTH_SECRET is not set");
}
