// Pure helpers for the document UI: wording of errors, dirty checks, defaults. No React, so they are unit tested.

import { DocApiError, type DocType, type FieldDef, type FieldValues, type VersionInfo } from "./docsClient";

const GENERATE_MESSAGES: Record<string, string> = {
  not_found: "This visit could not be found. It may have been deleted. Refresh the page.",
  no_transcript: "This visit has no transcript yet. Finish the recording first.",
  model_not_configured: "No note-writing model is set up yet. Ask the administrator to configure one.",
  generate_failed: "The note-writing model did not finish. Nothing was lost. Try again in a minute.",
};

export function generateErrorMessage(e: unknown): string {
  if (e instanceof DocApiError) return GENERATE_MESSAGES[e.code] ?? (e.status >= 500 ? GENERATE_MESSAGES.generate_failed : `Could not generate (${e.code}).`);
  return "Could not reach the server. Check your connection and try again.";
}

export function typeLabel(types: DocType[], id: string): string {
  return types.find((t) => t.id === id)?.label ?? id;
}

export function defaultSelection(types: DocType[]): string[] {
  return types.filter((t) => t.default).map((t) => t.id);
}

export function toggleSelection(sel: string[], id: string): string[] {
  return sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id];
}

export const isChecked = (v: unknown) => v === true || v === "true" || v === "yes" || v === "on" || v === 1;

/** Value as the form control shows it. */
export function displayValue(f: FieldDef, v: unknown): string {
  if (f.type === "checkbox") return isChecked(v) ? "true" : "";
  return v == null ? "" : String(v);
}

function norm(f: FieldDef, v: unknown): string | boolean {
  return f.type === "checkbox" ? isChecked(v) : displayValue(f, v);
}

/** True when the edited values differ from the saved ones, treating missing and empty alike. */
export function isDirty(fields: FieldDef[], saved: FieldValues, edited: FieldValues): boolean {
  return fields.some((f) => norm(f, saved[f.name]) !== norm(f, edited[f.name]));
}

/** Full value map for every field, so a save never drops a field the provider did not touch. */
export function completeValues(fields: FieldDef[], values: FieldValues): FieldValues {
  const out: FieldValues = {};
  for (const f of fields) out[f.name] = f.type === "checkbox" ? isChecked(values[f.name]) : displayValue(f, values[f.name]);
  return out;
}

/** The first version written by the model is the original the psychiatrist's edits are compared to. */
export function modelOriginal(versions: VersionInfo[]): number | null {
  const m = versions.filter((x) => /model|ai|generated/i.test(x.source)).sort((a, b) => a.version - b.version)[0];
  return m ? m.version : null;
}

export function versionLabel(v: VersionInfo, original: number | null, latest: number): string {
  const tags = [v.version === original ? "model original" : v.source === "user" || !/model/i.test(v.source) ? "edited" : "", v.version === latest ? "latest" : ""].filter(Boolean);
  const when = new Date(v.createdAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `v${v.version}${tags.length ? ` (${tags.join(", ")})` : ""} · ${when}${v.authorName ? ` · ${v.authorName}` : ""}`;
}

export type SaveOutcome = { kind: "saved"; version: number } | { kind: "stale" } | { kind: "no_changes" } | { kind: "error"; message: string };

export function saveErrorOutcome(e: unknown): SaveOutcome {
  if (e instanceof DocApiError) {
    if (e.code === "stale_version") return { kind: "stale" };
    if (e.code === "no_changes") return { kind: "no_changes" };
    if (e.code === "bad_values") return { kind: "error", message: "Some values are not valid for this form. Check the highlighted fields and try again." };
    if (e.status === 404) return { kind: "error", message: "This document no longer exists. Close this window and refresh." };
    if (e.status === 403 || e.status === 401) return { kind: "error", message: "You do not have permission to save this document." };
  }
  return { kind: "error", message: "Could not save. Your edits are still here. Try again." };
}

/** One small icon per document type for the row. The tooltip carries the full name. */
export function typeIcon(docType: string): string {
  const t = docType.toLowerCase();
  if (/eval/.test(t)) return "🧠";
  if (/discharge|dc/.test(t)) return "🚪";
  if (/admit/.test(t)) return "📥";
  if (/follow/.test(t)) return "🗒️";
  return "📝";
}
