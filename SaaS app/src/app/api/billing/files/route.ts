import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { audit } from "@/lib/audit";

const MAX = 5 * 1024 * 1024;
const safeName = (n: string) => n.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "file";

// POST multipart: file + optional note. Needs Billing edit. Stored in the database (BillingFile); 5 MB each.
export async function POST(req: Request) {
  const user = await requireAccess("billing", "edit");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a file." }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: "That file is over 5 MB." }, { status: 413 });
  const note = typeof form?.get("note") === "string" ? String(form?.get("note")).slice(0, 200) : "";
  const row = await db.billingFile.create({
    data: { name: safeName(file.name), mime: file.type || "application/octet-stream", size: file.size, data: Buffer.from(await file.arrayBuffer()), note, uploadedByEmail: user.email },
    select: { id: true },
  });
  await audit(user.email, "billing.file.upload", `file ${row.id} bytes=${file.size}`);
  return NextResponse.json({ ok: true, id: row.id });
}
