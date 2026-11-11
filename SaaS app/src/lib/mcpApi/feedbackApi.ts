// Shapes for the feedback API. Only these fields leave the app: no author, no email, nothing that could hold PHI
// beyond the title/description/test notes, which are checked for patient information when they are written.
import type { WorkflowActor } from "../feedback/service";
import type { FeedbackOut } from "../feedback/rules";

export const feedbackShape = (i: FeedbackOut) => ({
  id: i.id, kind: i.kind, title: i.title, description: i.description, status: i.status, scope: i.scope,
  testNotes: i.testNotes, ownerApproved: i.ownerApproved, release: i.release, createdAt: i.createdAt, updatedAt: i.updatedAt,
});

/** The token's user, acting as the agent: never an admin or approver, whoever owns the token. */
export const agentActor = (u: { email: string; name: string }): WorkflowActor => ({ kind: "agent", isAdmin: false, isApprover: false, email: u.email, name: "Agent" });
