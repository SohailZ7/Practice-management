import { useEffect, useId, useRef, useState } from "react";
import { normalizeTime, TIME_SLOTS } from "./lib/times";

/**
 * A text box with its own drop-down list (the browser's native suggestion list draws a detached, unstyled popup in the Mac
 * webview). Arrow keys move, Enter picks, Escape closes, a click picks. `strict` means only list values are kept;
 * otherwise typed text is fine. With no options at all a strict box turns into free text so a form is never stuck.
 */
export function Combobox({ value, onChange, options, label, placeholder, strict = false, autoFocus, size, invalid }: {
  value: string; onChange: (v: string) => void; options: string[]; label: string; placeholder?: string;
  strict?: boolean; autoFocus?: boolean; size?: number; invalid?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null); // text being typed; null = show the saved value
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);
  const free = !strict || options.length === 0;
  const shown = query ?? value;
  const needle = (query ?? "").trim().toLowerCase();
  const items = needle && query !== null ? options.filter((o) => o.toLowerCase().includes(needle)) : options;

  useEffect(() => {
    if (open && active >= 0) (listRef.current?.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const close = () => { setOpen(false); setActive(-1); setQuery(null); };
  const pick = (v: string) => { onChange(v); close(); };
  const settle = () => { // leaving the box: a strict one drops text that is not on the list
    if (query !== null && free) onChange(query);
    close();
  };

  return (
    <div className="combo" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) settle(); }}>
      <input
        role="combobox" aria-expanded={open} aria-controls={id} aria-autocomplete="list" aria-label={label} aria-invalid={invalid}
        autoComplete="off" autoFocus={autoFocus} size={size} placeholder={placeholder} value={shown}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(-1); if (free) onChange(e.target.value); }}
        onFocus={() => setOpen(true)}
        onMouseDown={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, items.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter") {
            if (open && active >= 0 && items[active] !== undefined) { e.preventDefault(); pick(items[active]); }
            else if (open) { e.preventDefault(); settle(); }
          } else if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); close(); }
        }}
      />
      {open && items.length > 0 && (
        <ul className="combo-list" id={id} role="listbox" ref={listRef}>
          {strict && value && !query && <li role="option" aria-selected={false} className="combo-clear" onMouseDown={(e) => { e.preventDefault(); pick(""); }}>Clear</li>}
          {items.map((o, i) => (
            <li key={o} role="option" aria-selected={o === value} className={(i === active ? "on " : "") + (o === value ? "sel" : "")}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setActive(i)}>{o}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A time field: pick a 15-minute slot or type one. Shows an inline message for anything that is not a time. */
export function TimeField({ value, onChange, label = "Time", autoFocus }: {
  value: string; onChange: (v: string) => void; label?: string; autoFocus?: boolean;
}) {
  const bad = value.trim() !== "" && normalizeTime(value) === null;
  return (
    <>
      <Combobox value={value} onChange={onChange} options={TIME_SLOTS} label={label} placeholder="9:00 AM" autoFocus={autoFocus} size={11} invalid={bad} />
      {bad && <span className="small err"> Enter a time like 9:00 AM, 13:30 or 9:00 - 11:30.</span>}
    </>
  );
}

/** A text field with suggestions: pick from the list or type a new value. */
export function ComboField({ value, onChange, options, label, placeholder }: {
  value: string; onChange: (v: string) => void; options: string[]; label: string; placeholder?: string;
}) {
  return <Combobox value={value} onChange={onChange} options={options} label={label} placeholder={placeholder} />;
}

/** A strict pick list. If the practice has none yet, falls back to typing so the form is never stuck. */
export function StrictSelect({ value, onChange, options, label, blankLabel = "Choose…" }: {
  value: string; onChange: (v: string) => void; options: string[]; label: string; blankLabel?: string;
}) {
  const list = value && !options.includes(value) ? [value, ...options] : options;
  return <Combobox strict value={value} onChange={onChange} options={list} label={label} placeholder={blankLabel} />;
}

/** Table cell for the time: plain text until Edit is clicked, then a validated field with Save and Cancel. */
export function TimeCell({ value, disabled, onSave }: {
  value: string; disabled: boolean; onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  if (!editing) {
    return (
      <>
        {value || <span className="small">—</span>}{" "}
        <button className="link" disabled={disabled} onClick={() => { setDraft(value); setEditing(true); }}>Edit</button>
      </>
    );
  }
  const clean = normalizeTime(draft);
  return (
    <>
      <TimeField value={draft} onChange={setDraft} autoFocus />
      <button disabled={busy || clean === null} onClick={async () => {
        setBusy(true);
        try { await onSave(clean ?? ""); setEditing(false); } finally { setBusy(false); }
      }}>Save</button>
      <button className="secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
    </>
  );
}
