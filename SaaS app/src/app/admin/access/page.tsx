import { redirect } from "next/navigation";

// Module access now lives on Employees > Logins and access (one row per person). Old links and bookmarks land there.
export default function Page() {
  redirect("/employees#logins");
}
