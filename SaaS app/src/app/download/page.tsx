import { requireUser } from "@/lib/session";
import { latestManifest, ReleaseNotConfigured } from "@/lib/release";

export const dynamic = "force-dynamic";

export default async function DownloadPage() {
  await requireUser();
  let version = "";
  let ready = false;
  try {
    const m = await latestManifest();
    ready = !!m?.platforms["darwin-aarch64"]?.dmg;
    version = m?.version ?? "";
  } catch (e) {
    if (!(e instanceof ReleaseNotConfigured)) throw e;
  }
  return (
    <div className="card">
      <h1>Practice Recorder for Mac</h1>
      {ready ? (
        <>
          <p>Version {version} for Macs with Apple silicon (M1 or later). The link works for a few minutes after you press the button.</p>
          <p><a className="button" href="/api/download/dmg">Download</a></p>
        </>
      ) : (
        <p>No download is published yet. Ask your Admin.</p>
      )}
    </div>
  );
}
