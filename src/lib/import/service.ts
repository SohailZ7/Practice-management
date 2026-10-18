// Preview and commit logic for schedule imports. Kept separate from the route handlers.

import { db } from "../db";
import { audit } from "../audit";
import { matchProvider } from "./match";
import type { ParseResult } from "./outpatientBoard";

export type NameDecision = {
  action: "auto" | "create" | "map" | "none";
  providerId?: string;
};

export type CommitOptions = {
  includeProviders: boolean;
  overwriteZoomPassword: boolean;
  mapping: Record<string, NameDecision>;
};

const CHUNK = 500;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function existingKeys(keys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunks(keys, 2000)) {
    const rows = await db.scheduleEntry.findMany({
      where: { dedupeKey: { in: part } },
      select: { dedupeKey: true },
    });
    rows.forEach((r) => found.add(r.dedupeKey));
  }
  return found;
}

export async function buildPreview(parsed: ParseResult) {
  const providers = await db.provider.findMany({ select: { id: true, name: true } });

  const counts = new Map<string, number>();
  for (const e of parsed.entries) {
    if (e.providerName) counts.set(e.providerName, (counts.get(e.providerName) ?? 0) + 1);
  }
  const names = [...counts.entries()].map(([name, count]) => {
    const matchedId = matchProvider(name, providers);
    return {
      name,
      count,
      matchedId,
      matchedName: providers.find((p) => p.id === matchedId)?.name ?? null,
    };
  });

  const existing = await existingKeys(parsed.entries.map((e) => e.dedupeKey));
  const duplicates = parsed.entries.filter((e) => existing.has(e.dedupeKey)).length;

  return {
    counts: {
      found: parsed.entries.length + parsed.skipped,
      new: parsed.entries.length - duplicates,
      duplicates,
      skipped: parsed.skipped,
      providersInSheet: parsed.providers.length,
    },
    names,
    providers: providers.sort((a, b) => a.name.localeCompare(b.name)),
    providerRows: parsed.providers.map((p) => ({ name: p.name, hours: p.hours, contact: p.contact })),
    warnings: parsed.warnings.slice(0, 50),
    sample: parsed.entries.slice(0, 25),
  };
}

export async function commitImport(args: {
  draftId: string;
  userEmail: string;
  options: CommitOptions;
}) {
  const draft = await db.importDraft.findUnique({ where: { id: args.draftId } });
  if (!draft || draft.userEmail !== args.userEmail) throw new Error("Import draft not found. Upload the file again.");
  const parsed = JSON.parse(draft.payload) as ParseResult;
  const { options } = args;

  const result = await db.$transaction(
    async (tx) => {
      let providerList = await tx.provider.findMany({ select: { id: true, name: true, zoomPassword: true } });
      let providersCreated = 0;
      let providersUpdated = 0;

      if (options.includeProviders) {
        for (const p of parsed.providers) {
          const id = matchProvider(p.name, providerList);
          if (id) {
            const current = providerList.find((x) => x.id === id)!;
            const data: Record<string, string> = {};
            if (p.contact) data.contact = p.contact;
            if (p.npi) data.npi = p.npi;
            if (p.zoomLink) data.zoomLink = p.zoomLink;
            if (p.hours) data.hours = p.hours;
            if (p.zoomPassword && (options.overwriteZoomPassword || !current.zoomPassword)) {
              data.zoomPassword = p.zoomPassword;
            }
            if (Object.keys(data).length) {
              await tx.provider.update({ where: { id }, data });
              providersUpdated++;
            }
          } else {
            await tx.provider.create({
              data: {
                name: p.name,
                contact: p.contact,
                npi: p.npi,
                zoomLink: p.zoomLink,
                zoomPassword: p.zoomPassword,
                hours: p.hours,
              },
            });
            providersCreated++;
          }
          providerList = await tx.provider.findMany({ select: { id: true, name: true, zoomPassword: true } });
        }
      }

      // Resolve each provider name used by entries.
      const resolved = new Map<string, { id: string | null; name: string }>();
      const rawNames = [...new Set(parsed.entries.map((e) => e.providerName).filter(Boolean))];
      for (const raw of rawNames) {
        const decision: NameDecision = options.mapping[raw] ?? { action: "auto" };
        let id: string | null = null;
        let name = raw;
        if (decision.action === "map" && decision.providerId) {
          const p = providerList.find((x) => x.id === decision.providerId);
          if (p) {
            id = p.id;
            name = p.name;
          }
        } else if (decision.action === "none") {
          id = null;
        } else {
          const auto = matchProvider(raw, providerList);
          if (auto) {
            id = auto;
            name = providerList.find((x) => x.id === auto)!.name;
          } else if (decision.action === "create" || decision.action === "auto") {
            const created = await tx.provider.create({ data: { name: raw } });
            providersCreated++;
            providerList.push({ id: created.id, name: created.name, zoomPassword: "" });
            id = created.id;
          }
        }
        resolved.set(raw, { id, name });
      }

      const existing = new Set<string>();
      for (const part of chunks(parsed.entries.map((e) => e.dedupeKey), 2000)) {
        const rows = await tx.scheduleEntry.findMany({
          where: { dedupeKey: { in: part } },
          select: { dedupeKey: true },
        });
        rows.forEach((r) => existing.add(r.dedupeKey));
      }
      const fresh = parsed.entries.filter((e) => !existing.has(e.dedupeKey));

      const log = await tx.importLog.create({
        data: {
          fileName: draft.fileName,
          sheet: draft.sheet,
          userEmail: args.userEmail,
          rowsFound: parsed.entries.length + parsed.skipped,
          created: fresh.length,
          duplicates: parsed.entries.length - fresh.length,
          skipped: parsed.skipped,
        },
      });

      for (const part of chunks(fresh)) {
        await tx.scheduleEntry.createMany({
          data: part.map((e) => {
            const r = e.providerName ? resolved.get(e.providerName) : undefined;
            return {
              date: e.date,
              section: e.section,
              timeLabel: e.timeLabel,
              trackName: e.trackName,
              typeName: e.typeName,
              clientInfo: e.clientInfo,
              providerId: r?.id ?? null,
              providerName: r?.name ?? e.providerName,
              absent: e.absent,
              canceled: e.canceled,
              completed: e.completed,
              missed: e.missed,
              dedupeKey: e.dedupeKey,
              importLogId: log.id,
            };
          }),
        });
      }

      await tx.importDraft.delete({ where: { id: draft.id } });
      return {
        created: fresh.length,
        duplicates: parsed.entries.length - fresh.length,
        skipped: parsed.skipped,
        providersCreated,
        providersUpdated,
      };
    },
    { timeout: 120000, maxWait: 10000 },
  );

  await audit(
    args.userEmail,
    "import.commit",
    `${draft.fileName} / ${draft.sheet}: ${result.created} new, ${result.duplicates} duplicates`,
  );
  return result;
}
