import type { ReactNode } from "react";

export type IconName = "home" | "calendar" | "tasks" | "users" | "shield" | "settings" | "pin" | "logout" | "billing" | "link" | "close" | "sun" | "chevron" | "ledger" | "flag" | "repeat" | "hourglass" | "note";

const PATHS: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  tasks: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M8 12.5l3 3 5-6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.3A5 5 0 0 1 21.5 19v1" />
    </>
  ),
  shield: (
    <>
      <path d="M12 21s8-3.5 8-10V5.5L12 3 4 5.5V11c0 6.5 8 10 8 10z" />
      <path d="M9 11.5l2.2 2.2L15 10" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  pin: (
    <>
      <path d="M12 16v5" />
      <path d="M8.5 3h7l-1 6.5 3 3.2V15h-12v-2.3l3-3.2z" />
    </>
  ),
  billing: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </>
  ),
  chevron: <path d="M6 9l6 6 6-6" />,
  ledger: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  note: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5M9 12h7M9 16h7" />
    </>
  ),
  hourglass: (
    <>
      <path d="M6 3h12M6 21h12" />
      <path d="M7 3v3.5c0 1.8 1.4 3 3 4.5l2 1-2 1c-1.6 1.5-3 2.7-3 4.5V21" />
      <path d="M17 3v3.5c0 1.8-1.4 3-3 4.5l-2 1 2 1c1.6 1.5 3 2.7 3 4.5V21" />
    </>
  ),
  repeat: (
    <>
      <path d="M17 2l3 3-3 3" />
      <path d="M4 11V9a4 4 0 0 1 4-4h12" />
      <path d="M7 22l-3-3 3-3" />
      <path d="M20 13v2a4 4 0 0 1-4 4H4" />
    </>
  ),
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h12l-2.5 4.5L17 13H5" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5.5A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3H9" />
      <path d="M16 16.5l4.5-4.5L16 7.5M20.5 12H9" />
    </>
  ),
};

export function Icon({ name, filled = false }: { name: IconName; filled?: boolean }) {
  return (
    <svg
      className="svg-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 20V12a7 7 0 0 1 14 0v8" />
        <path d="M9 20v-6a3 3 0 0 1 6 0v6" />
      </svg>
    </span>
  );
}
