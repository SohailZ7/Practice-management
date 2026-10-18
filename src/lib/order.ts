/**
 * Orders `items` by a saved list of ids. Items missing from the saved list keep their original
 * relative order after the saved ones; saved ids that no longer exist are ignored.
 */
export function applyOrder<T extends { id: string }>(items: T[], saved: string[]): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const first = saved.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  const seen = new Set(first.map((i) => i.id));
  return [...first, ...items.filter((i) => !seen.has(i.id))];
}

export function readOrder(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function writeOrder(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // storage unavailable: the order just won't be remembered
  }
}
