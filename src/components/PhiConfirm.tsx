"use client";

import { useState } from "react";

/** Shown when the server thinks free text holds patient information. Saving needs the explicit confirmation box. */
export function PhiConfirm({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  const [ticked, setTicked] = useState(false);
  return (
    <div className="error" role="alert">
      <div>{message}</div>
      <div className="row" style={{ marginTop: ".5rem" }}>
        <label className="check">
          <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} /> I confirm this contains no patient information
        </label>
        <span className="grow" />
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" disabled={!ticked} onClick={onConfirm}>
          Save anyway
        </button>
      </div>
    </div>
  );
}
