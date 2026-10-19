// Content-Security-Policy for pages. Pure, so it is unit-tested; built per request in middleware with a fresh nonce.
//
// Why not a fully static policy: Next.js App Router emits small inline <script> tags to hydrate pages. A per-request
// nonce lets exactly those run ('strict-dynamic' then trusts only what they load) without allowing 'unsafe-inline'
// scripts. Pages are all dynamic (force-dynamic), so the nonce is never baked into cached HTML.
//
// Styles: the UI sets many style="..." attributes while rendering on the server. Attributes cannot carry a nonce, so
// style-src-attr allows them; <style> elements and stylesheets stay limited to our own files. An inline style cannot
// run code. No third-party origins are allowed anywhere (fonts, images and scripts are all served by the app).

export function buildCsp(nonce: string, dev = false): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'"],
    "style-src-elem": ["'self'", ...(dev ? ["'unsafe-inline'"] : [])],
    "style-src-attr": ["'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...(dev ? ["ws:", "wss:"] : [])],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "frame-src": ["'none'"],
    "manifest-src": ["'self'"],
    "worker-src": ["'self'", "blob:"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!dev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** A fresh, unguessable nonce (works in the Edge runtime and in Node 20+). */
export function makeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
