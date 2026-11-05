// Thin client for the visit-document endpoints (contract agreed with the backend branch). This is the ONLY file that
// knows the URLs or the wire format: if the web app ends up calling server actions instead of routes, swap
// `request` and nothing else changes.

export type DocType = { id: string; label: string; default: boolean };
export type DocSummary = { id: string; docType: string; title: string; latestVersion: number; updatedAt?: string };
export type FieldType = "text" | "longtext" | "checkbox" | "select" | "date";
export type FieldDef = { name: string; label: string; type: FieldType; options?: string[] };
export type VersionInfo = { version: number; source: string; createdAt: string; authorName?: string | null };
export type FieldValues = Record<string, unknown>;
export type DocumentDetail = {
  id: string; docType: string; title: string; fields: FieldDef[]; versions: VersionInfo[];
  current: { version: number; values: FieldValues };
};
export type GenerateResult = { documents: DocSummary[]; errors?: { docType: string; error: string }[] };

export class DocApiError extends Error {
  constructor(public status: number, public code: string, public body?: Record<string, unknown>) {
    super(code);
  }
}

export const DOCS_BASE = "/api/notes";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${DOCS_BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    credentials: "same-origin",
  });
  let body: Record<string, unknown> | undefined;
  try { body = (await res.json()) as Record<string, unknown>; } catch { body = undefined; }
  if (!res.ok) throw new DocApiError(res.status, typeof body?.error === "string" ? body.error : `http_${res.status}`, body);
  return body as T;
}

const v = (id: string) => `/visits/${encodeURIComponent(id)}`;

export const docsApi = {
  docTypes: (appointmentType: string) =>
    request<{ docTypes: DocType[] }>(`/doc-types?appointmentType=${encodeURIComponent(appointmentType)}`).then((r) => r.docTypes),
  generate: (visitId: string, docTypes?: string[]) =>
    request<GenerateResult>(`${v(visitId)}/generate`, { method: "POST", body: JSON.stringify(docTypes ? { docTypes } : {}) }),
  list: (visitId: string) => request<{ documents: DocSummary[] }>(`${v(visitId)}/documents`).then((r) => r.documents),
  get: (visitId: string, docId: string, version?: number) =>
    request<DocumentDetail>(`${v(visitId)}/documents/${encodeURIComponent(docId)}${version ? `?version=${version}` : ""}`),
  saveVersion: (visitId: string, docId: string, baseVersion: number, values: FieldValues) =>
    request<{ version: number; createdAt: string }>(`${v(visitId)}/documents/${encodeURIComponent(docId)}/versions`, {
      method: "POST", body: JSON.stringify({ baseVersion, values }),
    }),
  pdfUrl: (visitId: string, docId: string, version?: number) =>
    `${DOCS_BASE}${v(visitId)}/documents/${encodeURIComponent(docId)}/pdf${version ? `?version=${version}` : ""}`,
};
export type DocsApi = typeof docsApi;
