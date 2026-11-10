"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { flash, str } from "@/lib/flash";
import { addFeedbackComment, createFeedback, FeedbackError, setFeedbackWorkflow, updateFeedback } from "@/lib/feedback/service";
import { workflowActor } from "@/lib/feedback/actor";

const BASE = "/feedback";

function body(form: FormData) {
  return { kind: str(form, "kind"), title: str(form, "title"), description: typeof form.get("description") === "string" ? (form.get("description") as string) : "" };
}

const WF: Record<string, string> = {
  only_owner_can_build_it: "Only the owner can mark an item Build it.",
  only_owner_can_set_scope: "Only the owner can set the scope.",
  scope_required: "Choose a scope (Small UI change or Other) before Build it.",
  comment_required: "Write what needs to change in the comment box.",
  test_notes_required: "Test notes are required before On staging.",
  not_allowed: "You can't do that on this item.",
  possible_phi: "This looks like it contains patient information. Remove it and try again.",
  already_in_status: "It is already in that status.",
  nothing_to_change: "Nothing to change.",
};
const message = (e: FeedbackError) => (WF[e.code] ? WF[e.code] : e.code === "possible_phi" ? "This looks like it contains patient information. Remove it and try again." : e.code === "forbidden" ? "Only the author can edit this." : e.code === "not_found" ? "That item no longer exists." : e.code);

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

export async function moveFeedback(form: FormData) {
  const user = await requireUser();
  const status = str(form, "status");
  try {
    await setFeedbackWorkflow(workflowActor(user), str(form, "id"), {
      status,
      ...(str(form, "scope") ? { scope: str(form, "scope") } : {}),
      ...(str(form, "comment") ? { comment: str(form, "comment") } : {}),
    });
  } catch (e) {
    if (e instanceof FeedbackError) flash(BASE, "error", message(e));
    throw e;
  }
  revalidatePath(BASE);
  flash(BASE, "notice", "Updated.");
}

export async function saveTestNotes(form: FormData) {
  const user = await requireUser();
  try {
    await setFeedbackWorkflow(workflowActor(user), str(form, "id"), { testNotes: typeof form.get("testNotes") === "string" ? form.get("testNotes") : "" });
  } catch (e) {
    if (e instanceof FeedbackError) flash(BASE, "error", message(e));
    throw e;
  }
  revalidatePath(BASE);
  flash(BASE, "notice", "Test notes saved.");
}

export async function commentOnFeedback(form: FormData) {
  const user = await requireUser();
  try {
    await addFeedbackComment(workflowActor(user), str(form, "id"), typeof form.get("comment") === "string" ? form.get("comment") : "");
  } catch (e) {
    if (e instanceof FeedbackError) flash(BASE, "error", message(e));
    throw e;
  }
  revalidatePath(BASE);
  flash(BASE, "notice", "Comment added.");
}
