import type { DocField, FieldValue } from "./lib/api";
import { humanize, layoutFields, type Item, type Row } from "./lib/formLayout";

type Props = { fields: DocField[]; values: Record<string, FieldValue>; readOnly: boolean; set: (name: string, v: FieldValue) => void };

/** A document as the printed form: titled tables, one row per question, the choices side by side. */
export function FormBody({ fields, values, readOnly, set }: Props) {
  return (
    <div className="form-sheet">
      {layoutFields(fields).map((b, i) =>
        b.kind === "top" ? (
          <label key={b.field.name} className="form-top">
            {b.field.type !== "checkbox" && <span>{humanize(b.field.label)}</span>}
            {b.field.type === "checkbox" ? <Choice item={{ field: b.field, label: humanize(b.field.label), own: false }} {...{ values, readOnly, set }} /> : <Control field={b.field} {...{ values, readOnly, set }} />}
          </label>
        ) : (
          <section key={`${b.section.key}-${i}`} className="form-section">
            <h3>{b.section.title}</h3>
            <div className={b.section.paired ? "form-table paired" : "form-table"}>
              {b.section.rows.map((r) => <RowView key={r.key} row={r} {...{ values, readOnly, set }} />)}
            </div>
          </section>
        ),
      )}
    </div>
  );
}

type Shared = Pick<Props, "values" | "readOnly" | "set">;

function RowView({ row, values, readOnly, set }: { row: Row } & Shared) {
  const own = row.items.find((i) => i.own && i.field.type === "checkbox");
  const rest = row.items.filter((i) => i !== own);
  return (
    <div className="form-row">
      <div className="form-label">
        {own ? (
          <label><input type="checkbox" disabled={readOnly} checked={values[own.field.name] === true} onChange={(e) => set(own.field.name, e.target.checked)} /> {row.label}</label>
        ) : row.label}
      </div>
      <div className="form-opts">
        {rest.map((i) => <Choice key={i.field.name} item={i} {...{ values, readOnly, set }} />)}
      </div>
    </div>
  );
}

function Choice({ item, values, readOnly, set }: { item: Item } & Shared) {
  const f = item.field;
  const v = values[f.name];
  if (f.type === "checkbox") {
    return (
      <label className="opt">
        <input type="checkbox" disabled={readOnly} checked={v === true} onChange={(e) => set(f.name, e.target.checked)} /> {item.label || f.label}
      </label>
    );
  }
  if (f.type === "select") {
    return (
      <span className="opt-group">
        {(f.options ?? []).map((o) => (
          <label key={o} className="opt">
            <input type="checkbox" disabled={readOnly} checked={v === o} onChange={(e) => set(f.name, e.target.checked ? o : "")} /> {o}
          </label>
        ))}
      </span>
    );
  }
  return (
    <span className="opt-text">
      {item.label && item.label !== "Other" && <span className="small">{item.label}:</span>}
      <Control field={f} values={values} readOnly={readOnly} set={set} />
    </span>
  );
}

function Control({ field: f, values, readOnly, set }: { field: DocField } & Shared) {
  const v = values[f.name];
  if (f.type === "longtext") return <textarea rows={4} aria-label={f.label} readOnly={readOnly} value={String(v ?? "")} onChange={(e) => set(f.name, e.target.value)} />;
  if (f.type === "select") return <Choice item={{ field: f, label: "", own: false }} values={values} readOnly={readOnly} set={set} />;
  return <input type={f.type === "date" ? "date" : "text"} aria-label={f.label} readOnly={readOnly} value={String(v ?? "")} onChange={(e) => set(f.name, e.target.value)} />;
}
