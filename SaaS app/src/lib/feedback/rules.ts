// Pure rules for Feedback: categories, input checks, who may edit, and the dictation clean-up prompt and parser.
import { detectPhi, type PhiKind } from "../phiGuard";
import { isScope, isStatus, type FeedbackScope, type FeedbackStatus } from "./workflow";

export const KINDS = ["FEEDBACK", "BUG"] as const;
export type FeedbackKind = (typeof KINDS)[number];
export const KIND_LABEL: Record<FeedbackKind, string> = { FEEDBACK: "Feedback", BUG: "Bug" };

export const MAX_TITLE = 200;
export const MAX_DESCRIPTION = 5000;
export const MAX_TRANSCRIPT = 20000;

export const isKind = (v: unknown): v is FeedbackKind => typeof v === "string" && (KINDS as readonly string[]).includes(v);

export type FeedbackInput = { kind: FeedbackKind; title: string; description: string };
export type FeedbackPatch = Partial<FeedbackInput>;

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string; phi?: PhiKind[] };

/** Accepts what a client may send. Unknown keys are ignored. Text that looks like patient information is refused. */
export function checkFeedback(body: Record<string, unknown>, mode: "create" | "update"): Checked<FeedbackPatch> {
  const out: FeedbackPatch = {};
  if (body.kind !== undefined || mode === "create") {
    if (!isKind(body.kind)) return { ok: false, error: "Choose Feedback or Bug." };
    out.kind = body.kind;
  }
  if (body.title !== undefined || mode === "create") {
    if (typeof body.title !== "string" || !body.title.trim()) return { ok: false, error: "Enter a title." };
    if (body.title.trim().length > MAX_TITLE) return { ok: false, error: `Title must be ${MAX_TITLE} characters or fewer.` };
    out.title = body.title.trim();
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string") return { ok: false, error: "Description must be text." };
    if (body.description.length > MAX_DESCRIPTION) return { ok: false, error: `Description must be ${MAX_DESCRIPTION} characters or fewer.` };
    out.description = body.description.trim();
  } else if (mode === "create") {
    out.description = "";
  }
  const phi = detectPhi(`${out.title ?? ""}\n${out.description ?? ""}`);
  if (phi.length) {
    return { ok: false, error: "This looks like it contains patient information. Remove it and try again.", phi: Array.from(new Set(phi.map((f) => f.kind))) };
  }
  return { ok: true, value: out };
}

/** Only the author edits. Admins and everyone else view only. */
export const canEditFeedback = (viewerId: string, authorId: string): boolean => viewerId === authorId;

export type FeedbackOut = {
  id: string;
  kind: FeedbackKind;
  title: string;
  description: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  mine: boolean;
  status: FeedbackStatus;
  scope: FeedbackScope | null;
  testNotes: string;
  ownerApproved: boolean;
};

export function toFeedbackOut(
  row: { id: string; kind: string; title: string; description: string; authorId: string; createdAt: Date; updatedAt: Date; author: { name: string }; status?: string; scope?: string | null; testNotes?: string; ownerApprovedAt?: Date | null },
  viewerId: string,
): FeedbackOut {
  return {
    id: row.id,
    kind: isKind(row.kind) ? row.kind : "FEEDBACK",
    title: row.title,
    description: row.description,
    authorName: row.author.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    mine: canEditFeedback(viewerId, row.authorId),
    status: isStatus(row.status) ? row.status : "new",
    scope: isScope(row.scope) ? row.scope : null,
    testNotes: row.testNotes ?? "",
    ownerApproved: !!row.ownerApprovedAt,
  };
}

export const CLEANUP_SYSTEM =
  "You tidy a spoken comment about a software app into a written feedback item. Use only what the speaker said; add nothing. " +
  "Remove filler words and repetition. Keep every point they made. Do not include any person's name, phone number or other identifying detail " +
  "about a patient; if one was spoken, leave it out. Reply with JSON only: " +
  '{"title": "a short clear title under 80 characters", "description": "the cleaned-up comment, in the speaker\'s own meaning, as short paragraphs"}';

export const cleanupPrompt = (transcript: string): string => `Transcript:\n"""\n${transcript}\n"""`;

/** Reads the model's reply. Tolerates code fences and surrounding text; returns null if there is no usable title. */
export function parseCleanup(reply: string): { title: string; description: string } | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(reply.slice(start, end + 1)) as { title?: unknown; description?: unknown };
    const title = typeof v.title === "string" ? v.title.trim().slice(0, MAX_TITLE) : "";
    const description = typeof v.description === "string" ? v.description.trim().slice(0, MAX_DESCRIPTION) : "";
    return title ? { title, description } : null;
  } catch {
    return null;
  }
}
