import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { audit } from "@/lib/audit";
import { markdownToPrintableHtml } from "@/lib/notes/pdf";

/**
 * The printable copy of a document. It returns HTML with a print stylesheet rather than a PDF binary: the browser's
 * own "Save as PDF" produces the file, which avoids running a headless browser on the server just to render a page.
 */
export async function GET(_req: Request, { params }: { params: { documentId: string } }) {
  const user = await requireAccess("notes", "view");
  const doc = await db.visitDocument.findUnique({ where: { id: params.documentId } });
  if (!doc) return new NextResponse("Not found", { status: 404 });
  await audit(user.email, "notes.document.print", `document ${doc.id}`);
  return new NextResponse(markdownToPrintableHtml(doc.markdown, doc.label), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
