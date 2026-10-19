import { SignInButton } from "@/components/SignInButton";

export const dynamic = "force-dynamic";

export default function LoginPage({ searchParams }: { searchParams: { error?: string; expired?: string } }) {
  const error = searchParams.error;
  return (
    <div className="card" style={{ maxWidth: 420, margin: "4rem auto" }}>
      <h1>Practice Management</h1>
      {searchParams.expired && !error && (
        <div className="notice">You were signed out to protect patient privacy (inactivity or maximum session length). Sign in again to continue.</div>
      )}
      {error === "AccessDenied" && (
        <div className="error">
          That Google account does not have access. Ask the administrator to add your email.
        </div>
      )}
      {error && error !== "AccessDenied" && (
        <div className="error">Sign-in failed ({error}). Please try again.</div>
      )}
      <p className="muted">Sign in with your Google account.</p>
      <SignInButton />
    </div>
  );
}
