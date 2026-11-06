/** The Admin console's sub-pages, shown as tabs in the console and as links under Admin in the left navigation. */
export const ADMIN_PAGES = [
  { href: "/admin", label: "Users" },
  { href: "/admin/access", label: "Module access" },
  { href: "/admin/task-tabs", label: "Task tabs" },
  { href: "/admin/task-access", label: "Task tab access" },
  { href: "/admin/timesheets", label: "Timesheets" },
  { href: "/admin/api-tokens", label: "Claude tokens" },
  { href: "/admin/activity", label: "Recent activity" },
  { href: "/admin/access-review", label: "Access review" },
  { href: "/admin/diagnostics", label: "Recorder diagnostics" },
  { href: "/admin/costs", label: "Costs" },
] as const;

export function adminPageActive(path: string, href: string): boolean {
  return href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`);
}
