// The recorder's only connection to the practice: the web app's desktop API.
//
// It pulls the day's visits and pushes back a transcript. The audio never leaves this Mac, and the recorder keeps
// no patient record of its own: visits arrive as initials and are forgotten when the day changes.
import { assertSafeBaseUrl } from "./environments";

export type Visit = {
  id: string;
  initials: string;
  program: string;
  /** Clock time(s) from the pasted board, e.g. "9:00-11:30". Empty or missing when the board had none. */
  apptTime?: string;
  appointmentType: string;
  providerName: string;
  hasTranscript: boolean;
  documentCount: number;
};

export type Session = {
  baseUrl: string;
  accessToken: string;
  /**
   * Called once after a 401. Returns a new access token, or null when the sign-in could not be renewed. When it is
   * missing a 401 simply means signed out.
   */
  refresh?: (staleToken: string) => Promise<string | null>;
};

/** The sign-in is gone and could not be renewed: the UI shows the sign-in screen. */
export class SignedOutError extends Error {
  constructor() {
    super("Signed out. Sign in again in Setup.");
    this.name = "SignedOutError";
  }
}

export type AuthConfig = { googleSignIn: boolean };

/**
 * Whether the practice app has Google sign-in set up. Asked before the button is offered, so a missing OAuth client
 * shows as an explanation rather than a button that does nothing.
 */
export async function fetchAuthConfig(baseUrl: string): Promise<AuthConfig> {
  assertSafeBaseUrl(baseUrl);
  const res = await transport(baseUrl, "GET", "/api/desktop/v1/auth/config", null);
  if (res.status < 200 || res.status > 299) throw new Error(`The practice app returned ${res.status}.`);
  let c: AuthConfig;
  try { c = JSON.parse(res.body) as AuthConfig; } catch { throw new Error("The practice app gave an unreadable reply."); }
  return { googleSignIn: c.googleSignIn === true };
}

/** The reply to one API call: just the status and the body text. */
export type ApiReply = { status: number; body: string };

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Every API call goes through here. In the app it runs in Rust, because the webview is a different origin from the
 * server and the server sends no CORS headers, so a webview fetch would always fail. In a plain browser (development
 * only) it falls back to fetch.
 */
export async function transport(
  baseUrl: string, method: string, path: string, token: string | null, body?: string,
): Promise<ApiReply> {
  const base = baseUrl.replace(/\/$/, "");
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      return await invoke<ApiReply>("api_request", { baseUrl: base, method, path, token, body: body ?? null });
    } catch (e) {
      throw new Error(typeof e === "string" ? e : "Could not reach the practice app.");
    }
  }
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body,
    });
    return { status: res.status, body: await res.text() };
  } catch {
    throw new Error("Could not reach the practice app.");
  }
}

async function send(session: Session, path: string, init: RequestInit): Promise<ApiReply> {
  return transport(session.baseUrl, init.method ?? "GET", `/api/desktop/v1${path}`, session.accessToken,
    typeof init.body === "string" ? init.body : undefined);
}

/** A non-success reply, with the server's short error code when it sent one. */
export class ApiFailure extends Error {
  constructor(readonly status: number, readonly code: string | null, message?: string) {
    super(message ?? `The practice app returned ${status}.`);
    this.name = "ApiFailure";
  }
}

function errorCode(res: ApiReply): string | null {
  try {
    const b = JSON.parse(res.body) as { error?: unknown };
    return typeof b.error === "string" ? b.error : null;
  } catch {
    return null;
  }
}

async function call<T>(session: Session, path: string, init: RequestInit = {}): Promise<T> {
  assertSafeBaseUrl(session.baseUrl);
  let res = await send(session, path, init);
  if (res.status === 401 && session.refresh) {
    const next = await session.refresh(session.accessToken);
    if (!next) throw new SignedOutError();
    session.accessToken = next;
    res = await send(session, path, init);
  }
  if (res.status === 401) throw new SignedOutError();
  if (res.status === 403) throw new ApiFailure(403, errorCode(res), "This account does not have access to Notes.");
  if (res.status < 200 || res.status > 299) throw new ApiFailure(res.status, errorCode(res));
  try { return JSON.parse(res.body) as T; } catch { throw new Error("The practice app gave an unreadable reply."); }
}

export const fetchVisits = (session: Session, date: string) =>
  call<{ date: string; visits: Visit[] }>(session, `/notes/visits?date=${encodeURIComponent(date)}`);

export type LoadResult = {
  created: number;
  skippedExisting: number;
  kept: number;
  skippedNoClient: number;
  skippedOtherProvider: number;
  otherProviders: string[];
};

/**
 * Sends a pasted board to the practice app, which parses it and creates the visits. The parsing deliberately happens
 * there: the recorder carries no copy of the board's rules.
 */
export const syncSchedule = (session: Session, date: string, pasted: string, provider: string) =>
  call<LoadResult>(session, "/notes/schedule", { method: "POST", body: JSON.stringify({ date, pasted, provider }) });

export const pushTranscript = (session: Session, visitId: string, transcript: string) =>
  call<{ ok: true }>(session, `/notes/visits/${encodeURIComponent(visitId)}/transcript`, {
    method: "POST",
    body: JSON.stringify({ transcript }),
  });

// ----------------------------------------------------------------------------- feedback

export type FeedbackKind = "FEEDBACK" | "BUG";
export type FeedbackItem = {
  id: string;
  kind: FeedbackKind;
  title: string;
  description: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  mine: boolean;
  /** Set by the server (or locally after a promote) when the item was copied to production. */
  promotedAt?: string | null;
};
export type FeedbackInput = { kind: FeedbackKind; title: string; description: string };

/** Turns a failed feedback call into a sentence the user can act on. */
export function feedbackErrorMessage(e: unknown): string {
  if (e instanceof ApiFailure) {
    if (e.status === 422 && e.code === "possible_phi")
      return "This looks like it may contain patient information. Remove names and details, then save again.";
    if (e.status === 503) return "The note-writing model is not set up on this server yet, so it cannot tidy dictation. Type it instead.";
    if (e.status === 502) return "The note-writing model failed. Try again, or type it instead.";
    if (e.status === 413) return "That recording is too long to tidy (over 20,000 characters). Record a shorter one.";
    if (e.status === 403) return "You can only edit your own feedback.";
  }
  return e instanceof Error ? e.message : String(e);
}

export const fetchFeedback = (session: Session) =>
  call<{ items: FeedbackItem[] }>(session, "/feedback?limit=100");

export const createFeedback = (session: Session, input: FeedbackInput) =>
  call<{ item: FeedbackItem }>(session, "/feedback", { method: "POST", body: JSON.stringify(input) });

export const updateFeedback = (session: Session, id: string, input: Partial<FeedbackInput>) =>
  call<{ item: FeedbackItem }>(session, `/feedback/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });

export const cleanupFeedback = (session: Session, transcript: string) =>
  call<{ title: string; description: string; possiblePhi: string[] }>(session, "/feedback/cleanup", {
    method: "POST",
    body: JSON.stringify({ transcript }),
  });

export type NewVisit = { patient: string; apptTime?: string; program?: string; appointmentType?: string; providerName?: string };

/** Adds one visit by hand. `patient` is "First Last". */
export const createVisit = (session: Session, date: string, v: NewVisit) =>
  call<{ id: string; apptTime: string; program: string; appointmentType: string }>(session, "/notes/visits", {
    method: "POST",
    body: JSON.stringify({ date, ...v }),
  });

/** Changes a visit's time, program, type or provider. */
export const updateVisit = (session: Session, id: string, patch: Partial<Omit<NewVisit, "patient">>) =>
  call<unknown>(session, `/notes/visits/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });

/** Removes a visit, including its transcript and documents. */
export const deleteVisit = (session: Session, id: string) =>
  call<{ ok: boolean }>(session, `/notes/visits/${encodeURIComponent(id)}`, { method: "DELETE" });

/** Plain wording for the add/edit errors. */
export function visitErrorMessage(e: unknown): string {
  if (e instanceof ApiFailure) {
    if (e.code === "bad_patient") return "Enter the client as First Last.";
    if (e.code === "bad_time") return "That time is not valid. Use a form like 9:00 or 9:00 - 11:30.";
    if (e.code === "bad_type") return "Choose an appointment type from the list.";
    if (e.code === "bad_provider") return "Choose a provider from the list.";
    if (e.code === "bad_date") return "That date is not valid.";
    if (e.code === "not_found") return "That visit no longer exists. Refresh the list.";
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Deletes several visits (and their transcripts and documents). Uses the bulk endpoint in chunks of 200; if the server
 * does not have it yet (404) it deletes one by one. Returns how many were deleted.
 */
export async function deleteVisits(session: Session, ids: string[]): Promise<{ deleted: number; notFound: number }> {
  let deleted = 0;
  let notFound = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    try {
      // The server answers with the lists of ids (older drafts used counts), so accept either.
      const r = await call<{ deleted: string[] | number; notFound: string[] | number }>(session, "/notes/visits/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ ids: chunk }),
      });
      const n = (v: string[] | number | undefined) => (Array.isArray(v) ? v.length : typeof v === "number" ? v : 0);
      deleted += n(r.deleted);
      notFound += n(r.notFound);
    } catch (e) {
      if (!(e instanceof ApiFailure) || (e.status !== 404 && e.status !== 405)) throw e;
      for (const id of chunk) {
        try {
          await deleteVisit(session, id);
          deleted++;
        } catch (err) {
          if (err instanceof ApiFailure && err.status === 404) notFound++;
          else throw err;
        }
      }
    }
  }
  return { deleted, notFound };
}

export type VisitOptions = { programs: string[]; appointmentTypes: string[]; providers: string[] };

/** The programs, appointment types and providers the practice uses. Null when the server has no such list yet. */
export async function fetchVisitOptions(session: Session): Promise<VisitOptions | null> {
  try {
    const o = await call<Partial<VisitOptions>>(session, "/notes/options");
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);
    return { programs: list(o.programs), appointmentTypes: list(o.appointmentTypes), providers: list(o.providers) };
  } catch (e) {
    if (e instanceof ApiFailure && (e.status === 404 || e.status === 405 || e.status === 403)) return null;
    throw e;
  }
}

/**
 * The transcript the practice app holds for a visit. Needs GET /notes/visits/{id}/transcript on the server; a 404 or
 * 405 means it is not there yet.
 */
export const fetchTranscript = (session: Session, visitId: string) =>
  call<{ transcript: string; updatedAt?: string }>(session, `/notes/visits/${encodeURIComponent(visitId)}/transcript`);

// ---------------------------------------------------------------------------------------------- generate a note

export type DocType = { id: string; label: string; default: boolean };
export type NoteDocument = { id: string; docType: string; title: string; latestVersion: number; updatedAt?: string };
export type DocField = { name: string; label: string; type: "text" | "longtext" | "checkbox" | "select" | "date"; options?: string[] };
export type DocVersion = { version: number; source: string; createdAt: string; authorName?: string };
export type FieldValue = string | boolean;
export type DocumentDetail = {
  id: string; docType: string; title: string; fields: DocField[]; versions: DocVersion[];
  current: { version: number; values: Record<string, FieldValue> };
};
export type GenerateResult = { documents: NoteDocument[]; errors: { docType: string; error: string }[] };

const vpath = (visitId: string) => `/notes/visits/${encodeURIComponent(visitId)}`;

/** Document types offered for an appointment type; `default` ones are pre-checked. */
export const fetchDocTypes = (session: Session, appointmentType: string) =>
  call<{ docTypes: DocType[] }>(session, `/notes/doc-types?appointmentType=${encodeURIComponent(appointmentType)}`);

/** Writes the chosen documents from the transcript (omit `docTypes` for the defaults). Can take about two minutes. */
export async function generateDocuments(session: Session, visitId: string, docTypes?: string[]): Promise<GenerateResult> {
  const r = await call<{ documents?: NoteDocument[]; errors?: { docType?: string; error?: string; code?: string }[] }>(
    session, `${vpath(visitId)}/generate`, { method: "POST", body: JSON.stringify(docTypes ? { docTypes } : {}) });
  return {
    documents: r.documents ?? [],
    errors: (r.errors ?? []).map((e) => ({ docType: e.docType ?? "", error: e.error ?? e.code ?? "generate_failed" })),
  };
}

export const listDocuments = (session: Session, visitId: string) =>
  call<{ documents: NoteDocument[] }>(session, `${vpath(visitId)}/documents`);

export const fetchDocument = (session: Session, visitId: string, docId: string, version?: number) =>
  call<DocumentDetail>(session, `${vpath(visitId)}/documents/${encodeURIComponent(docId)}${version ? `?version=${version}` : ""}`);

/** Saves the edited form as a NEW version (the earlier versions are never changed). */
export const saveDocumentVersion = (session: Session, visitId: string, docId: string, baseVersion: number, values: Record<string, FieldValue>) =>
  call<{ version: number; createdAt: string }>(session, `${vpath(visitId)}/documents/${encodeURIComponent(docId)}/versions`,
    { method: "POST", body: JSON.stringify({ baseVersion, values }) });

/** Plain wording for the generate / document errors. */
export function noteErrorMessage(e: unknown): string {
  if (e instanceof ApiFailure) {
    if (e.code === "no_transcript") return "This visit has no transcript yet. Record it first.";
    if (e.code === "model_not_configured") return "The note-writing model is not set up on this server yet.";
    if (e.code === "generate_failed" || e.status === 502) return "The note-writing model failed. Try again in a minute.";
    if (e.code === "no_doc_types") return "Choose at least one document to write.";
    if (e.code === "bad_doc_types") return "One of the chosen documents is not available. Reopen the chooser and try again.";
    if (e.code === "stale_version") return "Someone saved a newer version while you were editing. Load the latest, then redo your changes.";
    if (e.code === "no_changes") return "Nothing has changed since this version, so there is nothing to save.";
    if (e.code === "bad_values") return "Some answers are not valid. Check the form and try again.";
    if (e.code === "not_found" || e.status === 404) return "That visit or document no longer exists. Refresh the list.";
  }
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------------------------- promote feedback

/** Copies a feedback item from Staging to Production. Only offered when the environment is Staging. */
export const promoteFeedback = (session: Session, id: string) =>
  call<{ promoted: boolean; promotedAt: string }>(session, `/feedback/${encodeURIComponent(id)}/promote`, { method: "POST", body: "{}" });

export function promoteErrorMessage(e: unknown): string {
  if (e instanceof ApiFailure) {
    if (e.code === "already_promoted") return "This item was already promoted to Production.";
    if (e.code === "is_test_item") return "This is a test item, so it cannot be promoted.";
    if (e.code === "promote_failed" || e.status === 502) return "Production did not accept it. Try again in a minute.";
    if (e.code === "not_found" || e.status === 404) return "That feedback item no longer exists. Refresh the list.";
  }
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------------------------- my tasks

export type TaskStatus = "open" | "done";
export type Task = { id: string; title: string; dueDate: string | null; status: TaskStatus; createdAt: string };

export const fetchTasks = (session: Session, status: "open" | "done" | "all") =>
  call<{ tasks: Task[] }>(session, `/tasks?status=${status}`);

export const createTask = (session: Session, title: string, dueDate?: string) =>
  call<{ task?: Task; id?: string }>(session, "/tasks", { method: "POST", body: JSON.stringify({ title, ...(dueDate ? { dueDate } : {}) }) });

export const updateTask = (session: Session, id: string, patch: { status?: TaskStatus; title?: string; dueDate?: string | null }) =>
  call<unknown>(session, `/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });

export function taskErrorMessage(e: unknown): string {
  if (e instanceof ApiFailure) {
    if (e.code === "bad_title") return "Give the task a title.";
    if (e.status === 403) return "This account does not have access to Tasks.";
    if (e.code === "not_found" || e.status === 404) return "That task no longer exists. Refresh the list.";
  }
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------------------------- visit lookup

/** One search hit. Only these fields are ever shown. */
export type VisitHit = {
  id: string; date: string; time: string; program: string; type: string; provider: string;
  initials: string; hasTranscript: boolean; hasDocuments: boolean;
};

/** Finds visits by initials and/or date (at least one), newest first, at most 50. */
export const searchVisits = (session: Session, q: { initials?: string; date?: string }) => {
  const p = new URLSearchParams();
  if (q.initials) p.set("initials", q.initials);
  if (q.date) p.set("date", q.date);
  return call<{ visits: VisitHit[] }>(session, `/notes/visits/search?${p.toString()}`);
};

export function searchErrorMessage(e: unknown): string {
  if (e instanceof ApiFailure) {
    if (e.code === "bad_query") return "Enter the patient's initials, a date, or both.";
    if (e.code === "bad_date") return "That date is not valid.";
  }
  return e instanceof Error ? e.message : String(e);
}

/** Checks the search inputs before asking the server. Returns a message, or "" when fine. */
export function searchInputProblem(initials: string, date: string): string {
  const i = initials.trim();
  if (!i && !date) return "Enter the patient's initials, a date, or both.";
  if (i && !/^[A-Za-z][A-Za-z. ]*$/.test(i)) return "Initials are letters only, like AB.";
  if (i && i.replace(/[^A-Za-z]/g, "").length > 3) return "Use up to 3 initials, like AB.";
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "That date is not valid.";
  return "";
}
