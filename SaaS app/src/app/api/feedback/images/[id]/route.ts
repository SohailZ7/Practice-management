import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

// A feedback screenshot. Any signed-in user can see it (the same people who can read the item). Served as the type we checked on upload.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  await requireUser();
  const f = await db.feedbackImage.findUnique({ where: { id: params.id } });
  if (!f) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return new NextResponse(new Uint8Array(f.data), {
    headers: { "content-type": f.mime, "content-disposition": `inline; filename="${f.name}"`, "x-content-type-options": "nosniff", "cache-control": "private, no-store", "content-security-policy": "default-src 'none'; sandbox" },
  });
}

// Only the item's author can remove a screenshot.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  const f = await db.feedbackImage.findUnique({ where: { id: params.id }, select: { id: true, item: { select: { authorId: true } } } });
  if (!f) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (f.item.authorId !== user.id) return NextResponse.json({ error: "Only the author can remove a screenshot." }, { status: 403 });
  await db.feedbackImage.delete({ where: { id: f.id } });
  return NextResponse.json({ ok: true });
}
