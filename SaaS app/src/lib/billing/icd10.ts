// Shared by the server (validation) and the browser (live preview on the form).
//
// ICD-10-CM code shape: a letter, a digit, a letter or digit, then optionally a dot and 1-4
// letters or digits. Examples: I10, E11.9, F32.A, S72.001A. This checks the shape only, not
// whether the code exists in the official list.
const CODE_SHAPE = /^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/;

/** "e119" -> "E11.9", "i10" -> "I10" */
export function normalizeIcd10(token: string): string {
  let code = token.trim().toUpperCase().replace(/\.$/, "");
  if (/^[A-Z0-9]{4,7}$/.test(code)) code = `${code.slice(0, 3)}.${code.slice(3)}`;
  return code;
}

/** Splits on commas, semicolons or spaces. Codes keep the order typed (repeats dropped). */
export function parseIcd10List(input: string): { codes: string[]; invalid: string[] } {
  const codes: string[] = [];
  const invalid: string[] = [];
  for (const token of String(input ?? "").split(/[\s,;]+/)) {
    if (!token) continue;
    const code = normalizeIcd10(token);
    if (!CODE_SHAPE.test(code)) invalid.push(token);
    else if (!codes.includes(code)) codes.push(code);
  }
  return { codes, invalid };
}
