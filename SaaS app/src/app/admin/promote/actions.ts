"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { flash } from "@/lib/flash";
import { PROMOTE_KINDS, isStaging, type PromoteKind } from "@/lib/promote/rules";
import { PromoteConfigError, promoteItems, setTestFlag } from "@/lib/promote/send";

const BASE = "/admin/promote";

/** Every action first refuses unless this is staging and the caller is an Admin. */
async function guard() {
  if (!isStaging()) notFound();
  return requireAdmin();
}

const kindOf = (form: FormData): PromoteKind => {
  const k = form.get("kind");
  if (typeof k !== "string" || !(PROMOTE_KINDS as readonly string[]).includes(k)) notFound();
  return k as PromoteKind;
};

const REASON: Record<string, string> = {
  test_item: "is marked as a test item",
  already_promoted: "was already promoted",
  recurring: "is a recurring task",
  synced: "was synced from the Todo App",
  phi_blocked: "looks like it has patient information",
  not_found: "no longer exists",
  unauthorized: "was refused (check the service key)",
  unreachable: "could not reach production",
};

export async function promote(form: FormData) {
  const user = await guard();
  const kind = kindOf(form);
  const ids = form.getAll("id").filter((v): v is string => typeof v === "string" && v.length > 0);
  if (ids.length === 0) flash(BASE, "error", "Select at least one item.");
  let results;
  try {
    results = await promoteItems(user.email, kind, ids);
  } catch (e) {
    if (e instanceof PromoteConfigError) flash(BASE, "error", e.message);
    throw e;
  }
  revalidatePath(BASE);
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    const why = Array.from(new Set(failed.map((f) => REASON[f.error ?? ""] ?? f.error))).join("; ");
    flash(BASE, "error", `${ok} promoted, ${failed.length} not: ${why}.`);
  }
  flash(BASE, "notice", `${ok} promoted to production.`);
}

export async function toggleTest(form: FormData) {
  const user = await guard();
  const id = form.get("id");
  if (typeof id !== "string" || !id) notFound();
  await setTestFlag(user.email, kindOf(form), id, form.get("isTest") === "true");
  revalidatePath(BASE);
}
