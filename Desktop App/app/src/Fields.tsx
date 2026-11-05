import { useId, useState } from "react";
import { normalizeTime, TIME_SLOTS } from "./lib/times";

/** A time field: pick a 15-minute slot or type one. Shows an inline message for anything that is not a time. */
export function TimeField({ value, onChange, label = "Time", autoFocus }: {
  value: string; onChange: (v: string) => void; label?: string; autoFocus?: boolean;
}) {
  const id = useId();
  const bad = value.trim() !== "" && normalizeTime(value) === null;
  return (
    <>
      <input
        list={id} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} aria-invalid={bad}
        placeholder="9:00 AM" autoFocus={autoFocus} size={11}
      />
      <datalist id={id}>{TIME_SLOTS.map((t) => <option key={t} value={t} />)}</datalist>
      {bad && <span className="small err"> Enter a time like 9:00 AM, 13:30 or 9:00 - 11:30.</span>}
    </>
  );
}

/** A text field with suggestions: pick from the list or type a new value. */
export function ComboField({ value, onChange, options, label, placeholder }: {
  value: string; onChange: (v: string) => void; options: string[]; label: string; placeholder?: string;
}) {
  const id = useId();
  return (
    <>
      <input list={id} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} placeholder={placeholder} />
      <datalist id={id}>{options.map((o) => <option key={o} value={o} />)}</datalist>
    </>
  );
}

/** A strict pick list. If the practice has none yet, falls back to typing so the form is never stuck. */
export function StrictSelect({ value, onChange, options, label, blankLabel = "Choose…" }: {
  value: string; onChange: (v: string) => void; options: string[]; label: string; blankLabel?: string;
}) {
  if (options.length === 0) return <input value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />;
  const list = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{blankLabel}</option>
      {list.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
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
