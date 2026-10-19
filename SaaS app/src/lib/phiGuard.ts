// Heuristic detector for likely patient identifiers in free text (task titles and notes). Pure and tested.
//
// It is a safety net, not a classifier: it looks for patterns that are almost never anything else, so staff are not
// nagged. It cannot recognise a bare name or a diagnosis, which is why the UI also tells people what not to type.
// Findings carry only the kind, never the matched text, so nothing sensitive is echoed back or logged.

export type PhiKind = "mrn" | "ssn" | "dob" | "phone" | "email";

export const PHI_KIND_LABEL: Record<PhiKind, string> = {
  mrn: "a medical record number (MRN)",
  ssn: "a Social Security number",
  dob: "a date of birth",
  phone: "a phone number",
  email: "an email address",
};

export const PHI_WARNING = "Don't enter patient names or other identifying health information here. Use Billing or Schedule.";

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const DATE = [
  "\\d{1,2}[/.-]\\d{1,2}[/.-](?:\\d{4}|\\d{2})", // 3/4/1985, 03-04-85
  "\\d{4}-\\d{1,2}-\\d{1,2}", // 1985-03-04
  `${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+(?:\\d{4}|\\d{2})`, // Mar 4, 1985
  `\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH},?\\s+(?:\\d{4}|\\d{2})`, // 4 March 1985
].join("|");

const PATTERNS: { kind: PhiKind; re: RegExp }[] = [
  // MRN 12345, MRN: A1234567, medical record number 998877. A digit is required, so "MRN" alone or "MRN needed" passes.
  { kind: "mrn", re: /\b(?:mrn|m\.r\.n\.?|medical\s+record(?:\s+(?:number|no\.?|#))?)\s*[:#-]?\s*(?=[a-z0-9-]*\d)[a-z0-9-]{4,}\b/i },
  // 123-45-6789 (area 000/666/9xx, group 00 and serial 0000 are never valid) or "SSN 123456789".
  { kind: "ssn", re: /(?<![\d-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\d-])/ },
  { kind: "ssn", re: /\b(?:ssn|social\s+security(?:\s+(?:number|no\.?|#))?)\s*[:#-]?\s*\d{9}\b/i },
  // DOB 3/4/1985, "date of birth: Mar 4 1985". Only when the date follows the label.
  { kind: "dob", re: new RegExp(`\\b(?:dob|d\\.o\\.b\\.?|date\\s+of\\s+birth|birth\\s?date)\\s*[:\\-]?\\s*(?:${DATE})`, "i") },
  // (425) 555-1234, 425-555-1234, 425.555.1234, +1 425 555 1234: separators required so bare 10-digit ids pass.
  { kind: "phone", re: /(?<![\d-])(?:\+?1[\s.-]?)?(?:\([2-9]\d{2}\)\s?|[2-9]\d{2}[\s.-])[2-9]\d{2}[\s.-]\d{4}(?![\d-])/ },
  { kind: "phone", re: /\b(?:phone|cell|mobile|tel|telephone|fax)\b[\s:#.-]{0,3}[2-9]\d{9}\b/i },
  { kind: "email", re: /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi },
];

export type PhiFinding = { kind: PhiKind };

/** `ignoreEmails`: addresses that are fine to mention (the practice's own staff). */
export function detectPhi(text: string, opts: { ignoreEmails?: Iterable<string> } = {}): PhiFinding[] {
  if (!text) return [];
  const ignore = new Set([...(opts.ignoreEmails ?? [])].map((e) => e.trim().toLowerCase()));
  const found = new Set<PhiKind>();
  for (const { kind, re } of PATTERNS) {
    if (kind === "email") {
      for (const m of text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))) {
        if (!ignore.has(m[0].toLowerCase())) found.add("email");
      }
    } else if (re.test(text)) {
      found.add(kind);
    }
  }
  return [...found].map((kind) => ({ kind }));
}

/** The message shown when something was found. Names the kinds, never the text. */
export function phiMessage(findings: PhiFinding[]): string {
  const kinds = findings.map((f) => PHI_KIND_LABEL[f.kind]);
  const list = kinds.length > 1 ? `${kinds.slice(0, -1).join(", ")} and ${kinds[kinds.length - 1]}` : kinds[0];
  return `This looks like it contains ${list}. Remove it (${PHI_WARNING}) or tick the box to confirm it contains no patient information.`;
}

export type PhiBlock = { blocked: true; message: string; kinds: PhiKind[] };

export function phiBlock(findings: PhiFinding[]): PhiBlock {
  return { blocked: true, message: phiMessage(findings), kinds: findings.map((f) => f.kind) };
}

export const isPhiBlock = (v: unknown): v is PhiBlock => typeof v === "object" && v !== null && (v as PhiBlock).blocked === true;
