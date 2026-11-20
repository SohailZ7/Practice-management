"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/session";
import { MAX_BULK_ROWS, formDataFrom, resultFromRedirect, type BulkOutcome, type BulkRow, type RowResult } from "@/lib/adminBulk";
import { setTaskViewers, updatePerson } from "./actions";
import { updateTimesheetEntry, updateTimesheetPayment } from "./timesheets/actions";

type Applier = (form: FormData) => Promise<void>;

/** One entry per kind of row on an Admin tab. Each reuses that row's own Save action, so validation and the audit entry per change are identical. */
const APPLIERS: Record<string, Applier[]> = {
  // A person: login details, then module access (skipped for admins, whose selects are disabled and not submitted).
  people: [updatePerson],
  taskviewers: [setTaskViewers],
  tsEntry: [updateTimesheetEntry],
  tsPayment: [updateTimesheetPayment],
};

async function runOne(appliers: Applier[], form: FormData): Promise<RowResult> {
  let last: RowResult = { ok: true, message: "Saved." };
  for (const apply of appliers) {
    try {
      await apply(form);
      last = { ok: true, message: "Saved." };
    } catch (e) {
      const r = resultFromRedirect(e);
      if (!r) return { ok: false, message: "Could not save." };
      last = r;
      if (!r.ok) return r;
    }
  }
  return last;
}

/** Saves every changed row of an Admin tab in one go. Admin only. Rows are saved in order; one failing row does not stop the rest. */
export async function saveAllAction(rows: BulkRow[]): Promise<BulkOutcome> {
  const admin = await requireAdmin();
  const list = Array.isArray(rows) ? rows.slice(0, MAX_BULK_ROWS) : [];
  const out: BulkOutcome = { saved: 0, failed: [] };
  for (const [index, row] of list.entries()) {
    const appliers = APPLIERS[row?.kind];
    if (!appliers || !Array.isArray(row.fields)) {
      out.failed.push({ index, message: "Unknown row." });
      continue;
    }
    const r = await runOne(appliers, formDataFrom(row.fields));
    if (r.ok) out.saved++;
    else out.failed.push({ index, message: r.message });
  }
  // Counts only: each saved row already wrote its own audit entry.
  await audit(admin.email, "admin.bulk_save", `rows=${list.length} saved=${out.saved} failed=${out.failed.length}`);
  revalidatePath("/admin", "layout");
  revalidatePath("/employees");
  return out;
}
