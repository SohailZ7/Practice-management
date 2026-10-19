import { NextResponse } from "next/server";
import { auditDenied, getCurrentUser } from "../session";
import { canAccess } from "../access";

/** IMP-9: importing needs edit access to Schedule. Returns the user or a ready-made error response. */
export async function requireImportUser() {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) } as const;
  if (!canAccess(user, "schedule", "edit")) {
    await auditDenied(user.email, "schedule:edit (import API)");
    return { error: NextResponse.json({ error: "No access" }, { status: 403 }) } as const;
  }
  return { user } as const;
}

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

export async function readUpload(req: Request): Promise<{ file: File; form: FormData } | { error: NextResponse }> {
  const form = await req.formData().catch(() => null);
  if (!form) return { error: NextResponse.json({ error: "Upload a .xlsx file" }, { status: 400 }) };
  const file = form.get("file");
  if (!(file instanceof File)) return { error: NextResponse.json({ error: "No file uploaded" }, { status: 400 }) };
  if (!/\.xlsx$/i.test(file.name)) {
    return { error: NextResponse.json({ error: "Only .xlsx files are supported" }, { status: 400 }) };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: NextResponse.json({ error: "File is larger than 30 MB" }, { status: 413 }) };
  }
  return { file, form };
}
