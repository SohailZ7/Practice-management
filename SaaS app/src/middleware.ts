import { NextResponse, type NextRequest } from "next/server";
import { encode, getToken } from "next-auth/jwt";
import { checkSession, sessionPolicy, shouldRefresh } from "@/lib/sessionExpiry";
import { SESSION_COOKIE_NAMES, sessionCookieName, useSecureCookies } from "@/lib/sessionCookie";
import { buildCsp, makeNonce } from "@/lib/security/csp";
import { clientIp, createLimiter, ruleFor, type Rule } from "@/lib/security/rateLimit";

// Everything except static assets requires a valid session. Per-module authorization happens on the
// server in requireAccess(). Sign-in pages and the Auth.js routes are public.
const PUBLIC = [/^\/login(\/|$)/, /^\/api\/auth(\/|$)/];

// One limiter per rule, kept in this process only (see src/lib/security/rateLimit.ts for the multi-instance caveat).
const limiters = new Map<string, ReturnType<typeof createLimiter>>();
function limiterFor(rule: Rule) {
  let l = limiters.get(rule.name);
  if (!l) limiters.set(rule.name, (l = createLimiter({ limit: rule.limit, windowMs: rule.windowMs })));
  return l;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const dev = process.env.NODE_ENV !== "production";
  const csp = buildCsp(makeNonce(), dev);

  // Next.js reads the nonce from the CSP header on the request and stamps it on its own scripts.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);
  requestHeaders.set("content-security-policy", csp);

  /** Headers every response gets: the page policy, and no caching of anything behind sign-in. */
  const finish = <T extends NextResponse>(res: T): T => {
    res.headers.set("Content-Security-Policy", csp);
    res.headers.set("Cache-Control", "no-store, max-age=0");
    res.headers.set("Pragma", "no-cache");
    return res;
  };
  const tooMany = (rule: Rule, retryAfterSec: number) => {
    console.warn(`rate limit hit: ${rule.name}`);
    return finish(
      NextResponse.json({ error: "Too many requests. Wait a moment and try again." }, { status: 429, headers: { "Retry-After": String(retryAfterSec) } }),
    );
  };

  const isAction = req.headers.has("next-action");
  const rule = ruleFor(req.method, pathname, isAction);

  if (PUBLIC.some((re) => re.test(pathname))) {
    if (rule?.by === "ip") {
      const hit = limiterFor(rule).hit(clientIp(req.headers.get("x-forwarded-for"), Number(process.env.TRUSTED_PROXY_HOPS ?? 1)));
      if (!hit.allowed) return tooMany(rule, hit.retryAfterSec);
    }
    return finish(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  const secret = process.env.NEXTAUTH_SECRET;
  const secure = useSecureCookies();
  const token = await getToken({ req, secret, cookieName: sessionCookieName(secure) });
  const now = Date.now();
  const policy = sessionPolicy();
  const verdict = checkSession(token ? { authAt: token.authAt, lastActive: token.lastActive } : null, now, policy);

  if (!token || !verdict.ok) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (token) url.searchParams.set("expired", "1");
    else url.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    const res = NextResponse.redirect(url);
    if (token) for (const name of SESSION_COOKIE_NAMES) res.cookies.delete(name);
    return finish(res);
  }

  if (rule) {
    const hit = limiterFor(rule).hit(rule.by === "user" ? `u:${token.email}` : clientIp(req.headers.get("x-forwarded-for")));
    if (!hit.allowed) return tooMany(rule, hit.retryAfterSec);
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  // Only a real request counts as activity (prefetches never reach this function, see the matcher below).
  // No timer ever extends the session.
  const lastActive = token.lastActive as number;
  if (shouldRefresh(lastActive, now)) {
    const remainingSec = Math.max(1, Math.floor((verdict.absoluteDeadline - now) / 1000));
    const value = await encode({ token: { ...token, lastActive: now }, secret: secret!, maxAge: remainingSec });
    res.cookies.set(sessionCookieName(secure), value, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: remainingSec,
    });
  }
  return finish(res);
}

// Next.js hides the prefetch header from middleware code, so prefetches (which no person asked for) are excluded
// here. They are still authorized by requireAccess() in the page, and they never refresh the session.
export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
