import { NextResponse } from "next/server";
import { rejectCrossOrigin } from "@/lib/security/origin";
import { listSheets } from "@/lib/import/workbook";
import { audit, clip } from "@/lib/audit";
import { readUpload, requireImportUser } from "@/lib/import/api";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const cross = rejectCrossOrigin(req);
  if (cross) return cross;
  const auth = await requireImportUser();
  if ("error" in auth) return auth.error;
  const upload = await readUpload(req);
  if ("error" in upload) return upload.error;
  try {
    const sheets = await listSheets(await upload.file.arrayBuffer());
    await audit(auth.user.email, "import.sheets", `${clip(upload.file.name)}: ${sheets.length} sheet(s)`);
    return NextResponse.json({ sheets });
  } catch {
    return NextResponse.json({ error: "Could not read that workbook" }, { status: 400 });
  }
}
