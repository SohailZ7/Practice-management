import type { ReactNode } from "react";

/** Page header from the design boards: small caps eyebrow, serif headline, optional subtitle and actions. */
export function PageHead({ eyebrow, title, sub, children }: { eyebrow: string; title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-head-text">
        <p className="page-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      {children}
    </div>
  );
}
