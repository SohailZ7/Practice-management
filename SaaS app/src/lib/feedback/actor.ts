import type { CurrentUser } from "../session";
import type { WorkflowActor } from "./service";

/** The signed-in person as a workflow actor. Admins can approve too; others only with the Feedback approver flag. */
export const workflowActor = (u: Pick<CurrentUser, "id" | "email" | "name" | "role" | "feedbackApprover">): WorkflowActor & { id: string } => ({
  id: u.id, kind: "user", email: u.email, name: u.name, isAdmin: u.role === "ADMIN", isApprover: u.role === "ADMIN" || u.feedbackApprover,
});
