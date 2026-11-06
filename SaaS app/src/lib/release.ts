// Desktop app distribution: the DMG and the updater manifest live in a PRIVATE Cloud Storage bucket. Nothing here makes
// an object public; the app hands out V4 signed links that expire in minutes, only to signed-in users.
import { createHash } from "node:crypto";

export const TARGETS = ["darwin-aarch64"] as const;
export type Target = (typeof TARGETS)[number];
export const SIGNED_LINK_TTL_SEC = 600;

export type ManifestPlatform = { object: string; signature: string; dmg?: string };
export type Manifest = { version: string; notes: string; pub_date: string; platforms: Partial<Record<Target, ManifestPlatform>> };

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,5}$/;
const SAFE_OBJECT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;

export const isTarget = (t: string): t is Target => (TARGETS as readonly string[]).includes(t);
export const isVersion = (v: string) => VERSION.test(v);

/** -1, 0, 1. Both must pass isVersion. */
export function compareVersions(a: string, b: string): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** Validates latest.json. Object names must be plain file names (no slashes) so a bad manifest cannot point elsewhere. */
export function parseManifest(raw: unknown): Manifest | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.version !== "string" || !isVersion(m.version)) return null;
  if (!m.platforms || typeof m.platforms !== "object") return null;
  const platforms: Manifest["platforms"] = {};
  for (const t of TARGETS) {
    const p = (m.platforms as Record<string, unknown>)[t] as Record<string, unknown> | undefined;
    if (!p) continue;
    if (typeof p.object !== "string" || !SAFE_OBJECT.test(p.object) || typeof p.signature !== "string" || !p.signature) return null;
    if (p.dmg !== undefined && (typeof p.dmg !== "string" || !SAFE_OBJECT.test(p.dmg))) return null;
    platforms[t] = { object: p.object, signature: p.signature, dmg: p.dmg as string | undefined };
  }
  return {
    version: m.version,
    notes: typeof m.notes === "string" ? m.notes.slice(0, 2000) : "",
    pub_date: typeof m.pub_date === "string" ? m.pub_date : "",
    platforms,
  };
}

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Builds the V4 string to sign for a GET on bucket/object. Pure, so it is unit tested. */
export function v4Request(opts: { bucket: string; object: string; account: string; now: Date; ttlSec?: number }) {
  const ttl = opts.ttlSec ?? SIGNED_LINK_TTL_SEC;
  const stamp = opts.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); // 20261106T120000Z
  const date = stamp.slice(0, 8);
  const scope = `${date}/auto/storage/goog4_request`;
  const query = [
    ["X-Goog-Algorithm", "GOOG4-RSA-SHA256"],
    ["X-Goog-Credential", `${opts.account}/${scope}`],
    ["X-Goog-Date", stamp],
    ["X-Goog-Expires", String(ttl)],
    ["X-Goog-SignedHeaders", "host"],
  ]
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .sort()
    .join("&");
  const path = `/${opts.bucket}/${opts.object.split("/").map(enc).join("/")}`;
  const canonical = ["GET", path, query, "host:storage.googleapis.com\n", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["GOOG4-RSA-SHA256", stamp, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  return { toSign, urlBase: `https://storage.googleapis.com${path}?${query}` };
}

export class ReleaseNotConfigured extends Error {}

function config() {
  const bucket = process.env.RELEASES_BUCKET;
  const account = process.env.RELEASES_SIGNER;
  if (!bucket || !account) throw new ReleaseNotConfigured("releases are not set up");
  return { bucket, account };
}

let cached: { value: string; expires: number } | null = null;
async function token(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.value;
  const res = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
  if (!res.ok) throw new Error("no Google credential");
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { value: j.access_token, expires: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

/** A signed link for one object, valid SIGNED_LINK_TTL_SEC. The service account signs through IAM (no key file). */
export async function signedLink(object: string, now = new Date()): Promise<string> {
  const { bucket, account } = config();
  const { toSign, urlBase } = v4Request({ bucket, object, account, now });
  const res = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(account)}:signBlob`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ payload: Buffer.from(toSign).toString("base64") }),
  });
  if (!res.ok) throw new Error("could not sign the download link");
  const { signedBlob } = (await res.json()) as { signedBlob: string };
  return `${urlBase}&X-Goog-Signature=${Buffer.from(signedBlob, "base64").toString("hex")}`;
}

/** Reads and validates latest.json from the private bucket. Null when it is missing or malformed. */
export async function latestManifest(): Promise<Manifest | null> {
  const { bucket } = config();
  const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/latest.json?alt=media`, { headers: { authorization: `Bearer ${await token()}` }, cache: "no-store" });
  if (!res.ok) return null;
  try {
    return parseManifest(await res.json());
  } catch {
    return null;
  }
}
