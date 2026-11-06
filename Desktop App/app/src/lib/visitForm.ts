import { normalizeTime } from "./times";

export type VisitFormValues = { date: string; patient: string; time: string; type: string; provider: string };
export type VisitFormErrors = Record<"date" | "patient" | "time" | "type" | "provider", string>;

const NAME_WORD = /^\p{L}(?:[\p{L}'’-]*\p{L})?\.?$/u;

/**
 * "First Last" or "Last, First": words made of letters (no digits, symbols or keyboard mashing). Initials are allowed,
 * including initials only ("J. Smith", "Alex J. Rivera", "Smith, J.", "A. B.").
 */
export function clientNameError(raw: string): string {
  const text = raw.trim().replace(/\s+/g, " ");
  const words = text.replace(",", " ").split(" ").filter(Boolean);
  const wrong = "Enter the client's first and last name, like Alex Rivera or J. Rivera. Letters only.";
  if (words.length < 2 || words.length > 5 || text.split(",").length > 2) return wrong;
  if (!words.every((w) => NAME_WORD.test(w))) return wrong;
  const letters = (w: string) => w.replace(/[^\p{L}]/gu, "");
  if (words.some((w) => letters(w).length > 4 && !/[aeiouyAEIOUY]/.test(w))) return wrong;
  return "";
}

const SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;

/**
 * What is sent to the practice app. Middle initials stay with the first name ("Alex J. Rivera" is first "Alex J.").
 * A suffix stays with the last name: "Alex Rivera Jr." goes as "Rivera Jr., Alex", because the server takes the last
 * word of "First Last" as the last name.
 */
export function clientNameToSend(raw: string): string {
  const text = raw.trim().replace(/\s+/g, " ");
  if (text.includes(",")) return text;
  const words = text.split(" ");
  if (words.length >= 3 && SUFFIX.test(words[words.length - 1])) {
    return `${words.slice(-2).join(" ")}, ${words.slice(0, -2).join(" ")}`;
  }
  return text;
}

/** Everything the Add one visit form checks before it sends anything. Empty strings mean no error. */
export function visitFormErrors(v: VisitFormValues): VisitFormErrors {
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? "" : "Pick a date first.",
    patient: clientNameError(v.patient),
    time: normalizeTime(v.time) === null ? "Enter a time like 9:00 AM or 9:00 - 11:30." : "",
    type: v.type.trim() ? "" : "Choose the appointment type.",
    provider: v.provider.trim() ? "" : "Choose the provider.",
  };
}

/**
 * The lists the form may offer. When the server has a list for type or provider it is the only one used, because the
 * server refuses anything else (bad_type / bad_provider); names read off a pasted board are only a fallback.
 */
export function formChoices(
  server: { programs: string[]; appointmentTypes: string[]; providers: string[] } | null,
  seen: { program: string; appointmentType: string; providerName: string }[],
  current: { provider: string },
) {
  const distinct = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))].sort();
  const only = (listed: string[] | undefined, fallback: string[]) => (listed && listed.length ? distinct(listed) : distinct(fallback));
  return {
    programs: distinct([...(server?.programs ?? []), ...seen.map((v) => v.program)]),
    appointmentTypes: only(server?.appointmentTypes, seen.map((v) => v.appointmentType)),
    providers: only(server?.providers, [...seen.map((v) => v.providerName), current.provider]),
  };
}
