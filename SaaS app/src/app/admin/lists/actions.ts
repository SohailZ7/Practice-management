"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/session";
import { bool, flash, str } from "@/lib/flash";
import { isRefKind } from "@/lib/refLists/defaults";
import { loadStartingLists } from "@/lib/refLists/service";

const BACK = "/admin/lists";

export async function loadStarting() {
  const admin = await requireAdmin();
  const n = await loadStartingLists();
  await audit(admin.email, "reflist.load_starting", `${n} item(s) added`);
  revalidatePath(BACK);
  flash(BACK, "notice", n ? `Added ${n} starting item(s).` : "Starting lists are already loaded.");
}

export async function addRefItem(form: FormData) {
  const admin = await requireAdmin();
  const kind = str(form, "kind");
  const value = str(form, "value");
  if (!isRefKind(kind)) flash(BACK, "error", "Unknown list.");
  if (!value) flash(BACK, "error", "Enter a value.");
  if (await db.refItem.findFirst({ where: { kind, value: { equals: value, mode: "insensitive" } } })) flash(BACK, "error", "That item is already in the list.");
  const last = await db.refItem.aggregate({ where: { kind }, _max: { sortOrder: true } });
  const created = await db.refItem.create({ data: { kind, value, docType: kind === "charge_code" ? str(form, "docType") || null : null, nonBillable: kind === "charge_code" && bool(form, "nonBillable"), sortOrder: (last._max.sortOrder ?? -1) + 1 } });
  await audit(admin.email, "reflist.add", `${kind} ${created.id}`);
  revalidatePath(BACK);
  flash(BACK, "notice", `Added ${value}.`);
}

export async function saveRefItem(form: FormData) {
  const admin = await requireAdmin();
  const id = str(form, "id");
  const value = str(form, "value");
  if (!value) flash(BACK, "error", "Value cannot be blank.");
  const item = await db.refItem.findUnique({ where: { id } });
  if (!item) flash(BACK, "error", "Item not found.");
  const dup = await db.refItem.findFirst({ where: { kind: item.kind, value: { equals: value, mode: "insensitive" }, NOT: { id } } });
  if (dup) flash(BACK, "error", "Another item already uses that value.");
  // Old visits keep the text they were saved with; only new rows see the new name.
  await db.refItem.update({ where: { id }, data: { value, active: bool(form, "active"), ...(item.kind === "charge_code" ? { docType: str(form, "docType") || null, nonBillable: bool(form, "nonBillable") } : {}) } });
  await audit(admin.email, "reflist.save", `${item.kind} ${id}`);
  revalidatePath(BACK);
  flash(BACK, "notice", "Saved.");
}
