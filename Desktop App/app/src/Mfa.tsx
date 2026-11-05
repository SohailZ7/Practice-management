import { useEffect, useMemo, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import type { Engine } from "./lib/engine";
import type { EnvironmentId } from "./lib/environments";
import { cleanCode, isSixDigits, mfaCall } from "./lib/mfa";

/** The QR code is drawn here from the otpauth address; nothing is sent to any outside service. */
function Qr({ text }: { text: string }) {
  const svg = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
  }, [text]);
  return <div role="img" aria-label="QR code for your authenticator app" style={{ width: 200, height: 200, background: "#fff" }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * The two-factor steps after Google sign-in. The step token, secret and codes live only in this component's memory.
 * `onDone` means signed in; `onRestart` means start the Google sign-in again (with a message).
 */
export function Mfa({ engine, env, mode, token, onDone, onRestart }: {
  engine: Engine; env: EnvironmentId; mode: "enroll" | "verify"; token: string;
  onDone: () => void; onRestart: (message: string) => void;
}) {
  const [secret, setSecret] = useState("");
  const [uri, setUri] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const finished = useRef(false);

  // Forget the held sign-in if this screen goes away without finishing.
  useEffect(() => () => { if (!finished.current) void engine.mfaCancel(); }, []);

  useEffect(() => {
    if (mode !== "enroll") return;
    let alive = true;
    (async () => {
      const r = await mfaCall(engine, env, "enroll_start", { mfaToken: token });
      if (!alive) return;
      if (!r.ok) { if (r.kind === "error") setError(r.message); else onRestart(r.message); return; }
      setSecret(String(r.data.secret ?? "")); setUri(String(r.data.otpauthUri ?? ""));
    })();
    return () => { alive = false; setSecret(""); setUri(""); };
  }, [mode]);

  async function submit() {
    setBusy(true); setError("");
    const step = mode === "enroll" ? "enroll_confirm" : "verify";
    const body = mode === "verify" && useRecovery ? { mfaToken: token, recoveryCode: recovery.trim() } : { mfaToken: token, code };
    const r = await mfaCall(engine, env, step, body, useRecovery);
    setBusy(false);
    if (!r.ok) {
      if (r.kind === "error") { setError(r.message); setCode(""); return; }
      void engine.mfaCancel(); onRestart(r.message); return;
    }
    setCode(""); setRecovery(""); setSecret(""); setUri("");
    if (mode === "enroll") {
      const list = Array.isArray(r.data.recoveryCodes) ? (r.data.recoveryCodes as unknown[]).map(String) : [];
      setCodes(list);
    } else {
      finished.current = true; onDone();
    }
  }

  async function saved() {
    setBusy(true);
    try { await engine.mfaFinish(env); finished.current = true; setCodes(null); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  if (codes) {
    return (
      <div>
        <h3>Save your recovery codes</h3>
        <p className="small">Each code works once if you lose your phone. They are shown only now. Keep them somewhere safe and private, not in this app.</p>
        <pre style={{ fontSize: "1.05rem", lineHeight: 1.6 }}>{codes.join("\n")}</pre>
        {error && <p className="small err">{error}</p>}
        <div className="row">
          <button className="secondary" onClick={async () => {
            try { await navigator.clipboard.writeText(codes.join("\n")); setCopied(true); } catch { setCopied(false); }
          }}>{copied ? "Copied" : "Copy"}</button>
          <button disabled={busy} onClick={() => void saved()}>I saved them</button>
        </div>
      </div>
    );
  }

  const ready = mode === "verify" && useRecovery ? recovery.trim().length >= 6 : isSixDigits(code);
  return (
    <div>
      <h3>{mode === "enroll" ? "Set up two-factor sign-in" : "Enter your code"}</h3>
      {mode === "enroll" && (
        <>
          <p className="small">1. Open Microsoft Authenticator or Google Authenticator and add an account by scanning this code.</p>
          {uri ? <Qr text={uri} /> : !error && <p className="small">Preparing…</p>}
          {secret && <p className="small">Cannot scan? Enter this key by hand: <code style={{ userSelect: "all" }}>{secret}</code></p>}
          <p className="small">2. Type the 6-digit code the app shows.</p>
        </>
      )}
      {mode === "verify" && !useRecovery && <p className="small">Open your authenticator app and type the 6-digit code for this practice app.</p>}
      {mode === "verify" && useRecovery && <p className="small">Type one of your saved recovery codes. Each works once.</p>}
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (ready && !busy) void submit(); }}>
        {mode === "verify" && useRecovery ? (
          <input value={recovery} onChange={(e) => setRecovery(e.target.value)} aria-label="Recovery code" autoComplete="off" autoFocus />
        ) : (
          <input value={code} onChange={(e) => setCode(cleanCode(e.target.value))} onPaste={(e) => { e.preventDefault(); setCode(cleanCode(e.clipboardData.getData("text"))); }}
            inputMode="numeric" placeholder="123456" aria-label="6-digit code" autoComplete="one-time-code" autoFocus style={{ letterSpacing: ".25em", width: "9em" }} />
        )}
        <button disabled={!ready || busy || (mode === "enroll" && !secret)}>{busy ? "Checking…" : mode === "enroll" ? "Confirm" : "Sign in"}</button>
        <button type="button" className="secondary" onClick={() => { void engine.mfaCancel(); onRestart(""); }}>Cancel</button>
      </form>
      {error && <p className="small err">{error}</p>}
      {mode === "verify" && (
        <p className="small"><a href="#" onClick={(e) => { e.preventDefault(); setError(""); setCode(""); setRecovery(""); setUseRecovery(!useRecovery); }}>
          {useRecovery ? "Use my authenticator code instead" : "Use a recovery code"}</a></p>
      )}
    </div>
  );
}
