import { db } from "@/lib/db";
import { ApiError, authenticate, handle, json } from "@/lib/desktop/api";

export const dynamic = "force-dynamic";

/** The visit's documents, newest first (no text, just enough for a list). */
export const GET = (req: Request, { params }: { params: { id: string } }) =>
  handle(async () => {
    await authenticate(req, { module: "notes", level: "view" });
    const visit = await db.visit.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!visit) throw new ApiError(404, "not_found");
    const rows = await db.visitDocument.findMany({
      where: { visitId: params.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, label: true, kind: true, createdAt: true },
    });
    return json({ documents: rows.map((d) => ({ id: d.id, title: d.label, type: d.kind, createdAt: d.createdAt.toISOString() })) });
  })(req);
