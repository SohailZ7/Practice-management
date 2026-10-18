"use client";

import { useRef, useState } from "react";
import { formatShort } from "@/lib/dates";
import { totals, type EntryDTO, type EntryPatch, type Section } from "@/lib/scheduleTypes";
import { createEntry, removeEntry, updateEntry } from "@/app/schedule/actions";

type Opt = { id: string; name: string };
type Track = { id: string; name: string; startTime: string; endTime: string };

type Row = EntryDTO & { key: string; draft: boolean };

type Props = {
  entries: EntryDTO[];
  days: string[];
  providers: Opt[];
  tracks: Track[];
  types: Opt[];
  canEdit: boolean;
  defaultProviderId: string;
};

const SECTION_RANK: Record<Section, number> = { PSYCH_EVAL: 0, TRACK: 1 };
const FLAGS = [
  { key: "absent", head: "Abs", title: "Absent" },
  { key: "canceled", head: "Can", title: "Canceled" },
  { key: "completed", head: "Done", title: "Completed" },
  { key: "missed", head: "Miss", title: "Missed" },
] as const;

function rowClass(r: Row) {
  if (r.canceled) return "status-canceled";
  if (r.missed) return "status-missed";
  if (r.absent) return "status-absent";
  if (r.completed) return "status-completed";
  return "";
}

let draftCounter = 0;

export function ScheduleGrid({ entries, days, providers, tracks, types, canEdit, defaultProviderId }: Props) {
  const [rows, setRows] = useState<Row[]>(() =>
    entries.map((e) => ({ ...e, key: e.id, draft: false })),
  );
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; text: string }>({
    kind: "idle",
    text: "",
  });
  const creating = useRef(new Map<string, EntryPatch>());

  const fail = (e: unknown) =>
    setStatus({ kind: "error", text: e instanceof Error ? e.message : "Could not save" });

  const patchLocal = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function commit(row: Row, patch: EntryPatch) {
    const merged = { ...row, ...patch };
    patchLocal(row.key, patch);

    if (row.draft) {
      // A new row is only saved once it has a client; other edits wait until then.
      if (creating.current.has(row.key)) {
        creating.current.set(row.key, { ...creating.current.get(row.key), ...patch });
        return;
      }
      if (!merged.clientInfo.trim()) return;
      creating.current.set(row.key, {});
      setStatus({ kind: "saving", text: "Saving…" });
      try {
        const dto = await createEntry({
          date: merged.date,
          section: merged.section,
          timeLabel: merged.timeLabel,
          typeName: merged.typeName,
          clientInfo: merged.clientInfo,
          providerId: merged.providerId,
        });
        const pending = creating.current.get(row.key) ?? {};
        creating.current.delete(row.key);
        const flagsAndLater: EntryPatch = {
          absent: merged.absent,
          canceled: merged.canceled,
          completed: merged.completed,
          missed: merged.missed,
          ...pending,
        };
        const needsUpdate = Object.entries(flagsAndLater).some(
          ([k, v]) => v !== (dto as unknown as Record<string, unknown>)[k],
        );
        const final = needsUpdate ? await updateEntry(dto.id, flagsAndLater) : dto;
        setRows((rs) => rs.map((r) => (r.key === row.key ? { ...final, key: row.key, draft: false } : r)));
        setStatus({ kind: "saved", text: "Saved" });
      } catch (e) {
        creating.current.delete(row.key);
        fail(e);
      }
      return;
    }

    setStatus({ kind: "saving", text: "Saving…" });
    try {
      const dto = await updateEntry(row.id, patch);
      patchLocal(row.key, dto);
      setStatus({ kind: "saved", text: "Saved" });
    } catch (e) {
      patchLocal(row.key, row); // revert
      fail(e);
    }
  }

  async function remove(row: Row) {
    if (!row.draft && !window.confirm(`Delete the entry for "${row.clientInfo}"?`)) return;
    setRows((rs) => rs.filter((r) => r.key !== row.key));
    if (row.draft) return;
    try {
      await removeEntry(row.id);
      setStatus({ kind: "saved", text: "Deleted" });
    } catch (e) {
      setRows((rs) => [...rs, row]);
      fail(e);
    }
  }

  function addRow(date: string, section: Section) {
    draftCounter += 1;
    const key = `draft-${draftCounter}`;
    setRows((rs) => [
      ...rs,
      {
        key,
        id: key,
        draft: true,
        date,
        section,
        timeLabel: "",
        typeName: "",
        clientInfo: "",
        providerId: defaultProviderId || null,
        providerName: "",
        absent: false,
        canceled: false,
        completed: false,
        missed: false,
      },
    ]);
  }

  return (
    <div>
      <div className={`save-status ${status.kind}`} role="status" aria-live="polite">
        {status.text}
      </div>
      <datalist id="track-options">
        {tracks.map((t) => (
          <option key={t.id} value={`${t.name}   ${t.startTime} - ${t.endTime}`} />
        ))}
      </datalist>
      <datalist id="type-options">
        {types.map((t) => (
          <option key={t.id} value={t.name} />
        ))}
      </datalist>

      <div className="xl-wrap">
        <table className="xl">
          <colgroup>
            <col style={{ width: 118 }} />
            <col style={{ width: 210 }} />
            <col style={{ width: 170 }} />
            <col />
            <col style={{ width: 180 }} />
            {FLAGS.map((f) => (
              <col key={f.key} style={{ width: 46 }} />
            ))}
            {canEdit && <col style={{ width: 38 }} />}
          </colgroup>
          <thead>
            <tr>
              <th>Section</th>
              <th>Time / Track</th>
              <th>Type</th>
              <th>Client</th>
              <th>Provider</th>
              {FLAGS.map((f) => (
                <th key={f.key} title={f.title} className="c">
                  {f.head}
                </th>
              ))}
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const dayRows = rows
                .filter((r) => r.date === day)
                .sort((a, b) => SECTION_RANK[a.section] - SECTION_RANK[b.section]);
              const t = totals(dayRows.filter((r) => !r.draft));
              return (
                <DayBlock
                  key={day}
                  day={day}
                  rows={dayRows}
                  totalsText={`${t.scheduled} scheduled · ${t.completed} done · ${t.absent} absent · ${t.canceled} canceled · ${t.missed} missed`}
                  providers={providers}
                  canEdit={canEdit}
                  onCommit={commit}
                  onRemove={remove}
                  onAdd={addRow}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DayBlock({
  day,
  rows,
  totalsText,
  providers,
  canEdit,
  onCommit,
  onRemove,
  onAdd,
}: {
  day: string;
  rows: Row[];
  totalsText: string;
  providers: Opt[];
  canEdit: boolean;
  onCommit: (row: Row, patch: EntryPatch) => void;
  onRemove: (row: Row) => void;
  onAdd: (date: string, section: Section) => void;
}) {
  const span = 5 + FLAGS.length + (canEdit ? 1 : 0);
  return (
    <>
      <tr className="xl-day">
        <td colSpan={span}>
          <strong>{formatShort(day)}</strong>
          <span className="muted small"> {totalsText}</span>
          {canEdit && (
            <span className="xl-add">
              <button type="button" className="secondary" onClick={() => onAdd(day, "PSYCH_EVAL")}>
                + Psych Eval
              </button>
              <button type="button" className="secondary" onClick={() => onAdd(day, "TRACK")}>
                + Track
              </button>
            </span>
          )}
        </td>
      </tr>
      {rows.length === 0 && (
        <tr>
          <td colSpan={span} className="muted small xl-empty">
            Nothing scheduled.
          </td>
        </tr>
      )}
      {rows.map((r) => (
        <EntryRow
          key={r.key}
          row={r}
          providers={providers}
          canEdit={canEdit}
          onCommit={onCommit}
          onRemove={onRemove}
        />
      ))}
    </>
  );
}

function EntryRow({
  row,
  providers,
  canEdit,
  onCommit,
  onRemove,
}: {
  row: Row;
  providers: Opt[];
  canEdit: boolean;
  onCommit: (row: Row, patch: EntryPatch) => void;
  onRemove: (row: Row) => void;
}) {
  const text = (field: "timeLabel" | "typeName" | "clientInfo", list?: string, placeholder?: string) => (
    <input
      defaultValue={row[field]}
      list={list}
      placeholder={placeholder}
      aria-label={field}
      onBlur={(e) => {
        const v = e.currentTarget.value;
        if (v !== row[field]) onCommit(row, { [field]: v });
      }}
    />
  );
  const legacy = !row.providerId && row.providerName;

  if (!canEdit) {
    return (
      <tr className={rowClass(row)}>
        <td>{row.section === "TRACK" ? "Track" : "Psych Eval"}</td>
        <td>{row.timeLabel}</td>
        <td>{row.typeName}</td>
        <td>{row.clientInfo}</td>
        <td>{row.providerName}</td>
        {FLAGS.map((f) => (
          <td key={f.key} className="c">
            {row[f.key] ? "✓" : ""}
          </td>
        ))}
      </tr>
    );
  }

  return (
    <tr className={`${rowClass(row)} ${row.draft ? "xl-draft" : ""}`}>
      <td>
        <select
          value={row.section}
          aria-label="Section"
          onChange={(e) => onCommit(row, { section: e.target.value as Section })}
        >
          <option value="PSYCH_EVAL">Psych Eval</option>
          <option value="TRACK">Track</option>
        </select>
      </td>
      <td>{text("timeLabel", row.section === "TRACK" ? "track-options" : undefined, row.section === "TRACK" ? "Track" : "e.g. Psych Eval 9:00")}</td>
      <td>{text("typeName", "type-options", "Type")}</td>
      <td>{text("clientInfo", undefined, row.draft ? "Client name / info…" : undefined)}</td>
      <td>
        <select
          value={row.providerId ?? (legacy ? "__legacy" : "")}
          aria-label="Provider"
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__legacy") return;
            onCommit(row, { providerId: v || null });
          }}
        >
          <option value="">— provider —</option>
          {legacy && <option value="__legacy">({row.providerName})</option>}
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </td>
      {FLAGS.map((f) => (
        <td key={f.key} className="c">
          <input
            type="checkbox"
            checked={row[f.key]}
            aria-label={f.title}
            onChange={(e) => onCommit(row, { [f.key]: e.target.checked })}
          />
        </td>
      ))}
      <td className="c">
        <button type="button" className="icon-btn" title="Delete row" aria-label="Delete row" onClick={() => onRemove(row)}>
          ×
        </button>
      </td>
    </tr>
  );
}
