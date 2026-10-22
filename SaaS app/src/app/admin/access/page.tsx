import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/audit";
import { Banner } from "@/components/Banner";
import { LEVELS, MODULES } from "@/lib/access";
import { setAccess } from "../actions";

export default async function Page({ searchParams }: { searchParams: { error?: string; notice?: string } }) {
  const me = await requireAdmin();
  const [users] = await Promise.all([
    db.user.findMany({ orderBy: { createdAt: "asc" }, include: { access: true } }),
  ]);

  return (
    <>
      <Banner error={searchParams.error} notice={searchParams.notice} />
      <p className="muted">Choose which areas of the app each person can open. Admins can open everything.</p>
      <h2>Module access</h2>
      <div className="table-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th>User</th>
              {MODULES.map((m) => (
                <th key={m}>{m}</th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.name}
                  {u.role === "ADMIN" && <span className="pill"> admin: all</span>}
                </td>
                <td colSpan={MODULES.length + 1}>
                  <form action={setAccess} className="row" style={{ justifyContent: "space-around" }}>
                    <input type="hidden" name="id" value={u.id} />
                    {MODULES.map((m) => (
                      <select
                        key={m}
                        name={`level_${m}`}
                        defaultValue={u.access.find((a) => a.module === m)?.level ?? "none"}
                        disabled={u.role === "ADMIN"}
                        aria-label={`${u.name} ${m}`}
                      >
                        {LEVELS.map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </select>
                    ))}
                    <button type="submit" className="secondary" disabled={u.role === "ADMIN"}>
                      Save
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </>
  );
}
