import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { dueLabel, todayISO } from "@/lib/dates";
import { linkTypeMeta } from "@/lib/links";
import { Banner } from "@/components/Banner";
import { AutoDate, AutoSelect, AutoText } from "@/components/AutoFields";
import {
  addCategory,
  addLink,
  addTask,
  deleteCategory,
  deleteTask,
  moveTask,
  removeLink,
  renameCategory,
  setAssignee,
  setCategory,
  setDue,
  setTitle,
  toggleComplete,
  toggleToday,
} from "./actions";

type TaskRow = Prisma.TaskGetPayload<{ include: { links: true; assignee: true; category: true } }>;
type Opt = { id: string; name: string };
type Search = { scope?: string; error?: string; notice?: string };

export default async function TasksPage({ searchParams }: { searchParams: Search }) {
  const user = await requireAccess("tasks", "view");
  const canEdit = canAccess(user, "tasks", "edit");
  const scope = searchParams.scope || "mine";

  const [categories, employees, me] = await Promise.all([
    db.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.employee.findUnique({ where: { email: user.email } }),
  ]);

  const where: Prisma.TaskWhereInput = {};
  if (scope === "mine") where.assigneeId = me?.id ?? "none";
  else if (scope !== "all") where.assigneeId = scope;

  const tasks = await db.task.findMany({
    where,
    include: { links: true, assignee: true, category: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  const open = tasks.filter((t) => !t.completed);
  const today = open.filter((t) => t.inToday);
  const uncategorized = open.filter((t) => !t.categoryId);
  const completed = tasks.filter((t) => t.completed);

  const ctx = { canEdit, scope, categories, employees };

  return (
    <>
      <h1>Tasks</h1>
      <Banner error={searchParams.error} notice={searchParams.notice} />

      <form method="get" className="row" style={{ marginBottom: "1rem" }}>
        <label htmlFor="scope">Show</label>
        <select id="scope" name="scope" defaultValue={scope}>
          <option value="mine">My tasks</option>
          <option value="all">Everyone</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <button type="submit" className="secondary">
          Apply
        </button>
        {scope === "mine" && !me && (
          <span className="muted small">No employee record matches your login email yet.</span>
        )}
      </form>

      <Section id="today" title="Today" tasks={today} defaultOpen {...ctx} addDefaults={{ inToday: true, assigneeId: me?.id }} />
      {categories.map((c) => (
        <Section
          key={c.id}
          id={c.id}
          title={c.name}
          tasks={open.filter((t) => t.categoryId === c.id)}
          defaultOpen
          {...ctx}
          addDefaults={{ categoryId: c.id, assigneeId: me?.id }}
        />
      ))}
      <Section
        id="none"
        title="No category"
        tasks={uncategorized}
        defaultOpen
        {...ctx}
        addDefaults={{ assigneeId: me?.id }}
      />
      <Section id="completed" title="Completed" tasks={completed} {...ctx} />

      {canEdit && (
        <details className="card">
          <summary>Categories</summary>
          <div style={{ marginTop: ".5rem" }}>
            {categories.map((c) => (
              <div key={c.id} className="row" style={{ marginBottom: ".4rem" }}>
                <form action={renameCategory} className="row grow">
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="scope" value={scope} />
                  <input name="name" defaultValue={c.name} className="grow" aria-label="Category name" />
                  <button type="submit" className="secondary">
                    Rename
                  </button>
                </form>
                <form action={deleteCategory}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="scope" value={scope} />
                  <button type="submit" className="danger">
                    Delete
                  </button>
                </form>
              </div>
            ))}
            <form action={addCategory} className="row">
              <input type="hidden" name="scope" value={scope} />
              <input name="name" placeholder="New category" className="grow" />
              <button type="submit">Add category</button>
            </form>
            <p className="muted small">Deleting a category keeps its tasks; they move to "No category".</p>
          </div>
        </details>
      )}
    </>
  );
}

function Section({
  id,
  title,
  tasks,
  defaultOpen,
  canEdit,
  scope,
  categories,
  employees,
  addDefaults,
}: {
  id: string;
  title: string;
  tasks: TaskRow[];
  defaultOpen?: boolean;
  canEdit: boolean;
  scope: string;
  categories: Opt[];
  employees: Opt[];
  addDefaults?: { categoryId?: string; assigneeId?: string; inToday?: boolean };
}) {
  const order = tasks.map((t) => t.id).join(",");
  return (
    <details className="task-section" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        <span className="count">{tasks.length}</span>
      </summary>
      {tasks.map((t, i) => (
        <TaskItem
          key={t.id}
          task={t}
          index={i}
          last={tasks.length - 1}
          order={order}
          canEdit={canEdit}
          scope={scope}
          categories={categories}
          employees={employees}
        />
      ))}
      {canEdit && addDefaults && (
        <form action={addTask} className="add-task">
          <input type="hidden" name="scope" value={scope} />
          <input type="hidden" name="categoryId" value={addDefaults.categoryId ?? ""} />
          <input type="hidden" name="assigneeId" value={addDefaults.assigneeId ?? ""} />
          <input type="hidden" name="inToday" value={addDefaults.inToday ? "1" : "0"} />
          <input name="title" placeholder={`Add a task to ${title}…`} aria-label={`New task in ${title}`} />
          <button type="submit">Add</button>
        </form>
      )}
      {!canEdit && tasks.length === 0 && <div className="task muted">Nothing here.</div>}
      <span id={`sec-${id}`} />
    </details>
  );
}

function TaskItem({
  task: t,
  index,
  last,
  order,
  canEdit,
  scope,
  categories,
  employees,
}: {
  task: TaskRow;
  index: number;
  last: number;
  order: string;
  canEdit: boolean;
  scope: string;
  categories: Opt[];
  employees: Opt[];
}) {
  const due = dueLabel(t.dueDate, todayISO());
  const hidden = (
    <>
      <input type="hidden" name="id" value={t.id} />
      <input type="hidden" name="scope" value={scope} />
    </>
  );

  if (!canEdit) {
    return (
      <div>
        <div className={`task ${t.completed ? "done" : ""}`}>
          <span className="title">{t.title}</span>
          <span className="muted small">{t.category?.name ?? "No category"}</span>
          <span className="muted small">{t.assignee?.name ?? "Unassigned"}</span>
          {t.dueDate && <span className={`due-pill ${due.className}`}>{due.text}</span>}
        </div>
        <LinkChips task={t} canEdit={false} scope={scope} />
      </div>
    );
  }

  return (
    <div>
      <div className={`task ${t.completed ? "done" : ""}`}>
        <form action={toggleComplete}>
          {hidden}
          <button className="icon-btn" title={t.completed ? "Mark not done" : "Mark done"} aria-label="Toggle complete">
            {t.completed ? "☑" : "☐"}
          </button>
        </form>
        <form action={setTitle} className="title">
          {hidden}
          <AutoText name="title" defaultValue={t.title} label="Title" />
        </form>
        <form action={setCategory}>
          {hidden}
          <AutoSelect name="categoryId" defaultValue={t.categoryId ?? ""} label="Category">
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </AutoSelect>
        </form>
        <form action={setAssignee}>
          {hidden}
          <AutoSelect name="assigneeId" defaultValue={t.assigneeId ?? ""} label="Assignee">
            <option value="">Unassigned</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </AutoSelect>
        </form>
        <form action={setDue} className="row" style={{ gap: ".25rem" }}>
          {hidden}
          <span className={`due-pill ${due.className}`}>{due.text}</span>
          <AutoDate name="dueDate" defaultValue={t.dueDate ?? ""} label="Due date" />
        </form>
        <form action={toggleToday}>
          {hidden}
          <button className={`icon-btn ${t.inToday ? "active" : ""}`} title="Show in Today" aria-label="Toggle Today">
            ☀
          </button>
        </form>
        {!t.completed && (
          <>
            <form action={moveTask}>
              {hidden}
              <input type="hidden" name="order" value={order} />
              <input type="hidden" name="dir" value="up" />
              <button className="icon-btn" disabled={index === 0} title="Move up" aria-label="Move up">
                ↑
              </button>
            </form>
            <form action={moveTask}>
              {hidden}
              <input type="hidden" name="order" value={order} />
              <input type="hidden" name="dir" value="down" />
              <button className="icon-btn" disabled={index === last} title="Move down" aria-label="Move down">
                ↓
              </button>
            </form>
          </>
        )}
        <details>
          <summary className="icon-btn" title="Attach a link" style={{ cursor: "pointer", listStyle: "none" }}>
            🔗
          </summary>
          <form action={addLink} className="row" style={{ marginTop: ".25rem" }}>
            {hidden}
            <input name="url" placeholder="Paste a link (Webex, PR, doc, .md)…" aria-label="Link URL" />
            <button type="submit" className="secondary">
              Add
            </button>
          </form>
        </details>
        <form action={deleteTask}>
          {hidden}
          <button className="icon-btn" title="Delete task" aria-label="Delete task">
            ×
          </button>
        </form>
      </div>
      <LinkChips task={t} canEdit scope={scope} />
    </div>
  );
}

function LinkChips({ task, canEdit, scope }: { task: TaskRow; canEdit: boolean; scope: string }) {
  if (task.links.length === 0) return null;
  return (
    <div className="links">
      {task.links.map((l) => {
        const meta = linkTypeMeta(l.type);
        return (
          <span key={l.id} className="link-chip">
            <a href={l.url} target="_blank" rel="noreferrer noopener" title={l.url}>
              {meta.icon} {l.label}
            </a>
            {canEdit && (
              <form action={removeLink}>
                <input type="hidden" name="linkId" value={l.id} />
                <input type="hidden" name="scope" value={scope} />
                <button title="Remove link" aria-label="Remove link">
                  ×
                </button>
              </form>
            )}
          </span>
        );
      })}
    </div>
  );
}

export const dynamic = "force-dynamic";
