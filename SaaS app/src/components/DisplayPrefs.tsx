"use client";

import { useEffect, useState } from "react";
import { applyPrefs, readPrefs, savePrefs, type Prefs } from "@/lib/prefs";

export function DisplayPrefs() {
  const [p, setP] = useState<Prefs>({ compact: false, privacy: false });
  useEffect(() => { const v = readPrefs(); setP(v); applyPrefs(v); }, []);
  const set = (next: Prefs) => { setP(next); savePrefs(next); };
  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <h2 style={{ marginTop: 0 }}>This browser</h2>
      <p className="muted small">These two switches apply to this browser only and take effect straight away.</p>
      <label className="theme-option">
        <input type="checkbox" checked={p.compact} onChange={(e) => set({ ...p, compact: e.target.checked })} />
        <span><strong>Compact</strong><span className="muted small"> Tighter rows, so more fits on screen.</span></span>
      </label>
      <label className="theme-option" style={{ marginTop: ".5rem" }}>
        <input type="checkbox" checked={p.privacy} onChange={(e) => set({ ...p, privacy: e.target.checked })} />
        <span><strong>Privacy mode</strong><span className="muted small"> Patient names show as initials. Useful when others can see your screen.</span></span>
      </label>
    </div>
  );
}
