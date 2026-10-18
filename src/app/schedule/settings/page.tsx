import Link from "next/link";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { Banner } from "@/components/Banner";
import { addEntryType, addTrack, deleteEntryType, deleteTrack } from "./actions";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { error?: string; notice?: string };
}) {
  await requireAccess("schedule", "edit");
  const [tracks, types] = await Promise.all([
    db.trackDef.findMany({ orderBy: { sortOrder: "asc" } }),
    db.entryType.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <p>
        <Link href="/schedule">← Schedule</Link>
      </p>
      <h1>Tracks &amp; entry types</h1>
      <Banner error={searchParams.error} notice={searchParams.notice} />

      <h2>Tracks</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Start</th>
              <th>End</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.startTime}</td>
                <td>{t.endTime}</td>
                <td>
                  <form action={deleteTrack}>
                    <input type="hidden" name="id" value={t.id} />
                    <button type="submit" className="danger">
                      Remove
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form action={addTrack} className="card row" style={{ marginTop: ".5rem" }}>
        <input name="name" placeholder="Track name" required className="grow" />
        <input name="startTime" placeholder="Start, e.g. 8:30" />
        <input name="endTime" placeholder="End, e.g. 11:00" />
        <button type="submit">Add track</button>
      </form>

      <h2>Entry types</h2>
      <div className="table-wrap">
        <table>
          <tbody>
            {types.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td style={{ width: 120 }}>
                  <form action={deleteEntryType}>
                    <input type="hidden" name="id" value={t.id} />
                    <button type="submit" className="danger">
                      Remove
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form action={addEntryType} className="card row" style={{ marginTop: ".5rem" }}>
        <input name="name" placeholder="Type name" required className="grow" />
        <button type="submit">Add type</button>
      </form>
    </>
  );
}
