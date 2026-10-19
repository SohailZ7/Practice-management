"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** For people without the admin tabs: My tasks | Recurring | Analytics. */
export function TaskSwitch() {
  const path = usePathname();
  const rec = path.startsWith("/tasks/recurring");
  const ana = path.startsWith("/tasks/analytics");
  return (
    <div className="tabs" role="tablist" aria-label="Task views">
      <Link href="/tasks" role="tab" aria-selected={!rec && !ana} className={!rec && !ana ? "tab on" : "tab"}>
        My tasks
      </Link>
      <Link href="/tasks/recurring" role="tab" aria-selected={rec} className={rec ? "tab on" : "tab"}>
        Recurring
      </Link>
      <Link href="/tasks/analytics" role="tab" aria-selected={ana} className={ana ? "tab on" : "tab"}>
        Analytics
      </Link>
    </div>
  );
}
