import { requireAccess } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { isISODate, todayISO } from "@/lib/dates";
import { visitsForDate } from "@/lib/notes/queries";
import { NotesBoard } from "@/components/notes/NotesBoard";

export default async function NotesPage({ searchParams }: { searchParams: { date?: string } }) {
  const user = await requireAccess("notes", "view");
  const date = searchParams.date && isISODate(searchParams.date) ? searchParams.date : todayISO();
  const visits = await visitsForDate(date);
  return (
    <NotesBoard
      date={date}
      visits={visits}
      canEdit={canAccess(user, "notes", "edit")}
      defaultProvider={process.env.NOTES_DEFAULT_PROVIDER ?? ""}
    />
  );
}
