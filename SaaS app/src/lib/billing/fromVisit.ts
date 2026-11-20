// Seen to Billing (feedback cmwldbokg): when a visit is marked Seen or Note signed, one Encounter is created for it, once.
// Pure rules here; the DB part is autoEncounterForVisit. Tracking-only providers and orders-only rows never reach billing.
import { isOrdersOnly } from "@/lib/notes/ordersOnly";

export function isBillableStatus(status: string): boolean {
  return status === "seen" || status === "note_signed";
}

/** The charge code an appointment type calls for: Eval 99203, Progress note 99213, Discharge summary 99238, D/C orders only NB DC. */
export function chargeCodeFor(appointmentType: string): string {
  const t = (appointmentType || "").toLowerCase();
  if (isOrdersOnly(t)) return /dc|d\/c|discharge/.test(t) ? "NB DC" : "";
  if (/psych\s*eval|evaluation/.test(t)) return "99203";
  if (/discharge|\bd\/?c\b/.test(t)) return "99238";
  if (/follow\s*-?\s*up/.test(t) || t.trim() !== "") return "99213";
  return "";
}

export type SkipReason = "already_linked" | "not_billable_status" | "tracking_only" | "orders_only_no_code" | "no_program";
