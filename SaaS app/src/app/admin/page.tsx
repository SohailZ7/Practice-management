import { redirect } from "next/navigation";

// People moved to the Employees page (one tab for staff records and logins). Old links and bookmarks land on the first Admin tab.
export default function Page() {
  redirect("/admin/task-tabs");
}
