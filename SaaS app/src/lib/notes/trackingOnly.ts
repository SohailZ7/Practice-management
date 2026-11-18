// "Not B&B / tracking only" providers (e.g. a Fairfax evening provider who is not ours). Their rows are kept only to count
// patients seen and revenue left on the table. They must never reach transcripts, documents, billing, invoices or
// timesheets, so every write path asks this module first.

import { db } from "../db";

/** Lower-cased provider names flagged tracking-only. */
export async function trackingOnlyNames(): Promise<Set<string>> {
  const rows = await db.provider.findMany({ where: { trackingOnly: true }, select: { name: true } });
  return new Set(rows.map((r) => r.name.trim().toLowerCase()));
}

export async function isTrackingOnlyName(providerName: string): Promise<boolean> {
  const n = (providerName ?? "").trim();
  if (!n) return false;
  return (await db.provider.count({ where: { trackingOnly: true, name: { equals: n, mode: "insensitive" } } })) > 0;
}

export const TRACKING_ONLY_MESSAGE = "This visit is tracking only (a provider who is not B&B). It has no transcript, documents or billing.";

/** Throws unless the visit may carry a transcript, documents or billing. Returns nothing. */
export async function assertBillableVisit(visitId: string): Promise<void> {
  const v = await db.visit.findUnique({ where: { id: visitId }, select: { providerName: true } });
  if (v && (await isTrackingOnlyName(v.providerName))) throw new Error(TRACKING_ONLY_MESSAGE);
}
