"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addProgram, renameProgram, setProgramActive } from "@/app/billing/actions";

type P = { id: string; name: string; active: boolean };

export function ProgramManager({ programs }: { programs: P[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function run(fn: () => Promise<{ error?: string }>) {
    setError("");
    try {
      const r = await fn();
      if (r.error) setError(r.error);
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  return (
    <div>
      {error && <div className="error">{error}</div>}
      <p className="muted">
        The encounter form&apos;s Program dropdown lists only active programs. Deactivating a program keeps it on
        existing encounters.
      </p>
      <div className="card">
        {programs.length === 0 && <p className="muted">No programs yet. Add the first one below.</p>}
        {programs.map((p) => (
          <div key={p.id} className="row" style={{ marginBottom: ".4rem" }}>
            <input
              className="grow"
              defaultValue={p.name}
              aria-label={`Rename ${p.name}`}
              onBlur={(e) => {
                const v = e.currentTarget.value.trim();
                if (v && v !== p.name) run(() => renameProgram(p.id, v));
                else e.currentTarget.value = p.name;
              }}
            />
            <label className="check">
              <input type="checkbox" checked={p.active} onChange={(e) => run(() => setProgramActive(p.id, e.target.checked))} /> Active
            </label>
          </div>
        ))}
        <form
          className="row"
          style={{ marginTop: ".6rem" }}
          onSubmit={(e) => {
            e.preventDefault();
            const v = name;
            setName("");
            run(() => addProgram(v));
          }}
        >
          <input className="grow" placeholder="New program name" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit">Add program</button>
        </form>
      </div>
    </div>
  );
}
