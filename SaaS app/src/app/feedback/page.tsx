import { requireUser } from "@/lib/session";
import { Banner } from "@/components/Banner";
import { listComments, listEvents, listFeedback } from "@/lib/feedback/service";
import { nextMoves, readyToPromote, SCOPES, SCOPE_LABEL, STATUS_LABEL, STATUSES, isStatus } from "@/lib/feedback/workflow";
import { KINDS, KIND_LABEL, MAX_DESCRIPTION, MAX_TITLE } from "@/lib/feedback/rules";
import { submitFeedback, editFeedback, moveFeedback, saveTestNotes, commentOnFeedback } from "./actions";
import { workflowActor } from "@/lib/feedback/actor";

export const dynamic = "force-dynamic";

const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });

export default async function Page({ searchParams }: { searchParams: { error?: string; notice?: string; status?: string } }) {
  const user = await requireUser();
  const actor = workflowActor(user);
  const all = await listFeedback(user.id);
  const filter = isStatus(searchParams.status) ? searchParams.status : "";
  const items = filter ? all.filter((i) => i.status === filter) : all;
  const [comments, events] = await Promise.all([listComments(items.map((i) => i.id)), listEvents(items.map((i) => i.id))]);
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

      <form method="get" className="row fb-filter">
        <label>Status{" "}
          <select name="status" defaultValue={filter}>
            <option value="">All</option>
            {STATUSES.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
          </select>
        </label>
        <button type="submit" className="secondary">Filter</button>
      </form>
      {items.length === 0 && <p className="muted">Nothing here yet.</p>}
      {items.map((i) => (
        <div key={i.id} className="card">
          <div className="row">
            <strong className="grow">{i.title}</strong>
            <span className={`fb-status fb-${i.status}`}>{STATUS_LABEL[i.status]}</span>
            <span className="muted small">{KIND_LABEL[i.kind]}</span>
          </div>
          <div className="muted small">{i.authorName} · {when(i.createdAt)}</div>
          {i.description && <p style={{ whiteSpace: "pre-wrap" }}>{i.description}</p>}
          {(i.scope || i.status === "approved" || i.release) && (
            <p className="muted small">
              Scope: {i.scope ? SCOPE_LABEL[i.scope] : "not set"}{i.release ? ` · built in Web 1.${i.release}${i.status === "shipped" ? ", live in production" : ""}` : ""}
              {i.status === "approved" ? (readyToPromote(i).ready ? " · ready to promote" : " · needs the owner's approval before promotion") : ""}
            </p>
          )}
          {i.testNotes && <div className="fb-notes"><strong className="small">Test notes</strong><p style={{ whiteSpace: "pre-wrap", margin: ".25rem 0 0" }}>{i.testNotes}</p></div>}
          {(comments[i.id] ?? []).length > 0 && (
            <div className="fb-thread" aria-label="Comments">
              {comments[i.id].map((c) => (
                <p key={c.id} className="small"><strong>{c.authorName}{c.authorKind === "agent" ? " (agent)" : ""}</strong> · {when(c.createdAt)}<br />{c.body}</p>
              ))}
            </div>
          )}
          {(events[i.id] ?? []).length > 0 && (
            <details>
              <summary className="small muted">History</summary>
              <ul className="small muted">
                {events[i.id].map((e) => <li key={e.id}>{when(e.at)} · {e.actorName}{e.actorKind === "agent" ? " (agent)" : ""}: {e.field.replace("_", " ")} {e.from ? `${e.from} → ` : ""}{e.to}</li>)}
              </ul>
            </details>
          )}
          {nextMoves(actor, i.status).length > 0 && (
            <form action={moveFeedback} className="fb-actions">
              <input type="hidden" name="id" value={i.id} />
              <textarea name="comment" rows={2} placeholder={actor.isAdmin ? "Comment (required for Needs changes)" : "What needs to change? (required for Needs changes)"} maxLength={2000} aria-label="Comment" />
              <div className="row">
                {actor.isAdmin && (
                  <select name="scope" defaultValue={i.scope ?? ""} aria-label="Scope (needed for Build it)">
                    <option value="">Scope…</option>
                    {SCOPES.map((sc) => <option key={sc} value={sc}>{SCOPE_LABEL[sc]}</option>)}
                  </select>
                )}
                {nextMoves(actor, i.status).map((st) => (
                  <button key={st} type="submit" name="status" value={st} className={st === "approved" || st === "build_it" ? "" : "secondary"}>{STATUS_LABEL[st]}</button>
                ))}
              </div>
            </form>
          )}
          {actor.isAdmin && (
            <details>
              <summary className="small">Test notes</summary>
              <form action={saveTestNotes}>
                <input type="hidden" name="id" value={i.id} />
                <textarea name="testNotes" defaultValue={i.testNotes} rows={3} maxLength={4000} placeholder="What changed, how to test, preview link" style={{ width: "100%" }} />
                <button type="submit" className="secondary" style={{ marginTop: ".5rem" }}>Save test notes</button>
              </form>
            </details>
          )}
          {(actor.isAdmin || actor.isApprover || i.mine) && nextMoves(actor, i.status).length === 0 && (
            <form action={commentOnFeedback} className="row">
              <input type="hidden" name="id" value={i.id} />
              <input name="comment" placeholder="Add a comment" maxLength={2000} className="grow" aria-label="Comment" />
              <button type="submit" className="secondary">Comment</button>
            </form>
          )}
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
