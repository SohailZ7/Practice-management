// Starting reference lists, from the schedule tracker workbook's list tab (list values only, no patient data).
// Seeded once by "Load starting lists" on Administration > Lists; after that the admin edits them in the app.

export const REF_KINDS = [
  { kind: "visit_type", label: "Visit types" },
  { kind: "charge_code", label: "Charge codes" },
  { kind: "doc_type", label: "Documentation types" },
  { kind: "order_type", label: "Order types" },
] as const;
export type RefKind = (typeof REF_KINDS)[number]["kind"];
export const isRefKind = (k: string): k is RefKind => REF_KINDS.some((x) => x.kind === k);

export type RefSeed = { kind: RefKind; value: string; docType?: string; nonBillable?: boolean };

export const REF_DEFAULTS: RefSeed[] = [
  ...["Psych Eval", "Admit+Follow", "FollowUp + Discharge", "FollowUp", "D/C Orders Only", "Admit Orders Only", "Step Up", "Step Down"].map((value): RefSeed => ({ kind: "visit_type", value })),
  { kind: "charge_code", value: "99203", docType: "Eval" },
  { kind: "charge_code", value: "99213", docType: "PN" },
  { kind: "charge_code", value: "99238", docType: "DC SUM" },
  { kind: "charge_code", value: "NB DC", docType: "DC SUM", nonBillable: true },
  ...["Eval", "PN", "DC SUM"].map((value): RefSeed => ({ kind: "doc_type", value })),
  ...["Admit Order", "Discharge Order", "N/A"].map((value): RefSeed => ({ kind: "order_type", value })),
];

/** Which defaults are not in the list yet (by kind + value, case-insensitive). Pure, so "Load starting lists" never duplicates. */
export function missingDefaults(existing: { kind: string; value: string }[]): RefSeed[] {
  const have = new Set(existing.map((e) => `${e.kind}|${e.value.trim().toLowerCase()}`));
  return REF_DEFAULTS.filter((d) => !have.has(`${d.kind}|${d.value.toLowerCase()}`));
}

/** The documentation type a charge code suggests (the workbook fills it in from the code). */
export function docTypeForCode(items: { value: string; docType: string | null }[], code: string): string {
  return items.find((i) => i.value.toLowerCase() === code.trim().toLowerCase())?.docType ?? "";
}
