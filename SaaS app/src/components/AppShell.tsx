"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { applyOrder, readOrder, writeOrder } from "@/lib/order";
import { Icon, type IconName } from "./Icons";
import { IdleLogoff } from "./IdleLogoff";
import { ConfirmHost } from "./ConfirmHost";
import { TopTools, type Cmd } from "./TopTools";

type Props = {
  name: string;
  email: string;
  levels: { schedule: string; tasks: string; employees: string; billing: string; ledger: string; notes: string };
  isAdmin: boolean;
  staging?: boolean;
  roleLabel?: string;
  timing: { idleMs: number; absoluteDeadline: number; serverNow: number } | null;
  children: ReactNode;
};

const PIN_KEY = "nav-pinned";
const WIDTH_KEY = "nav-width";
const ORDER_KEY = "nav-order";
const DEFAULT_WIDTH = 250;
const MIN_WIDTH = 200;

/** The bar can be dragged wider, up to one third of the window. */
const maxWidth = () => Math.max(MIN_WIDTH, Math.floor(window.innerWidth / 3));
const clamp = (w: number) => Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(w)));

export function AppShell({ name, email, levels, isAdmin, staging, roleLabel, timing, children }: Props) {
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

  // Every module is listed. One the person cannot open stays visible (dimmed) and shows "no access" when clicked.
  // Groups (decided with Sohail 2026-11-19): CLINICAL, OPERATIONS, MANAGE. Access mapping: Patients = notes view,
  // Schedule = schedule, Billing and Reports = billing (a report that shows names also needs notes view).
  type NavItem = { id: string; href: string; label: string; icon: IconName; locked?: boolean };
  const clinical: NavItem[] = [
    { id: "/patients", href: "/patients", label: "Patients", icon: "person", locked: levels.notes === "none" },
    { id: "/schedule", href: "/schedule", label: "Schedule", icon: "calendar", locked: levels.schedule === "none" && levels.notes === "none" },
    { id: "/billing", href: "/billing", label: "Billing", icon: "billing", locked: levels.billing === "none" },
    { id: "/reports", href: "/reports", label: "Reports", icon: "chart", locked: levels.billing === "none" },
  ];
  const operations: NavItem[] = [
    { id: "/tasks", href: "/tasks", label: "Tasks", icon: "tasks", locked: levels.tasks === "none" },
    { id: "/employees", href: "/employees", label: "Employees", icon: "users", locked: levels.employees === "none" },
    { id: "/ledger", href: "/ledger", label: "Ledger", icon: "ledger", locked: levels.ledger === "none" },
  ];
  const items = [...clinical, ...operations];
  // MANAGE group. Feedback and Settings are open to every signed-in user. Admin is visible to everyone; anyone but the
  // Admin who opens it sees the "no access" page (AUTH-13).
  const manage: { href: string; label: string; icon: IconName }[] = [
    { href: "/feedback", label: "Feedback", icon: "flag" },
    { href: "/settings", label: "Settings", icon: "settings" },
    { href: "/admin", label: "Administration", icon: "shield" },
  ];

  const commands: Cmd[] = [
    { label: "Overview", href: "/" },
    ...items.filter((i) => !i.locked).map((i) => ({ label: i.label, href: i.href })),
    ...(levels.billing !== "none" ? [{ label: "Billing: new encounter", href: "/billing/new", hint: "New" }] : []),
    ...(levels.notes !== "none" ? [{ label: "Patients: all patients", href: "/patients" }] : []),
    ...(levels.schedule !== "none" ? [{ label: "Schedule: week", href: "/schedule?view=week" }, { label: "Schedule: month", href: "/schedule?view=month" }] : []),
    { label: "Feedback", href: "/feedback" },
    ...(isAdmin ? [{ label: "Administration", href: "/admin" }] : []),
    { label: "Settings", href: "/settings" },
  ];

  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => setOrder(readOrder(ORDER_KEY)), []);
  const orderedClinical = applyOrder(clinical, order);
  const orderedOperations = applyOrder(operations, order);
  const navSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Reordering stays inside a group; the saved order is one flat list of ids covering both groups.
  const onNavDragEnd = (group: NavItem[], other: NavItem[], groupFirst: boolean) => (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = group.map((i) => i.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const moved = arrayMove(ids, from, to);
    const otherIds = other.map((i) => i.id);
    const next = groupFirst ? [...moved, ...otherIds] : [...otherIds, ...moved];
    setOrder(next);
    writeOrder(ORDER_KEY, next);
  };
  const group = (label: string, list: NavItem[], other: NavItem[], groupFirst: boolean) => (
    <>
      <div className="nav-label label">{label}</div>
      {isAdmin ? (
        <DndContext sensors={navSensors} collisionDetection={closestCenter} onDragEnd={onNavDragEnd(list, other, groupFirst)}>
          <SortableContext items={list.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            {list.map((i) => (
              <SortableNavItem key={i.id} id={i.id} label={i.label}>
                {link(i.href, i.label, i.icon, i.locked)}
              </SortableNavItem>
            ))}
          </SortableContext>
        </DndContext>
      ) : (
        list.map((i) => link(i.href, i.label, i.icon, i.locked))
      )}
    </>
  );

  const link = (href: string, label: string, icon: IconName, locked = false) => (
    <Link key={href} href={href} title={locked ? `${label} (no access)` : label} className={`${path.startsWith(href) ? "active" : ""} ${locked ? "locked" : ""}`.trim()}>
      <Icon name={icon} />
      <span className="label">{label}</span>
    </Link>
  );

  return (
    <div
      className={`shell ${pinned ? "pinned" : "rail"} ${resizing ? "resizing" : ""}`}
      style={{ "--side-w": `${width}px` } as CSSProperties}
    >
      {timing && <IdleLogoff {...timing} />}
      <div className="side-slot" />
      <aside className="side" aria-label="Main navigation">
        <div className="brand-row">
          <Link href="/" className="brand" title="Home">
            <span className="brand-tile" aria-hidden="true">B</span>
            <span className="label brand-text">
              <span className="brand-name">Brain &amp; Behavior</span>
              <span className="brand-sub">PRACTICE STUDIO</span>
            </span>
          </Link>
          <button
            type="button"
            className={`pin-toggle ${pinned ? "on" : ""}`}
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
            <span className="label">Overview</span>
          </Link>
          {group("CLINICAL", orderedClinical, orderedOperations, true)}
          {group("OPERATIONS", orderedOperations, orderedClinical, false)}
          <div className="nav-label label">MANAGE</div>
          {manage.map((m) => link(m.href, m.label, m.icon))}
        </nav>
        <div className={`env-badge ${staging ? "staging" : ""}`} role="status">
          <span className="dot" aria-hidden="true" />
          <span className="txt">
            <strong>{staging ? "STAGING · TEST ONLY" : "PRODUCTION"}</strong>
            <span className="sub">{staging ? "Not real patient data" : "Live practice data"}</span>
          </span>
        </div>
        <div className="foot">
          <div className="user-card" title={email}>
            <span className="avatar" aria-hidden="true">{initialsOf(name)}</span>
            <span className="label user-text">
              <span className="user-name">{name}</span>
              <span className="user-role">{roleLabel ?? ""}</span>
            </span>
          </div>
          <button onClick={() => signOut({ callbackUrl: "/login" })} title={`Sign out (${email})`}>
            <Icon name="logout" />
            <span className="label">Sign out</span>
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
        <header className="topbar">
          <div className="crumbs">Workspace <span>/</span> <b>{crumb(path)}</b></div>
          <TopTools commands={commands} />
          <span className={`env-pill ${staging ? "staging" : ""}`}>{staging ? "STAGING · TEST ONLY" : "PRODUCTION"}</span>
        </header>
        <div className="content">
          <div className="content-inner">{children}</div>
        </div>
        <ConfirmHost />
      </div>
    </div>
  );
}

const initialsOf = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const CRUMBS: [string, string][] = [["/patients", "Patients"], ["/reports", "Reports"], ["/schedule", "Schedule"], ["/tasks", "Tasks"], ["/employees", "Employees"], ["/billing", "Billing"], ["/ledger", "Ledger"], ["/feedback", "Feedback"], ["/admin", "Administration"], ["/settings", "Settings"]];
const crumb = (path: string) => CRUMBS.find(([p]) => path.startsWith(p))?.[1] ?? "Overview";

function SortableNavItem({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      className="nav-item"
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1, zIndex: isDragging ? 5 : undefined }}
    >
      {children}
      <button className="nav-grip" title={`Drag to reorder (${label})`} aria-label={`Drag to reorder ${label}`} {...attributes} {...listeners}>
        ⠿
      </button>
    </div>
  );
}
