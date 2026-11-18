// The servers this build can talk to. There is deliberately no free-text address.
// The released app is PRODUCTION ONLY (Sohail, 2026-11-18). Staging and localhost exist only in the separate
// "Practice Recorder (Staging TEST)" build, made with VITE_STAGING_TEST=1 and `--features staging-test`.

/** Every environment a saved transcript can have been recorded against (queues from older builds hold all three). */
export type EnvironmentId = "production" | "staging" | "localhost";

export const STAGING_TEST: boolean = import.meta.env.VITE_STAGING_TEST === "1";

type Env = { id: EnvironmentId; label: string; url: string };
const PRODUCTION: Env = { id: "production", label: "Production", url: "https://practice-mgmt-802176721153.us-east4.run.app" };
// The test addresses sit behind the build flag so the released bundle does not contain them at all.
const TEST_ENVIRONMENTS: Env[] = STAGING_TEST
  ? [
      { id: "staging", label: "Staging", url: "https://practice-mgmt-321509350517.us-east4.run.app" },
      { id: "localhost", label: "Localhost", url: "http://localhost:3000" },
    ]
  : [];

/** What this build may connect to. */
export const ENVIRONMENTS: Env[] = STAGING_TEST ? TEST_ENVIRONMENTS : [PRODUCTION];
export const DEFAULT_ENVIRONMENT: EnvironmentId = ENVIRONMENTS[0].id;

/** True when this build can connect to the environment. A queued transcript for any other one is never sent. */
export const isEnvironment = (id: string): id is EnvironmentId => ENVIRONMENTS.some((e) => e.id === id);
/** A name for any environment a saved transcript may carry, including ones this build cannot connect to. */
export const labelFor = (id: string): string => ({ production: "Production", staging: "Staging", localhost: "Localhost" } as Record<string, string>)[id] ?? "Production";
/** The address of an environment this build may use. Throws for any other, so a transcript recorded against the test
 *  environment can never be sent to Production by accident. */
export function urlFor(id: string): string {
  const e = ENVIRONMENTS.find((x) => x.id === id);
  if (!e) throw new Error("This version of the app does not connect to that environment.");
  return e.url;
}

/** Only https is allowed, except plain http to this Mac (localhost or 127.0.0.1). */
export function isSafeBaseUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.username || u.password) return false;
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
}

export function assertSafeBaseUrl(url: string): void {
  if (!isSafeBaseUrl(url)) throw new Error("The practice app address must use https (http is only allowed for localhost).");
}
