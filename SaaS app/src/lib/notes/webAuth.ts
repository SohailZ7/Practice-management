// Session (cookie) authentication for the web copies of the Notes document routes. Unlike requireAccess, which
// redirects, an API caller needs a status code.

import { ApiError } from "../desktop/api";
import { canAccess, canOpenAdmin, type Level } from "../access";
import { auditDenied, getCurrentUser } from "../session";

export async function webNotesAuth(_req: Request, need: { module: "notes"; level: Level }) {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "unauthorized");
  if (!canAccess(user, need.module, need.level)) {
    await auditDenied(user.email, `${need.module}:${need.level}`);
    throw new ApiError(403, "forbidden");
  }
  return user;
}

export async function webAdminAuth() {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "unauthorized");
  if (!canOpenAdmin(user)) {
    await auditDenied(user.email, "admin");
    throw new ApiError(403, "forbidden");
  }
  return user;
}
