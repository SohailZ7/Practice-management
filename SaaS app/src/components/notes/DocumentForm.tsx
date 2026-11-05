"use client";

import type { FieldDef, FieldValues } from "@/lib/notes/docsClient";
import { displayValue, isChecked } from "@/lib/notes/docUi";

/** Renders a document's fields as the form it is. Checkboxes sit in a compact grid, long text spans the page. */
export function DocumentForm({ fields, values, readOnly, onChange }: {
  fields: FieldDef[]; values: FieldValues; readOnly: boolean; onChange: (name: string, v: unknown) => void;
}) {
  return (
    <form className="docform" onSubmit={(e) => e.preventDefault()} aria-label="Document form">
      {fields.map((f) => {
        const id = `df-${f.name}`;
        const val = values[f.name];
        if (f.type === "checkbox") {
          return (
            <label key={f.name} className="docform-check">
              <input type="checkbox" checked={isChecked(val)} disabled={readOnly} onChange={(e) => onChange(f.name, e.target.checked)} /> {f.label}
            </label>
          );
        }
        return (
          <div key={f.name} className={`docform-field${f.type === "longtext" ? " wide" : ""}`}>
            <label htmlFor={id}>{f.label}</label>
            {f.type === "longtext" ? (
              <textarea id={id} rows={4} value={displayValue(f, val)} readOnly={readOnly} spellCheck onChange={(e) => onChange(f.name, e.target.value)} />
            ) : f.type === "select" ? (
              <select id={id} value={displayValue(f, val)} disabled={readOnly} onChange={(e) => onChange(f.name, e.target.value)}>
                <option value="" />
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                {displayValue(f, val) && !(f.options ?? []).includes(displayValue(f, val)) && <option value={displayValue(f, val)}>{displayValue(f, val)}</option>}
              </select>
            ) : (
              <input id={id} type={f.type === "date" ? "date" : "text"} value={displayValue(f, val)} readOnly={readOnly} onChange={(e) => onChange(f.name, e.target.value)} />
            )}
          </div>
        );
      })}
    </form>
  );
}
