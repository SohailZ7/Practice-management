import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/session";
import { latestManifest, ReleaseNotConfigured, signedLink } from "@/lib/release";

export const dynamic = "force-dynamic";

/** Signed-in users only (requireUser sends everyone else to sign-in). Redirects to a link that expires in minutes. */
export async function GET() {
  const user = await requireUser();
  try {
    const m = await latestManifest();
    const dmg = m?.dmg;
    if (!m || !dmg) return NextResponse.json({ error: "no_release" }, { status: 404 });
    await audit(user.email, "desktop.download", `dmg ${m.version}`);
    return NextResponse.redirect(await signedLink(dmg), { status: 302, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ReleaseNotConfigured) return NextResponse.json({ error: "no_releases" }, { status: 404 });
    console.error("download link failed");
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
