"use client";

import { signOut } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { idleState } from "@/lib/idleClock";

const TOUCH_URL = "/api/session/touch";
/** At most one keep-alive request a minute, and only because a person did something. There is no timer-driven ping. */
const PING_EVERY_MS = 60_000;
const EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel", "pointerdown"] as const;

type Props = { idleMs: number; absoluteDeadline: number; serverNow: number };

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Warns two minutes before automatic logoff and signs out at the deadline. This is a courtesy: the server
 * rejects idle and over-age sessions on its own (middleware and getCurrentUser), whatever this component does.
 */
export function IdleLogoff({ idleMs, absoluteDeadline, serverNow }: Props) {
  const last = useRef(0);
  const lastPing = useRef(0);
  const skew = useRef(0);
  const warning = useRef<"idle" | "absolute" | null>(null);
  const dismissedAbsolute = useRef(false);
  const leaving = useRef(false);
  const [view, setView] = useState<{ reason: "idle" | "absolute"; msLeft: number } | null>(null);

  const leave = useCallback(async () => {
    if (leaving.current) return;
    leaving.current = true;
    try {
      await signOut({ callbackUrl: "/login?expired=1" });
    } catch {
      window.location.assign("/login?expired=1");
    }
  }, []);

  const ping = useCallback(async (): Promise<boolean> => {
    lastPing.current = Date.now();
    try {
      const res = await fetch(TOUCH_URL, { method: "POST", cache: "no-store", credentials: "same-origin", redirect: "manual" });
      return res.ok;
    } catch {
      return true; // offline: not a reason to log out; the server decides on the next request
    }
  }, []);

  useEffect(() => {
    const t = Date.now();
    last.current = t;
    lastPing.current = t;
    skew.current = serverNow - t;

    const onActivity = () => {
      if (warning.current === "idle") return; // only the button dismisses the idle warning
      const now = Date.now();
      last.current = now;
      if (now - lastPing.current >= PING_EVERY_MS) void ping().then((ok) => { if (!ok) void leave(); });
    };
    EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true, capture: true }));

    // Server requests (links, server actions) also refresh the server clock, so they reset the local one too.
    const realFetch = window.fetch;
    window.fetch = function patched(input: RequestInfo | URL, init?: RequestInit) {
      try {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (!url.includes(TOUCH_URL) && !headers.has("next-router-prefetch") && warning.current !== "idle") {
          last.current = Date.now();
          lastPing.current = last.current;
        }
      } catch {
        // never let bookkeeping break a request
      }
      return realFetch.call(window, input, init);
    } as typeof window.fetch;

    const tick = () => {
      const now = Date.now();
      const s = idleState({ now, lastActivity: last.current, idleMs, absoluteDeadline: absoluteDeadline - skew.current });
      if (s.kind === "expired") {
        void leave();
      } else if (s.kind === "warn" && !(s.reason === "absolute" && dismissedAbsolute.current)) {
        warning.current = s.reason;
        setView({ reason: s.reason, msLeft: s.msLeft });
      } else if (warning.current !== null) {
        warning.current = null;
        setView(null);
      }
    };
    const id = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }));
      window.fetch = realFetch;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [idleMs, absoluteDeadline, serverNow, ping, leave]);

  const stay = async () => {
    const ok = await ping();
    if (!ok) return void leave();
    last.current = Date.now();
    warning.current = null;
    setView(null);
  };

  if (!view) return null;
  return (
    <div className="notes-overlay" role="presentation">
      <div className="notes-dialog idle-dialog" role="alertdialog" aria-modal="true" aria-labelledby="idle-title" aria-describedby="idle-desc">
        <div className="notes-title" id="idle-title">
          {view.reason === "idle" ? "Still there?" : "Your session is ending"}
        </div>
        <p id="idle-desc" style={{ margin: 0 }}>
          {view.reason === "idle"
            ? "For privacy you are signed out after a period of inactivity."
            : "For security, sessions end after a maximum length. Save your work, then sign in again."}{" "}
          You will be signed out in <strong>{fmt(view.msLeft)}</strong>.
        </p>
        <div className="notes-footer">
          <button type="button" className="secondary" onClick={() => void leave()}>
            Sign out now
          </button>
          {view.reason === "idle" ? (
            <button type="button" className="notes-done" onClick={() => void stay()} autoFocus>
              Stay signed in
            </button>
          ) : (
            <button
              type="button"
              className="notes-done"
              onClick={() => {
                dismissedAbsolute.current = true;
                warning.current = null;
                setView(null);
              }}
              autoFocus
            >
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
