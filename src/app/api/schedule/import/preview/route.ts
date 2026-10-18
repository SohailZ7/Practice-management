import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readGrid } from "@/lib/import/workbook";
import { parseOutpatientBoard } from "@/lib/import/outpatientBoard";
import { buildPreview } from "@/lib/import/service";
import { readUpload, requireImportUser } from "@/lib/import/api";

export const runtime = "nodejs";

export async function POST(req: Request) {
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

    // Drop old drafts so uploaded client data is not kept around.
    await db.importDraft.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } },
    });
    const draft = await db.importDraft.create({
      data: {
        userEmail: auth.user.email,
        fileName: upload.file.name,
        sheet,
        payload: JSON.stringify(parsed),
      },
    });
    const preview = await buildPreview(parsed);
    return NextResponse.json({ draftId: draft.id, ...preview });
  } catch (err) {
    console.error("import preview failed", err);
    return NextResponse.json({ error: "Could not read that sheet" }, { status: 400 });
  }
}
