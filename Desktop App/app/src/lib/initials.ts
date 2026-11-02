// The recorder shows patients as initials; it never holds a full name.

/**
 * Initials for the on-screen schedule (owner's request). The board is often visible to other people in a clinic
 * room, so it shows "A.T." rather than the full name. The folder and file names keep the full name, because the
 * provider has to be able to find the documents afterwards.
 */
export function patientInitials(lastName: string, firstName: string): string {
  const letters = [firstName, lastName]
    .map((n) => (n ?? "").trim().replace(/^["\u201c]|["\u201d]$/g, ""))
    .map((n) => n.match(/\p{L}/u)?.[0] ?? "")
    .filter(Boolean)
    .map((c) => c.toUpperCase());
  return letters.length ? `${letters.join(".")}.` : "?";
}
