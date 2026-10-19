import { SignInButton } from "@/components/SignInButton";

export const dynamic = "force-dynamic";

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  const error = searchParams.error;
  return (
    <div className="card" style={{ maxWidth: 420, margin: "4rem auto" }}>
      <h1>Practice Management</h1>
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
