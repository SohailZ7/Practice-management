"use client";

import { useEffect, useState } from "react";
import { DEFAULT_PREFS, applyPrefs, readPrefs, savePrefs, type Prefs } from "@/lib/prefs";

export function DisplayPrefs({ canFullNames = false }: { canFullNames?: boolean }) {
  const [p, setP] = useState<Prefs>(DEFAULT_PREFS);
  useEffect(() => { const v = readPrefs(); setP(v); applyPrefs(v); }, []);
  const set = (next: Prefs) => { setP(next); savePrefs(next); };
  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <h2 style={{ marginTop: 0 }}>This browser</h2>
      <p className="muted small">These switches apply to this browser only and take effect straight away.</p>
      <label className="theme-option">
        <input type="checkbox" checked={p.compact} onChange={(e) => set({ ...p, compact: e.target.checked })} />
        <span><strong>Compact</strong><span className="muted small"> Tighter rows, so more fits on screen.</span></span>
      </label>
      <label className="theme-option" style={{ marginTop: ".5rem" }}>
        <input type="checkbox" checked={p.privacy} onChange={(e) => set({ ...p, privacy: e.target.checked })} />
        <span><strong>Privacy mode</strong><span className="muted small"> Patient names show as initials. Useful when others can see your screen.</span></span>
      </label>
      {canFullNames && (
        <label className="theme-option" style={{ marginTop: ".5rem" }}>
          <input type="checkbox" checked={p.fullNames} onChange={(e) => set({ ...p, fullNames: e.target.checked })} />
          <span><strong>See full names</strong><span className="muted small"> Show full patient names instead of initials (same switch as the Desktop app). Privacy mode still wins.</span></span>
        </label>
      )}
    </div>
  );
}
