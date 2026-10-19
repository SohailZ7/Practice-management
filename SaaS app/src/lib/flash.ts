import { redirect } from "next/navigation";

/** Redirects back to a page with a message shown in a banner (errors or notices). */
export function flash(path: string, kind: "error" | "notice", message: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}${kind}=${encodeURIComponent(message)}`);
}

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function bool(form: FormData, key: string): boolean {
  return form.get(key) === "on" || form.get(key) === "true";
}
