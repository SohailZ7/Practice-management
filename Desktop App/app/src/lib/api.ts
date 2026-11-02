// The recorder's only connection to the practice: the web app's desktop API.
//
// It pulls the day's visits and pushes back a transcript. The audio never leaves this Mac, and the recorder keeps
// no patient record of its own: visits arrive as initials and are forgotten when the day changes.

export type Visit = {
  id: string;
  initials: string;
  program: string;
  appointmentType: string;
  providerName: string;
  hasTranscript: boolean;
  documentCount: number;
};

export type Session = { baseUrl: string; accessToken: string };

export type AuthConfig = { googleSignIn: boolean };

/**
 * Whether the practice app has Google sign-in set up. Asked before the button is offered, so a missing OAuth client
 * shows as an explanation rather than a button that does nothing.
 */
export async function fetchAuthConfig(baseUrl: string): Promise<AuthConfig> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/desktop/v1/auth/config`);
  if (!res.ok) throw new Error(`The practice app returned ${res.status}.`);
  return (await res.json()) as AuthConfig;
}

async function call<T>(session: Session, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${session.baseUrl.replace(/\/$/, "")}/api/desktop/v1${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${session.accessToken}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
  if (res.status === 401) throw new Error("Signed out. Sign in again in Setup.");
  if (res.status === 403) throw new Error("This account does not have access to Notes.");
  if (!res.ok) throw new Error(`The practice app returned ${res.status}.`);
  return (await res.json()) as T;
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
