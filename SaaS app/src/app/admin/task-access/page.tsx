import { redirect } from "next/navigation";

// Task tab access is now part of Admin > Task tabs. Old links and bookmarks land there.
export default function Page() {
  redirect("/admin/task-tabs");
}
