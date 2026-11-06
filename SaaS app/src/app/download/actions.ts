"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { isVersion } from "@/lib/release";

/** Hides the update banner for this version. A newer version shows it again. */
export async function dismissDesktopUpdate(form: FormData) {
  const user = await requireUser();
  const version = String(form.get("version") ?? "");
  if (!isVersion(version)) return;
  await db.user.update({ where: { id: user.id }, data: { desktopDismissedVersion: version } });
  revalidatePath("/", "layout");
}
