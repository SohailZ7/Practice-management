import { assertKeyConfigured } from "./lib/crypto/phi";
import { envMismatch } from "./lib/envGuard";

// In production, refuse to start without a valid PHI encryption key rather than discover the problem on the first write.
// Exiting (instead of only throwing) stops the container, so the platform reports a failed start instead of serving 500s.
if (process.env.NODE_ENV === "production") {
  try {
    assertKeyConfigured();
    const mismatch = envMismatch(process.env); // staging must never reach the prod database, nor prod the staging one
    if (mismatch) throw new Error(mismatch);
    if (!process.env.NEXTAUTH_SECRET) throw new Error("NEXTAUTH_SECRET is not set");
  } catch (err) {
    console.error(`Refusing to start: ${err instanceof Error ? err.message : "invalid configuration"}`);
    process.exit(1);
  }
}
