"use client";
import { useEffect, useState } from "react";
import { readPrefs } from "@/lib/prefs";
import { nameLabel } from "@/lib/fullNames";

/** For client components that need the label as a string (tooltips, file names). Same switch as <PatientName>. */
export function useShowFullNames(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => { const p = readPrefs(); setOn(p.fullNames && !p.privacy); };
    sync();
    window.addEventListener("bb-prefs", sync);
    return () => window.removeEventListener("bb-prefs", sync);
  }, []);
  return on;
}
export { nameLabel };
