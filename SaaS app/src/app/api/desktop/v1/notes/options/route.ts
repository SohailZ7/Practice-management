import { authenticate, handle, json } from "@/lib/desktop/api";
import { loadVisitOptions } from "@/lib/notes/options";

export const dynamic = "force-dynamic";

/**
 * Choices for the Add-visit form. Programs and times may also be typed; appointmentTypes and providers are strict
 * (POST/PATCH visits answers bad_type / bad_provider for anything else). Lists only: no patient data.
 */
export const GET = handle(async (req) => {
  await authenticate(req, { module: "notes", level: "edit" });
  return json(await loadVisitOptions());
});
