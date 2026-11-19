"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { CONFIRM_EVENT, type ConfirmRequest } from "@/lib/confirm";

/** Shows the in-page confirmation / small form asked for by askConfirm() and askFields(). Mounted once in AppShell. */
export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault(); // tells ask() that a host is listening
      const r = (e as CustomEvent<ConfirmRequest>).detail;
      setVals(Object.fromEntries(r.fields.map((f) => [f.name, f.value ?? ""])));
      setReq(r);
    };
    window.addEventListener(CONFIRM_EVENT, on);
    return () => window.removeEventListener(CONFIRM_EVENT, on);
  }, []);

  useEffect(() => { if (req && req.fields.length === 0) okRef.current?.focus(); }, [req]);

  if (!req) return null;
  const done = (ok: boolean) => { req.resolve(ok ? vals : null); setReq(null); };
  return (
    <Modal
      title="Please confirm"
      size="sm"
      role="alertdialog"
      onClose={() => done(false)}
      footer={
        <>
          <button type="button" className="secondary" onClick={() => done(false)}>{req.cancelLabel}</button>
          <button type="button" ref={okRef} className={req.danger ? "danger" : ""} onClick={() => done(true)}>{req.confirmLabel}</button>
        </>
      }
    >
      <p style={{ margin: "0 0 .6rem" }}>{req.message}</p>
      {req.fields.map((f, i) => (
        <label key={f.name} className="stack" style={{ display: "grid", gap: ".25rem", marginBottom: ".5rem" }}>
          <span className="small muted">{f.label}</span>
          <input autoFocus={i === 0} value={vals[f.name] ?? ""} placeholder={f.placeholder} onChange={(e) => setVals((v) => ({ ...v, [f.name]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") done(true); }} />
        </label>
      ))}
    </Modal>
  );
}
