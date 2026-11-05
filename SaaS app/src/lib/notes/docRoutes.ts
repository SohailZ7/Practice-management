// Route handlers for template documents, built once and mounted twice: under /api/desktop/v1 (desktop token) and under
// /api/notes (web session). They differ only in how the caller is identified; the Notes access levels are the same.

import { NextResponse } from "next/server";
import { ApiError, json, readJson } from "../desktop/api";
import {
  BadValues, documentPdf, generateDocs, getDocument, listDocTypes, listDocuments, saveVersion, trainingJsonl, type Actor,
} from "./docService";
import type { Level } from "../access";

export type NotesAuth = (req: Request, need: { module: "notes"; level: Level }) => Promise<Actor>;
type Ctx = { params: { id: string; docId: string } };

function wrap(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof BadValues) return json({ error: e.code, fields: e.fields }, 400);
      if (e instanceof ApiError) return json({ error: e.code }, e.status);
      console.error("notes documents error"); // never log the error text: it may echo patient values
      return json({ error: "server_error" }, 500);
    }
  };
}

export function docRoutes(auth: NotesAuth) {
  const view = { module: "notes", level: "view" } as const;
  const edit = { module: "notes", level: "edit" } as const;
  return {
    docTypes: (req: Request) =>
      wrap(async () => {
        await auth(req, view);
        return json(listDocTypes(new URL(req.url).searchParams.get("appointmentType") ?? ""));
      })(req),

    generate: (req: Request, { params }: { params: { id: string } }) =>
      wrap(async () => {
        const actor = await auth(req, edit);
        const text = await req.text();
        let body: Record<string, unknown> = {};
        if (text.trim()) {
          try {
            const v = JSON.parse(text);
            if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
            body = v;
          } catch {
            throw new ApiError(400, "bad_request");
          }
        }
        return json(await generateDocs(actor, params.id, body.docTypes));
      })(req),

    list: (req: Request, { params }: { params: { id: string } }) =>
      wrap(async () => {
        await auth(req, view);
        return json(await listDocuments(params.id));
      })(req),

    one: (req: Request, { params }: Ctx) =>
      wrap(async () => {
        await auth(req, view);
        return json(await getDocument(params.id, params.docId, new URL(req.url).searchParams.get("version")));
      })(req),

    saveVersion: (req: Request, { params }: Ctx) =>
      wrap(async () => {
        const actor = await auth(req, edit);
        return json(await saveVersion(actor, params.id, params.docId, await readJson(req)), 201);
      })(req),

    pdf: (req: Request, { params }: Ctx) =>
      wrap(async () => {
        await auth(req, view);
        const { bytes, fileName } = await documentPdf(params.id, params.docId, new URL(req.url).searchParams.get("version"));
        return new NextResponse(Buffer.from(bytes), {
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `inline; filename="${fileName.replace(/[^\w .-]/g, "_")}"`,
            "cache-control": "no-store",
          },
        });
      })(req),
  };
}

/** Admin-only export. PHI: see trainingRecords(). */
export async function trainingExportResponse(): Promise<Response> {
  const { body } = await trainingJsonl();
  return new NextResponse(body, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store", "content-disposition": 'attachment; filename="notes-training-export.jsonl"' },
  });
}
