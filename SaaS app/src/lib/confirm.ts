/** Ask in the page, not with the browser's pop-up boxes (which can't be styled, and block automated testing).
 *  `askConfirm("Delete this?")` resolves true on OK, false on Cancel / Escape.
 *  `askFields("Consent", [{ name, label, value }])` resolves the typed values, or null on Cancel.
 *  The ConfirmHost in AppShell shows them. With no host mounted (login page, tests) askConfirm falls back to the browser box. */
export type AskField = { name: string; label: string; value?: string; placeholder?: string };
export type ConfirmRequest = {
  message: string; confirmLabel: string; cancelLabel: string; danger: boolean; fields: AskField[];
  resolve: (answer: Record<string, string> | null) => void;
};
export const CONFIRM_EVENT = "bbc:confirm";

type Opts = { confirmLabel?: string; cancelLabel?: string; danger?: boolean };

function ask(message: string, fields: AskField[], opts: Opts): Promise<Record<string, string> | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req: ConfirmRequest = { message, fields, confirmLabel: opts.confirmLabel ?? "OK", cancelLabel: opts.cancelLabel ?? "Cancel", danger: opts.danger ?? false, resolve };
    const hosted = !window.dispatchEvent(new CustomEvent(CONFIRM_EVENT, { detail: req, cancelable: true }));
    if (!hosted) resolve(fields.length === 0 ? (window.confirm(message) ? {} : null) : null);
  });
}

export async function askConfirm(message: string, opts: Opts = {}): Promise<boolean> {
  return (await ask(message, [], opts)) !== null;
}

export function askFields(message: string, fields: AskField[], opts: Opts = {}): Promise<Record<string, string> | null> {
  return ask(message, fields, opts);
}
