import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { audit } from "@/lib/audit";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await requireAccess("billing", "view");
  const f = await db.billingFile.findUnique({ where: { id: params.id } });
  if (!f) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await audit(user.email, "billing.file.download", `file ${f.id}`);
  return new NextResponse(new Uint8Array(f.data), { headers: { "content-type": f.mime, "content-disposition": `attachment; filename="${f.name}"`, "x-content-type-options": "nosniff", "cache-control": "no-store" } });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await requireAccess("billing", "edit");
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Only an admin can remove files." }, { status: 403 });
  await db.billingFile.deleteMany({ where: { id: params.id } });
  await audit(user.email, "billing.file.delete", `file ${params.id}`);
  return NextResponse.json({ ok: true });
}
