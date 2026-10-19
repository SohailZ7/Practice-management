/**
 * Server logs must never carry PHI. Error messages from the database driver can echo submitted values, so log only the
 * context, the error class and a code. Add ids here, never names, notes or client text.
 */
export function logError(context: string, err: unknown): void {
  const e = err as { name?: string; code?: string } | null;
  console.error(`${context}: ${e?.name ?? "Error"}${e?.code ? ` (${e.code})` : ""}`);
}
