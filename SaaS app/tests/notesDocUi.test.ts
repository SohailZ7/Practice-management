import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DocApiError, docsApi, type FieldDef } from "../src/lib/notes/docsClient";
import { completeValues, defaultSelection, generateErrorMessage, isDirty, modelOriginal, saveErrorOutcome, toggleSelection, typeIcon, versionLabel } from "../src/lib/notes/docUi";
import { DocumentForm } from "../src/components/notes/DocumentForm";

const fields: FieldDef[] = [
  { name: "cc", label: "Chief Complaint", type: "longtext" },
  { name: "sleep", label: "Sleep", type: "select", options: ["Good", "Fair", "Poor"] },
  { name: "dob", label: "Date", type: "date" },
  { name: "name", label: "Name", type: "text" },
  { name: "si", label: "Suicidal ideation", type: "checkbox" },
];

describe("generate chooser logic", () => {
  const types = [{ id: "progress", label: "Progress Note", default: true }, { id: "eval", label: "Psych Eval", default: false }];
  it("pre-checks defaults and toggles extras", () => {
    const sel = defaultSelection(types);
    expect(sel).toEqual(["progress"]);
    expect(toggleSelection(sel, "eval")).toEqual(["progress", "eval"]);
    expect(toggleSelection(["progress", "eval"], "progress")).toEqual(["eval"]);
  });
  it("friendly message per error code", () => {
    expect(generateErrorMessage(new DocApiError(409, "no_transcript"))).toMatch(/no transcript/i);
    expect(generateErrorMessage(new DocApiError(409, "model_not_configured"))).toMatch(/administrator/i);
    expect(generateErrorMessage(new DocApiError(502, "generate_failed"))).toMatch(/try again/i);
    expect(generateErrorMessage(new DocApiError(404, "not_found"))).toMatch(/could not be found/i);
    expect(generateErrorMessage(new TypeError("fetch failed"))).toMatch(/reach the server/i);
  });
  it("icons by type", () => {
    expect(typeIcon("psych_eval")).not.toBe(typeIcon("progress_note"));
  });
});

describe("dirty and save outcomes", () => {
  it("treats missing and empty alike, notices real edits", () => {
    expect(isDirty(fields, { cc: "a" }, { cc: "a", sleep: "", si: false })).toBe(false);
    expect(isDirty(fields, { cc: "a" }, { cc: "ab" })).toBe(true);
    expect(isDirty(fields, { si: false }, { si: true })).toBe(true);
  });
  it("completeValues includes every field", () => {
    expect(completeValues(fields, { cc: "x", si: "true" })).toEqual({ cc: "x", sleep: "", dob: "", name: "", si: true });
  });
  it("maps save errors", () => {
    expect(saveErrorOutcome(new DocApiError(409, "stale_version")).kind).toBe("stale");
    expect(saveErrorOutcome(new DocApiError(400, "no_changes")).kind).toBe("no_changes");
    expect(saveErrorOutcome(new DocApiError(400, "bad_values"))).toMatchObject({ kind: "error" });
    expect(saveErrorOutcome(new Error("x"))).toMatchObject({ kind: "error" });
  });
});

describe("versions", () => {
  const versions = [
    { version: 2, source: "user", createdAt: "2026-11-05T18:00:00Z", authorName: "Dr A" },
    { version: 1, source: "model", createdAt: "2026-11-05T17:00:00Z" },
  ];
  it("marks the first model version as the original", () => {
    expect(modelOriginal(versions)).toBe(1);
    expect(versionLabel(versions[1], 1, 2)).toContain("model original");
    expect(versionLabel(versions[0], 1, 2)).toContain("latest");
  });
  it("no model version -> no original", () => expect(modelOriginal([versions[0]])).toBeNull());
});

describe("DocumentForm", () => {
  it("renders each field type from the definition", () => {
    const html = renderToStaticMarkup(createElement(DocumentForm, {
      fields, values: { cc: "Anxious", sleep: "Poor", si: true }, readOnly: false, onChange: () => {},
    }));
    expect(html).toContain("Chief Complaint");
    expect(html).toContain("<textarea");
    expect(html).toContain("Anxious");
    expect(html).toMatch(/<option value="Poor" selected/);
    expect(html).toContain('type="date"');
    expect(html).toMatch(/type="checkbox"[^>]*checked/);
    expect(html).not.toContain("disabled");
  });
  it("read-only disables controls", () => {
    const html = renderToStaticMarkup(createElement(DocumentForm, { fields, values: {}, readOnly: true, onChange: () => {} }));
    expect(html).toContain("readonly");
    expect(html).toContain("disabled");
  });
});

describe("docsApi client", () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (status: number, body: unknown) => vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  it("posts the chosen types and returns the documents", async () => {
    const f = reply(200, { documents: [{ id: "d1", docType: "progress", title: "Progress Note", latestVersion: 1 }] });
    vi.stubGlobal("fetch", f);
    const r = await docsApi.generate("v 1", ["progress", "eval"]);
    expect(r.documents[0].id).toBe("d1");
    expect(f.mock.calls[0][0]).toBe("/api/notes/visits/v%201/generate");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ docTypes: ["progress", "eval"] });
  });
  it("throws DocApiError with the code", async () => {
    vi.stubGlobal("fetch", reply(409, { error: "stale_version" }));
    await expect(docsApi.saveVersion("v", "d", 1, {})).rejects.toMatchObject({ status: 409, code: "stale_version" });
  });
  it("builds urls", () => {
    expect(docsApi.pdfUrl("v", "d", 3)).toBe("/api/notes/visits/v/documents/d/pdf?version=3");
    expect(docsApi.pdfUrl("v", "d")).toBe("/api/notes/visits/v/documents/d/pdf");
  });
});
