import { db } from "@/lib/db";
import { ApiError, authenticate, handle, json } from "@/lib/desktop/api";

export const dynamic = "force-dynamic";

/** One document's full text, for the recorder's note viewer. */
export const GET = (req: Request, { params }: { params: { id: string; docId: string } }) =>
  handle(async () => {
    await authenticate(req, { module: "notes", level: "view" });
    const doc = await db.visitDocument.findFirst({ where: { id: params.docId, visitId: params.id } });
    if (!doc) throw new ApiError(404, "not_found");
    return json({ id: doc.id, title: doc.label, content: doc.markdown, createdAt: doc.createdAt.toISOString() });
  })(req);
