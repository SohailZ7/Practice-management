/** How a visit document reads in the chart's Visits list: still a draft, or Approved (no longer a draft) with the date it was finalized. */
export function docStateLabel(d: { draft: boolean; finalizedAt: Date | null }): string {
  if (d.draft) return " (draft)";
  return d.finalizedAt ? ` (Approved ${d.finalizedAt.toISOString().slice(0, 10)})` : " (Approved)";
}
