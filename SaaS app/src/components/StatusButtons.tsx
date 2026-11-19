// One row of status buttons: the current one is highlighted, one tap changes the state. Used by Feedback (submit buttons in a
// server-action form, `name` set) and by Tasks (`onSelect` set). No hooks, so a server page can render it too.
import type { ReactNode } from "react";

export type StatusOption = { value: string; label: ReactNode; disabled?: boolean; title?: string };

export function StatusButtons({
  options, current, name, onSelect, disabled = false, label,
}: {
  options: StatusOption[];
  current: string;
  /** Submit mode: each button submits its form with name=value. */
  name?: string;
  /** Click mode: called with the tapped value. */
  onSelect?: (value: string) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="status-buttons" role="group" aria-label={label}>
      {options.map((o) => {
        const active = o.value === current;
        return (
          <button
            key={o.value}
            type={name ? "submit" : "button"}
            name={name}
            value={name ? o.value : undefined}
            className={`status-btn ${active ? "active" : ""}`}
            aria-pressed={active}
            disabled={disabled || o.disabled || active}
            title={o.title}
            onClick={onSelect && !active ? () => onSelect(o.value) : undefined}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
