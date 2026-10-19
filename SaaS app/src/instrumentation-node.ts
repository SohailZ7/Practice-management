import { assertKeyConfigured } from "./lib/crypto/phi";

// In production, refuse to start without a valid PHI encryption key rather than discover the problem on the first write.
// Exiting (instead of only throwing) stops the container, so the platform reports a failed start instead of serving 500s.
if (process.env.NODE_ENV === "production") {
  try {
    assertKeyConfigured();
    if (!process.env.NEXTAUTH_SECRET) throw new Error("NEXTAUTH_SECRET is not set");
  } catch (err) {
    console.error(`Refusing to start: ${err instanceof Error ? err.message : "invalid configuration"}`);
    process.exit(1);
  }
}
