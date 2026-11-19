import { initialsFor } from "@/lib/prefs";

/** A patient name that turns into initials when Privacy mode is on (CSS only, so it also covers server-rendered pages). */
export function Phi({ name }: { name: string }) {
  return <span className="phi" data-initials={initialsFor(name)}>{name}</span>;
}
