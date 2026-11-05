// The three servers the recorder can talk to. There is deliberately no free-text address.

export type EnvironmentId = "production" | "staging" | "localhost";

export const ENVIRONMENTS: { id: EnvironmentId; label: string; url: string }[] = [
  { id: "production", label: "Production", url: "https://practice-mgmt-802176721153.us-east4.run.app" },
  { id: "staging", label: "Staging", url: "https://practice-mgmt-321509350517.us-east4.run.app" },
  { id: "localhost", label: "Localhost", url: "http://localhost:3000" },
];

export const urlFor = (id: string): string => ENVIRONMENTS.find((e) => e.id === id)?.url ?? ENVIRONMENTS[0].url;
export const labelFor = (id: string): string => ENVIRONMENTS.find((e) => e.id === id)?.label ?? "Production";
export const isEnvironment = (id: string): id is EnvironmentId => ENVIRONMENTS.some((e) => e.id === id);

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
