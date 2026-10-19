"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { THEMES, normalizeTheme } from "@/lib/theme";
import { flash, str } from "@/lib/flash";

export async function saveTheme(form: FormData) {
  const user = await requireUser();
  const raw = str(form, "theme");
  if (!(THEMES as readonly string[]).includes(raw)) flash("/settings", "error", "Choose Light, Dark or System.");
  await db.user.update({ where: { id: user.id }, data: { theme: normalizeTheme(raw) } });
  revalidatePath("/", "layout");
  flash("/settings", "notice", "Theme saved.");
}
