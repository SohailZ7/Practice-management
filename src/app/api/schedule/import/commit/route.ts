import { NextResponse } from "next/server";
import { commitImport, type CommitOptions, type NameDecision } from "@/lib/import/service";
import { requireImportUser } from "@/lib/import/api";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireImportUser();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => null)) as {
    draftId?: string;
    includeProviders?: boolean;
    overwriteZoomPassword?: boolean;
    mapping?: Record<string, NameDecision>;
  } | null;
  if (!body?.draftId) return NextResponse.json({ error: "Missing draft" }, { status: 400 });

  const options: CommitOptions = {
    includeProviders: body.includeProviders === true,
    overwriteZoomPassword: body.overwriteZoomPassword === true,
    mapping: body.mapping ?? {},
  };
  try {
    const result = await commitImport({ draftId: body.draftId, userEmail: auth.user.email, options });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    console.error("import commit failed", err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
