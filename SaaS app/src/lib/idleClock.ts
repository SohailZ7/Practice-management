// Pure state machine for the in-browser idle warning. The server still enforces the real limits.

import { WARNING_MS } from "./sessionExpiry";

export type IdleState =
  | { kind: "active" }
  | { kind: "warn"; reason: "idle" | "absolute"; msLeft: number }
  | { kind: "expired"; reason: "idle" | "absolute" };

export function idleState(args: {
  now: number;
  lastActivity: number;
  idleMs: number;
  absoluteDeadline: number;
  warnMs?: number;
}): IdleState {
  const warnMs = args.warnMs ?? WARNING_MS;
  const idleLeft = args.lastActivity + args.idleMs - args.now;
  const absLeft = args.absoluteDeadline - args.now;
  if (absLeft <= 0) return { kind: "expired", reason: "absolute" };
  if (idleLeft <= 0) return { kind: "expired", reason: "idle" };
  if (idleLeft <= warnMs && idleLeft <= absLeft) return { kind: "warn", reason: "idle", msLeft: idleLeft };
  if (absLeft <= warnMs) return { kind: "warn", reason: "absolute", msLeft: absLeft };
  return { kind: "active" };
}
