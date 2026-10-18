import { requireUser } from "@/lib/session";
import { normalizeTheme } from "@/lib/theme";
import { Banner } from "@/components/Banner";
import { saveTheme } from "./actions";

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
  return (
    <>
      <h1>Settings</h1>
      <Banner error={searchParams.error} notice={searchParams.notice} />
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
        <h2 style={{ marginTop: 0 }}>Account</h2>
        <div>{user.name}</div>
        <div className="muted small">{user.email}</div>
      </div>
    </>
  );
}
