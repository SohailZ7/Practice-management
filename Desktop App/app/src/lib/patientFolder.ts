// Folder and file names for saved notes (desktop spec DOC-3). Pure.

/** Characters that cannot appear in a file name on macOS or Windows, plus control characters. */
const BAD = /[\\/:*?"<>|\u0000-\u001f\u007f]+/g;

export function safePart(value: string): string {
  const cleaned = value.replace(BAD, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "").slice(0, 80);
  return cleaned || "Unknown";
}

/** "Last, First" exactly as the practice wants it. */
export function patientFolderName(lastName: string, firstName: string): string {
  return `${safePart(lastName)}, ${safePart(firstName)}`;
}

/** `prefix` puts the patient's name in front, as the owner asked: "Last, First 2026-10-29 Follow-up DRAFT.docx". */
export function noteFileName(
  date: string,
  typeLabel: string,
  taken: (name: string) => boolean = () => false,
  prefix = "",
  draft = true,
): string {
  const base = `${prefix}${date} ${safePart(typeLabel)}${draft ? " DRAFT" : ""}`;
  let name = `${base}.docx`;
  for (let n = 2; taken(name); n++) name = `${base} (${n}).docx`;
  return name;
}
