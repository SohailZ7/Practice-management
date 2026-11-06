import { requireUser } from "@/lib/session";
import { normalizeTheme } from "@/lib/theme";
import { Banner } from "@/components/Banner";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { RECORDER_TOKEN_COOKIE } from "@/lib/desktop/tokens";
import { environmentLabel, webRelease } from "@/lib/buildInfo";
import { latestManifestCached } from "@/lib/release";
import Link from "next/link";
import { connectRecorder, revokeMyDesktopSession, saveTheme } from "./actions";

const OPTIONS = [
  { value: "light", label: "Light", hint: "Bright background, white navigation." },
  { value: "dark", label: "Dark", hint: "Dark navy navigation and panels." },
  { value: "system", label: "System", hint: "Match this device's setting." },
] as const;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { error?: string; notice?: string };
}) {
  const user = await requireUser();
  const current = normalizeTheme(user.theme);
  const macs = await db.desktopSession.findMany({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastUsedAt: "desc" } });
  const latestMac = (await latestManifestCached())?.version ?? null;
  const env = environmentLabel();
  const fresh = cookies().get(RECORDER_TOKEN_COOKIE)?.value.split("\n");
  return (
    <>
      <h1>Settings</h1>
      <Banner error={searchParams.error} notice={searchParams.notice} />
      <div className="card" style={{ maxWidth: 560 }}>
        <h2 style={{ marginTop: 0 }}>This version</h2>
        <p style={{ fontSize: "1.25rem", margin: 0 }}>
          <strong>{webRelease()}</strong> <span className="pill">{env}</span>
        </p>
      </div>
      {fresh && fresh.length === 2 && (
        <div className="notice">
          <strong>{fresh[0]}</strong>: <code>{fresh[1]}</code>
        </div>
      )}
      <form action={saveTheme} className="card" style={{ maxWidth: 560 }}>
        <h2 style={{ marginTop: 0 }}>Appearance</h2>
        <p className="muted small">Saved to your account, so it follows you to other browsers and devices.</p>
        <div className="theme-options" role="radiogroup" aria-label="Theme">
          {OPTIONS.map((o) => (
            <label key={o.value} className="theme-option">
              <input type="radio" name="theme" value={o.value} defaultChecked={current === o.value} />
              <span>
                <strong>{o.label}</strong>
                <span className="muted small"> {o.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <button type="submit" style={{ marginTop: ".75rem" }}>
          Save
        </button>
      </form>
      <div className="card" style={{ maxWidth: 560 }}>
        <h2 style={{ marginTop: 0 }}>Mac Desktop App</h2>
        <p className="muted small">
          The recorder is a small Mac app that records a visit and sends back the text. Download it, open it and sign in with
          Google. There is nothing to paste.
        </p>
        <p>
          <Link href="/download">Download the Mac app</Link>
          {" · "}Latest version: <strong>{latestMac ? `v${latestMac}` : "not published yet"}</strong>
        </p>
        <details style={{ marginBottom: ".6rem" }}>
          <summary className="muted small">Connect with a pairing token instead (only if Google sign-in is not possible)</summary>
          <form action={connectRecorder} className="row" style={{ marginTop: ".4rem" }}>
            <input name="label" placeholder="Which Mac? e.g. Consulting room" aria-label="Recorder name" />
            <button type="submit">Connect a recorder</button>
          </form>
        </details>
        {macs.length === 0 ? (
          <p className="muted small">No recorder is connected.</p>
        ) : (
          macs.map((m) => (
            <form key={m.id} action={revokeMyDesktopSession} className="row">
              <input type="hidden" name="id" value={m.id} />
              <span>
                {m.deviceLabel || "Mac"} <span className="muted small">· last used {m.lastUsedAt.toISOString().slice(0, 10)} · app {m.appVersion ? `v${m.appVersion}${latestMac && m.appVersion !== latestMac ? " (update available)" : ""}` : "version not reported yet"}</span>
              </span>
              <span className="grow" />
              <button type="submit" className="secondary">
                Sign out
              </button>
            </form>
          ))
        )}
      </div>
      <div className="card" style={{ maxWidth: 560 }}>
        <h2 style={{ marginTop: 0 }}>Account</h2>
        <div>{user.name}</div>
        <div className="muted small">{user.email}</div>
      </div>
    </>
  );
}
