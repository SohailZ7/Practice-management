// Who can see whose tasks. Pure so it is easy to test.
//
// - The Admin sees every employee's tasks and can change them.
// - Everyone else sees their own tasks and can change them, and can see (read-only) the tasks of the
//   employees the Admin has granted them (TaskViewer).

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

/** Changing tasks needs edit access to Tasks, and for non-admins it only applies to their own list. */
export function canEditBoard(o: { isAdmin: boolean; moduleEdit: boolean; meId: string | null; selected: string | null }): boolean {
  if (!o.moduleEdit) return false;
  return o.isAdmin || (o.selected !== null && o.selected === o.meId);
}
