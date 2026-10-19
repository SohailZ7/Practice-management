"use client";

import { useState } from "react";

type Sheet = { name: string; hidden: boolean };
type NameRow = { name: string; count: number; matchedId: string | null; matchedName: string | null };
type Preview = {
  draftId: string;
  counts: { found: number; new: number; duplicates: number; skipped: number; providersInSheet: number };
  names: NameRow[];
  providers: { id: string; name: string }[];
  providerRows: { name: string; hours: string; contact: string }[];
  warnings: string[];
  sample: {
    date: string;
    section: string;
    timeLabel: string;
    typeName: string;
    clientInfo: string;
    providerName: string;
  }[];
};
type Decision = { action: "auto" | "create" | "map" | "none"; providerId?: string };
type Result = {
  created: number;
  duplicates: number;
  skipped: number;
  providersCreated: number;
  providersUpdated: number;
};

async function post<T>(url: string, body: FormData | string, json = false): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    body,
    headers: json ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function ImportWizard() {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheet, setSheet] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, Decision>>({});
  const [includeProviders, setIncludeProviders] = useState(false);
  const [overwritePw, setOverwritePw] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const reset = () => {
    setSheets([]);
    setSheet("");
    setPreview(null);
    setResult(null);
    setError("");
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy("");
    }
  };

  const loadSheets = (f: File) =>
    run("Reading workbook…", async () => {
      const form = new FormData();
      form.append("file", f);
      const { sheets } = await post<{ sheets: Sheet[] }>("/api/schedule/import/sheets", form);
      setSheets(sheets);
      const visible = sheets.filter((s) => !s.hidden);
      const guess = visible.find((s) => /doc.*hp/i.test(s.name)) ?? visible[0] ?? sheets[0];
      setSheet(guess?.name ?? "");
    });

  const makePreview = () =>
    run("Reading sheet…", async () => {
      if (!file || !sheet) return;
      const form = new FormData();
      form.append("file", file);
      form.append("sheet", sheet);
      const p = await post<Preview>("/api/schedule/import/preview", form);
      const initial: Record<string, Decision> = {};
      p.names.forEach((n) => (initial[n.name] = { action: n.matchedId ? "auto" : "create" }));
      setMapping(initial);
      setIncludeProviders(false);
      setOverwritePw(false);
      setPreview(p);
    });

  const commit = () =>
    run("Importing…", async () => {
      if (!preview) return;
      const r = await post<Result>(
        "/api/schedule/import/commit",
        JSON.stringify({
          draftId: preview.draftId,
          includeProviders,
          overwriteZoomPassword: overwritePw,
          mapping,
        }),
        true,
      );
      setResult(r);
      setPreview(null);
    });

  return (
    <div className="card">
      {error && <div className="error">{error}</div>}
      {busy && <p className="muted">{busy}</p>}

      {result ? (
        <>
          <div className="notice">
            Imported {result.created} new entries ({result.duplicates} duplicates skipped,{" "}
            {result.skipped} empty/placeholder rows ignored). Providers created: {result.providersCreated},
            updated: {result.providersUpdated}.
          </div>
          <button
            onClick={() => {
              reset();
              setFile(null);
            }}
          >
            Import another file
          </button>
        </>
      ) : (
        <>
          <div className="row">
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                reset();
                if (f) loadSheets(f);
              }}
            />
            {sheets.length > 0 && (
              <>
                <select
                  value={sheet}
                  onChange={(e) => {
                    setSheet(e.target.value);
                    setPreview(null);
                  }}
                  aria-label="Sheet"
                >
                  {sheets.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                      {s.hidden ? " (hidden)" : ""}
                    </option>
                  ))}
                </select>
                <button onClick={makePreview} disabled={!!busy || !sheet}>
                  Preview
                </button>
              </>
            )}
          </div>

          {preview && (
            <div style={{ marginTop: "1rem" }}>
              <h2>Preview</h2>
              <p>
                <span className="pill ok">{preview.counts.new} new</span>{" "}
                <span className="pill">{preview.counts.duplicates} already in app</span>{" "}
                <span className="pill">{preview.counts.skipped} skipped</span>{" "}
                <span className="pill">{preview.counts.providersInSheet} providers in sheet</span>
              </p>

              {preview.warnings.length > 0 && (
                <details>
                  <summary>{preview.warnings.length} warnings</summary>
                  <ul className="small">
                    {preview.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}

              {preview.names.length > 0 && (
                <>
                  <h2>Providers named in the entries</h2>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Name in sheet</th>
                          <th>Entries</th>
                          <th>Match</th>
                          <th>What to do</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.names.map((n) => {
                          const d = mapping[n.name] ?? { action: "create" };
                          const value = d.action === "map" ? `map:${d.providerId}` : d.action;
                          return (
                            <tr key={n.name}>
                              <td>{n.name}</td>
                              <td>{n.count}</td>
                              <td>
                                {n.matchedName ? (
                                  <span className="pill ok">{n.matchedName}</span>
                                ) : (
                                  <span className="pill warn">no match</span>
                                )}
                              </td>
                              <td>
                                <select
                                  value={value}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    const next: Decision = v.startsWith("map:")
                                      ? { action: "map", providerId: v.slice(4) }
                                      : { action: v as Decision["action"] };
                                    setMapping({ ...mapping, [n.name]: next });
                                  }}
                                >
                                  {n.matchedId && <option value="auto">Use matched provider</option>}
                                  <option value="create">Create as external provider</option>
                                  <option value="none">Keep the name only</option>
                                  {preview.providers.map((p) => (
                                    <option key={p.id} value={`map:${p.id}`}>
                                      Map to {p.name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {preview.providerRows.length > 0 && (
                <div style={{ marginTop: "1rem" }}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={includeProviders}
                      onChange={(e) => setIncludeProviders(e.target.checked)}
                    />
                    Also import the providers table ({preview.providerRows.length} rows: contact, NPI, Zoom, hours)
                  </label>
                  <br />
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={overwritePw}
                      disabled={!includeProviders}
                      onChange={(e) => setOverwritePw(e.target.checked)}
                    />
                    Overwrite Zoom passwords that are already saved
                  </label>
                </div>
              )}

              <h2>First {preview.sample.length} rows</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Section</th>
                      <th>Time / track</th>
                      <th>Type</th>
                      <th>Client info</th>
                      <th>Provider</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.map((s, i) => (
                      <tr key={i}>
                        <td>{s.date}</td>
                        <td>{s.section === "TRACK" ? "Track" : "Psych Eval"}</td>
                        <td>{s.timeLabel}</td>
                        <td>{s.typeName}</td>
                        <td>{s.clientInfo}</td>
                        <td>{s.providerName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="row" style={{ marginTop: "1rem" }}>
                <button onClick={commit} disabled={!!busy || preview.counts.new + (includeProviders ? 1 : 0) === 0}>
                  Import {preview.counts.new} entries
                </button>
                <button className="secondary" onClick={() => setPreview(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
