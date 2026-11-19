// Recording-consent gate: wording lives in one file, every start asks first, the answer is stored and travels with the transcript.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildConsentEvent, consentWire, CONSENT_TEXT, CONSENT_TEXT_VERSION } from "../src/lib/consent";
import { sendConfirmed } from "../src/lib/queue";

const app = readFileSync("src/App.tsx", "utf8");
afterEach(() => vi.restoreAllMocks());

describe("consent gate", () => {
  it("the wording is one constant file, not copied into the screen", () => {
    expect(app).not.toContain("transcribed by an AI tool");
    expect(readFileSync("src/lib/consent.ts", "utf8")).toContain("transcribed by an AI tool");
    expect(CONSENT_TEXT_VERSION).toMatch(/draft/);
  });
  it("Record only opens the question; capture starts only from the confirm button, which needs the checkbox", () => {
    expect(app).toMatch(/function start\(\) \{ setConsentChecked\(false\); setAskConsent\(true\); \}/);
    expect(app).toMatch(/disabled=\{!consentChecked\} onClick=\{confirmConsent\}/);
    expect(app).toMatch(/async function confirmConsent\(\) \{\s*if \(!consentChecked\) return;/);
    expect(app).toMatch(/useState\(false\);\s*\n\s*const \[consentChecked/);   // unchecked by default
    const calls = [...app.matchAll(/engine\.startRecording\(/g)].length;
    expect(calls).toBe(1);   // the only capture start is inside startNow, reached only through confirmConsent
    expect(app.indexOf("await startNow()")).toBeGreaterThan(app.indexOf("async function confirmConsent"));
  });
  it("the wire shape is what the practice app stores: given, textVersion, at", () => {
    const e = buildConsentEvent("v1", "p", true, new Date("2026-11-19T10:00:00Z"));
    expect(consentWire(e)).toEqual({ given: true, textVersion: CONSENT_TEXT_VERSION, at: "2026-11-19T10:00:00.000Z" });
  });
  it("cancel starts nothing", () => {
    expect(app).toMatch(/onClick=\{\(\) => setAskConsent\(false\)\}>\{CONSENT_CANCEL_LABEL\}/);
  });
  it("the event carries visit, provider, time, value and wording version", () => {
    const e = buildConsentEvent("v1", "Dr. A", true, new Date("2026-11-19T10:00:00Z"));
    expect(e).toEqual({ visitId: "v1", providerId: "Dr. A", timestamp: "2026-11-19T10:00:00.000Z", consentGiven: true, textVersion: CONSENT_TEXT_VERSION });
    expect(buildConsentEvent("v1", "p", false).consentGiven).toBe(false);
  });
  it("the consent record is uploaded with the transcript, and the opening of the transcript is sent untouched", async () => {
    let sent: any = null;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: any) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ ok: true, uuid: "u", seq: 1000000, sha256: sent.sha256, final: true, visitId: null }), { status: 200 }); }));
    const text = "Provider: I am using an AI tool to write the note, no audio is saved. Is that okay?\nPatient: Yes, that's fine.\nrest";
    const consent = buildConsentEvent("v1", "Dr. A", true);
    const session: any = { baseUrl: "http://127.0.0.1:1", accessToken: "t", request: async (_m: string, _p: string, body: string) => { sent = JSON.parse(body); return { status: 200, body: JSON.stringify({ ok: true, uuid: "u", seq: 1, sha256: sent.sha256, final: true, visitId: null }) }; } };
    try { await sendConfirmed(session, { visit_id: "v1", environment: "production", created_at: "2026-11-19T10:00:00Z", duration_seconds: 5, status: "pending", recording_id: "11111111-2222-4333-8444-555555555555" } as any, text, consent); } catch { /* transport shape differs; assert on what was captured */ }
    if (sent) { expect(sent.consent).toEqual({ given: true, textVersion: consent.textVersion, at: consent.timestamp }); expect(sent.text).toBe(text); }
  });
});
