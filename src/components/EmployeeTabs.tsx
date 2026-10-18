"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { applyOrder, readOrder, writeOrder } from "@/lib/order";

export type TabDef = { id: string; label: string; count: number; href: string };

const KEY = "task-tab-order";

/** The Admin's per-employee tabs. Drag the grip to reorder; the order is remembered in this browser. */
export function EmployeeTabs({ tabs, selectedId }: { tabs: TabDef[]; selectedId: string }) {
  const [ordered, setOrdered] = useState(tabs);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Re-apply the saved order after hydration and whenever the tabs (e.g. counts) change.
  useEffect(() => {
    setOrdered(applyOrder(tabs, readOrder(KEY)));
  }, [tabs]);

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ordered.findIndex((t) => t.id === active.id);
    const to = ordered.findIndex((t) => t.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(ordered, from, to);
    setOrdered(next);
    writeOrder(KEY, next.map((t) => t.id));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ordered.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
        <div className="tabs" role="tablist" aria-label="Employees">
          {ordered.map((t) => (
            <SortableTab key={t.id} tab={t} on={t.id === selectedId} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableTab({ tab, on }: { tab: TabDef; on: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });
  return (
    <div
      ref={setNodeRef}
      className={`tab-wrap ${on ? "on" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
    >
      <button className="tab-grip" title="Drag to reorder tabs" aria-label={`Drag to reorder the ${tab.label} tab`} {...attributes} {...listeners}>
        ⠿
      </button>
      <Link href={tab.href} role="tab" aria-selected={on} className={on ? "tab on" : "tab"}>
        {tab.label}
        <span className="count">{tab.count}</span>
      </Link>
    </div>
  );
}
