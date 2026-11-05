import { requireUser } from "@/lib/session";
import { Banner } from "@/components/Banner";
import { listFeedback } from "@/lib/feedback/service";
import { KINDS, KIND_LABEL, MAX_DESCRIPTION, MAX_TITLE } from "@/lib/feedback/rules";
import { submitFeedback, editFeedback } from "./actions";

export const dynamic = "force-dynamic";

const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });

export default async function Page({ searchParams }: { searchParams: { error?: string; notice?: string } }) {
  const user = await requireUser();
  const items = await listFeedback(user.id);
  return (
    <>
      <h1>Feedback</h1>
      <Banner error={searchParams.error} notice={searchParams.notice} />
      <p className="muted small">Tell us what to improve or what is broken. Type only, and never include patient information. Anyone signed in can add an item; only its author can edit it.</p>
      <form action={submitFeedback} className="card">
        <div className="row">
          <select name="kind" defaultValue="FEEDBACK" aria-label="Category">
            {KINDS.map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
          <input name="title" placeholder="Title" maxLength={MAX_TITLE} className="grow" required />
        </div>
        <textarea name="description" placeholder="Description" rows={4} maxLength={MAX_DESCRIPTION} style={{ width: "100%", marginTop: ".5rem" }} />
        <button type="submit" style={{ marginTop: ".5rem" }}>Submit</button>
      </form>

      {items.length === 0 && <p className="muted">Nothing here yet.</p>}
      {items.map((i) => (
        <div key={i.id} className="card">
          <div className="row">
            <strong className="grow">{i.title}</strong>
            <span className="muted small">{KIND_LABEL[i.kind]}</span>
          </div>
          <div className="muted small">{i.authorName} · {when(i.createdAt)}</div>
          {i.description && <p style={{ whiteSpace: "pre-wrap" }}>{i.description}</p>}
          {i.mine && (
            <details>
              <summary className="small">Edit</summary>
              <form action={editFeedback}>
                <input type="hidden" name="id" value={i.id} />
                <div className="row">
                  <select name="kind" defaultValue={i.kind} aria-label="Category">
                    {KINDS.map((k) => (
                      <option key={k} value={k}>{KIND_LABEL[k]}</option>
                    ))}
                  </select>
                  <input name="title" defaultValue={i.title} maxLength={MAX_TITLE} className="grow" required />
                </div>
                <textarea name="description" defaultValue={i.description} rows={4} maxLength={MAX_DESCRIPTION} style={{ width: "100%", marginTop: ".5rem" }} />
                <button type="submit" style={{ marginTop: ".5rem" }}>Save</button>
              </form>
            </details>
          )}
        </div>
      ))}
    </>
  );
}
