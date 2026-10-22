import Link from "next/link";

export default function DeniedPage() {
  return (
    <div className="card">
      <h1>No access</h1>
      <p>You do not have access. Please request your Admin for access.</p>
      <Link href="/">Back to home</Link>
    </div>
  );
}
