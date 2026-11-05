"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { flash, str } from "@/lib/flash";
import { createFeedback, FeedbackError, updateFeedback } from "@/lib/feedback/service";

const BASE = "/feedback";

function body(form: FormData) {
  return { kind: str(form, "kind"), title: str(form, "title"), description: typeof form.get("description") === "string" ? (form.get("description") as string) : "" };
}

const message = (e: FeedbackError) => (e.code === "possible_phi" ? "This looks like it contains patient information. Remove it and try again." : e.code === "forbidden" ? "Only the author can edit this." : e.code === "not_found" ? "That item no longer exists." : e.code);

export async function submitFeedback(form: FormData) {
  const user = await requireUser();
  try {
    await createFeedback(user, body(form), "web");
  } catch (e) {
    if (e instanceof FeedbackError) flash(BASE, "error", message(e));
    throw e;
  }
  revalidatePath(BASE);
  flash(BASE, "notice", "Thank you. Your feedback was added.");
}

export async function editFeedback(form: FormData) {
  const user = await requireUser();
  try {
    await updateFeedback(user, str(form, "id"), body(form), "web");
  } catch (e) {
    if (e instanceof FeedbackError) flash(BASE, "error", message(e));
    throw e;
  }
  revalidatePath(BASE);
  flash(BASE, "notice", "Saved.");
}
