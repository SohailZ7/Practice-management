// Two-factor sign-in helpers: input cleanup and friendly messages. Secrets and codes are never stored or logged.
import type { Engine, EnvironmentId, MfaStep } from "./engine";

/** Keeps only digits (so pasting "123 456" or "123-456" works) and caps at 6. */
export const cleanCode = (s: string): string => s.replace(/\D/g, "").slice(0, 6);
export const isSixDigits = (s: string): boolean => /^\d{6}$/.test(s);

export type MfaResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; kind: "expired" | "restart" | "error"; message: string };

/** When the lockout ends, in words, from whatever hint the server gave (seconds or a timestamp). */
export function retryWording(data: Record<string, unknown>, now = Date.now()): string {
  let secs: number | null = null;
  const n = (k: string) => (typeof data[k] === "number" ? (data[k] as number) : null);
  secs = n("retryAfterSeconds") ?? n("retryAfter");
  const at = data.retryAt ?? data.lockedUntil;
  if (secs === null && typeof at === "string" && !Number.isNaN(Date.parse(at))) secs = Math.max(0, Math.ceil((Date.parse(at) - now) / 1000));
  if (secs === null) return "Try again in a few minutes.";
  if (secs <= 60) return "Try again in a minute.";
  return `Try again in about ${Math.ceil(secs / 60)} minutes.`;
}

/** Turns a reply into a result with plain wording. */
export function interpret(status: number, text: string, usingRecovery = false): MfaResult {
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(text) as Record<string, unknown>; } catch { /* leave empty */ }
  if (status === 200 || status === 201) return { ok: true, data };
  const code = String(data.error ?? data.code ?? "");
  if (status === 401 || code === "invalid_or_expired_mfa_token") {
    return { ok: false, kind: "expired", message: "That sign-in step timed out. Sign in with Google again." };
  }
  if (status === 429 || code === "too_many_attempts") {
    return { ok: false, kind: "error", message: `Too many wrong codes. ${retryWording(data)}` };
  }
  if (code === "already_enrolled") return { ok: false, kind: "restart", message: "Two-factor is already set up for this account. Sign in again to enter a code." };
  if (code === "not_enrolled") return { ok: false, kind: "restart", message: "Two-factor is not set up for this account yet. Sign in again to set it up." };
  if (code === "bad_code" || status === 400) {
    return { ok: false, kind: "error", message: usingRecovery ? "That recovery code is not right, or it was already used." : "That code is not right. Check the 6 digits and that your phone's clock is correct, then try again." };
  }
  return { ok: false, kind: "error", message: "The practice app could not complete that step. Try again." };
}

/** Runs one step against the server through the Rust side. */
export async function mfaCall(engine: Engine, env: EnvironmentId, step: MfaStep, body: object, usingRecovery = false): Promise<MfaResult> {
  try {
    const r = await engine.mfaStep(env, step, body);
    return interpret(r.status, r.body, usingRecovery);
  } catch (e) {
    return { ok: false, kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
