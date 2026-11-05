import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { Banner } from "@/components/Banner";
import { NEW_TOKEN_COOKIE } from "@/lib/mcpApi/tokens";
import { issueApiToken, revokeApiToken } from "../actions";

export default async function Page({ searchParams }: { searchParams: { error?: string; notice?: string } }) {
  await requireAdmin();
  const [users, tokens] = await Promise.all([
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true } }),
    db.apiToken.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { user: { select: { email: true } } } }),
  ]);
  const fresh = cookies().get(NEW_TOKEN_COOKIE)?.value.split("\n");
  const now = Date.now();

  return (
    <>
      <Banner error={searchParams.error} notice={searchParams.notice} />
      <h2>Claude tokens</h2>
      <p className="muted small">
        Lets Claude manage Tasks through the MCP server. A token acts as the chosen user, can only use Tasks, never sees more than
        that user can, and every call is written to the activity log. It is shown once and only its hash is stored.
      </p>
      {fresh && fresh.length === 2 && (
        <div className="notice">
          <strong>{fresh[0]}</strong>: <code>{fresh[1]}</code>
        </div>
      )}
      <form action={issueApiToken} className="card row">
        <select name="userId" defaultValue="" aria-label="User" required>
          <option value="" disabled>
            User…
          </option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.email})
            </option>
          ))}
        </select>
        <input name="label" placeholder="Label (e.g. Sohail's Claude)" className="grow" />
        <input name="days" type="number" min={1} max={365} defaultValue={90} aria-label="Days valid" style={{ width: 90 }} />
        <button type="submit">Create token</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>User</th>
              <th>Expires</th>
              <th>Last used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => {
              const state = t.revokedAt ? "revoked" : t.expiresAt.getTime() <= now ? "expired" : "active";
              return (
                <tr key={t.id}>
                  <td>{t.label}</td>
                  <td className="small muted">{t.user.email}</td>
                  <td className="small">{t.expiresAt.toISOString().slice(0, 10)}</td>
                  <td className="small muted">{t.lastUsedAt ? t.lastUsedAt.toISOString().slice(0, 16).replace("T", " ") : "never"}</td>
                  <td>
                    {state === "active" ? (
                      <form action={revokeApiToken}>
                        <input type="hidden" name="id" value={t.id} />
                        <button type="submit" className="secondary">
                          Revoke
                        </button>
                      </form>
                    ) : (
                      <span className="muted small">{state}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
