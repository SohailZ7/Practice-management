import { initialsFor } from "@/lib/prefs";

/**
 * THE way to show a patient name. Pass `fullName` only when the viewer may see it (canSeeFullNames); the browser shows
 * initials unless "See full names" is on, and Privacy mode always wins. Works in server and client components (CSS only).
 */
export function PatientName({ initials, fullName }: { initials?: string; fullName?: string | null }) {
  const ini = initials || (fullName ? initialsFor(fullName) : "?");
  if (!fullName) return <>{ini}</>;
  return <span className="pname" data-initials={ini}>{fullName}</span>;
}
