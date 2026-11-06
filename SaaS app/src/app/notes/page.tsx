import { redirect } from "next/navigation";
import { isISODate } from "@/lib/dates";

// Notes and Schedule are one tab now. Old /notes links land on the Schedule day view for the same date.
export default function NotesPage({ searchParams }: { searchParams: { date?: string } }) {
  const date = searchParams.date && isISODate(searchParams.date) ? `&date=${searchParams.date}` : "";
  redirect(`/schedule?view=day${date}`);
}
