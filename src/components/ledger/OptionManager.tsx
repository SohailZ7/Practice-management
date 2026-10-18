"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addLedgerOption, deleteLedgerOption, renameLedgerOption } from "@/app/ledger/actions";
import type { OptionKind, Opt } from "@/lib/ledger/types";

export function OptionManager({ kind, title, hint, options }: { kind: OptionKind; title: string; hint: string; options: Opt[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function run(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <p className="muted small">{hint}</p>
      {error && <div className="error">{error}</div>}
      {options.map((o) => (
        <div key={o.id} className="row" style={{ marginBottom: ".35rem" }}>
          <input
            className="grow"
            defaultValue={o.name}
            aria-label={`Rename ${o.name}`}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim();
              if (v && v !== o.name) run(() => renameLedgerOption(kind, o.id, v));
              else e.currentTarget.value = o.name;
            }}
          />
          <button
            className="danger"
            onClick={() => {
              if (window.confirm(`Remove "${o.name}"? Existing entries keep their amounts but lose this label.`)) {
                run(() => deleteLedgerOption(kind, o.id));
              }
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <form
        className="row"
        style={{ marginTop: ".5rem" }}
        onSubmit={(e) => {
          e.preventDefault();
          const v = name;
          setName("");
          run(() => addLedgerOption(kind, v));
        }}
      >
        <input className="grow" placeholder={`New ${title.toLowerCase().replace(/s$/, "")}`} value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit">Add</button>
      </form>
    </div>
  );
}
