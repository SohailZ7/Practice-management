import { useEffect, useRef, useState } from "react";
import type { Session } from "./lib/api";
import { canInstallNow, checkForUpdate, installUpdate, type UpdateInfo } from "./lib/updates";

const CHECK_EVERY = 30 * 60_000;
const COUNTDOWN = 10;
const SNOOZE = 4 * 60 * 60_000;

/**
 * Checks for a new version at start and every 30 minutes. When one is published it says so, and installs itself after
 * a short countdown, unless a recording or a send is in progress (then it waits). "Not now" hides it for four hours.
 */
export function UpdateBanner({ session, busy }: { session: Session | null; busy: boolean }) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const snoozedUntil = useRef(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const signedIn = !!session;

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    const run = async () => {
      const s = sessionRef.current;
      if (!s || installing) return;
      try {
        const u = await checkForUpdate(s);
        if (alive) { setInfo(u); setError(""); }
      } catch { /* quiet: the next check tries again; the error is in diagnostics */ }
    };
    const first = setTimeout(run, 5_000);
    const every = setInterval(run, CHECK_EVERY);
    return () => { alive = false; clearTimeout(first); clearInterval(every); };
  }, [signedIn, installing]);

  const waiting = !!info && Date.now() >= snoozedUntil.current && canInstallNow(busy);
  useEffect(() => {
    if (!info || !waiting || installing) { setLeft(null); return; }
    setLeft(COUNTDOWN);
    const t = setInterval(() => setLeft((n) => (n === null ? n : n - 1)), 1000);
    return () => clearInterval(t);
  }, [info?.version, waiting, installing]);

  const install = async () => {
    const s = sessionRef.current;
    if (!s || !canInstallNow(busy)) return;
    setInstalling(true); setError("");
    try { await installUpdate(s); } // the app relaunches itself when this succeeds
    catch (e) { setInstalling(false); setError(typeof e === "string" ? e : "The update could not be installed."); setInfo(null); }
  };

  useEffect(() => { if (left === 0) void install(); }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="banner err" role="status">Update failed: {error} <button className="link" onClick={() => setError("")}>Dismiss</button></div>;
  if (installing) return <div className="banner" role="status">Updating to v{info?.version}… the app will restart.</div>;
  if (!info || Date.now() < snoozedUntil.current) return null;
  if (!canInstallNow(busy)) {
    return <div className="banner" role="status">New version v{info.version} available. It will install when the current recording or send is finished.</div>;
  }
  return (
    <div className="banner" role="status">
      New version v{info.version} available.{left !== null ? ` Updating in ${left}s.` : ""}{" "}
      <button className="link" onClick={() => void install()}>Update now</button>{" "}
      <button className="link" onClick={() => { snoozedUntil.current = Date.now() + SNOOZE; setInfo((i) => (i ? { ...i } : i)); setLeft(null); }}>Not now</button>
    </div>
  );
}
