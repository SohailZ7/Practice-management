// "Orders only" rows (for example "D/C Orders Only", "Admit Orders Only") are a checklist item, not a scheduled visit:
// there is no appointment with the patient. They stay on the schedule and chart, but never count as a visit
// (appointments, visits today, overdue). Pure, so every counter shares one definition.
export function isOrdersOnly(appointmentType: string | null | undefined): boolean {
  return /orders?\s*only/i.test(appointmentType ?? "");
}
