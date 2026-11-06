import { audit } from "@/lib/audit";
import { ApiError, authenticate, handle, json } from "@/lib/desktop/api";
import { compareVersions, isTarget, isVersion, latestManifest, ReleaseNotConfigured, signedLink } from "@/lib/release";

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
  let manifest;
  try {
    manifest = await latestManifest();
  } catch (e) {
    if (e instanceof ReleaseNotConfigured) throw new ApiError(404, "no_releases");
    throw e;
  }
  const p = manifest?.platforms[target];
  if (!manifest || !p) throw new ApiError(404, "no_release");
  if (compareVersions(manifest.version, version) <= 0) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  await audit(user.email, "desktop.update.check", `${target} ${version} -> ${manifest.version}`);
  return json({ version: manifest.version, notes: manifest.notes, pub_date: manifest.pub_date, signature: p.signature, url: await signedLink(p.object) });
});
