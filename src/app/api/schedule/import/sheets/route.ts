import { NextResponse } from "next/server";
import { listSheets } from "@/lib/import/workbook";
import { readUpload, requireImportUser } from "@/lib/import/api";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireImportUser();
  if ("error" in auth) return auth.error;
  const upload = await readUpload(req);
  if ("error" in upload) return upload.error;
  try {
    const sheets = await listSheets(await upload.file.arrayBuffer());
    return NextResponse.json({ sheets });
  } catch {
    return NextResponse.json({ error: "Could not read that workbook" }, { status: 400 });
  }
}
