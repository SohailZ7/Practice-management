// Matching of provider names from a spreadsheet to providers already in the app.

const TITLES = new Set(["dr", "md", "do", "np", "arnp", "pmhnp", "phd", "rn", "lcsw"]);

export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !TITLES.has(t));
}

/**
 * Returns the id of the single provider whose name matches `raw`, or null.
 * A match is an identical token set, or one name's tokens being a subset of the other's
 * ("Dr Khalid" matches "Dr. Khalid Ahmed"). Ambiguous matches return null.
 */
export function matchProvider(raw: string, providers: { id: string; name: string }[]): string | null {
  const wanted = nameTokens(raw);
  if (wanted.length === 0) return null;
  const wantedKey = [...wanted].sort().join(" ");

  const exact = providers.filter((p) => [...nameTokens(p.name)].sort().join(" ") === wantedKey);
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) return null;

  const subset = providers.filter((p) => {
    const have = nameTokens(p.name);
    if (have.length === 0) return false;
    const [small, big] = have.length <= wanted.length ? [have, wanted] : [wanted, have];
    return small.every((t) => big.includes(t));
  });
  return subset.length === 1 ? subset[0].id : null;
}
