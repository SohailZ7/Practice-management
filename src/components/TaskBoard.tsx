"use client";

import { useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { dueLabel } from "@/lib/dates";
import { linkTypeMeta } from "@/lib/links";
import { applyReorder, type CategoryDTO, type TaskDTO, type TaskPatch } from "@/lib/taskTypes";
import {
  addCategory,
  addTaskLink,
  createTask,
  deleteCategory,
  deleteTask,
  removeTaskLink,
  renameCategory,
  reorderTasks,
  updateTask,
} from "@/app/tasks/actions";

type Opt = { id: string; name: string };

type Props = {
  initialTasks: TaskDTO[];
  categories: CategoryDTO[];
  employees: Opt[];
  canEdit: boolean;
  /** The employee whose tab this is (null = Unassigned). */
  boardAssigneeId: string | null;
  today: string;
};

const TODAY = "today";
const NONE = "none";
const DONE = "completed";

export function TaskBoard({ initialTasks, categories: initialCategories, employees, canEdit, boardAssigneeId, today }: Props) {
  const [tasks, setTasks] = useState<TaskDTO[]>(initialTasks);
  const [categories, setCategories] = useState<CategoryDTO[]>(initialCategories);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set([DONE]));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : "Something went wrong");

  /** Optimistic update: apply locally, call the server, roll back on failure. */
  async function mutate(next: TaskDTO[], call: () => Promise<unknown>) {
    const snapshot = tasks;
    setTasks(next);
    setError("");
    try {
      await call();
    } catch (e) {
      setTasks(snapshot);
      fail(e);
    }
  }

  const patchTask = (id: string, patch: TaskPatch) => {
    // Reassigning to someone else moves the task to that person's tab.
    const leaves = patch.assigneeId !== undefined && patch.assigneeId !== boardAssigneeId;
    const next = leaves
      ? tasks.filter((t) => t.id !== id)
      : tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
    return mutate(next, () => updateTask(id, patch));
  };

  const removeTask = (id: string) => mutate(tasks.filter((t) => t.id !== id), () => deleteTask(id));

  async function add(title: string, categoryId: string | null, inToday: boolean) {
    setError("");
    try {
      const dto = await createTask({ title, categoryId, assigneeId: boardAssigneeId, inToday });
      setTasks((ts) => [...ts, dto]);
    } catch (e) {
      fail(e);
    }
  }

  const reorder = (orderedIds: string[]) =>
    mutate(applyReorder(tasks, orderedIds), () => reorderTasks(orderedIds));

  async function addLink(id: string, url: string) {
    setError("");
    try {
      const link = await addTaskLink(id, url);
      setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, links: [...t.links, link] } : t)));
    } catch (e) {
      fail(e);
    }
  }

  async function removeLink(id: string, linkId: string) {
    const snapshot = tasks;
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, links: t.links.filter((l) => l.id !== linkId) } : t)));
    try {
      await removeTaskLink(linkId);
    } catch (e) {
      setTasks(snapshot);
      fail(e);
    }
  }

  const open = useMemo(() => tasks.filter((t) => !t.completed), [tasks]);
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const itemProps = {
    categories,
    employees,
    today,
    onPatch: patchTask,
    onDelete: removeTask,
    onAddLink: addLink,
    onRemoveLink: removeLink,
  };
  const sectionProps = { sensors, canEdit, collapsed, onToggle: toggle, onReorder: reorder, itemProps };

  return (
    <div className="todo-board">
      {error && (
        <div className="error" role="alert">
          {error}{" "}
          <button className="icon-btn" onClick={() => setError("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <Section
        id={TODAY}
        name="Today"
        tasks={open.filter((t) => t.inToday)}
        onAdd={canEdit ? (title) => add(title, null, true) : undefined}
        {...sectionProps}
      />
      {categories.map((c) => (
        <Section
          key={c.id}
          id={c.id}
          name={c.name}
          tasks={open.filter((t) => t.categoryId === c.id)}
          onAdd={canEdit ? (title) => add(title, c.id, false) : undefined}
          {...sectionProps}
        />
      ))}
      <Section
        id={NONE}
        name="No category"
        tasks={open.filter((t) => !t.categoryId)}
        onAdd={canEdit ? (title) => add(title, null, false) : undefined}
        {...sectionProps}
      />
      <Section id={DONE} name="Completed" tasks={tasks.filter((t) => t.completed)} {...sectionProps} />

      {canEdit && (
        <CategoryManager
          categories={categories}
          onAdd={async (name) => {
            try {
              const c = await addCategory(name);
              setCategories((cs) => [...cs, c]);
            } catch (e) {
              fail(e);
            }
          }}
          onRename={async (id, name) => {
            try {
              await renameCategory(id, name);
              setCategories((cs) => cs.map((c) => (c.id === id ? { ...c, name } : c)));
            } catch (e) {
              fail(e);
            }
          }}
          onDelete={async (id) => {
            try {
              await deleteCategory(id);
              setCategories((cs) => cs.filter((c) => c.id !== id));
              setTasks((ts) => ts.map((t) => (t.categoryId === id ? { ...t, categoryId: null } : t)));
            } catch (e) {
              fail(e);
            }
          }}
        />
      )}
    </div>
  );
}

type ItemProps = {
  categories: CategoryDTO[];
  employees: Opt[];
  today: string;
  onPatch: (id: string, patch: TaskPatch) => void;
  onDelete: (id: string) => void;
  onAddLink: (id: string, url: string) => void;
  onRemoveLink: (id: string, linkId: string) => void;
};

function Section({
  id,
  name,
  tasks,
  sensors,
  canEdit,
  collapsed,
  onToggle,
  onReorder,
  onAdd,
  itemProps,
}: {
  id: string;
  name: string;
  tasks: TaskDTO[];
  sensors: ReturnType<typeof useSensors>;
  canEdit: boolean;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onAdd?: (title: string) => void;
  itemProps: ItemProps;
}) {
  const isOpen = !collapsed.has(id);
  const ids = tasks.map((t) => t.id);

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  }

  return (
    <section className="todo-section" id={`sec-${id}`}>
      <button className="todo-section-head" onClick={() => onToggle(id)} aria-expanded={isOpen}>
        <span className="chev">{isOpen ? "▾" : "▸"}</span>
        <span className="name">{name}</span>
        <span className="count">{tasks.length}</span>
      </button>
      {isOpen && (
        <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              {tasks.map((t) => (
                <TaskItem key={t.id} task={t} canEdit={canEdit} {...itemProps} />
              ))}
            </SortableContext>
          </DndContext>
          {tasks.length === 0 && <div className="todo-empty">Nothing here.</div>}
          {onAdd && <InlineAdd placeholder={`Add a task to ${name}…`} onAdd={onAdd} />}
        </>
      )}
    </section>
  );
}

function InlineAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (title: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="todo-add"
      onSubmit={(e) => {
        e.preventDefault();
        const t = value.trim();
        if (t) onAdd(t);
        setValue("");
      }}
    >
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </form>
  );
}

function TaskItem({
  task,
  canEdit,
  categories,
  employees,
  today,
  onPatch,
  onDelete,
  onAddLink,
  onRemoveLink,
}: ItemProps & { task: TaskDTO; canEdit: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !canEdit,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const [addingLink, setAddingLink] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const dateRef = useRef<HTMLInputElement>(null);

  const due = dueLabel(task.dueDate, today);
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const commitTitle = () => {
    const t = draft.trim();
    if (t && t !== task.title) onPatch(task.id, { title: t });
    else setDraft(task.title);
    setEditing(false);
  };
  const commitLink = () => {
    const u = linkDraft.trim();
    if (u) onAddLink(task.id, u);
    setLinkDraft("");
    setAddingLink(false);
  };
  const openPicker = () => {
    const input = dateRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  };

  return (
    <div ref={setNodeRef} style={style} className={`todo-item ${task.completed ? "completed" : ""}`}>
      <div className="todo-row">
        {canEdit && (
          <button className="drag-handle" {...attributes} {...listeners} title="Drag to reorder" aria-label="Drag to reorder">
            ⠿
          </button>
        )}
        <input
          type="checkbox"
          checked={task.completed}
          disabled={!canEdit}
          aria-label="Done"
          onChange={() => onPatch(task.id, { completed: !task.completed })}
        />
        {editing && canEdit ? (
          <input
            className="todo-title-input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitle();
              if (e.key === "Escape") {
                setDraft(task.title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span
            className="todo-title"
            title={canEdit ? "Click to edit" : undefined}
            onClick={() => {
              if (!canEdit) return;
              setDraft(task.title);
              setEditing(true);
            }}
          >
            {task.title}
          </span>
        )}
        <select
          className="pick"
          value={task.categoryId ?? ""}
          disabled={!canEdit}
          aria-label="Category"
          onChange={(e) => onPatch(task.id, { categoryId: e.target.value || null })}
        >
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className="pick"
          value={task.assigneeId ?? ""}
          disabled={!canEdit}
          aria-label="Assigned to"
          onChange={(e) => onPatch(task.id, { assigneeId: e.target.value || null })}
        >
          <option value="">Unassigned</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <button type="button" className={`due-pill ${due.className}`} onClick={openPicker} disabled={!canEdit} title="Set due date">
          {due.text}
        </button>
        <input
          ref={dateRef}
          type="date"
          className="due-date-hidden"
          value={task.dueDate ?? ""}
          tabIndex={-1}
          aria-label="Due date"
          onChange={(e) => onPatch(task.id, { dueDate: e.target.value || null })}
        />
        <button
          className={`icon-btn ${task.inToday ? "active" : ""}`}
          title="Show in Today"
          aria-label="Show in Today"
          aria-pressed={task.inToday}
          disabled={!canEdit}
          onClick={() => onPatch(task.id, { inToday: !task.inToday })}
        >
          ☀
        </button>
        {canEdit && (
          <>
            <button className="icon-btn" title="Attach a link" aria-label="Attach a link" onClick={() => setAddingLink((v) => !v)}>
              🔗
            </button>
            <button className="icon-btn" title="Delete task" aria-label="Delete task" onClick={() => onDelete(task.id)}>
              ×
            </button>
          </>
        )}
      </div>
      {(task.links.length > 0 || addingLink) && (
        <div className="todo-links">
          {task.links.map((l) => {
            const meta = linkTypeMeta(l.type);
            return (
              <span key={l.id} className="link-chip">
                <a href={l.url} target="_blank" rel="noreferrer noopener" title={l.url}>
                  {meta.icon} {l.label}
                </a>
                {canEdit && (
                  <button onClick={() => onRemoveLink(task.id, l.id)} title="Remove link" aria-label="Remove link">
                    ×
                  </button>
                )}
              </span>
            );
          })}
          {addingLink && (
            <input
              className="link-input"
              autoFocus
              placeholder="Paste a link (Webex, PR, doc, .md)…"
              value={linkDraft}
              onChange={(e) => setLinkDraft(e.target.value)}
              onBlur={commitLink}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitLink();
                if (e.key === "Escape") {
                  setLinkDraft("");
                  setAddingLink(false);
                }
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function CategoryManager({
  categories,
  onAdd,
  onRename,
  onDelete,
}: {
  categories: CategoryDTO[];
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <details className="card" style={{ marginTop: "1rem" }}>
      <summary>Manage categories</summary>
      <div style={{ marginTop: ".5rem" }}>
        {categories.map((c) => (
          <div key={c.id} className="row" style={{ marginBottom: ".4rem" }}>
            <input
              defaultValue={c.name}
              className="grow"
              aria-label={`Rename ${c.name}`}
              onBlur={(e) => {
                const v = e.currentTarget.value.trim();
                if (v && v !== c.name) onRename(c.id, v);
                else e.currentTarget.value = c.name;
              }}
            />
            <button
              className="danger"
              onClick={() => {
                if (window.confirm(`Delete category "${c.name}"? Its tasks move to "No category".`)) onDelete(c.id);
              }}
            >
              Delete
            </button>
          </div>
        ))}
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onAdd(name);
            setName("");
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category" className="grow" />
          <button type="submit">Add category</button>
        </form>
      </div>
    </details>
  );
}
