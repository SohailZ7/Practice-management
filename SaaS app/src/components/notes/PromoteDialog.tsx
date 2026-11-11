"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "../Modal";
import { getPromoteSource, recordPromote } from "@/app/notes/actions";
import { preflightProduction, prodDeps, promoteToProduction } from "@/lib/promote/webPromote";

type Gis = { accounts: { id: { initialize: (o: { client_id: string; callback: (r: { credential?: string }) => void }) => void; renderButton: (el: HTMLElement, o: Record<string, unknown>) => void } } };
declare global { interface Window { google?: Gis } }

function loadGoogle(): Promise<void> {
  if (window.google) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Google sign-in did not load."));
    document.head.appendChild(s);
  });
}

type State = { kind: "checking" } | { kind: "blocked"; text: string } | { kind: "ready" } | { kind: "working"; text: string } | { kind: "done"; already: boolean } | { kind: "error"; text: string };

/**
 * Staging only, admin only, one visit at a time. The page signs in to production itself (Google, as the person pressing
 * the button) and calls production's own API, so staging holds no production key. Nothing is stored: the production
 * token lives in this dialog's memory and is gone when it closes. Press again after an error: it never duplicates.
 */
export function PromoteDialog({ visitId, who, prodUrl, clientId, onClose }: { visitId: string; who: string; prodUrl: string; clientId: string; onClose: () => void }) {
  const [state, setState] = useState<State>({ kind: "checking" });

  useEffect(() => {
    let dead = false;
    void preflightProduction(prodUrl, clientId).then((p) => { if (!dead) setState(p.ok ? { kind: "ready" } : { kind: "blocked", text: p.message }); });
    return () => { dead = true; };
  }, [prodUrl, clientId]);
  const btn = useRef<HTMLDivElement>(null);

  async function run(credential: string) {
    const fail = async (text: string) => { setState({ kind: "error", text }); await recordPromote(visitId, "failed").catch(() => {}); };
    try {
      setState({ kind: "working", text: "Signing in to production…" });
      const res = await fetch(`${prodUrl}/api/desktop/v1/auth/google-web`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential }), cache: "no-store",
      });
      if (!res.ok) return fail(res.status === 403 ? "Production does not know this Google account." : `Production sign-in failed (${res.status}).`);
      const { accessToken } = (await res.json()) as { accessToken: string };
      setState({ kind: "working", text: "Copying the visit and transcript…" });
      const src = await getPromoteSource(visitId);
      if (!src.ok) return fail(src.error);
      const r = await promoteToProduction(src.source, prodDeps(prodUrl, accessToken));
      if (!r.ok) return fail(r.message);
      await recordPromote(visitId, r.already ? "already" : "promoted").catch(() => {});
      setState({ kind: "done", already: r.already });
    } catch (e) {
      await fail(e instanceof Error && e.message ? "Could not reach production. Nothing was changed." : "Something went wrong. Nothing was changed.");
    }
  }

  useEffect(() => {
    if (state.kind !== "ready" && state.kind !== "error") return;
    let dead = false;
    loadGoogle().then(() => {
      if (dead || !btn.current || !window.google) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => { if (r.credential) void run(r.credential); } });
      btn.current.innerHTML = "";
      window.google.accounts.id.renderButton(btn.current, { theme: "outline", size: "large", text: "signin_with", width: 260 });
    }).catch(() => { if (!dead) setState({ kind: "error", text: "Google sign-in did not load." }); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind]);

  const busy = state.kind === "working";
  return (
    <Modal title="Promote to production" size="sm" onClose={onClose} busy={busy} footer={<button className="secondary" disabled={busy} onClick={onClose}>{state.kind === "done" ? "Close" : "Cancel"}</button>}
      notices={state.kind === "error" || state.kind === "blocked" ? <p className="error" role="alert">{state.text}</p> : undefined}>
      {state.kind === "done" ? (
        <p>{state.already ? "This visit is already in production with its transcript. Nothing was changed." : "Done. The visit and its transcript are now in production."}</p>
      ) : (
        <>
          <p>Copy the visit for <strong>{who}</strong> and its transcript to production. Nothing in production is replaced, and pressing it twice does not add it twice.</p>
          <p className="small muted">Sign in with the Google account you use on production. The sign-in is used once for this copy and is not kept.</p>
          {state.kind === "checking" ? <p role="status" className="muted">Checking production…</p> : state.kind === "blocked" ? null : busy ? <p role="status">{state.text}</p> : <div ref={btn} style={{ minHeight: 44 }} />}
        </>
      )}
    </Modal>
  );
}
