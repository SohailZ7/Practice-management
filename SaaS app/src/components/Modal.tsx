"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The one pop-up for the whole app. Drawn on document.body (never inside a table cell or card, whatever their overflow or
 * transform), over a backdrop, as three parts: a fixed header, a scrolling body and a fixed footer. Anything the user must
 * see right away (an error, "Unsaved changes", a save result) goes in `notices`, which sits between header and body and never
 * scrolls away; buttons go in `footer`, which wraps instead of overlapping. Esc and a click on the backdrop call onClose
 * unless `busy`.
 */
export function Modal({
  title,
  onClose,
  children,
  notices,
  footer,
  headerExtra,
  size = "md",
  busy = false,
  role = "dialog",
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  notices?: ReactNode;
  footer?: ReactNode;
  headerExtra?: ReactNode;
  size?: "sm" | "md" | "lg";
  busy?: boolean;
  role?: "dialog" | "alertdialog";
}) {
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!mounted) return null;
  const label = typeof title === "string" ? title : undefined;
  return createPortal(
    <div
      className="modal-back"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className={`modal-shell modal-${size}`} role={role} aria-modal="true" aria-label={label}>
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          {headerExtra}
          <span className="grow" />
          <button type="button" className="modal-x" onClick={onClose} disabled={busy} aria-label="Close" title="Close (Esc)">
            ×
          </button>
        </div>
        {notices && <div className="modal-notices">{notices}</div>}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
