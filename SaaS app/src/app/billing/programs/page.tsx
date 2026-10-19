import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { ProgramManager } from "@/components/billing/ProgramManager";

export default async function ProgramsPage() {
  await requireAdmin();
  const programs = await db.program.findMany({ orderBy: { name: "asc" } });
  return <ProgramManager programs={programs.map((p) => ({ id: p.id, name: p.name, active: p.active }))} />;
}
