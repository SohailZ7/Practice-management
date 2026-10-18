"use client";

import { useMemo, useRef, useState } from "react";
import { createLedgerEntry, deleteLedgerEntry, listLedger, updateLedgerEntry } from "@/app/ledger/actions";
import { addDays } from "@/lib/dates";
import { editableMoney, formatMoney, parseMoney } from "@/lib/ledger/money";
import { ledgerTotals } from "@/lib/ledger/validate";
import type { LedgerDTO, LedgerFilters, LedgerPatch, Opt } from "@/lib/ledger/types";

type Row = LedgerDTO & { key: string; draft: boolean };

type Props = {
  initialRows: LedgerDTO[];
  initialFilters: LedgerFilters;
  categories: Opt[];
  methods: Opt[];
  parties: Opt[];
  canEdit: boolean;
  today: string;
};

let draftCounter = 0;

export function LedgerGrid({ initialRows, initialFilters, categories, methods, parties, canEdit, today }: Props) {
  const [f, setF] = useState(initialFilters);
  const [rows, setRows] = useState<Row[]>(() => initialRows.map((r) => ({ ...r, key: r.id, draft: false })));
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; text: string }>({ kind: "idle", text: "" });
  const [busy, setBusy] = useState(false);
  const creating = useRef(new Set<string>());

  const set = <K extends keyof LedgerFilters>(k: K, v: LedgerFilters[K]) => setF((s) => ({ ...s, [k]: v }));
  const totals = useMemo(() => ledgerTotals(rows.filter((r) => !r.draft)), [rows]);
  const fail = (e: unknown) => setStatus({ kind: "error", text: e instanceof Error ? e.message : "Could not save" });

  async function apply(next = f) {
    setBusy(true);
    setStatus({ kind: "idle", text: "" });
    try {
      const list = await listLedger(next);
      setRows(list.map((r) => ({ ...r, key: r.id, draft: false })));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  function preset(kind: "month" | "last" | "year" | "all") {
    const month = today.slice(0, 7);
    let next: LedgerFilters;
    if (kind === "month") next = { ...f, from: `${month}-01`, to: "" };
    else if (kind === "last") {
      const first = `${month}-01`;
      const prevLast = addDays(first, -1);
      next = { ...f, from: `${prevLast.slice(0, 7)}-01`, to: prevLast };
    } else if (kind === "year") next = { ...f, from: `${today.slice(0, 4)}-01-01`, to: "" };
    else next = { ...f, from: "", to: "" };
    setF(next);
    apply(next);
  }

  const patchLocal = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function commit(row: Row, patch: LedgerPatch) {
    // Entering one amount clears the other: an entry is either cash in or cash out.
    const full: LedgerPatch = { ...patch };
    if (patch.cashIn && patch.cashIn > 0) full.cashOut = 0;
    if (patch.cashOut && patch.cashOut > 0) full.cashIn = 0;
    const merged = { ...row, ...full };
    patchLocal(row.key, full);

    if (row.draft) {
      // A new row is saved once it has a date and an amount.
      if (creating.current.has(row.key)) return;
      if (!merged.date || (merged.cashIn === 0 && merged.cashOut === 0)) return;
      creating.current.add(row.key);
      setStatus({ kind: "saving", text: "Saving…" });
      try {
        const dto = await createLedgerEntry({
          date: merged.date,
          cashIn: merged.cashIn,
          cashOut: merged.cashOut,
          partyId: merged.partyId,
          categoryId: merged.categoryId,
          methodId: merged.methodId,
          comments: merged.comments,
        });
        setRows((rs) => rs.map((r) => (r.key === row.key ? { ...dto, key: row.key, draft: false } : r)));
        setStatus({ kind: "saved", text: "Saved" });
      } catch (e) {
        fail(e);
      } finally {
        creating.current.delete(row.key);
      }
      return;
    }

    setStatus({ kind: "saving", text: "Saving…" });
    try {
      const dto = await updateLedgerEntry(row.id, full);
      patchLocal(row.key, dto);
      setStatus({ kind: "saved", text: "Saved" });
    } catch (e) {
      patchLocal(row.key, row); // revert
      fail(e);
    }
  }

  async function remove(row: Row) {
    if (!row.draft && !window.confirm("Delete this ledger entry?")) return;
    setRows((rs) => rs.filter((r) => r.key !== row.key));
    if (row.draft) return;
    try {
      await deleteLedgerEntry(row.id);
      setStatus({ kind: "saved", text: "Deleted" });
    } catch (e) {
      setRows((rs) => [...rs, row]);
      fail(e);
    }
  }

  function addRow() {
    draftCounter += 1;
    const key = `draft-${draftCounter}`;
    setRows((rs) => [
      ...rs,
      { key, id: key, draft: true, date: today, cashIn: 0, cashOut: 0, partyId: null, categoryId: null, methodId: null, comments: "" },
    ]);
  }

  const exportHref = `/ledger/export?${new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString()}`;

  const amountCell = (row: Row, field: "cashIn" | "cashOut") => (
    <input
      key={`${row.key}-${field}-${row[field]}`}
      className="num"
      defaultValue={editableMoney(row[field])}
      placeholder="-"
      inputMode="decimal"
      aria-label={field === "cashIn" ? "Cash in" : "Cash out"}
      onBlur={(e) => {
        const parsed = parseMoney(e.currentTarget.value);
        if ("error" in parsed) {
          setStatus({ kind: "error", text: parsed.error });
          e.currentTarget.value = editableMoney(row[field]);
          return;
        }
        if (parsed.cents !== row[field]) commit(row, { [field]: parsed.cents });
      }}
    />
  );

  const selectCell = (row: Row, field: "partyId" | "categoryId" | "methodId", options: Opt[], label: string) => (
    <select
      value={row[field] ?? ""}
      aria-label={label}
      onChange={(e) => commit(row, { [field]: e.target.value || null })}
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );

  const nameOf = (list: Opt[], id: string | null) => list.find((o) => o.id === id)?.name ?? "";

  return (
    <div>
      <form
        className="card row"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <label className="check">
          From <input type="date" value={f.from} onChange={(e) => set("from", e.target.value)} />
        </label>
        <label className="check">
          To <input type="date" value={f.to} onChange={(e) => set("to", e.target.value)} />
        </label>
        <div className="seg" aria-label="Date presets">
          <a onClick={() => preset("month")}>This month</a>
          <a onClick={() => preset("last")}>Last month</a>
          <a onClick={() => preset("year")}>This year</a>
          <a onClick={() => preset("all")}>All</a>
        </div>
        <select value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          <option value="none">(No category)</option>
          {categories.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select value={f.methodId} onChange={(e) => set("methodId", e.target.value)} aria-label="Method">
          <option value="">All methods</option>
          {methods.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select value={f.partyId} onChange={(e) => set("partyId", e.target.value)} aria-label="Transaction by">
          <option value="">Anyone</option>
          {parties.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select value={f.type} onChange={(e) => set("type", e.target.value as LedgerFilters["type"])} aria-label="Type">
          <option value="all">Cash in and out</option>
          <option value="in">Cash in only</option>
          <option value="out">Cash out only</option>
        </select>
        <input className="grow" placeholder="Search comments" value={f.q} onChange={(e) => set("q", e.target.value)} aria-label="Search comments" />
        <button type="submit" disabled={busy}>
          {busy ? "Loading…" : "Apply"}
        </button>
        <a className="btn secondary" href={exportHref}>
          Export CSV
        </a>
      </form>

      <div className="stat-row">
        <div className="stat">
          <span className="muted small">Cash in</span>
          <strong className="pos">{formatMoney(totals.cashIn)}</strong>
        </div>
        <div className="stat">
          <span className="muted small">Cash out</span>
          <strong className="neg">{formatMoney(totals.cashOut)}</strong>
        </div>
        <div className="stat">
          <span className="muted small">Net</span>
          <strong className={totals.net < 0 ? "neg" : "pos"}>{formatMoney(totals.net)}</strong>
        </div>
        <div className="stat">
          <span className="muted small">Entries</span>
          <strong>{totals.count}</strong>
        </div>
        <span className={`save-status ${status.kind}`} role="status" aria-live="polite" style={{ marginLeft: "auto" }}>
          {status.text}
        </span>
      </div>

      <div className="xl-wrap">
        <table className="xl ledger">
          <colgroup>
            <col style={{ width: 130 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 170 }} />
            <col style={{ width: 170 }} />
            <col />
            {canEdit && <col style={{ width: 38 }} />}
          </colgroup>
          <thead>
            <tr>
              <th>Date</th>
              <th className="r">Cash In</th>
              <th className="r">Cash Out</th>
              <th>Transaction By</th>
              <th>Category</th>
              <th>Method</th>
              <th>Comments</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted xl-empty">
                  No entries for these filters.
                </td>
              </tr>
            )}
            {rows.map((r) =>
              canEdit ? (
                <tr key={r.key} className={r.draft ? "xl-draft" : ""}>
                  <td>
                    <input
                      type="date"
                      defaultValue={r.date}
                      key={`${r.key}-date-${r.date}`}
                      aria-label="Date"
                      onBlur={(e) => {
                        if (e.currentTarget.value && e.currentTarget.value !== r.date) commit(r, { date: e.currentTarget.value });
                      }}
                    />
                  </td>
                  <td>{amountCell(r, "cashIn")}</td>
                  <td>{amountCell(r, "cashOut")}</td>
                  <td>{selectCell(r, "partyId", parties, "Transaction by")}</td>
                  <td>{selectCell(r, "categoryId", categories, "Category")}</td>
                  <td>{selectCell(r, "methodId", methods, "Method")}</td>
                  <td>
                    <input
                      key={`${r.key}-c-${r.comments}`}
                      defaultValue={r.comments}
                      aria-label="Comments"
                      onBlur={(e) => {
                        if (e.currentTarget.value !== r.comments) commit(r, { comments: e.currentTarget.value });
                      }}
                    />
                  </td>
                  <td className="c">
                    <button className="icon-btn" title="Delete row" aria-label="Delete row" onClick={() => remove(r)}>
                      ×
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={r.key}>
                  <td>{r.date}</td>
                  <td className="r">{r.cashIn ? formatMoney(r.cashIn) : "-"}</td>
                  <td className="r">{r.cashOut ? formatMoney(r.cashOut) : "-"}</td>
                  <td>{nameOf(parties, r.partyId)}</td>
                  <td>{nameOf(categories, r.categoryId)}</td>
                  <td>{nameOf(methods, r.methodId)}</td>
                  <td>{r.comments}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <p>
          <button type="button" className="secondary" onClick={addRow}>
            + Add row
          </button>
          <span className="muted small"> A new row is saved once it has a date and an amount.</span>
        </p>
      )}
      {initialRows.length >= 1000 && <p className="muted small">Showing the first 1,000 entries. Narrow the dates to see others.</p>}
    </div>
  );
}
