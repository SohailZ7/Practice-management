"use client";

import type { ReactNode } from "react";

/** A submit button that asks first. Use inside a form whose action does the destructive thing. */
export function ConfirmButton({ message, children, disabled, title }: { message: string; children: ReactNode; disabled?: boolean; title?: string }) {
  return (
    <button
      type="submit"
      className="secondary"
      disabled={disabled}
      title={title}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
