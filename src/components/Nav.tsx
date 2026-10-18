"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

type Props = {
  name: string;
  email: string;
  levels: { schedule: string; tasks: string; employees: string };
  isAdmin: boolean;
};

export function Nav({ name, email, levels, isAdmin }: Props) {
  const path = usePathname();
  const item = (href: string, label: string) => (
    <Link key={href} href={href} className={path.startsWith(href) ? "active" : ""}>
      {label}
    </Link>
  );
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        Practice Management
      </Link>
      <nav>
        {levels.schedule !== "none" && item("/schedule", "Schedule")}
        {levels.tasks !== "none" && item("/tasks", "Tasks")}
        {levels.employees !== "none" && item("/employees", "Employees")}
        {isAdmin && item("/admin", "Access")}
      </nav>
      <span className="who">{name} ({email})</span>
      <button className="secondary" onClick={() => signOut({ callbackUrl: "/login" })}>
        Sign out
      </button>
    </header>
  );
}
