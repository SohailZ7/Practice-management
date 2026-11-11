// Settings for the browser-side "Promote to production" button. Pure and env-injectable so it is unit-tested.
//
// Production side: PROMOTE_WEB_ORIGINS (comma list of exact https origins, empty = off) lets that web page call the
// Desktop API with a bearer token, and GOOGLE_WEB_CLIENT_ID lets auth/google-web accept a Google sign-in from it.
// Staging side: PROMOTE_PROD_URL + GOOGLE_WEB_CLIENT_ID (APP_ENV=staging only) switch the button on.
// No shared secret exists in this design: the browser signs in to production itself, as the person pressing the button.

type Env = Record<string, string | undefined>;

const httpsOrigin = (s: string): string | null => {
  try {
    const u = new URL(s.trim());
    return u.protocol === "https:" && !u.username && !u.password ? u.origin : null;
  } catch {
    return null;
  }
};

export function webPromoteOrigins(env: Env): string[] {
  return (env.PROMOTE_WEB_ORIGINS ?? "").split(",").map(httpsOrigin).filter((o): o is string => !!o);
}

/** CORS headers for an allowed origin, or null (no headers at all) for anything else. Bearer tokens only, no cookies. */
export function corsHeadersFor(origin: string | null, env: Env): Record<string, string> | null {
  if (!origin || !webPromoteOrigins(env).includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export type StagingPromote = { prodUrl: string; clientId: string };

/** Present only on staging with both settings; otherwise the button is not offered at all. */
export function stagingPromoteConfig(env: Env): StagingPromote | null {
  if ((env.APP_ENV ?? "").trim().toLowerCase() !== "staging") return null;
  const prodUrl = httpsOrigin(env.PROMOTE_PROD_URL ?? "");
  const clientId = (env.GOOGLE_WEB_CLIENT_ID ?? "").trim();
  return prodUrl && clientId ? { prodUrl, clientId } : null;
}

/** Extra Content-Security-Policy sources the button needs (Google sign-in and the production address). Staging only. */
export function promoteCspExtras(env: Env): { connect: string[]; frame: string[] } | undefined {
  const c = stagingPromoteConfig(env);
  return c ? { connect: [c.prodUrl, "https://accounts.google.com"], frame: ["https://accounts.google.com"] } : undefined;
}
