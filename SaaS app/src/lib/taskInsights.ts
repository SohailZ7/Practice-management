import { addDays, todayISO } from "@/lib/dates";
import type { TaskDTO } from "@/lib/taskTypes";

/** "A little progress, every day": what was finished today, what is still open, what is due in the next 7 days. */
export function taskProgress(tasks: TaskDTO[], today: string, tz?: string) {
  const live = (t: TaskDTO) => !t.completed && !(t.expiresAt && t.expiresAt < today);
  const doneToday = tasks.filter((t) => t.completed && t.completedAt != null && todayISO(new Date(t.completedAt), tz) === today).length;
  const open = tasks.filter(live).length;
  const weekEnd = addDays(today, 6);
  const dueThisWeek = tasks.filter((t) => live(t) && t.dueDate && t.dueDate >= today && t.dueDate <= weekEnd).length;
  const overdue = tasks.filter((t) => live(t) && t.dueDate && t.dueDate < today).length;
  const total = open + doneToday;
  return { doneToday, open, total, dueThisWeek, overdue, pct: total === 0 ? 0 : Math.round((doneToday / total) * 100) };
}

/** The sentence under the progress bar. */
export function progressLine(p: ReturnType<typeof taskProgress>): string {
  const done = p.doneToday === 0 ? "Nothing finished yet today." : p.doneToday === 1 ? "One finished today." : `${p.doneToday} finished today.`;
  const due = p.dueThisWeek === 0 ? "" : p.dueThisWeek === 1 ? " One is due this week." : ` ${p.dueThisWeek} are due this week.`;
  const late = p.overdue === 0 ? "" : p.overdue === 1 ? " One is overdue." : ` ${p.overdue} are overdue.`;
  return done + due + late;
}

/** Open tasks by category, for the Board view; "No category" is last and only shown when it has tasks. */
export function boardColumns(tasks: TaskDTO[], categories: { id: string; name: string }[], today: string) {
  const live = tasks.filter((t) => !t.completed && !(t.expiresAt && t.expiresAt < today));
  const cols = categories.map((c) => ({ id: c.id as string | null, name: c.name, tasks: live.filter((t) => t.categoryId === c.id) }));
  const none = live.filter((t) => !t.categoryId || !categories.some((c) => c.id === t.categoryId));
  return none.length ? [...cols, { id: null, name: "No category", tasks: none }] : cols;
}
