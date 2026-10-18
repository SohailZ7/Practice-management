"use client";

import type { ReactNode } from "react";

// Form fields that submit their parent <form> (a server action) as soon as they change.

export function AutoSelect({
  name,
  defaultValue,
  children,
  label,
}: {
  name: string;
  defaultValue: string;
  children: ReactNode;
  label: string;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      aria-label={label}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    >
      {children}
    </select>
  );
}

/** Text input that saves on blur (if changed) or Enter. */
export function AutoText({
  name,
  defaultValue,
  label,
}: {
  name: string;
  defaultValue: string;
  label: string;
}) {
  return (
    <input
      type="text"
      name={name}
      defaultValue={defaultValue}
      aria-label={label}
      title="Click to edit"
      onBlur={(e) => {
        if (e.currentTarget.value !== defaultValue) e.currentTarget.form?.requestSubmit();
      }}
    />
  );
}

export function AutoDate({ name, defaultValue, label }: { name: string; defaultValue: string; label: string }) {
  return (
    <input
      type="date"
      name={name}
      defaultValue={defaultValue}
      aria-label={label}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    />
  );
}
