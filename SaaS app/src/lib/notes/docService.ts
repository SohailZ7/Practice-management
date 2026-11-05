// Template-based documents with full version history. One implementation behind both the web routes and the
// desktop-token routes, so the rules, status codes and audit entries cannot drift apart.
//
// Versions are insert-only. (documentId, version) is unique in the database, so two saves that start from the same
// base version cannot both succeed: the loser gets stale_version.

import { db } from "../db";
import { audit } from "../audit";
import { ApiError } from "../desktop/api";
import { fillDocument } from "./docFill";
import { fillPdf } from "./docPdf";
import {
  DOC_TYPES, LEGACY_FIELDS, isSystemField, defaultDocTypes, docTypeLabel, emptyValue, emptyValues, isDocType, sameValues, schemaFor,
  templateFor, valueProblem, type DocField, type DocTypeId, type DocValues,
} from "./docTemplates";
import { makeLlm, modelConfigured, ModelNotConfiguredError } from "./model";
import type { Llm } from "./types";

export type Actor = { id: string; email: string };

const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

/** Plain-text copy of the values kept in `markdown`, so the older Notes board still lists and opens these documents. */
export function valuesToMarkdown(title: string, fields: DocField[], values: DocValues): string {
  const lines = [`# ${title}`, ""];
  for (const f of fields) {
    const v = values[f.name];
    if (v === "" || v === false || v === undefined) continue;
    lines.push(v === true ? `- [x] ${f.label}` : `**${f.label}:** ${v}`);
  }
  return lines.join("\n");
}

type DocRow = { id: string; docType: string | null; templateId: string | null; label: string; markdown: string; createdAt: Date };

async function schemaOf(doc: Pick<DocRow, "docType" | "templateId">): Promise<DocField[]> {
  return doc.templateId ? schemaFor(doc.templateId) : LEGACY_FIELDS;
}

async function loadDoc(visitId: string, docId: string) {
  const doc = await db.visitDocument.findFirst({ where: { id: docId, visitId } });
  if (!doc) throw new ApiError(404, "not_found");
  return doc as DocRow & { updatedAt: Date };
}

type VersionRow = { version: number; source: string; values: unknown; authorUserId: string | null; createdAt: Date };

async function versionsOf(doc: DocRow): Promise<VersionRow[]> {
  const rows = (await db.documentVersion.findMany({ where: { documentId: doc.id }, orderBy: { version: "asc" } })) as VersionRow[];
  if (rows.length) return rows;
  // A document written before templates existed: its stored text is version 1.
  return [{ version: 1, source: "model", values: { content: doc.markdown }, authorUserId: null, createdAt: doc.createdAt }];
}

// ---- doc types ---------------------------------------------------------------------------------------------------

export function listDocTypes(appointmentType: string) {
  const defaults = defaultDocTypes(appointmentType);
  return { docTypes: DOC_TYPES.map((t) => ({ id: t.id, label: t.label, default: defaults.includes(t.id) })) };
}

// ---- generate ----------------------------------------------------------------------------------------------------

export type GenerateDeps = { llm?: Llm };

export async function generateDocs(actor: Actor, visitId: string, requested: unknown, deps: GenerateDeps = {}) {
  const visit = await db.visit.findUnique({ where: { id: visitId }, include: { patient: true, documents: true } });
  if (!visit) throw new ApiError(404, "not_found");
  if (!visit.transcript.trim()) throw new ApiError(409, "no_transcript");
  if (!modelConfigured()) throw new ApiError(409, "model_not_configured");

  let types: DocTypeId[];
  if (requested === undefined || requested === null) types = defaultDocTypes(visit.appointmentType);
  else if (Array.isArray(requested) && requested.every(isDocType)) types = [...new Set(requested as DocTypeId[])];
  else throw new ApiError(400, "bad_doc_types");
  if (!types.length) throw new ApiError(400, "no_doc_types");

  const llm = deps.llm ?? makeLlm();
  // Templates are filled from this visit's transcript only (the prior-note carry-forward belongs to the markdown notes).
  const documents: { id: string; docType: string; title: string; latestVersion: number }[] = [];
  const errors: { docType: string; error: string }[] = [];
  let created = 0;
  for (const docType of types) {
    const existing = visit.documents.find((d) => d.docType === docType);
    if (existing) {
      // Never overwrite what a provider may have edited.
      const latest = await db.documentVersion.findFirst({ where: { documentId: existing.id }, orderBy: { version: "desc" }, select: { version: true } });
      documents.push({ id: existing.id, docType, title: existing.label, latestVersion: latest?.version ?? 1 });
      continue;
    }
    try {
      const templateId = templateFor(docType, visit.providerName);
      const fields = await schemaFor(templateId);
      const values = await fillDocument({
        docType, templateId, llm,
        transcript: visit.transcript,
        visitDate: visit.visitDate,
        providerName: visit.providerName,
        patientLabel: `${visit.patient.lastName}, ${visit.patient.firstName}`,
      });
      const title = docTypeLabel(docType);
      const doc = await db.visitDocument.create({
        data: {
          visitId: visit.id, kind: `TEMPLATE_${docType.toUpperCase()}`, label: title, docType, templateId, draft: true,
          markdown: valuesToMarkdown(title, fields, values),
          fieldVersions: { create: { version: 1, source: "model", values, authorUserId: actor.id } },
        },
      });
      documents.push({ id: doc.id, docType, title, latestVersion: 1 });
      created++;
    } catch (e) {
      errors.push({ docType, error: e instanceof ModelNotConfiguredError ? "model_not_configured" : "generate_failed" });
    }
  }
  if (!documents.length) {
    throw new ApiError(errors.some((e) => e.error === "model_not_configured") ? 409 : 502, errors[0]?.error ?? "generate_failed");
  }
  await audit(actor.email, "notes.documents.generate", `visit ${visit.id} created=${created} failed=${errors.length}`);
  return { documents, ...(errors.length ? { errors } : {}) };
}

// ---- read ---------------------------------------------------------------------------------------------------------

export async function listDocuments(visitId: string) {
  const visit = await db.visit.findUnique({ where: { id: visitId }, select: { id: true } });
  if (!visit) throw new ApiError(404, "not_found");
  const rows = await db.visitDocument.findMany({
    where: { visitId },
    orderBy: { createdAt: "asc" },
    include: { fieldVersions: { orderBy: { version: "desc" }, take: 1, select: { version: true } } },
  });
  return {
    documents: rows.map((d) => ({
      id: d.id,
      docType: d.docType ?? "legacy_note",
      title: d.label,
      latestVersion: d.fieldVersions[0]?.version ?? 1,
      updatedAt: d.updatedAt.toISOString(),
    })),
  };
}

function parseVersion(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new ApiError(400, "bad_request");
  return Number(raw);
}

export async function getDocument(visitId: string, docId: string, versionParam?: string | null) {
  const doc = await loadDoc(visitId, docId);
  const want = parseVersion(versionParam);
  const [fields, versions] = await Promise.all([schemaOf(doc), versionsOf(doc)]);
  const current = want ? versions.find((v) => v.version === want) : versions[versions.length - 1];
  if (!current) throw new ApiError(404, "not_found");

  const ids = [...new Set(versions.map((v) => v.authorUserId).filter((x): x is string => !!x))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const values = { ...emptyValues(fields), ...(current.values as DocValues) };
  return {
    id: doc.id,
    docType: doc.docType ?? "legacy_note",
    title: doc.label,
    fields,
    versions: versions.map((v) => ({
      version: v.version,
      source: v.source,
      createdAt: v.createdAt.toISOString(),
      authorName: v.authorUserId ? nameOf.get(v.authorUserId) ?? null : null,
    })),
    current: { version: current.version, values },
  };
}

export async function documentPdf(visitId: string, docId: string, versionParam?: string | null) {
  const doc = await loadDoc(visitId, docId);
  const want = parseVersion(versionParam);
  const [fields, versions] = await Promise.all([schemaOf(doc), versionsOf(doc)]);
  const v = want ? versions.find((x) => x.version === want) : versions[versions.length - 1];
  if (!v) throw new ApiError(404, "not_found");
  const bytes = await fillPdf(doc.templateId ?? "", doc.label, fields, { ...emptyValues(fields), ...(v.values as DocValues) });
  return { bytes, fileName: `${doc.label} v${v.version}.pdf` };
}

// ---- save a version -----------------------------------------------------------------------------------------------

export async function saveVersion(actor: Actor, visitId: string, docId: string, body: Record<string, unknown>) {
  const { baseVersion, values } = body;
  if (!Number.isInteger(baseVersion) || (baseVersion as number) < 1) throw new ApiError(400, "bad_request");
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new ApiError(400, "bad_request");

  const doc = await loadDoc(visitId, docId);
  const fields = await schemaOf(doc);
  const stored = (await db.documentVersion.findMany({ where: { documentId: doc.id }, orderBy: { version: "desc" }, take: 1 })) as VersionRow[];
  const legacy = stored.length === 0;
  const latestNumber = stored[0]?.version ?? 1;
  const latestValues: DocValues = legacy ? { content: doc.markdown } : { ...emptyValues(fields), ...(stored[0].values as DocValues) };
  if (baseVersion !== latestNumber) throw new ApiError(409, "stale_version");

  const known = new Map(fields.map((f) => [f.name, f]));
  const bad = Object.entries(values as Record<string, unknown>)
    .filter(([name, v]) => !known.has(name) || valueProblem(known.get(name)!, v) !== null)
    .map(([name]) => name);
  if (bad.length) throw new BadValues(bad);

  const merged: DocValues = { ...latestValues, ...(values as DocValues) };
  if (sameValues(fields, merged, latestValues)) throw new ApiError(400, "no_changes");

  const full: DocValues = Object.fromEntries(fields.map((f) => [f.name, merged[f.name] ?? emptyValue(f)]));
  const next = latestNumber + 1;
  const markdown = doc.templateId ? valuesToMarkdown(doc.label, fields, full) : String(full.content ?? "");
  try {
    const ops = [
      // An older note gets its stored text recorded as version 1 the first time it is edited.
      ...(legacy ? [db.documentVersion.create({ data: { documentId: doc.id, version: 1, source: "model", values: latestValues, createdAt: doc.createdAt } })] : []),
      db.documentVersion.create({ data: { documentId: doc.id, version: next, source: "edit", values: full, authorUserId: actor.id } }),
      db.visitDocument.update({ where: { id: doc.id }, data: { markdown, draft: true } }),
    ];
    const res = (await db.$transaction(ops)) as { createdAt?: Date }[];
    const row = res[legacy ? 1 : 0];
    await audit(actor.email, "notes.document.version", `document ${doc.id} version ${next}`);
    return { version: next, createdAt: (row?.createdAt ?? new Date()).toISOString() };
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError(409, "stale_version");
    throw e;
  }
}

/** 400 bad_values, with the names of the offending fields so the editor can mark them. */
export class BadValues extends ApiError {
  constructor(public fields: string[]) {
    super(400, "bad_values");
  }
}

// ---- training export ----------------------------------------------------------------------------------------------

/**
 * One JSON object per template document that has a model version: the input the model was given, version 1 (model
 * output), the final version (clinician edits) and everything in between. THIS IS PHI (the transcript and clinical
 * values). It must not leave the practice's environment or be used to fine-tune anything until the BAA covering the
 * destination is confirmed and de-identification has been reviewed.
 */
export async function* trainingRecords() {
  let cursor: string | undefined;
  for (;;) {
    const docs = await db.visitDocument.findMany({
      where: { docType: { not: null } },
      orderBy: { id: "asc" },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { visit: true, fieldVersions: { orderBy: { version: "asc" } } },
    });
    if (!docs.length) return;
    for (const d of docs) {
      const vs = d.fieldVersions as VersionRow[];
      if (!vs.length || vs[0].source !== "model" || !d.templateId) continue;
      const fields = await schemaFor(d.templateId);
      const last = vs[vs.length - 1];
      // Name, dates and provider are written by the system, not the model: leaving them out keeps the patient's name
      // out of the file and the comparison about the model's own work.
      const clinical = (v: unknown) => Object.fromEntries(Object.entries(v as DocValues).filter(([k]) => !isSystemField(k)));
      yield {
        documentId: d.id,
        visitId: d.visitId,
        docType: d.docType,
        templateId: d.templateId,
        input: {
          transcript: d.visit.transcript,
          appointmentType: d.visit.appointmentType,
          visitDate: d.visit.visitDate,
          fields: fields.map((f) => ({ name: f.name, label: f.label, type: f.type, ...(f.options ? { options: f.options } : {}) })),
          systemFilledFields: fields.filter((f) => isSystemField(f.name)).map((f) => f.name),
        },
        modelOutput: { version: vs[0].version, createdAt: vs[0].createdAt.toISOString(), values: clinical(vs[0].values) },
        final: { version: last.version, source: last.source, createdAt: last.createdAt.toISOString(), authorUserId: last.authorUserId, values: clinical(last.values) },
        edited: vs.length > 1,
        intermediateVersions: vs.slice(1, -1).map((v) => ({ version: v.version, createdAt: v.createdAt.toISOString(), authorUserId: v.authorUserId, values: clinical(v.values) })),
      };
    }
    cursor = docs[docs.length - 1].id;
  }
}

export async function trainingJsonl(): Promise<{ body: string; count: number }> {
  const lines: string[] = [];
  for await (const r of trainingRecords()) lines.push(JSON.stringify(r));
  return { body: lines.length ? `${lines.join("\n")}\n` : "", count: lines.length };
}
