// CSRF defence for JSON/multipart API routes that change state. SameSite=Lax cookies already block most cross-site
// POSTs; this adds an explicit same-origin check on top (defence in depth).

export type OriginInput = {
  method: string;
  origin: string | null;
  host: string | null;
  forwardedHost?: string | null;
  secFetchSite?: string | null;
  allowedOrigin?: string | null; // e.g. NEXTAUTH_URL
};

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** True when a state-changing request plausibly came from our own pages. */
export function isSameOrigin(i: OriginInput): boolean {
  if (SAFE.has(i.method.toUpperCase())) return true;
  const allowed = new Set(
    [i.host, i.forwardedHost?.split(",")[0].trim(), hostOf(i.allowedOrigin)].filter(Boolean).map((h) => h!.toLowerCase()),
  );
  if (i.origin) {
    const originHost = hostOf(i.origin);
    return i.origin !== "null" && originHost !== null && allowed.has(originHost);
  }
  // No Origin header (some older clients): only a same-origin Fetch Metadata value is acceptable.
  return i.secFetchSite === "same-origin";
}

/** Returns a 403 response when the check fails, otherwise null. */
export function rejectCrossOrigin(req: Request): Response | null {
  const h = req.headers;
  const ok = isSameOrigin({
    method: req.method,
    origin: h.get("origin"),
    host: h.get("host"),
    forwardedHost: h.get("x-forwarded-host"),
    secFetchSite: h.get("sec-fetch-site"),
    allowedOrigin: process.env.NEXTAUTH_URL,
  });
  return ok ? null : Response.json({ error: "Cross-origin request refused" }, { status: 403 });
}
