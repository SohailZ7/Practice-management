import { NextResponse, type NextRequest } from "next/server";
import { encode, getToken } from "next-auth/jwt";
import { checkSession, sessionPolicy, shouldRefresh } from "@/lib/sessionExpiry";
import { SESSION_COOKIE_NAMES, sessionCookieName, useSecureCookies } from "@/lib/sessionCookie";

// Everything except static assets requires a valid session. Per-module authorization happens on the
// server in requireAccess(). Sign-in pages and the Auth.js routes are public.
const PUBLIC = [/^\/login(\/|$)/, /^\/api\/auth(\/|$)/];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();

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
    return res;
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);
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
  return res;
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
