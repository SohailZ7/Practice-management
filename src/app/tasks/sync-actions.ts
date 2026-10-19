"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { syncFromTodoApp, type SyncResult } from "@/lib/todoSyncService";

/** Admin only. Copies the Todo App's "B & BC" list into the signed-in admin's own tasks (one-way). */
export async function syncTodoApp(): Promise<SyncResult & { at: string }> {
  const admin = await requireAdmin();
  const me = await db.employee.findUnique({ where: { email: admin.email }, select: { id: true } });
  if (!me) throw new Error("Your login isn't linked to an employee record.");
  const result = await syncFromTodoApp(me.id, admin.email);
  revalidatePath("/tasks", "layout");
  return { ...result, at: new Date().toISOString() };
}
