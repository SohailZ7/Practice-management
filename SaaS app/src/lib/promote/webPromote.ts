// Copies one visit and its transcript from this (staging) page to production, from the browser. The browser holds a
// production sign-in of its own (Google, as the person pressing the button) and calls production's Desktop API, so no
// shared secret exists and no staging identity touches the production database. Same rules as the Desktop app's Promote:
// add-only (a production transcript is never replaced), safe to press again (the same visit is found, not duplicated),
// and nothing here is logged. The fetch is injected so the logic is unit-tested without a network.

export type ProdVisit = { id: string; initials: string; fullName?: string; apptTime: string; program: string; hasTranscript: boolean };
export type PromoteSource = {
  date: string; fullName: string; apptTime: string; program: string; appointmentType: string; providerName: string; transcript: string;
};
export type PromoteDeps = {
  listProduction: (date: string) => Promise<ProdVisit[]>;
  createProduction: (date: string, v: { patient: string; apptTime?: string; program?: string; appointmentType?: string; providerName?: string }) => Promise<{ id: string }>;
  pushProduction: (visitId: string, transcript: string) => Promise<unknown>;
};
export type PromoteResult = { ok: true; already: boolean } | { ok: false; message: string };

const clock = (t?: string) => (t ?? "").replace(/\s+/g, "").toLowerCase();
/** "First Last" -> "FL", matching how both servers show initials is not needed: names are compared as typed. */
const norm = (s?: string) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** The same visit in production: same day (the list is for one day), patient name, time and program. */
export function sameVisit(src: PromoteSource, p: ProdVisit): boolean {
  return norm(p.fullName) !== "" && norm(p.fullName) === norm(src.fullName) && clock(p.apptTime) === clock(src.apptTime) && (p.program ?? "") === (src.program ?? "");
}

export async function promoteToProduction(src: PromoteSource, d: PromoteDeps): Promise<PromoteResult> {
  const text = src.transcript.trim();
  if (!text) return { ok: false, message: "The transcript on staging is empty. Nothing was changed." };
  let existing: ProdVisit | undefined;
  try {
    const day = await d.listProduction(src.date);
    // Without names the same visit cannot be recognised, and pressing twice would add it twice. Stop instead.
    if (day.some((p) => !p.fullName)) return { ok: false, message: "Full names are off for your account on production, so a duplicate cannot be ruled out. Nothing was changed." };
    existing = day.find((p) => sameVisit(src, p));
  }
  catch (e) { return { ok: false, message: `Could not reach production. Nothing was changed. ${e instanceof Error ? e.message : ""}`.trim() }; }
  if (existing?.hasTranscript) return { ok: true, already: true };

  let id = existing?.id;
  if (!id) {
    try {
      id = (await d.createProduction(src.date, {
        patient: src.fullName, apptTime: src.apptTime || undefined, program: src.program || undefined,
        appointmentType: src.appointmentType || undefined, providerName: src.providerName || undefined,
      })).id;
    } catch (e) {
      return { ok: false, message: `Production did not accept the visit, so nothing was moved. ${e instanceof Error ? e.message : ""}`.trim() };
    }
  }
  try { await d.pushProduction(id, text); }
  catch (e) { return { ok: false, message: `The visit is in production but its transcript did not upload. Press Promote again to finish. ${e instanceof Error ? e.message : ""}`.trim() }; }
  return { ok: true, already: false };
}

/** Production's Desktop API over fetch with a bearer token. Errors carry the server's short code only, never a body with data. */
export function prodDeps(prodUrl: string, accessToken: string, f: typeof fetch = fetch): PromoteDeps {
  const call = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const res = await f(`${prodUrl}/api/desktop/v1${path}`, {
      ...init, headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, cache: "no-store",
    });
    if (!res.ok) {
      let code = "";
      try { code = String(((await res.json()) as { error?: unknown }).error ?? ""); } catch { /* no body */ }
      throw new Error(code ? `(${res.status} ${code})` : `(${res.status})`);
    }
    return (await res.json()) as T;
  };
  return {
    listProduction: async (date) => (await call<{ visits: ProdVisit[] }>(`/notes/visits?date=${encodeURIComponent(date)}`)).visits,
    createProduction: (date, v) => call(`/notes/visits`, { method: "POST", body: JSON.stringify({ date, ...v }) }),
    pushProduction: (id, transcript) => call(`/notes/visits/${encodeURIComponent(id)}/transcript`, { method: "POST", body: JSON.stringify({ transcript }) }),
  };
}

export type Preflight = { ok: true } | { ok: false; message: string };

/**
 * Read-only check the button makes before offering sign-in: is production set up for this page? A 404/405 means an older
 * production without the check, so the flow continues (the sign-in itself still reports a refusal clearly).
 */
export async function preflightProduction(prodUrl: string, clientId: string, f: typeof fetch = fetch): Promise<Preflight> {
  let res: Response;
  try { res = await f(`${prodUrl}/api/desktop/v1/auth/google-web`, { method: "GET", cache: "no-store" }); }
  catch { return { ok: false, message: "Could not reach production, or production does not allow Promote from this address yet. Check your connection and try again. Nothing was changed." }; }
  if (res.status === 404 || res.status === 405) return { ok: true };
  if (res.status === 503) return { ok: false, message: "Production is not set up for Promote yet (its Google sign-in setting is missing). Nothing was changed." };
  if (res.status === 403) return { ok: false, message: "Production does not allow Promote from this address. Ask for this staging address to be added on production. Nothing was changed." };
  if (!res.ok) return { ok: false, message: `Production answered with an error (${res.status}). Try again in a minute. Nothing was changed.` };
  try {
    const body = (await res.json()) as { clientId?: unknown };
    if (typeof body.clientId === "string" && body.clientId !== clientId) return { ok: false, message: "Production and staging use different Google sign-in settings. Nothing was changed." };
  } catch { /* an answer without a body is still a ready server */ }
  return { ok: true };
}
