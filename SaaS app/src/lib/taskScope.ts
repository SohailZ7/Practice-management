import { db } from "./db";
import { editableGrantIds, viewableEmployeeIds } from "./taskAccess";
import type { CurrentUser } from "./session";

/**
 * Who a signed-in user can see and edit under Tasks, decided on the server (TSK-6, TSK-59).
 * `tabs` are the employees that have a task tab; everything else is derived from them.
 */
export async function loadTaskScope(user: CurrentUser) {
  const isAdmin = user.role === "ADMIN";
  const [tabs, me, grants] = await Promise.all([
    db.employee.findMany({ where: { active: true, taskTab: true }, orderBy: { name: "asc" } }),
    db.employee.findUnique({ where: { email: user.email } }),
    isAdmin ? Promise.resolve([]) : db.taskViewer.findMany({ where: { userId: user.id }, select: { employeeId: true, level: true } }),
  ]);
  const tabIds = tabs.map((e) => e.id);
  const meId = me?.id ?? null;
  const viewIds = viewableEmployeeIds({ isAdmin, meId, grantedIds: grants.map((g) => g.employeeId), allIds: tabIds });
  const editIds = isAdmin ? tabIds : editableGrantIds(grants, tabIds, meId).filter((id) => viewIds.includes(id));
  return { isAdmin, tabs, tabIds, me, meId, viewIds, editIds };
}
