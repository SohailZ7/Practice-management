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
