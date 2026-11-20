// Who can see whose tasks. Pure so it is easy to test.
//
// - The Admin sees every employee's tasks and can change them.
// - Everyone else sees their own tasks and can change them, and can see the tasks of the employees the Admin
//   has granted them (TaskViewer), read-only or, when the grant's level is "edit", editable too (TSK-59).

export type TaskScopeInput = {
  isAdmin: boolean;
  /** The signed-in user's own employee id, if their login is linked to an employee. */
  meId: string | null;
  /** Employee ids the Admin granted this user read-only access to. */
  grantedIds: string[];
  /** Every active employee id. */
  allIds: string[];
};

/** Employee ids whose task lists this user may open, own first. */
export function viewableEmployeeIds({ isAdmin, meId, grantedIds, allIds }: TaskScopeInput): string[] {
  if (isAdmin) return allIds;
  const out: string[] = [];
  if (meId && allIds.includes(meId)) out.push(meId);
  for (const id of grantedIds) if (id !== meId && allIds.includes(id) && !out.includes(id)) out.push(id);
  return out;
}

/** Which employee's list to show: the requested one if allowed, otherwise the user's own. */
export function pickEmployee(requested: string | undefined, allowed: string[], meId: string | null): string | null {
  if (requested && allowed.includes(requested)) return requested;
  return meId && allowed.includes(meId) ? meId : (allowed[0] ?? null);
}

/**
 * Changing tasks needs edit access to Tasks, and for non-admins it only applies to their own list or a list
 * the Admin granted them edit access to (`editableIds`).
 */
export function canEditBoard(o: {
  isAdmin: boolean;
  moduleEdit: boolean;
  meId: string | null;
  selected: string | null;
  editableIds?: string[];
}): boolean {
  if (!o.moduleEdit) return false;
  if (o.isAdmin) return true;
  if (o.selected === null) return false;
  return o.selected === o.meId || (o.editableIds ?? []).includes(o.selected);
}

export type TabGrant = { employeeId: string; level: string };

/** Employee ids a non-admin may edit besides their own: grants of level "edit" on tabs that still exist. */
export function editableGrantIds(grants: TabGrant[], tabIds: string[], meId: string | null): string[] {
  return grants.filter((g) => g.level === "edit" && g.employeeId !== meId && tabIds.includes(g.employeeId)).map((g) => g.employeeId);
}

/**
 * May this user hand a task to `targetId` (null = Unassigned)? Only to someone who has a tab; Unassigned is the
 * Admin's. (TSK-60) Whether they can edit the task being moved is checked separately.
 */
export function canAssignTo(o: { isAdmin: boolean; targetId: string | null; tabIds: string[] }): boolean {
  if (o.targetId === null) return o.isAdmin;
  return o.tabIds.includes(o.targetId);
}

export type MoveKind = "assigned" | "created-for" | "tab-removed";

/**
 * Sohail's rule (2026-11-19): everyone sees everyone's tasks. Admin (and anyone the Admin granted "edit" on that person's
 * tab) changes everything. On their OWN tasks others change status and Today; on any task they may hand it to another
 * person with a tab (assign). Titles, dates, notes, priority, links and deleting need the Admin.
 */
export type TaskLevel = "full" | "own" | "assign" | "none";
export function taskLevel(o: { isAdmin: boolean; moduleEdit: boolean; meId: string | null; editIds: string[]; assigneeId: string | null }): TaskLevel {
  if (!o.moduleEdit) return "none";
  if (o.isAdmin) return "full";
  if (o.assigneeId && o.editIds.includes(o.assigneeId)) return "full";
  if (o.assigneeId && o.assigneeId === o.meId) return "own";
  return "assign";
}
const PATCH_KEYS: Record<TaskLevel, readonly string[] | "all"> = {
  full: "all",
  own: ["status", "completed", "inToday", "assigneeId"],
  assign: ["assigneeId"],
  none: [],
};
/** Keys of a patch this level may not change (empty = fine). */
export function blockedPatchKeys(level: TaskLevel, patch: Record<string, unknown>): string[] {
  const ok = PATCH_KEYS[level];
  return ok === "all" ? [] : Object.keys(patch).filter((k) => patch[k] !== undefined && !ok.includes(k));
}
