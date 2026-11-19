import { db } from "@/lib/db";
import { missingDefaults, type RefKind } from "./defaults";

/** Active items of one list, in the admin's order, for dropdowns. */
export async function refItems(kind: RefKind) {
  return db.refItem.findMany({ where: { kind, active: true }, orderBy: [{ sortOrder: "asc" }, { value: "asc" }] });
}

/** Adds the starting items that are not there yet. Never changes or removes anything. Returns how many were added. */
export async function loadStartingLists(): Promise<number> {
  const existing = await db.refItem.findMany({ select: { kind: true, value: true, sortOrder: true } });
  const add = missingDefaults(existing);
  const next = new Map<string, number>();
  for (const e of existing) next.set(e.kind, Math.max(next.get(e.kind) ?? 0, e.sortOrder + 1));
  for (const a of add) {
    const order = next.get(a.kind) ?? 0;
    next.set(a.kind, order + 1);
    await db.refItem.create({ data: { kind: a.kind, value: a.value, docType: a.docType ?? null, nonBillable: a.nonBillable ?? false, sortOrder: order } });
  }
  return add.length;
}
