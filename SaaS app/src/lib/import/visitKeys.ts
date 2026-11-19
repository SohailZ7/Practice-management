// Release B2a: schedule imports used to skip rows already on the Schedule by their dedupe key. Appointments that now
// live as Visits carry no key, so the key is recomputed from the Visit for the dates being imported.

import { makeDedupeKey } from "./outpatientBoard";
import { visitAsEntry } from "../schedule/rows";

type VisitClient = { visit: { findMany: (args: never) => Promise<unknown[]> } };

export async function visitDedupeKeys(client: VisitClient, dates: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const uniq = [...new Set(dates)];
  for (let i = 0; i < uniq.length; i += 200) {
    const rows = (await client.visit.findMany({ where: { visitDate: { in: uniq.slice(i, i + 200) } }, include: { patient: { select: { lastName: true, firstName: true } } } } as never)) as Parameters<typeof visitAsEntry>[0][];
    for (const v of rows) {
      const e = visitAsEntry(v);
      out.add(makeDedupeKey({ date: e.date, section: e.section, timeLabel: e.timeLabel, providerName: e.providerName, clientInfo: e.clientInfo }));
    }
  }
  return out;
}
