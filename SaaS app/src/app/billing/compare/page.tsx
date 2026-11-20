import { requireAccess } from "@/lib/session";
import { CompareForm } from "@/components/billing/CompareForm";

export default async function GetixCompare() {
  await requireAccess("billing", "view");
  return <CompareForm />;
}
