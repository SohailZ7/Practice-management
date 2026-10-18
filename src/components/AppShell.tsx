"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon, Logo, type IconName } from "./Icons";

type Props = {
  name: string;
  email: string;
  levels: { schedule: string; tasks: string; employees: string; billing: string };
  isAdmin: boolean;
  children: ReactNode;
};

const PIN_KEY = "nav-pinned";
const WIDTH_KEY = "nav-width";
const DEFAULT_WIDTH = 250;
const MIN_WIDTH = 200;

/** The bar can be dragged wider, up to one third of the window. */
const maxWidth = () => Math.max(MIN_WIDTH, Math.floor(window.innerWidth / 3));
const clamp = (w: number) => Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(w)));

export function AppShell({ name, email, levels, isAdmin, children }: Props) {
  const path = usePathname();
  const [pinned, setPinned] = useState(true);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const widthRef = useRef(DEFAULT_WIDTH);

  const applyWidth = useCallback((w: number) => {
    widthRef.current = w;
    setWidth(w);
  }, []);

  useEffect(() => {
    try {
      if (localStorage.getItem(PIN_KEY) === "0") setPinned(false);
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      if (saved) applyWidth(clamp(saved));
    } catch {
      // storage unavailable: defaults
    }
    const onResize = () => applyWidth(clamp(widthRef.current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [applyWidth]);

  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    try {
      localStorage.setItem(PIN_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  };

  // Drag the right edge of the bar to resize it.
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    setResizing(true);
    const move = (ev: PointerEvent) => applyWidth(clamp(ev.clientX));
    const stop = () => {
      setResizing(false);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", stop);
      target.removeEventListener("pointercancel", stop);
      try {
        localStorage.setItem(WIDTH_KEY, String(widthRef.current));
      } catch {
        // ignore
      }
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", stop);
    target.addEventListener("pointercancel", stop);
  };

  const resetWidth = () => {
    applyWidth(DEFAULT_WIDTH);
    try {
      localStorage.removeItem(WIDTH_KEY);
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
    <div
      className={`shell ${pinned ? "pinned" : "rail"} ${resizing ? "resizing" : ""}`}
      style={{ "--side-w": `${width}px` } as CSSProperties}
    >
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
          <button onClick={() => signOut({ callbackUrl: "/login" })} title={`Sign out (${email})`}>
            <Icon name="logout" />
            <span className="label">Sign out · {name}</span>
          </button>
        </div>
        <div
          className="side-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize navigation (double-click to reset)"
          onPointerDown={startResize}
          onDoubleClick={resetWidth}
        />
      </aside>
      <div className="content-wrap">
        <div className="content">
          <div className="content-inner">{children}</div>
        </div>
      </div>
    </div>
  );
}
