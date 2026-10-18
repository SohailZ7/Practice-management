import type { ScheduleEntry } from "@prisma/client";

export type Section = "PSYCH_EVAL" | "TRACK";

export type EntryDTO = {
  id: string;
  date: string;
  section: Section;
  timeLabel: string;
  typeName: string;
  clientInfo: string;
  providerId: string | null;
  providerName: string;
  absent: boolean;
  canceled: boolean;
  completed: boolean;
  missed: boolean;
};

export type EntryPatch = Partial<
  Pick<
    EntryDTO,
    "section" | "timeLabel" | "typeName" | "clientInfo" | "providerId" | "absent" | "canceled" | "completed" | "missed"
  >
>;

export function toEntryDTO(e: ScheduleEntry): EntryDTO {
  return {
    id: e.id,
    date: e.date,
    section: e.section === "TRACK" ? "TRACK" : "PSYCH_EVAL",
    timeLabel: e.timeLabel,
    typeName: e.typeName,
    clientInfo: e.clientInfo,
    providerId: e.providerId,
    providerName: e.providerName,
    absent: e.absent,
    canceled: e.canceled,
    completed: e.completed,
    missed: e.missed,
  };
}

export function totals(entries: { absent: boolean; canceled: boolean; completed: boolean; missed: boolean }[]) {
  return {
    scheduled: entries.length,
    completed: entries.filter((e) => e.completed).length,
    absent: entries.filter((e) => e.absent).length,
    canceled: entries.filter((e) => e.canceled).length,
    missed: entries.filter((e) => e.missed).length,
  };
}
