import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFName, PDFCheckBox, PDFTextField } from "pdf-lib";

// ---- an in-memory database: just enough of Prisma for the document service, with a unique (documentId, version) ----
type Row = Record<string, any>;
const state = { visits: [] as Row[], docs: [] as Row[], versions: [] as Row[], users: [] as Row[], seq: 0 };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v), (_k, x) => (typeof x === "string" && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(x) ? new Date(x) : x));
/** Prisma's array transactions run lazily and roll back together; so does this. */
const lazy = <T,>(fn: () => T) => ({ then: (res: any, rej: any) => Promise.resolve().then(fn).then(res, rej), run: fn });
const dupe = () => Object.assign(new Error("unique"), { code: "P2002" });

const db = {
  visit: {
    findUnique: vi.fn(async ({ where, include }: any) => {
      const v = state.visits.find((x) => x.id === where.id);
      if (!v) return null;
      return include ? { ...v, patient: { lastName: "Doe", firstName: "Jane" }, documents: state.docs.filter((d) => d.visitId === v.id).map(clone) } : { id: v.id };
    }),
  },
  visitDocument: {
    findFirst: vi.fn(async ({ where }: any) => clone(state.docs.find((d) => d.id === where.id && d.visitId === where.visitId) ?? null)),
    findMany: vi.fn(async ({ where, include, take, cursor }: any) => {
      let rows = state.docs.filter((d) => (where?.visitId ? d.visitId === where.visitId : true) && (where?.docType?.not === null ? d.docType != null : true));
      rows = [...rows].sort((a, b) => a.id.localeCompare(b.id));
      if (cursor) rows = rows.slice(rows.findIndex((r) => r.id === cursor.id) + 1);
      if (take) rows = rows.slice(0, take);
      return rows.map((d) => ({
        ...clone(d),
        visit: state.visits.find((v) => v.id === d.visitId),
        fieldVersions: state.versions.filter((v) => v.documentId === d.id).sort((a, b) => (include?.fieldVersions?.orderBy?.version === "desc" ? b.version - a.version : a.version - b.version)).slice(0, include?.fieldVersions?.take ?? 999).map(clone),
      }));
    }),
    create: vi.fn(async ({ data }: any) => {
      const { fieldVersions, ...rest } = data;
      const doc = { id: `d${++state.seq}`, createdAt: new Date("2026-11-05T12:00:00Z"), updatedAt: new Date("2026-11-05T12:00:00Z"), ...rest };
      state.docs.push(doc);
      if (fieldVersions) state.versions.push({ id: `fv${++state.seq}`, documentId: doc.id, createdAt: new Date(), authorUserId: null, ...fieldVersions.create });
      return clone(doc);
    }),
    update: vi.fn(({ where, data }: any) => lazy(() => Object.assign(state.docs.find((d) => d.id === where.id)!, data, { updatedAt: new Date() }))),
  },
  documentVersion: {
    findMany: vi.fn(async ({ where, orderBy, take }: any) => {
      const rows = state.versions.filter((v) => v.documentId === where.documentId).sort((a, b) => (orderBy.version === "desc" ? b.version - a.version : a.version - b.version));
      return rows.slice(0, take ?? rows.length).map(clone);
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      const rows = state.versions.filter((v) => v.documentId === where.documentId).sort((a, b) => b.version - a.version);
      return rows[0] ? clone(rows[0]) : null;
    }),
    create: vi.fn(({ data }: any) =>
      lazy(() => {
        if (state.versions.some((v) => v.documentId === data.documentId && v.version === data.version)) throw dupe();
        const row = { id: `fv${++state.seq}`, createdAt: new Date(), authorUserId: null, ...data };
        state.versions.push(row);
        return clone(row);
      }),
    ),
  },
  user: { findMany: vi.fn(async ({ where }: any) => state.users.filter((u) => where.id.in.includes(u.id))) },
  $transaction: vi.fn((ops: any[]) => {
    const run = txQueue.then(() => txBody(ops));
    txQueue = run.catch(() => undefined);
    return run;
  }),
};
let txQueue: Promise<unknown> = Promise.resolve();
const txBody = async (ops: any[]) => {
    const snap = { docs: clone(state.docs), versions: clone(state.versions) };
    try {
      const out = [];
      for (const op of ops) out.push(await op);
      return out;
    } catch (e) {
      state.docs = snap.docs;
      state.versions = snap.versions;
      throw e;
    }
};
vi.mock("../src/lib/db", () => ({ db }));
const audit = vi.fn();
vi.mock("../src/lib/audit", () => ({ audit: (...a: unknown[]) => audit(...a) }));
const authenticate = vi.fn();
vi.mock("../src/lib/desktop/api", async () => ({ ...(await vi.importActual<any>("../src/lib/desktop/api")), authenticate: (...a: unknown[]) => authenticate(...a) }));
const getCurrentUser = vi.fn();
vi.mock("../src/lib/session", () => ({ getCurrentUser: () => getCurrentUser(), auditDenied: vi.fn() }));
const modelConfigured = vi.fn();
const llmFn = vi.fn();
class ModelNotConfiguredError extends Error {}
vi.mock("../src/lib/notes/model", () => ({ makeLlm: () => llmFn, modelConfigured: () => modelConfigured(), ModelNotConfiguredError }));

const { ApiError } = await vi.importActual<typeof import("../src/lib/desktop/api")>("../src/lib/desktop/api");
const tpl = await import("../src/lib/notes/docTemplates");
const svc = await import("../src/lib/notes/docService");
const pdfLib = await import("../src/lib/notes/docPdf");
const dTypes = await import("../src/app/api/desktop/v1/notes/doc-types/route");
const dGen = await import("../src/app/api/desktop/v1/notes/visits/[id]/generate/route");
const dList = await import("../src/app/api/desktop/v1/notes/visits/[id]/documents/route");
const dOne = await import("../src/app/api/desktop/v1/notes/visits/[id]/documents/[docId]/route");
const dVer = await import("../src/app/api/desktop/v1/notes/visits/[id]/documents/[docId]/versions/route");
const dPdf = await import("../src/app/api/desktop/v1/notes/visits/[id]/documents/[docId]/pdf/route");
const wTypes = await import("../src/app/api/notes/doc-types/route");
const wGen = await import("../src/app/api/notes/visits/[id]/generate/route");
const wVer = await import("../src/app/api/notes/visits/[id]/documents/[docId]/versions/route");
const wExport = await import("../src/app/api/notes/training-export/route");

const USER = { id: "u1", email: "doc@example.org", name: "Dr Khalid" };
const url = (p = "") => `http://x/${p}`;
const post = (body?: unknown) => new Request(url(), { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const idp = { params: { id: "v1" } };
const docp = (docId: string) => ({ params: { id: "v1", docId } });

/** Answers each batch with a fixed JSON object, plus junk the service must discard. */
function fakeModel() {
  llmFn.mockImplementation(async ({ prompt }: { prompt: string }) => {
    const names = [...prompt.matchAll(/\{"name":"([^"]+)"/g)].map((m) => m[1]);
    const pick = (n: string, v: unknown) => (names.includes(n) ? { [n]: v } : {});
    return "```json\n" + JSON.stringify({
      ...pick("ChiefComplaint", "Feels anxious"), ...pick("IH_Sleep", "Poor"), ...pick("IH_ADL_Fair", true),
      ...pick("IH_Appetite", "Excellent"), // not an option: dropped
      ...pick("IH_Energy", true),          // wrong type: dropped
      ...pick("chief_complaint", "Low mood"), ...pick("impression", "MDD, recurrent"),
      NotAField: "x",
      ...pick("PatientName", "Should Be Ignored"), // system field: the model may not set it
    }) + "\n```";
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { visits: [{ id: "v1", patientId: "p1", appointmentType: "Follow-up", visitDate: "2026-11-05", providerName: "Dr Khalid", transcript: "Doctor: how is sleep? Patient: poor, I feel anxious." }], docs: [], versions: [], users: [{ id: "u1", name: "Dr Khalid" }], seq: 0 });
  authenticate.mockResolvedValue({ user: USER });
  getCurrentUser.mockResolvedValue({ ...USER, active: true, role: "STAFF", access: [{ module: "notes", level: "edit" }] });
  modelConfigured.mockReturnValue(true);
  fakeModel();
});

// ---- templates --------------------------------------------------------------------------------------------------
describe("templates and schema", () => {
  it("reads real field names from each fillable PDF; mirror and signature fields are not asked for", async () => {
    const progress = await tpl.schemaFor("progress_note.master");
    const names = progress.map((f) => f.name);
    expect(names).toContain("ChiefComplaint");
    expect(names.some((n) => n.endsWith("_p2"))).toBe(false);
    expect(names.some((n) => /Signature/i.test(n))).toBe(false);
    expect(progress.find((f) => f.name === "ChiefComplaint")?.type).toBe("longtext");
    expect(progress.find((f) => f.name === "IH_ADL_Fair")?.type).toBe("checkbox");
    expect(progress.find((f) => f.name === "IH_Sleep")).toMatchObject({ type: "select", options: ["Good", "Fair", "Poor"] });
    expect((await tpl.schemaFor("admit_order.master")).find((f) => f.name === "PatientMRN")).toBeDefined();
    expect((await tpl.schemaFor("admit_order.master")).find((f) => f.name === "Diet_SpecialText")?.type).toBe("text");
    expect((await tpl.schemaFor("discharge_order.master")).map((f) => f.name)).toContain("TreatmentCourse");
  });
  it("Psych Eval has no form fields, so it uses sections", async () => {
    const s = await tpl.schemaFor("psych_eval.master");
    expect(s.map((f) => f.name)).toContain("history_present_illness");
    expect(s.every((f) => f.type === "longtext" || f.type === "date")).toBe(true);
  });
  it("picks the provider's variant, else the master", () => {
    expect(tpl.templateFor("progress_note", "Dr. Ahmed")).toBe("progress_note.ahmed");
    expect(tpl.templateFor("discharge_order", "Dr Khalid")).toBe("discharge_order.khalid");
    expect(tpl.templateFor("discharge_order", "Dr. Ahmed")).toBe("discharge_order.master");
    expect(tpl.templateFor("psych_eval", "anyone")).toBe("psych_eval.master");
  });
  it("defaults per appointment type, every type still offered", () => {
    const ids = (t: string) => tpl.docTypeList(t).filter((d) => d.default).map((d) => d.id);
    expect(ids("Follow-up")).toEqual(["progress_note"]);
    expect(ids("Psych Eval")).toEqual(["psych_eval"]);
    expect(ids("Psych Eval & Admit Order")).toEqual(["psych_eval", "admit_order"]);
    expect(ids("Follow-up & Discharge Order")).toEqual(["progress_note", "discharge_order"]);
    expect(ids("DC Orders Only")).toEqual(["discharge_order"]);
    expect(ids("")).toEqual([]);
    expect(tpl.docTypeList("Follow-up")).toHaveLength(4);
  });
  it("validates values by type", async () => {
    const f = await tpl.schemaFor("progress_note.master");
    const by = (n: string) => f.find((x) => x.name === n)!;
    expect(tpl.valueProblem(by("IH_Sleep"), "Poor")).toBeNull();
    expect(tpl.valueProblem(by("IH_Sleep"), "Great")).not.toBeNull();
    expect(tpl.valueProblem(by("IH_ADL_Fair"), "yes")).not.toBeNull();
    expect(tpl.valueProblem(by("ChiefComplaint"), 5)).not.toBeNull();
  });
});

describe("filled PDF", () => {
  it("fills text, checkboxes and a select, and mirrors page-2 header fields", async () => {
    const templateId = "progress_note.master";
    const fields = await tpl.schemaFor(templateId);
    const values = { ...tpl.emptyValues(fields), PatientName: "Doe, Jane", ChiefComplaint: "Feels anxious", IH_Sleep: "Poor", IH_ADL_Fair: true, EncounterDate: "2026-11-05" };
    const out = await PDFDocument.load(await pdfLib.fillPdf(templateId, "Progress Note", fields, values));
    const form = out.getForm();
    expect(form.getTextField("ChiefComplaint").getText()).toBe("Feels anxious");
    expect(form.getTextField("PatientName_p2").getText()).toBe("Doe, Jane");
    expect(form.getTextField("EncounterDate").getText()).toBe("11/05/2026");
    expect(form.getCheckBox("IH_ADL_Fair").isChecked()).toBe(true);
    expect(form.getCheckBox("IH_ADL_Poor").isChecked()).toBe(false);
    const sleep = form.getCheckBox("IH_Sleep").acroField;
    expect(sleep.getWidgets().map((w) => w.getAppearanceState()?.decodeText())).toEqual(["Off", "Off", "Poor"]);
    expect(form.getField("IH_Sleep")).toBeInstanceOf(PDFCheckBox);
    expect(form.getField("ChiefComplaint")).toBeInstanceOf(PDFTextField);
    void PDFName;
  });
  it("typesets a section document", async () => {
    const fields = await tpl.schemaFor("psych_eval.master");
    const bytes = await pdfLib.fillPdf("psych_eval.master", "Psych Eval", fields, { ...tpl.emptyValues(fields), impression: "Low mood – “quoted” ".repeat(80) });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

// ---- doc-types --------------------------------------------------------------------------------------------------
describe("GET doc-types", () => {
  const get = (r: any, q: string) => r.GET(new Request(url(`doc-types?appointmentType=${encodeURIComponent(q)}`)));
  it("200 with defaults; desktop and web agree", async () => {
    const d = await get(dTypes, "Follow-up & Discharge Order");
    expect(d.status).toBe(200);
    const body = await d.json();
    expect(body.docTypes.find((t: any) => t.id === "progress_note")).toEqual({ id: "progress_note", label: "Progress Note", default: true });
    expect(body.docTypes.find((t: any) => t.id === "psych_eval").default).toBe(false);
    expect(await (await get(wTypes, "Follow-up & Discharge Order")).json()).toEqual(body);
    expect(authenticate.mock.calls[0][1]).toEqual({ module: "notes", level: "view" });
  });
  it("401 and 403", async () => {
    authenticate.mockRejectedValue(new ApiError(401, "unauthorized"));
    expect((await get(dTypes, "")).status).toBe(401);
    getCurrentUser.mockResolvedValue(null);
    expect((await get(wTypes, "")).status).toBe(401);
    getCurrentUser.mockResolvedValue({ ...USER, active: true, role: "STAFF", access: [] });
    expect((await get(wTypes, "")).status).toBe(403);
  });
});

// ---- generate ---------------------------------------------------------------------------------------------------
describe("POST generate", () => {
  it("200 creates the defaults; version 1 is the model's checked answer plus system fields", async () => {
    const r = await dGen.POST(post({}), idp);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ documents: [{ id: "d1", docType: "progress_note", title: "Progress Note", latestVersion: 1 }] });
    expect(authenticate.mock.calls[0][1]).toEqual({ module: "notes", level: "edit" });
    expect(state.docs[0]).toMatchObject({ docType: "progress_note", templateId: "progress_note.master" });
    const v1 = state.versions[0];
    expect(v1).toMatchObject({ version: 1, source: "model", authorUserId: "u1" });
    expect(v1.values).toMatchObject({ ChiefComplaint: "Feels anxious", IH_Sleep: "Poor", IH_ADL_Fair: true, IH_Appetite: "", IH_Energy: "", PatientName: "Doe, Jane", EncounterDate: "2026-11-05" });
    expect(v1.values.NotAField).toBeUndefined();
    expect(llmFn.mock.calls.every(([a]) => !/Jane|Doe/.test(a.prompt))).toBe(true); // the name never reaches the model
    expect(state.docs[0].markdown).toContain("Feels anxious");
  });
  it("uses the requested types, the provider's variant template, and works with no body", async () => {
    const r = await dGen.POST(post({ docTypes: ["psych_eval", "discharge_order"] }), idp);
    const body = await r.json();
    expect(body.documents.map((d: any) => d.docType)).toEqual(["psych_eval", "discharge_order"]);
    expect(state.docs.map((d) => d.templateId)).toEqual(["psych_eval.master", "discharge_order.khalid"]);
    expect((await dGen.POST(new Request(url(), { method: "POST" }), idp)).status).toBe(200);
  });
  it("does not regenerate a document the visit already has", async () => {
    await dGen.POST(post({}), idp);
    llmFn.mockClear();
    const r = await dGen.POST(post({}), idp);
    expect((await r.json()).documents).toHaveLength(1);
    expect(llmFn).not.toHaveBeenCalled();
    expect(state.docs).toHaveLength(1);
  });
  it("partial success lists per-type errors", async () => {
    llmFn.mockImplementation(async ({ prompt }: { prompt: string }) => {
      if (/admission psychiatric evaluation/i.test(prompt)) throw new Error("boom with patient text");
      return "{}";
    });
    const r = await dGen.POST(post({ docTypes: ["progress_note", "psych_eval"] }), idp);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.documents.map((d: any) => d.docType)).toEqual(["progress_note"]);
    expect(body.errors).toEqual([{ docType: "psych_eval", error: "generate_failed" }]);
  });
  it("400 for unknown types, nothing to generate, or a bad body", async () => {
    expect(await (await dGen.POST(post({ docTypes: ["nope"] }), idp)).json()).toEqual({ error: "bad_doc_types" });
    state.visits[0].appointmentType = "";
    expect(await (await dGen.POST(post({}), idp)).json()).toEqual({ error: "no_doc_types" });
    expect((await dGen.POST(new Request(url(), { method: "POST", body: "[1" }), idp)).status).toBe(400);
  });
  it("404 not_found", async () => {
    const r = await dGen.POST(post({}), { params: { id: "zz" } });
    expect([r.status, await r.json()]).toEqual([404, { error: "not_found" }]);
  });
  it("409 no_transcript", async () => {
    state.visits[0].transcript = "  ";
    const r = await dGen.POST(post({}), idp);
    expect([r.status, await r.json()]).toEqual([409, { error: "no_transcript" }]);
  });
  it("409 model_not_configured, up front and when the model throws it", async () => {
    modelConfigured.mockReturnValue(false);
    let r = await dGen.POST(post({}), idp);
    expect([r.status, await r.json()]).toEqual([409, { error: "model_not_configured" }]);
    modelConfigured.mockReturnValue(true);
    llmFn.mockRejectedValue(new ModelNotConfiguredError("x"));
    r = await dGen.POST(post({}), idp);
    expect([r.status, await r.json()]).toEqual([409, { error: "model_not_configured" }]);
  });
  it("502 generate_failed when every type fails, without echoing the error", async () => {
    llmFn.mockRejectedValue(new Error("secret patient text"));
    const r = await dGen.POST(post({}), idp);
    expect([r.status, await r.json()]).toEqual([502, { error: "generate_failed" }]);
    llmFn.mockResolvedValue("not json at all");
    expect((await dGen.POST(post({}), idp)).status).toBe(502);
  });
  it("403 for view-only users on the web route", async () => {
    getCurrentUser.mockResolvedValue({ ...USER, active: true, role: "STAFF", access: [{ module: "notes", level: "view" }] });
    expect((await wGen.POST(post({}), idp)).status).toBe(403);
    getCurrentUser.mockResolvedValue({ ...USER, active: true, role: "STAFF", access: [{ module: "notes", level: "edit" }] });
    expect((await wGen.POST(post({}), idp)).status).toBe(200);
  });
});

// ---- read -------------------------------------------------------------------------------------------------------
describe("GET documents, GET document, GET pdf", () => {
  beforeEach(async () => { await dGen.POST(post({}), idp); });
  it("lists documents with latestVersion", async () => {
    const r = await dList.GET(new Request(url()), idp);
    expect(await r.json()).toEqual({ documents: [{ id: "d1", docType: "progress_note", title: "Progress Note", latestVersion: 1, updatedAt: expect.any(String) }] });
    state.docs.push({ id: "other", visitId: "v1", docType: null, templateId: null, label: "Old", markdown: "text", createdAt: new Date(), updatedAt: new Date() });
    const again = (await (await dList.GET(new Request(url()), idp)).json()).documents;
    expect(again[1]).toMatchObject({ id: "other", docType: "legacy_note", latestVersion: 1 });
    state.visits.length = 0;
    expect((await dList.GET(new Request(url()), idp)).status).toBe(404);
  });
  it("returns fields, versions and current values; a version can be asked for", async () => {
    await dVer.POST(post({ baseVersion: 1, values: { Subjective: "Better" } }), docp("d1"));
    const r = await dOne.GET(new Request(url()), docp("d1"));
    const body = await r.json();
    expect(body).toMatchObject({ id: "d1", docType: "progress_note", title: "Progress Note" });
    expect(body.fields.find((f: any) => f.name === "IH_Sleep")).toEqual({ name: "IH_Sleep", label: "IH / Sleep", type: "select", options: ["Good", "Fair", "Poor"] });
    expect(body.versions).toEqual([
      { version: 1, source: "model", createdAt: expect.any(String), authorName: "Dr Khalid" },
      { version: 2, source: "edit", createdAt: expect.any(String), authorName: "Dr Khalid" },
    ]);
    expect(body.current.version).toBe(2);
    expect(body.current.values.Subjective).toBe("Better");
    const first = await (await dOne.GET(new Request(url("?version=1")), docp("d1"))).json();
    expect(first.current).toMatchObject({ version: 1, values: { Subjective: "" } });
    expect((await dOne.GET(new Request(url("?version=9")), docp("d1"))).status).toBe(404);
    expect((await dOne.GET(new Request(url("?version=x")), docp("d1"))).status).toBe(400);
    expect((await dOne.GET(new Request(url()), docp("nope"))).status).toBe(404);
  });
  it("returns the filled PDF for a version", async () => {
    await dVer.POST(post({ baseVersion: 1, values: { Subjective: "Better" } }), docp("d1"));
    const latest = await dPdf.GET(new Request(url()), docp("d1"));
    expect(latest.status).toBe(200);
    expect(latest.headers.get("content-type")).toBe("application/pdf");
    const f2 = (await PDFDocument.load(new Uint8Array(await latest.arrayBuffer()))).getForm();
    expect(f2.getTextField("Subjective").getText()).toBe("Better");
    const f1 = (await PDFDocument.load(new Uint8Array(await (await dPdf.GET(new Request(url("?version=1")), docp("d1"))).arrayBuffer()))).getForm();
    expect(f1.getTextField("Subjective").getText() ?? "").toBe("");
    expect((await dPdf.GET(new Request(url("?version=7")), docp("d1"))).status).toBe(404);
  });
});

// ---- versions ---------------------------------------------------------------------------------------------------
describe("POST versions", () => {
  beforeEach(async () => { await dGen.POST(post({}), idp); });
  const save = (body: unknown, docId = "d1", r: any = dVer) => r.POST(post(body), docp(docId));

  it("201 and the version number goes up by one each save; the model's version 1 is never touched", async () => {
    const a = await save({ baseVersion: 1, values: { Subjective: "A" } });
    expect(a.status).toBe(201);
    expect(await a.json()).toEqual({ version: 2, createdAt: expect.any(String) });
    expect((await (await save({ baseVersion: 2, values: { Subjective: "B", IH_Sleep: "Good" } })).json()).version).toBe(3);
    expect(state.versions.map((v) => [v.version, v.source])).toEqual([[1, "model"], [2, "edit"], [3, "edit"]]);
    expect(state.versions[0].values.Subjective).toBe("");
    expect(state.versions[0].values.IH_Sleep).toBe("Poor");
    expect(state.versions[2]).toMatchObject({ authorUserId: "u1" });
    expect(state.versions[2].values).toMatchObject({ Subjective: "B", IH_Sleep: "Good", ChiefComplaint: "Feels anxious" });
    expect(state.docs[0].markdown).toContain("B");
    expect(authenticate.mock.calls.at(-1)![1]).toEqual({ module: "notes", level: "edit" });
  });
  it("clears a field by sending its empty value", async () => {
    await save({ baseVersion: 1, values: { IH_Sleep: "", IH_ADL_Fair: false } });
    expect(state.versions[1].values).toMatchObject({ IH_Sleep: "", IH_ADL_Fair: false });
  });
  it("409 stale_version when baseVersion is not the latest", async () => {
    await save({ baseVersion: 1, values: { Subjective: "A" } });
    const r = await save({ baseVersion: 1, values: { Subjective: "B" } });
    expect([r.status, await r.json()]).toEqual([409, { error: "stale_version" }]);
    expect(state.versions).toHaveLength(2);
    expect((await save({ baseVersion: 5, values: { Subjective: "B" } })).status).toBe(409);
  });
  it("two saves from the same base: one wins, the other is stale_version (database uniqueness)", async () => {
    const [a, b] = await Promise.all([save({ baseVersion: 1, values: { Subjective: "A" } }), save({ baseVersion: 1, values: { Subjective: "B" } })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(state.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(state.docs[0].markdown).toContain(state.versions[1].values.Subjective);
  });
  it("400 no_changes when values equal the latest (including an empty change)", async () => {
    let r = await save({ baseVersion: 1, values: { IH_Sleep: "Poor" } });
    expect([r.status, await r.json()]).toEqual([400, { error: "no_changes" }]);
    expect((await save({ baseVersion: 1, values: {} })).status).toBe(400);
    expect(state.versions).toHaveLength(1);
  });
  it("400 bad_values for unknown fields or wrong types, naming them", async () => {
    let r = await save({ baseVersion: 1, values: { Nope: "x" } });
    expect([r.status, await r.json()]).toEqual([400, { error: "bad_values", fields: ["Nope"] }]);
    r = await save({ baseVersion: 1, values: { IH_Sleep: "Great", IH_ADL_Fair: "yes", Subjective: 4 } });
    expect((await r.json()).fields.sort()).toEqual(["IH_ADL_Fair", "IH_Sleep", "Subjective"]);
    expect(state.versions).toHaveLength(1);
  });
  it("400 bad_request for a missing or malformed baseVersion or values", async () => {
    for (const body of [{ values: {} }, { baseVersion: "1", values: {} }, { baseVersion: 1 }, { baseVersion: 1, values: [] }, { baseVersion: 0, values: {} }])
      expect((await save(body)).status).toBe(400);
  });
  it("404 for an unknown document or one on another visit", async () => {
    expect((await save({ baseVersion: 1, values: {} }, "nope")).status).toBe(404);
    expect((await dVer.POST(post({ baseVersion: 1, values: { Subjective: "x" } }), { params: { id: "other", docId: "d1" } })).status).toBe(404);
  });
  it("401 and 403, on desktop and web", async () => {
    authenticate.mockRejectedValue(new ApiError(403, "forbidden"));
    expect((await save({ baseVersion: 1, values: { Subjective: "x" } })).status).toBe(403);
    getCurrentUser.mockResolvedValue(null);
    expect((await save({ baseVersion: 1, values: { Subjective: "x" } }, "d1", wVer)).status).toBe(401);
    getCurrentUser.mockResolvedValue({ ...USER, active: true, role: "STAFF", access: [{ module: "notes", level: "view" }] });
    expect((await save({ baseVersion: 1, values: { Subjective: "x" } }, "d1", wVer)).status).toBe(403);
    expect(state.versions).toHaveLength(1);
  });
  it("an older note's stored text becomes version 1 the first time it is edited", async () => {
    state.docs.push({ id: "old", visitId: "v1", docType: null, templateId: null, label: "Note", markdown: "original text", createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date() });
    const body = await (await dOne.GET(new Request(url()), docp("old"))).json();
    expect(body).toMatchObject({ docType: "legacy_note", fields: [{ name: "content", type: "longtext" }], current: { version: 1, values: { content: "original text" } } });
    expect((await save({ baseVersion: 1, values: { content: "edited" } }, "old")).status).toBe(201);
    const rows = state.versions.filter((v) => v.documentId === "old");
    expect(rows.map((v) => [v.version, v.source, v.values.content])).toEqual([[1, "model", "original text"], [2, "edit", "edited"]]);
    expect(state.docs.find((d) => d.id === "old")!.markdown).toBe("edited");
  });
});

// ---- training export --------------------------------------------------------------------------------------------
describe("training export", () => {
  it("emits input, version 1, the final version and the ones between", async () => {
    await dGen.POST(post({}), idp);
    await dVer.POST(post({ baseVersion: 1, values: { Subjective: "A" } }), docp("d1"));
    await dVer.POST(post({ baseVersion: 2, values: { IH_Sleep: "Good" } }), docp("d1"));
    state.docs.push({ id: "old", visitId: "v1", docType: null, templateId: null, label: "Old", markdown: "x", createdAt: new Date(), updatedAt: new Date() });
    const { body, count } = await svc.trainingJsonl();
    expect(count).toBe(1);
    const rec = JSON.parse(body.trim());
    expect(rec).toMatchObject({ documentId: "d1", docType: "progress_note", edited: true });
    expect(rec.input.transcript).toContain("poor, I feel anxious");
    expect(rec.input.systemFilledFields).toContain("PatientName");
    expect(rec.modelOutput).toMatchObject({ version: 1, values: { IH_Sleep: "Poor", Subjective: "" } });
    expect(rec.final).toMatchObject({ version: 3, source: "edit", values: { IH_Sleep: "Good", Subjective: "A" } });
    expect(rec.intermediateVersions.map((v: any) => v.version)).toEqual([2]);
    expect(JSON.stringify(rec)).not.toMatch(/Jane|Doe/); // system-written fields (patient name) are left out
    expect(rec.modelOutput.values.PatientName).toBeUndefined();
  });
  it("a document nobody edited has final = model output, edited false", async () => {
    await dGen.POST(post({}), idp);
    const rec = JSON.parse((await svc.trainingJsonl()).body.trim());
    expect(rec.edited).toBe(false);
    expect(rec.final.values).toEqual(rec.modelOutput.values);
  });
  it("the route is admin only and audited", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await wExport.GET()).status).toBe(401);
    getCurrentUser.mockResolvedValue({ ...USER, active: true, role: "STAFF", access: [{ module: "notes", level: "edit" }] });
    expect((await wExport.GET()).status).toBe(403);
    await dGen.POST(post({}), idp);
    getCurrentUser.mockResolvedValue({ ...USER, active: true, role: "ADMIN", access: [] });
    const r = await wExport.GET();
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/x-ndjson");
    expect((await r.text()).trim().split("\n")).toHaveLength(1);
    expect(audit).toHaveBeenCalledWith(USER.email, "notes.training.export", "jsonl");
  });
});
