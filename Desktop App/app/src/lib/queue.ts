// Uploading the transcripts saved on this Mac. A queued transcript is uploaded to the environment recorded when it
// was saved (not the one currently selected) and is deleted only after the server confirms.
import type { ConsentEvent } from "./consent";
import { ApiFailure, FINAL_SEQ, linkInbox, pushTranscript, putInbox, sha256Hex, SignedOutError, type Session } from "./api";
import { isEnvironment, labelFor, urlFor } from "./environments";
import type { Engine, QueueItem } from "./engine";

export type FailureKind = "checksum" | "other_env" | "signed_out" | "no_access" | "not_found" | "unreachable" | "app" | "server" | "refused" | "local" | "inbox_pending";

/** Why an upload failed, in plain words. Built only from the error kind, status and short code: never from the
 *  transcript, a patient name or the server's free text, so it is safe to show and to log. */
export type UploadFailure = { kind: FailureKind; message: string; environment: QueueItem["environment"]; /** The server ended this session for good (revoked, expired, user inactive). */ serverEnded?: boolean;
  /** Set by the app: how many times this recording has been tried and when it was last tried (memory only). */ tries?: number; lastTriedAt?: number };

export type UploadResult = { visitId: string; ok: boolean; reason?: string; failure?: UploadFailure };

const NETWORK_CAUSE: Record<string, string> = {
  Dns: "this Mac could not look up the server's address (DNS)", ConnectionFailed: "the connection was refused or blocked (firewall or proxy)",
  Io: "the connection dropped or timed out", TooManyRedirects: "the network sent the app in circles (a sign-in page on guest Wi-Fi?)",
  ProxyConnect: "the proxy refused the connection", InvalidProxyCreds: "the proxy needs a login", InsecureRequestHttpsOnly: "the network blocked the secure connection",
  BadStatus: "the server sent an unreadable reply", InvalidUrl: "the server address is not valid", UnknownScheme: "the server address is not valid", HTTP: "the server sent an unreadable reply",
};
const REASONS: Record<string, string> = {
  session_revoked: "this session was ended", session_expired: "the session expired", unknown_session: "the server no longer knows this session",
  user_inactive: "this account is inactive", no_token: "no sign-in",
};

/** Maps an upload error to a plain-words reason. `item.environment` is where the transcript is going. */
export function describeUploadFailure(e: unknown, env: QueueItem["environment"]): UploadFailure {
  const where = labelFor(env);
  const f = (kind: FailureKind, message: string): UploadFailure => ({ kind, message, environment: env });
  if (e instanceof SignedOutError) {
    const out = f("signed_out", e.reason ? `Signed out of ${where}: ${REASONS[e.reason] ?? e.reason.replace(/_/g, " ")}. Sign in in Setup; recordings stay safe on this Mac.` : `Signed out: sign in again to ${where}.`);
    if (e.reason && e.reason !== "no_token") out.serverEnded = true;
    return out;
  }
  if (e instanceof ApiFailure) {
    if (e.status === 401) return f("signed_out", `Signed out: sign in again to ${where}.`);
    if (e.status === 403) return f("no_access", "This account does not have Notes edit access.");
    if (e.status === 422 && e.code === "checksum_mismatch") return f("checksum", "The server received damaged text, so it will be sent again.");
    if (e.status === 404 && e.code === "inbox_pending") return f("inbox_pending", "The practice app is not ready to receive recordings yet. The recording is safe on this Mac and will be sent as soon as it is ready.");
    if (e.status === 404) return f("not_found", `This visit is not in the ${where} app. Add it on the ${where} website.`);
    if (e.status >= 500) return f("server", `The practice app had a problem (HTTP ${e.status}).`);
    return f("refused", `The practice app refused the transcript (HTTP ${e.status}${/^[a-z_]{1,40}$/.test(e.code ?? "") ? " " + e.code : ""}).`);
  }
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const reach = /Could not reach the practice app \((\w+)\)/.exec(msg);
  const abort = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
  if (reach || abort || e instanceof TypeError || /could not reach the practice app|failed to fetch|network|timed out|connection/i.test(msg) || !msg) {
    return f("unreachable", `Cannot reach the practice app: ${NETWORK_CAUSE[reach?.[1] ?? ""] ?? "no connection to the server"}. Nothing is lost; it keeps trying.`);
  }
  // The app itself refused to send (a bug in the app, not the network): say so, never call it a network problem.
  // Only the app's own fixed rule messages are shown (they carry no patient text); anything else is left out.
  const own = /^(Unsupported request\.|The app tried to use an HTTP method it does not allow \([A-Z]*\)\.|The app built a request it will not send \([^)]{0,120}\))/.exec(msg.replace(/\s+/g, " "));
  return f("app", `The app could not send this${own ? ` (${own[0].replace(/\.$/, "")})` : ""}. This is a problem inside the app, not your network. The recording is safe on this Mac; use Send diagnostics.`);
}

/** True for a saved transcript recorded against an environment this build does not connect to (the old staging or
 *  localhost switch). It is kept, never sent anywhere, and the provider chooses Export, Keep or Discard. */
export const isOtherEnvironment = (item: QueueItem): boolean => !isEnvironment(item.environment);

export const OTHER_ENV_MESSAGE = "Recorded against the test environment. It is kept on this Mac and is not sent to Production. Export it, keep it, or discard it.";

/** Marks a reason as already mapped (so a local failure is not mistaken for a network one). */
class LocalReadFailure extends Error {}

/** A readable name for the optional transcript copy (initials, date, time), set when a visit is recorded. */
const labels = new Map<string, string>();
export const setCopyLabel = (visitId: string, label: string) => { labels.set(visitId, label); };

let lastOk: number | null = null;
/** When the server last confirmed an upload in this session (for the Health screen). */
export const lastUploadAt = (): number | null => lastOk;

const inFlight = new Map<string, Promise<UploadResult>>();

/**
 * One renewal at a time per environment. The server rotates the sign-in on every renewal, so several uploads that all hit
 * an expired token must share ONE renewal (a second, parallel one could be refused and look like a sign-out).
 * A caller holding a token that was already replaced gets the newer one without another round trip.
 */
const renewals = new Map<string, { stale: string; result: Promise<string | null> }>();
const replaced = new Map<string, Map<string, string>>();
function renewOnce(engine: Engine, env: string, stale: string): Promise<string | null> {
  const newer = replaced.get(env)?.get(stale);
  if (newer) return Promise.resolve(newer);
  const running = renewals.get(env);
  if (running && running.stale === stale) return running.result;
  const result = engine.refreshAccessToken(env as QueueItem["environment"], stale).then((t) => {
    if (t) { const m = replaced.get(env) ?? new Map<string, string>(); m.set(stale, t); if (m.size > 8) m.delete(m.keys().next().value as string); replaced.set(env, m); }
    return t;
  }).finally(() => { if (renewals.get(env)?.result === result) renewals.delete(env); });
  renewals.set(env, { stale, result });
  return result;
}

/** A session for an environment, using the stored sign-in; null when not signed in there. */
export async function sessionFor(engine: Engine, env: QueueItem["environment"]): Promise<Session | null> {
  if (!isEnvironment(env)) return null;
  const token = await engine.accessToken(env);
  if (!token) return null;
  return { baseUrl: urlFor(env), accessToken: token, refresh: (stale) => renewOnce(engine, env, stale) };
}

/** What an upload to the server ended with. */
export type Delivery = { via: "inbox" | "visit"; linked: boolean };

/**
 * Sends the saved transcript and returns only when the server has CONFIRMED it. With a recording id it goes to the inbox
 * (never needs the visit to exist; retrying cannot duplicate) and the server must echo the SHA-256 of what it stored.
 * Until the inbox exists on the server (404) the old per-visit upload is used for items that name a visit.
 */
export async function sendConfirmed(s: Session, item: QueueItem, text: string, consent?: ConsentEvent | null): Promise<Delivery> {
  const id = item.recording_id;
  if (!id) { await pushTranscript(s, item.visit_id, text, consent); return { via: "visit", linked: true }; }
  const want = await sha256Hex(text);
  let reply;
  try {
    reply = await putInbox(s, id, { seq: FINAL_SEQ, final: true, text, durationSeconds: item.duration_seconds, recordedAt: item.created_at, visitId: item.link_visit ?? null, consent: consent ?? null });
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404 && item.link_visit) {
      // Old server without the inbox: fall back to the visit upload once. If that is a 404 too, say "not ready" (not a
      // missing visit) and stop; the retry timer then waits PARK_RETRY_MS instead of asking again every few minutes.
      try { await pushTranscript(s, item.link_visit, text, consent); } catch (e2) { if (e2 instanceof ApiFailure && e2.status === 404) throw new ApiFailure(404, "inbox_pending"); throw e2; }
      return { via: "visit", linked: true };
    }
    if (e instanceof ApiFailure && e.status === 404) throw new ApiFailure(404, "inbox_pending");
    throw e;
  }
  if (!reply.final || reply.sha256 !== want) throw new ApiFailure(422, "checksum_mismatch");
  let linked = !!reply.visitId;
  if (!linked && item.link_visit) {
    try { await linkInbox(s, id, item.link_visit); linked = true; } catch (e) {
      // Safe on the server already; it just waits to be linked to a visit ("Needs link"). Sign-in problems still retry.
      if (e instanceof SignedOutError || (e instanceof ApiFailure && e.status === 401)) throw e;
    }
  }
  return { via: "inbox", linked };
}

/** Uploads one queued transcript. On any failure the saved copy is kept. Never logs the text. */
export function uploadQueued(engine: Engine, item: QueueItem, session?: Session | null): Promise<UploadResult> {
  const running = inFlight.get(item.visit_id);
  if (running) return running;
  const p = (async (): Promise<UploadResult> => {
    let delivered: Delivery | undefined;
    try {
      if (isOtherEnvironment(item)) {
        const failure: UploadFailure = { kind: "other_env", message: OTHER_ENV_MESSAGE, environment: item.environment };
        return { visitId: item.visit_id, ok: false, reason: failure.message, failure };
      }
      if (item.status !== "uploaded") {
        const s = session ?? (await sessionFor(engine, item.environment));
        if (!s) {
          const failure = describeUploadFailure(new SignedOutError(), item.environment);
          return { visitId: item.visit_id, ok: false, reason: failure.message, failure };
        }
        let text: string;
        try { text = await engine.queueText(item.visit_id); } catch { throw new LocalReadFailure(); }
        const consent = await Promise.resolve().then(() => engine.consentFor(item.visit_id)).catch(() => null);
        delivered = await sendConfirmed(s, item, text, consent);
      }
      let warning: string | undefined;
      if (delivered && !delivered.linked && item.recording_id) warning = item.link_visit
          ? "Recording saved, but the visit already has different text, so it was not changed. Choose Append under Needs link."
          : "Recovered recording saved. The visit has not changed yet. Link it under Needs link.";
      try {
        // The queue copy is shredded next, so the optional plain-text copy is written first.
        await engine.saveTranscriptCopy(item.visit_id, labels.get(item.visit_id) ?? `visit_${item.created_at.slice(0, 16)}_${item.visit_id.slice(0, 8)}`);
      } catch (e) {
        warning = typeof e === "string" ? e : e instanceof Error ? e.message : "Could not save the transcript copy.";
      }
      await engine.queueComplete(item.visit_id);
      labels.delete(item.visit_id);
      lastOk = Date.now();
      return { visitId: item.visit_id, ok: true, reason: warning };
    } catch (e) {
      const failure: UploadFailure = e instanceof LocalReadFailure
        ? { kind: "local", message: "Could not read the saved transcript on this Mac.", environment: item.environment }
        : describeUploadFailure(e, item.environment);
      return { visitId: item.visit_id, ok: false, reason: failure.message, failure };
    } finally {
      inFlight.delete(item.visit_id);
    }
  })();
  inFlight.set(item.visit_id, p);
  return p;
}

/** Automatic retries leave a recording alone this long when the server answered "not ready" (404). */
export const PARK_RETRY_MS = 30 * 60_000;

/** Recordings the automatic retry skips right now: a visit the server does not know (waits for "Retry now" or the visit),
 *  and "server not ready" for PARK_RETRY_MS after the last try. Nothing is deleted; they are only asked less often. */
export function parkedIds(failures: Record<string, UploadFailure>, now: number): Set<string> {
  const out = new Set<string>();
  for (const [id, f] of Object.entries(failures)) {
    if (f.kind === "not_found") out.add(id);
    else if (f.kind === "inbox_pending" && now - (f.lastTriedAt ?? 0) < PARK_RETRY_MS) out.add(id);
  }
  return out;
}

/** Retries everything in the queue, each against its own environment. */
export async function retryAll(engine: Engine, skip: ReadonlySet<string> = new Set()): Promise<UploadResult[]> {
  const items = (await engine.queueList()).filter((i) => i.status !== "uploaded" && !skip.has(i.visit_id));
  return Promise.all(items.map((i) => uploadQueued(engine, i)));
}

/** The environments whose session the SERVER ended for good in these results (each listed once). The app signs those out
 *  everywhere at once; a network failure or a missing token is never in this list. */
export function endedEnvironments(results: UploadResult[]): QueueItem["environment"][] {
  const out: QueueItem["environment"][] = [];
  for (const r of results) if (r.failure?.serverEnded && !out.includes(r.failure.environment)) out.push(r.failure.environment);
  return out;
}
