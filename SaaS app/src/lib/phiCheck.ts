import { db } from "./db";
import { audit } from "./audit";
import { detectPhi, phiBlock, type PhiBlock } from "./phiGuard";
import type { CurrentUser } from "./session";

/**
 * Task titles and notes are free text and staff will paste patient details. When the text looks like it holds an
 * identifier, refuse unless the user ticked "I confirm this contains no patient information". Only the kinds found are
 * audited, never the text.
 */
export async function phiCheck(user: CurrentUser, taskId: string | null, texts: string[], confirmed: boolean, label = "task"): Promise<PhiBlock | null> {
  const text = texts.filter(Boolean).join("\n");
  let ignoreEmails: string[] = [];
  if (text.includes("@")) {
    const [users, employees] = await Promise.all([
      db.user.findMany({ select: { email: true } }),
      db.employee.findMany({ where: { email: { not: null } }, select: { email: true } }),
    ]);
    ignoreEmails = [...users.map((u) => u.email), ...employees.map((e) => e.email!)];
  }
  const findings = detectPhi(text, { ignoreEmails });
  if (findings.length === 0) return null;
  const kinds = findings.map((f) => f.kind).join(",");
  const ref = taskId ? `${label} ${taskId}` : `new ${label}`;
  if (confirmed) {
    await audit(user.email, `${label}.phi_confirmed`, `${ref}: ${kinds}`);
    return null;
  }
  await audit(user.email, `${label}.phi_blocked`, `${ref}: ${kinds}`);
  return phiBlock(findings);
}
