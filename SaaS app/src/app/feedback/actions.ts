"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { flash, str } from "@/lib/flash";
import { addFeedbackComment, createFeedback, FeedbackError, setFeedbackWorkflow, updateFeedback } from "@/lib/feedback/service";
import { workflowActor } from "@/lib/feedback/actor";
import { addFeedbackImages } from "@/lib/feedback/images";

const BASE = "/feedback";

function body(form: FormData) {
  return { kind: str(form, "kind"), title: str(form, "title"), description: typeof form.get("description") === "string" ? (form.get("description") as string) : "" };
}

const files = (form: FormData) => form.getAll("image").filter((f): f is File => f instanceof File);

const WF: Record<string, string> = {
  only_owner_can_triage: "Only the owner can triage an item.",
  only_owner_can_set_scope: "Only the owner can set the scope.",
  triage_required: "Choose a triage outcome: Accepted, Rejected or More info needed.",
  scope_required: "Choose a scope (Small UI change or Other) before accepting or building.",
  comment_required: "Write a comment first: what is needed, or what needs to change.",
  test_notes_required: "Test notes are required before On staging.",
  not_allowed: "You can't do that on this item.",
  possible_phi: "This looks like it contains patient information. Remove it and try again.",
  already_in_status: "It is already in that status.",
  nothing_to_change: "Nothing to change.",
  too_many_images: "An item can have up to 5 screenshots.",
  image_too_large: "Each screenshot must be under 3 MB.",
  not_an_image: "Screenshots must be PNG, JPEG, GIF or WebP images.",
};
const message = (e: FeedbackError) => (WF[e.code] ? WF[e.code] : e.code === "possible_phi" ? "This looks like it contains patient information. Remove it and try again." : e.code === "forbidden" ? "Only the author can edit this." : e.code === "not_found" ? "That item no longer exists." : e.code);

export async function submitFeedback(form: FormData) {
  const user = await requireUser();
  let id: string;
  try {
    id = (await createFeedback(user, body(form), "web")).id;
  } catch (e) {
    if (e instanceof FeedbackError) flash(BASE, "error", message(e));
    throw e;
  }
  let imageError = "";
  try {
    await addFeedbackImages(user, id, files(form));
  } catch (e) {
    if (!(e instanceof FeedbackError)) throw e;
    imageError = message(e);
  }
  revalidatePath(BASE);
  if (imageError) flash(BASE, "error", `Your feedback was added, but the screenshots were not: ${imageError} Use Add screenshot on the item to try again.`);
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
  const triage = str(form, "triage");
  try {
    await setFeedbackWorkflow(workflowActor(user), str(form, "id"), {
      ...(triage ? { triage } : { status }),
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

export async function addScreenshots(form: FormData) {
  const user = await requireUser();
  try {
    const n = await addFeedbackImages(user, str(form, "id"), files(form));
    if (n === 0) flash(BASE, "error", "Choose an image first.");
  } catch (e) {
    if (e instanceof FeedbackError) flash(BASE, "error", message(e));
    throw e;
  }
  revalidatePath(BASE);
  flash(BASE, "notice", "Screenshot added.");
}
