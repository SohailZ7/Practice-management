// Uploading the transcripts saved on this Mac. A queued transcript is uploaded to the environment recorded when it
// was saved (not the one currently selected) and is deleted only after the server confirms.
import { pushTranscript, SignedOutError, type Session } from "./api";
import { urlFor } from "./environments";
import type { Engine, QueueItem } from "./engine";

export type UploadResult = { visitId: string; ok: boolean; reason?: string };

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
        if (!s) return { visitId: item.visit_id, ok: false, reason: "Not signed in to that environment." };
        await pushTranscript(s, item.visit_id, await engine.queueText(item.visit_id));
      }
      await engine.queueComplete(item.visit_id);
      return { visitId: item.visit_id, ok: true };
    } catch (e) {
      const reason = e instanceof SignedOutError ? "Signed out." : e instanceof Error ? e.message : "Upload failed.";
      return { visitId: item.visit_id, ok: false, reason };
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
