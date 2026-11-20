// The choices offered when adding a visit by hand: drop-downs on the web form and in the recorder. Pure builders plus
// one loader. Programs and times accept a typed value too; appointment type and provider are strict.

import { db } from "../db";
import { TIME_PRESETS } from "./scheduleTime";
import { LIVE_VISITS } from "../unify/visible";

export const BASE_APPOINTMENT_TYPES = [
  "Psych Eval",
  "Psych Eval & Admit Order",
  "Follow-up",
  "Follow-up & Admit Order",
  "Follow-up & Discharge Order",
  "DC Orders Only",
];

/** 15-minute slots from 6:00 AM to 8:00 PM, written the way the sheet and the Time column show them. */
export function timeSlots(): string[] {
  const out: string[] = [];
  for (let m = 6 * 60; m <= 20 * 60; m += 15) {
    const h24 = Math.floor(m / 60);
    const h = h24 % 12 === 0 ? 12 : h24 % 12;
    out.push(`${h}:${String(m % 60).padStart(2, "0")} ${h24 >= 12 ? "PM" : "AM"}`);
  }
  return out;
}

/** Union by case-insensitive text, first spelling wins, blanks dropped, sorted. */
export function mergeOptions(...lists: string[][]): string[] {
  const seen = new Map<string, string>();
  for (const v of lists.flat()) {
    const t = v.replace(/\s+/g, " ").trim();
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** The listed spelling of `value`, or null when it is not an option. */
export function matchOption(options: string[], value: string): string | null {
  const t = value.replace(/\s+/g, " ").trim().toLowerCase();
  return options.find((o) => o.toLowerCase() === t) ?? null;
}

export type VisitOptions = { programs: string[]; appointmentTypes: string[]; providers: string[]; times: string[] };

export const HIDEABLE_KINDS = ["program", "appointment_type", "provider"] as const;
export type HideKind = (typeof HIDEABLE_KINDS)[number];

/** Drops values (case-insensitive) that are hidden. Pure. */
export function withoutHidden(options: string[], hidden: string[]): string[] {
  const h = new Set(hidden.map((v) => v.trim().toLowerCase()));
  return options.filter((o) => !h.has(o.trim().toLowerCase()));
}

/**
 * Pick lists for NEW visits hide soft-hidden values. Pass includeHidden for validating a save, so an old visit that still
 * carries a hidden provider or type can be edited, and for the admin screen that lists everything.
 */
export async function loadVisitOptions(opts: { includeHidden?: boolean } = {}): Promise<VisitOptions> {
  const [visits, providers, tracks, types, hiddenRows] = await Promise.all([
    db.visit.findMany({ where: LIVE_VISITS, distinct: ["program", "appointmentType", "providerName"], select: { program: true, appointmentType: true, providerName: true } }),
    db.provider.findMany({ select: { name: true } }),
    db.trackDef.findMany({ select: { name: true } }),
    db.entryType.findMany({ select: { name: true } }),
    opts.includeHidden ? Promise.resolve([]) : db.hiddenOption.findMany({ select: { kind: true, value: true } }),
  ]);
  const hid = (kind: HideKind) => hiddenRows.filter((h) => h.kind === kind).map((h) => h.value);
  return {
    programs: withoutHidden(mergeOptions(tracks.map((t) => t.name), visits.map((v) => v.program)), hid("program")),
    appointmentTypes: withoutHidden(mergeOptions(BASE_APPOINTMENT_TYPES, types.map((t) => t.name), visits.map((v) => v.appointmentType)), hid("appointment_type")),
    providers: withoutHidden(mergeOptions(providers.map((p) => p.name), visits.map((v) => v.providerName)), hid("provider")),
    times: [...TIME_PRESETS, ...timeSlots()],
  };
}
