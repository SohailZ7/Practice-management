// A throwaway fake of the practice app's /api/desktop/v1 routes, for looking at the recorder's screens in a browser
// (`node tests/qa/mock-server.mjs`, then open http://localhost:1420/?qa=1 with `npm run dev`). Fake data only.
import http from "node:http";

let n = 100;
const visits = [
  { id: "v1", initials: "A.B.", program: "IOP", apptTime: "9:00-10:00", appointmentType: "Initial Evaluation", providerName: "Dr. Test", hasTranscript: true, documentCount: 2, status: "seen" },
  { id: "v2", initials: "C.D.", program: "PHP", apptTime: "10:00", appointmentType: "Follow Up", providerName: "Dr. Test", hasTranscript: false, documentCount: 0 },
  { id: "v3", initials: "E.F.", program: "IOP", apptTime: "", appointmentType: "Follow Up", providerName: "Dr. Test", hasTranscript: true, documentCount: 0 },
];
const transcripts = { v1: "Provider: How have you been? Other party: Better, sleeping seven hours.\n\n--- Added 3:42 PM ---\n\nFake follow-up text.".repeat(6), v3: "Short fake transcript." };
const docs = { v1: [{ id: "d1", docType: "progress_note", title: "Progress note", latestVersion: 2 }, { id: "d2", docType: "legacy_note", title: "Note (earlier format)", latestVersion: 1 }] };
const tasks = [{ id: "t1", title: "Call the biller", dueDate: "2026-11-09", status: "open", createdAt: "2026-11-01T10:00:00Z" }, { id: "t2", title: "Sign orders", dueDate: null, status: "done", createdAt: "2026-11-01T10:00:00Z" }];
const feedback = [{ id: "f1", kind: "BUG", title: "Time column is narrow", description: "Fake bug text.", authorName: "Test User", createdAt: "2026-11-02T10:00:00Z", updatedAt: "2026-11-02T10:00:00Z", mine: true, promotedAt: null }];
import { readFileSync } from "node:fs";
const fields = JSON.parse(readFileSync(new URL("./progress-fields.json", import.meta.url), "utf8"));
const _oldFields = [
  { name: "summary", label: "Summary", type: "longtext" }, { name: "dx", label: "Diagnosis", type: "text" },
  { name: "seen", label: "Patient seen", type: "checkbox" }, { name: "level", label: "Level of care", type: "select", options: ["IOP", "PHP"] }, { name: "when", label: "Date", type: "date" },
];
let latest = 2;
let curValues = { ChiefComplaint: "Fake chief complaint.", IH_Sleep: "Poor", IH_ADL_Fair: true, PS_Complaint_Other: true, PS_Complaint_OtherText: "knee pain", MSE_SI_None: true };
const versionList = () => Array.from({ length: latest }, (_, i) => ({ version: i + 1, source: i === 0 ? "model" : "edit", createdAt: `2026-11-04T1${i}:00:00Z`, authorName: i === 0 ? undefined : "Test User" }));

const send = (res, status, body) => { res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }); res.end(JSON.stringify(body)); };
http.createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  let raw = ""; req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const u = new URL(req.url, "http://x"); const p = u.pathname.replace("/api/desktop/v1", ""); const m = req.method;
    let b = {}; try { b = raw ? JSON.parse(raw) : {}; } catch {}
    let r;
    if (p === "/auth/config") return send(res, 200, { googleSignIn: true });
    if (p === "/notes/options") return send(res, 200, { programs: ["IOP", "PHP"], appointmentTypes: ["Initial Evaluation", "Follow Up"], providers: ["Dr. Test"] });
    if (p === "/notes/visits/search") { const i = (u.searchParams.get("initials") || "").replace(/[^A-Za-z]/g, "").toUpperCase(); return send(res, 200, { visits: visits.filter((v) => !i || v.initials.replace(/[^A-Z]/g, "").startsWith(i)).map((v) => ({ id: v.id, date: "2026-11-05", time: v.apptTime, program: v.program, type: v.appointmentType, provider: v.providerName, initials: v.initials, hasTranscript: v.hasTranscript, hasDocuments: v.documentCount > 0 })) }); }
    if (p === "/notes/visits" && m === "GET") return send(res, 200, { date: u.searchParams.get("date"), visits });
    if (p === "/notes/visits" && m === "POST") { if (b.providerName === "Unlisted") return send(res, 400, { error: "bad_provider" }); if (b.patient === "Odd Error") return send(res, 400, { error: "bad_request" }); const v = { id: `v${++n}`, initials: b.patient.split(" ").map((w) => w[0]).join(".") + ".", program: b.program || "IOP", apptTime: b.apptTime || "", appointmentType: b.appointmentType || "Follow Up", providerName: b.providerName || "Dr. Test", hasTranscript: false, documentCount: 0 }; visits.push(v); return send(res, 201, v); }
    if (p === "/notes/schedule") { visits.push({ id: `v${++n}`, initials: "G.H.", program: "IOP", apptTime: "11:00", appointmentType: "Follow Up", providerName: "Dr. Test", hasTranscript: false, documentCount: 0 }); return send(res, 200, { created: 1, skippedExisting: 0, kept: 0, skippedNoClient: 0, skippedOtherProvider: 0, otherProviders: [] }); }
    if (p === "/notes/visits/bulk-delete") { for (const id of b.ids) { const i = visits.findIndex((v) => v.id === id); if (i >= 0) visits.splice(i, 1); } return send(res, 200, { deleted: b.ids, notFound: [] }); }
    let mm;
    if ((mm = p.match(/^\/notes\/visits\/([^/]+)$/))) { const i = visits.findIndex((v) => v.id === mm[1]); if (i < 0) return send(res, 404, { error: "not_found" }); if (m === "PATCH") Object.assign(visits[i], b); if (m === "DELETE") visits.splice(i, 1); return send(res, 200, { ok: true }); }
    if ((mm = p.match(/^\/notes\/visits\/([^/]+)\/transcript$/))) { if (m === "POST") { transcripts[mm[1]] = b.transcript; const v = visits.find((x) => x.id === mm[1]); if (v) v.hasTranscript = true; return send(res, 200, { ok: true }); } return send(res, 200, { transcript: transcripts[mm[1]] ?? "", updatedAt: "2026-11-05T10:00:00Z" }); }
    if (p === "/notes/doc-types") return send(res, 200, { docTypes: [{ id: "progress_note", label: "Progress note", default: true }, { id: "psych_eval", label: "Psychiatric evaluation", default: false }, { id: "admit_order", label: "Admit order", default: false }, { id: "discharge_order", label: "Discharge order", default: false }] });
    if ((mm = p.match(/^\/notes\/visits\/([^/]+)\/documents$/))) return send(res, 200, { documents: docs[mm[1]] ?? [] });
    if ((mm = p.match(/^\/notes\/visits\/([^/]+)\/documents\/([^/]+)\/pdf$/))) { res.writeHead(200, { "content-type": "application/pdf", "access-control-allow-origin": "*" }); return res.end("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"); }
    if ((mm = p.match(/^\/notes\/visits\/([^/]+)\/documents\/([^/]+)\/versions$/))) { if (b.baseVersion !== undefined && b.baseVersion !== latest) return send(res, 409, { error: "stale_version" }); latest += 1; curValues = b.values ?? curValues; return send(res, 201, { version: latest, createdAt: new Date().toISOString() }); }
    if ((mm = p.match(/^\/notes\/visits\/([^/]+)\/documents\/([^/]+)$/))) { const v = Number(u.searchParams.get("version") || latest); return send(res, 200, { id: mm[2], docType: "progress_note", title: "Progress note", fields, versions: versionList(), current: { version: v, values: v === latest ? curValues : { ...curValues, dx: "older" } } }); }
    if ((mm = p.match(/^\/notes\/visits\/([^/]+)\/generate$/))) { const v = visits.find((x) => x.id === mm[1]); setTimeout(() => { docs[mm[1]] = [{ id: "d9", docType: "progress_note", title: "Progress note", latestVersion: 1 }]; v.documentCount = 1; send(res, 200, { documents: docs[mm[1]], errors: [] }); }, 1500); return; }
    if (p === "/tasks" && m === "GET") { const s = u.searchParams.get("status"); return send(res, 200, { tasks: tasks.filter((t) => s === "all" || t.status === s) }); }
    if (p === "/tasks" && m === "POST") { if (!String(b.title || "").trim()) return send(res, 400, { error: "bad_title" }); const t = { id: `t${++n}`, title: b.title, dueDate: b.dueDate ?? null, status: "open", createdAt: new Date().toISOString() }; tasks.push(t); return send(res, 201, { task: t }); }
    if ((mm = p.match(/^\/tasks\/([^/]+)$/))) { const t = tasks.find((x) => x.id === mm[1]); if (!t) return send(res, 404, { error: "not_found" }); Object.assign(t, b); return send(res, 200, { task: t }); }
    if (p === "/feedback" && m === "GET") return send(res, 200, { items: feedback });
    if (p === "/feedback" && m === "POST") { const f = { id: `f${++n}`, ...b, authorName: "Test User", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mine: true, promotedAt: null }; feedback.unshift(f); return send(res, 201, { item: f }); }
    if ((mm = p.match(/^\/feedback\/([^/]+)\/promote$/))) return send(res, 200, { promoted: true, promotedAt: new Date().toISOString() });
    if ((mm = p.match(/^\/feedback\/([^/]+)$/))) { const f = feedback.find((x) => x.id === mm[1]); if (f) Object.assign(f, b); return send(res, 200, { item: f }); }
    if (p === "/feedback/cleanup") return send(res, 200, { title: "Tidied title", description: "Tidied description.", possiblePhi: [] });
    return send(res, 404, { error: "not_found", path: p });
  });
}).listen(3000, () => console.log("mock practice app on :3000"));
