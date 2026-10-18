"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** For people without the admin tabs: My tasks | Recurring. */
export function TaskSwitch() {
  const path = usePathname();
  const rec = path.startsWith("/tasks/recurring");
  return (
    <div className="tabs" role="tablist" aria-label="Task views">
      <Link href="/tasks" role="tab" aria-selected={!rec} className={!rec ? "tab on" : "tab"}>
        My tasks
      </Link>
      <Link href="/tasks/recurring" role="tab" aria-selected={rec} className={rec ? "tab on" : "tab"}>
        Recurring
      </Link>
    </div>
  );
}
