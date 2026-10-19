import Link from "next/link";

export default function DeniedPage() {
  return (
    <div className="card">
      <h1>No access</h1>
      <p>You do not have access to that area. Ask the administrator if you need it.</p>
      <Link href="/">Back to home</Link>
    </div>
  );
}
