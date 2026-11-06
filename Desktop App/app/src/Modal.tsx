import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The one pop-up used everywhere. It is drawn on document.body (not inside the table row or card that opened it, so it
 * never inherits that cell's alignment or no-wrap rules), centered, with a header, a body that scrolls on its own and a
 * footer whose buttons wrap instead of overlapping. Escape and the × button call onClose.
 */
export function Modal({ title, onClose, children, footer, width = 560, label }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number; label?: string;
}) {
  const id = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={label} aria-labelledby={label ? undefined : id} style={{ maxWidth: width }}>
        <div className="modal-head">
          <h2 id={id}>{title}</h2>
          <button className="secondary modal-x" aria-label="Close" title="Close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
