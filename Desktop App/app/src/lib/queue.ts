// Uploading the transcripts saved on this Mac. A queued transcript is uploaded to the environment recorded when it
// was saved (not the one currently selected) and is deleted only after the server confirms.
import { ApiFailure, pushTranscript, SignedOutError, type Session } from "./api";
import { labelFor, urlFor } from "./environments";
import type { Engine, QueueItem } from "./engine";

export type FailureKind = "signed_out" | "no_access" | "not_found" | "unreachable" | "server" | "refused" | "local";

/** Why an upload failed, in plain words. Built only from the error kind, status and short code: never from the
 *  transcript, a patient name or the server's free text, so it is safe to show and to log. */
export type UploadFailure = { kind: FailureKind; message: string; environment: QueueItem["environment"] };

export type UploadResult = { visitId: string; ok: boolean; reason?: string; failure?: UploadFailure };

/** Maps an upload error to a plain-words reason. `item.environment` is where the transcript is going. */
export function describeUploadFailure(e: unknown, env: QueueItem["environment"]): UploadFailure {
  const where = labelFor(env);
  const f = (kind: FailureKind, message: string): UploadFailure => ({ kind, message, environment: env });
  if (e instanceof SignedOutError) return f("signed_out", `Signed out: sign in again to ${where}.`);
  if (e instanceof ApiFailure) {
    if (e.status === 401) return f("signed_out", `Signed out: sign in again to ${where}.`);
    if (e.status === 403) return f("no_access", "This account does not have Notes edit access.");
    if (e.status === 404) return f("not_found", `That visit is not in ${where} (it may belong to another environment).`);
    if (e.status >= 500) return f("server", `The practice app had a problem (HTTP ${e.status}).`);
    return f("refused", `The practice app refused the transcript (HTTP ${e.status}${/^[a-z_]{1,40}$/.test(e.code ?? "") ? " " + e.code : ""}).`);
  }
  // Anything else from the send itself is the network: offline, DNS, timeout, blocked.
  return f("unreachable", "Cannot reach the practice app.");
}

/** Marks a reason as already mapped (so a local failure is not mistaken for a network one). */
class LocalReadFailure extends Error {}

/** A readable name for the optional transcript copy (initials, date, time), set when a visit is recorded. */
const labels = new Map<string, string>();
export const setCopyLabel = (visitId: string, label: string) => { labels.set(visitId, label); };

const inFlight = new Map<string, Promise<UploadResult>>();

/** A session for an environment, using the stored sign-in; null when not signed in there. */
export async function sessionFor(engine: Engine, env: QueueItem["environment"]): Promise<Session | null> {
  const token = await engine.accessToken(env);
  if (!token) return null;
  return { baseUrl: urlFor(env), accessToken: token, refresh: (stale) => engine.refreshAccessToken(env, stale) };
}

/** Uploads one queued transcript. On any failure the saved copy is kept. Never logs the text. */
export function uploadQueued(engine: Engine, item: QueueItem, session?: Session | null): Promise<UploadResult> {
  const running = inFlight.get(item.visit_id);
  if (running) return running;
  const p = (async (): Promise<UploadResult> => {
    try {
      if (item.status !== "uploaded") {
        const s = session ?? (await sessionFor(engine, item.environment));
        if (!s) {
          const failure = describeUploadFailure(new SignedOutError(), item.environment);
          return { visitId: item.visit_id, ok: false, reason: failure.message, failure };
        }
        let text: string;
        try { text = await engine.queueText(item.visit_id); } catch { throw new LocalReadFailure(); }
        await pushTranscript(s, item.visit_id, text);
      }
      let warning: string | undefined;
      try {
        // The queue copy is shredded next, so the optional plain-text copy is written first.
        await engine.saveTranscriptCopy(item.visit_id, labels.get(item.visit_id) ?? `visit_${item.created_at.slice(0, 16)}_${item.visit_id.slice(0, 8)}`);
      } catch (e) {
        warning = typeof e === "string" ? e : e instanceof Error ? e.message : "Could not save the transcript copy.";
      }
      await engine.queueComplete(item.visit_id);
      labels.delete(item.visit_id);
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

/** Retries everything in the queue, each against its own environment. */
export async function retryAll(engine: Engine): Promise<UploadResult[]> {
  const items = await engine.queueList();
  return Promise.all(items.map((i) => uploadQueued(engine, i)));
}
