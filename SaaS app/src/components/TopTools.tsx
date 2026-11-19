"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_PREFS, applyPrefs, readPrefs, savePrefs, type Prefs } from "@/lib/prefs";

export type Cmd = { label: string; href: string; hint?: string };

/** Top-bar tools: Cmd/Ctrl-K go-to palette (navigation only, never patient data) and the privacy-mode switch. */
export function TopTools({ commands }: { commands: Cmd[] }) {
  const router = useRouter();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sync = () => { const p = readPrefs(); setPrefs(p); applyPrefs(p); };
    sync();
    window.addEventListener("bb-prefs", sync);
    return () => window.removeEventListener("bb-prefs", sync);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);

  const list = commands.filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase()));
  const go = (c?: Cmd) => { if (!c) return; setOpen(false); router.push(c.href); };

  return (
    <>
      <button type="button" className="cmdk-btn" onClick={() => setOpen(true)} aria-label="Open the go-to menu (Command K)">
        <span>Go to…</span><kbd>⌘K</kbd>
      </button>
      <button type="button" className={prefs.privacy ? "icon-sq on" : "icon-sq"} aria-pressed={prefs.privacy} aria-label={prefs.privacy ? "Privacy mode on, names hidden. Turn off" : "Privacy mode off, names shown. Turn on"} title="Privacy mode" onClick={() => savePrefs({ ...prefs, privacy: !prefs.privacy })}>
        {prefs.privacy ? "◐" : "◉"}
      </button>
      {open && (
        <div className="cmdk-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="cmdk" role="dialog" aria-modal="true" aria-label="Go to">
            <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} placeholder="Go to a screen…" aria-label="Go to a screen"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, list.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
                else if (e.key === "Enter") { e.preventDefault(); go(list[sel]); }
              }} />
            <ul role="listbox">
              {list.length === 0 && <li className="muted">Nothing matches. Patient search is not available here by design.</li>}
              {list.map((c, i) => (
                <li key={c.href + c.label} role="option" aria-selected={i === sel} className={i === sel ? "on" : ""} onMouseEnter={() => setSel(i)} onClick={() => go(c)}>
                  <span>{c.label}</span>{c.hint && <span className="muted small">{c.hint}</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
