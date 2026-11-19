"use client";

import type { ReactNode } from "react";
import { askConfirm } from "@/lib/confirm";

/** A submit button that asks first (in the page). Use inside a form whose action does the destructive thing. */
export function ConfirmButton({ message, children, disabled, title }: { message: string; children: ReactNode; disabled?: boolean; title?: string }) {
  return (
    <button
      type="submit"
      className="secondary"
      disabled={disabled}
      title={title}
      onClick={async (e) => {
        const btn = e.currentTarget;
        const form = btn.form;
        e.preventDefault();
        if (form && (await askConfirm(message, { danger: true, confirmLabel: "Yes, continue" }))) form.requestSubmit(btn);
      }}
    >
      {children}
    </button>
  );
}
