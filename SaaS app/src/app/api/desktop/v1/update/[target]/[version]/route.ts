import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ApiError, authenticate, handle, json } from "@/lib/desktop/api";
import { isTarget, isVersion, latestManifest, ReleaseNotConfigured, signedLink } from "@/lib/release";

export const dynamic = "force-dynamic";

/**
 * Tauri updater endpoint. Any signed-in recorder may ask. 204 = up to date. Otherwise the new version, its signature
 * and a signed link that expires in minutes (the bucket itself stays private).
 */
export const GET = handle(async (req) => {
  const { user } = await authenticate(req);
  const parts = new URL(req.url).pathname.split("/");
  const version = parts[parts.length - 1];
  const target = parts[parts.length - 2];
  if (!isTarget(target)) throw new ApiError(400, "bad_target");
  if (!isVersion(version)) throw new ApiError(400, "bad_version");
  // Remember which version this person's recorder is on (drives the web update banner).
  await db.user.update({ where: { id: user.id }, data: { desktopVersion: version, desktopSeenAt: new Date() } });
  let manifest;
  try {
    manifest = await latestManifest();
  } catch (e) {
    if (e instanceof ReleaseNotConfigured) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    throw e;
  }
  const p = manifest?.platforms[target];
  // Nothing published for this Mac, or already on the published version: 204. A different version applies, so pointing
  // latest.json at an older release is a working rollback.
  if (!manifest || !p || manifest.version === version) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  await audit(user.email, "desktop.update.check", `${target} ${version} -> ${manifest.version}`); // never the signed link
  return json({ version: manifest.version, notes: manifest.notes, pub_date: manifest.pub_date, signature: p.signature, url: await signedLink(p.object) });
});
