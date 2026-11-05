// The recorder's only connection to the practice: the web app's desktop API.
//
// It pulls the day's visits and pushes back a transcript. The audio never leaves this Mac, and the recorder keeps
// no patient record of its own: visits arrive as initials and are forgotten when the day changes.
import { assertSafeBaseUrl } from "./environments";

export type Visit = {
  id: string;
  initials: string;
  program: string;
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
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/desktop/v1/auth/config`);
  if (!res.ok) throw new Error(`The practice app returned ${res.status}.`);
  const c = (await res.json()) as AuthConfig;
  return { googleSignIn: c.googleSignIn === true };
}

async function send(session: Session, path: string, init: RequestInit): Promise<Response> {
  return fetch(`${session.baseUrl.replace(/\/$/, "")}/api/desktop/v1${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${session.accessToken}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
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
