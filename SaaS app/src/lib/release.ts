// Desktop app distribution: the DMG and the updater manifest live in a PRIVATE Cloud Storage bucket. Nothing here makes
// an object public; the app hands out V4 signed links that expire in minutes, only to signed-in users.
import { createHash } from "node:crypto";

export const TARGETS = ["darwin-aarch64"] as const;
export type Target = (typeof TARGETS)[number];
export const SIGNED_LINK_TTL_SEC = 900;

export type ManifestPlatform = { object: string; signature: string };
export type Manifest = { version: string; commit: string; notes: string; pub_date: string; dmg?: string; platforms: Partial<Record<Target, ManifestPlatform>> };

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,5}$/;
// Object paths inside the bucket, e.g. "releases/1.0.6/Practice Recorder.app.tar.gz": no leading slash, no "..".
const SAFE_OBJECT = /^[A-Za-z0-9][A-Za-z0-9 ._\/-]{0,200}$/;
export const safeObject = (o: unknown): o is string => typeof o === "string" && SAFE_OBJECT.test(o) && !o.split("/").some((seg) => seg === ".." || seg === "." || seg === "");

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
    if (!safeObject(p.object) || typeof p.signature !== "string" || !p.signature) return null;
    platforms[t] = { object: p.object, signature: p.signature };
  }
  if (m.dmg !== undefined && !safeObject(m.dmg)) return null;
  return {
    version: m.version,
    commit: typeof m.commit === "string" ? m.commit.slice(0, 40) : "",
    dmg: m.dmg as string | undefined,
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

/** Pure rule for the web banner. Only people who use the recorder (it reported a version or has a session) and have Notes access. */
export function shouldShowUpdateBanner(o: { latest: string | null; reported: string | null; dismissed: string | null; usesDesktop: boolean; hasNotes: boolean }): boolean {
  if (!o.latest || !isVersion(o.latest) || !o.usesDesktop || !o.hasNotes) return false;
  if (o.reported && isVersion(o.reported) && compareVersions(o.latest, o.reported) <= 0) return false;
  if (o.dismissed && isVersion(o.dismissed) && compareVersions(o.latest, o.dismissed) <= 0) return false;
  return true;
}

export class ReleaseNotConfigured extends Error {}

function config() {
  const bucket = process.env.DESKTOP_RELEASE_BUCKET;
  const account = process.env.DESKTOP_RELEASE_SIGNER;
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
let manifestCache: { at: number; value: Manifest | null } | null = null;
/** Same as latestManifest, kept for 5 minutes so every page view does not call Cloud Storage. Never throws. */
export async function latestManifestCached(): Promise<Manifest | null> {
  if (manifestCache && Date.now() - manifestCache.at < 300_000) return manifestCache.value;
  let value: Manifest | null = null;
  try {
    value = await latestManifest();
  } catch {
    value = null;
  }
  manifestCache = { at: Date.now(), value };
  return value;
}

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
