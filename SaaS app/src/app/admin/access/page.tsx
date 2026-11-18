import { redirect } from "next/navigation";

// Module access now lives on Admin > People (one row per person). Old links and bookmarks land there.
export default function Page() {
  redirect("/admin");
}
