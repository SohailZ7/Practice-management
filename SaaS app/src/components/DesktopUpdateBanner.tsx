import Link from "next/link";
import { db } from "@/lib/db";
import { levelFor } from "@/lib/access";
import { latestManifestCached, shouldShowUpdateBanner } from "@/lib/release";
import { dismissDesktopUpdate } from "@/app/download/actions";
import type { CurrentUser } from "@/lib/session";

/** Shown at the top for people who use the Mac recorder when a newer version is published. Version numbers only, no PHI. */
export async function DesktopUpdateBanner({ user }: { user: CurrentUser }) {
  if (levelFor(user, "notes") === "none") return null;
  const latest = (await latestManifestCached())?.version ?? null;
  if (!latest) return null;
  const usesDesktop = !!user.desktopVersion || (await db.desktopSession.count({ where: { userId: user.id } })) > 0;
  if (!shouldShowUpdateBanner({ latest, reported: user.desktopVersion, dismissed: user.desktopDismissedVersion, usesDesktop, hasNotes: true })) return null;
  return (
    <div className="notice row" role="status">
      <span className="grow">A new version of Practice Recorder is available (v{latest}).{" "}<Link href="/download">Download it</Link></span>
      <form action={dismissDesktopUpdate}>
        <input type="hidden" name="version" value={latest} />
        <button type="submit" className="secondary" aria-label="Dismiss this update notice">Dismiss</button>
      </form>
    </div>
  );
}
