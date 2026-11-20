// Comment-style notes on a visit (feedback: schedule notes like Tasks, provider notes and admin notes). Pure rules.
export const NOTE_KINDS = [
  { value: "general", label: "Note" },
  { value: "provider", label: "Provider note" },
  { value: "admin", label: "Admin note" },
] as const;
export type NoteKind = (typeof NOTE_KINDS)[number]["value"];
export const MAX_NOTE = 2000;

export const isNoteKind = (v: unknown): v is NoteKind => NOTE_KINDS.some((k) => k.value === v);
export const noteKindLabel = (v: string) => NOTE_KINDS.find((k) => k.value === v)?.label ?? "Note";

/** Who may write which kind: anyone with Notes edit writes a general note; provider notes need a provider or admin; admin notes need an admin. */
export function canWriteKind(role: string, kind: NoteKind): boolean {
  if (kind === "general") return true;
  if (kind === "provider") return role === "ADMIN" || role === "PROVIDER";
  return role === "ADMIN";
}

/** Only the author or an admin may mark a note resolved or reopen it. */
export function canResolve(role: string, authorEmail: string, userEmail: string): boolean {
  return role === "ADMIN" || authorEmail === userEmail;
}

export function cleanNoteBody(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim().slice(0, MAX_NOTE) : "";
}

export type VisitNoteDTO = { id: string; kind: string; body: string; author: string; at: number; resolved: boolean; resolvedBy: string | null };
