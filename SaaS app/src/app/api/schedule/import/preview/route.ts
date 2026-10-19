import { NextResponse } from "next/server";
import { logError } from "@/lib/safeLog";
import { rejectCrossOrigin } from "@/lib/security/origin";
import { db } from "@/lib/db";
import { readGrid } from "@/lib/import/workbook";
import { parseOutpatientBoard } from "@/lib/import/outpatientBoard";
import { buildPreview, purgeStaleDrafts } from "@/lib/import/service";
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

  const sheet = upload.form.get("sheet");
  if (typeof sheet !== "string" || !sheet) {
    return NextResponse.json({ error: "Choose a sheet" }, { status: 400 });
  }

  try {
    const grid = await readGrid(await upload.file.arrayBuffer(), sheet);
    const parsed = parseOutpatientBoard(grid);
    if (parsed.entries.length === 0 && parsed.providers.length === 0) {
      return NextResponse.json(
        { error: "Nothing importable found on that sheet.", warnings: parsed.warnings },
        { status: 422 },
      );
    }

    await purgeStaleDrafts();
    const draft = await db.importDraft.create({
      data: {
        userEmail: auth.user.email,
        fileName: upload.file.name,
        sheet,
        payload: JSON.stringify(parsed),
      },
    });
    const preview = await buildPreview(parsed);
    await audit(
      auth.user.email,
      "import.preview",
      `${clip(upload.file.name)} / ${clip(sheet, 60)}: ${preview.counts.new} new, ${preview.counts.duplicates} duplicates, ${preview.counts.skipped} skipped, draft ${draft.id}`,
    );
    return NextResponse.json({ draftId: draft.id, ...preview });
  } catch (err) {
    logError("import preview failed", err);
    return NextResponse.json({ error: "Could not read that sheet" }, { status: 400 });
  }
}
