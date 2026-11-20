// Starter list for the ICD-10 picker: the common psychiatric codes (ICD-10-CM). This is a STARTER list chosen by the practice
// owner's request until the doctor's own common-code list is supplied; replace the entries below and nothing else needs to change.

export type CommonIcd10 = { code: string; label: string };

export const COMMON_ICD10: CommonIcd10[] = [
  { code: "F32.A", label: "Depression, unspecified" },
  { code: "F32.9", label: "Major depressive disorder, single episode, unspecified" },
  { code: "F33.9", label: "Major depressive disorder, recurrent, unspecified" },
  { code: "F33.1", label: "Major depressive disorder, recurrent, moderate" },
  { code: "F41.1", label: "Generalized anxiety disorder" },
  { code: "F41.9", label: "Anxiety disorder, unspecified" },
  { code: "F41.0", label: "Panic disorder" },
  { code: "F43.10", label: "Post-traumatic stress disorder, unspecified" },
  { code: "F43.20", label: "Adjustment disorder, unspecified" },
  { code: "F31.9", label: "Bipolar disorder, unspecified" },
  { code: "F31.81", label: "Bipolar II disorder" },
  { code: "F20.9", label: "Schizophrenia, unspecified" },
  { code: "F25.9", label: "Schizoaffective disorder, unspecified" },
  { code: "F29", label: "Unspecified psychosis not due to a substance or known physiological condition" },
  { code: "F90.9", label: "Attention-deficit hyperactivity disorder, unspecified" },
  { code: "F42.9", label: "Obsessive-compulsive disorder, unspecified" },
  { code: "F60.3", label: "Borderline personality disorder" },
  { code: "F10.20", label: "Alcohol dependence, uncomplicated" },
  { code: "F11.20", label: "Opioid dependence, uncomplicated" },
  { code: "F12.20", label: "Cannabis dependence, uncomplicated" },
];

/** Entries matching what was typed (code prefix or any word of the label); everything when empty. */
export function searchCommonIcd10(query: string, list: CommonIcd10[] = COMMON_ICD10): CommonIcd10[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((e) => e.code.toLowerCase().startsWith(q) || e.label.toLowerCase().includes(q));
}

/** `current` (the text in the ICD-10 box) with `code` appended once, keeping the order typed. */
export function addIcd10(current: string, code: string): string {
  const have = current.split(/[\s,;]+/).filter(Boolean).map((c) => c.toUpperCase());
  if (have.includes(code.toUpperCase())) return current;
  const base = current.trim().replace(/[,;]+$/, "");
  return base ? `${base}, ${code}` : code;
}
