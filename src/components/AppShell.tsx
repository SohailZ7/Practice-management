"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, Logo, type IconName } from "./Icons";

type Props = {
  name: string;
  email: string;
  levels: { schedule: string; tasks: string; employees: string; billing: string };
  isAdmin: boolean;
  children: ReactNode;
};

const PIN_KEY = "nav-pinned";

export function AppShell({ name, email, levels, isAdmin, children }: Props) {
  const path = usePathname();
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    try {
      if (localStorage.getItem(PIN_KEY) === "0") setPinned(false);
    } catch {
      // storage unavailable: stay pinned
    }
  }, []);

  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    try {
      localStorage.setItem(PIN_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  };

  const items: { href: string; label: string; icon: IconName }[] = [];
  if (levels.schedule !== "none") items.push({ href: "/schedule", label: "Schedule", icon: "calendar" });
  if (levels.tasks !== "none") items.push({ href: "/tasks", label: "Tasks", icon: "tasks" });
  if (levels.employees !== "none") items.push({ href: "/employees", label: "Employees", icon: "users" });
  if (levels.billing !== "none") items.push({ href: "/billing", label: "Billing", icon: "billing" });
  if (isAdmin) items.push({ href: "/admin", label: "Access", icon: "shield" });

  const link = (href: string, label: string, icon: IconName) => (
    <Link key={href} href={href} title={label} className={path.startsWith(href) ? "active" : ""}>
      <Icon name={icon} />
      <span className="label">{label}</span>
    </Link>
  );

  return (
    <div className={`shell ${pinned ? "pinned" : "rail"}`}>
      <div className="side-slot" />
      <aside className="side" aria-label="Main navigation">
        <div className="brand-row">
          <Link href="/" className="brand" title="Home">
            <Logo />
            <span className="label">Practice Management</span>
          </Link>
          <button
            type="button"
            className={`pin-toggle label ${pinned ? "on" : ""}`}
            onClick={togglePin}
            title={pinned ? "Unpin the navigation bar (collapse to icons)" : "Pin the navigation bar open"}
            aria-pressed={pinned}
            aria-label={pinned ? "Unpin navigation" : "Pin navigation"}
          >
            <Icon name="pin" filled={pinned} />
          </button>
        </div>
        <nav>
          <Link href="/" title="Home" className={path === "/" ? "active" : ""}>
            <Icon name="home" />
            <span className="label">Home</span>
          </Link>
          {items.map((i) => link(i.href, i.label, i.icon))}
        </nav>
        <div className="foot">
          {link("/settings", "Settings", "settings")}
          <button onClick={togglePin} title={pinned ? "Unpin the navigation bar" : "Pin the navigation bar"} aria-pressed={pinned}>
            <Icon name="pin" filled={pinned} />
            <span className="label">{pinned ? "Unpin" : "Pin"} navigation</span>
          </button>
          <button onClick={() => signOut({ callbackUrl: "/login" })} title={`Sign out (${email})`}>
            <Icon name="logout" />
            <span className="label">Sign out · {name}</span>
          </button>
        </div>
      </aside>
      <div className="content-wrap">
        <div className="content">
          <div className="content-inner">{children}</div>
        </div>
      </div>
    </div>
  );
}
