import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type MenuItem = { label: string; onClick: () => void; disabled?: boolean; title?: string; danger?: boolean };

/** The "…" menu of a visit row: the rare actions (transcript, promote, delete) behind one small button. Drawn on <body>
 *  so the table's rounded edge never clips it. */
export function RowMenu({ items, label = "More actions" }: { items: MenuItem[]; label?: string }) {
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("click", close); window.addEventListener("resize", close); window.addEventListener("scroll", close, true); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("click", close); window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); window.removeEventListener("keydown", key); };
  }, [at]);
  return (
    <>
      <button ref={btn} className="secondary menu-btn" aria-haspopup="menu" aria-expanded={!!at} aria-label={label} title={label}
        onClick={(e) => { e.stopPropagation(); const r = btn.current!.getBoundingClientRect(); setAt(at ? null : { top: r.bottom + 4, right: window.innerWidth - r.right }); }}>
        <span aria-hidden="true">⋯</span>
      </button>
      {at && createPortal(
        <div className="row-menu" role="menu" style={{ top: at.top, right: at.right }} onClick={(e) => e.stopPropagation()}>
          {items.map((it) => (
            <button key={it.label} role="menuitem" className={`menu-item${it.danger ? " danger" : ""}`} disabled={it.disabled} title={it.title}
              onClick={() => { setAt(null); it.onClick(); }}>{it.label}</button>
          ))}
        </div>, document.body)}
    </>
  );
}
