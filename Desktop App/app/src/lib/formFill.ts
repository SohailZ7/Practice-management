// Fills the practice's checkbox forms (change request 9). These are different from the Word master template: almost all
// of the content is ticking boxes, and free text is a phrase rather than a paragraph (see docs/form-filling-style.md).
//
// A form is found by its field labels, which appear either in the first cell of a table row or at the start of a
// paragraph. Ticking turns "[ ]" into "[X]" next to the chosen option; free text replaces a run of underscores.
// Nothing is ticked that the model did not choose, because on these forms a blank box means "not assessed".

import JSZip from "jszip";
import { appendAttention, children, insertBanner, parseDoc, serializeDoc, setText, textOf, W, type El } from "./docxCore";

/** A line that can hold an answer: it has checkboxes or a blank to write on. */
const isFillable = (line: string) => /\[|_{4,}/.test(line);

const EMPTY = "[ ]";
const TICKED = "[X]";

export type FieldValue = {
  /** Option labels to tick. Anything not matching an option on the form is ignored. */
  ticked?: string[];
  /** Short free text, written where the field's blank line is. */
  text?: string;
};

export type FormValues = Record<string, FieldValue>;

export type FormFillResult = {
  bytes: Uint8Array;
  /** Options the model asked for that the form does not have; surfaced rather than silently dropped. */
  unknownOptions: { field: string; option: string }[];
  /** Fields the model answered that the form does not have. */
  unknownFields: string[];
  filledFields: string[];
};


const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** True when the element sits inside a table cell. Those are handled by the row pass, not the paragraph pass. */
function insideTableCell(el: El): boolean {
  for (let n: Node | null = el.parentNode; n; n = n.parentNode) {
    if ((n as El).localName === "tc") return true;
  }
  return false;
}


/**
 * Ticks the chosen options inside one line of form text and fills its blank.
 * Returns the new text plus any options that were not found on the line.
 */
export function applyToLine(line: string, value: FieldValue): { text: string; unknown: string[] } {
  let out = line;
  const unknown: string[] = [];

  for (const want of value.ticked ?? []) {
    const target = norm(want);
    if (!target) continue;
    // Each option runs from "[ ]" up to the next "[" or the end, so an option's own words are matched, not its neighbour's.
    const options = [...out.matchAll(/\[[ X]\]\s*([^[]*)/g)];
    const hit = options.find((m) => {
      const label = norm(m[1]);
      return label === target || (label.length > 2 && target.length > 2 && (label.startsWith(target) || target.startsWith(label)));
    });
    if (!hit || hit.index === undefined) {
      unknown.push(want);
      continue;
    }
    out = out.slice(0, hit.index) + TICKED + out.slice(hit.index + EMPTY.length);
  }

  if (value.text) {
    const blank = /_{4,}/.exec(out);
    if (blank) out = out.slice(0, blank.index) + value.text + out.slice(blank.index + blank[0].length);
    else out = `${out.replace(/\s+$/, "")} ${value.text}`;
  }
  return { text: out, unknown };
}

/** The label a line or table row answers to: the text before the first colon or checkbox. */
export function labelOf(line: string): string {
  const upto = line.split(/\[|_{4,}/)[0];
  const colon = upto.indexOf(":");
  return (colon >= 0 ? upto.slice(0, colon) : upto).trim();
}

export async function fillForm(templateBytes: Uint8Array | ArrayBuffer, values: FormValues, opts: { banner?: boolean; attention?: string[] } = {}): Promise<FormFillResult> {
  const zip = await JSZip.loadAsync(templateBytes);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("Not a Word document: word/document.xml is missing");
  const doc = parseDoc(await file.async("string"));

  const wanted = new Map(Object.entries(values).map(([k, v]) => [norm(k), { key: k, value: v }]));
  const unknownOptions: FormFillResult["unknownOptions"] = [];
  const filled = new Set<string>();

  const use = (key: string, el: El, line: string) => {
    const hit = wanted.get(norm(key));
    if (!hit) return false;
    const { text, unknown } = applyToLine(line, hit.value);
    if (text !== line) setText(el, text);
    for (const o of unknown) unknownOptions.push({ field: hit.key, option: o });
    filled.add(hit.key);
    return true;
  };

  // Table rows: the first cell holds the label, the second the options and blank.
  for (const row of Array.from(doc.getElementsByTagNameNS(W, "tr"))) {
    const cells = children(row as unknown as El).filter((c) => c.localName === "tc");
    if (cells.length < 2) continue;
    use(textOf(cells[0]), cells[1], textOf(cells[1]));
  }

  // Paragraphs. A field is named either on the same line as its answer ("Diet:  [ ] Regular") or by a heading with the
  // answer on the lines below it ("Chief Complaint" then a blank line). Its options may also wrap onto further lines.
  // A label only claims a field if there is somewhere to write: that is what stops a heading or the document title
  // from swallowing the real field of the same name further down.
  const paragraphs = Array.from(doc.getElementsByTagNameNS(W, "p"))
    .map((p) => p as unknown as El)
    .filter((el) => !insideTableCell(el));
  const isContinuation = (line: string) => isFillable(line) && !labelOf(line);

  for (let i = 0; i < paragraphs.length; i++) {
    const line = textOf(paragraphs[i]);
    const label = labelOf(line);
    if (!label.trim()) continue;
    const hit = wanted.get(norm(label));
    if (!hit) continue;

    const group: El[] = isFillable(line) ? [paragraphs[i]] : [];
    let last = i;
    for (let j = i + 1; j < paragraphs.length; j++) {
      const next = textOf(paragraphs[j]);
      if (!next.trim()) break;
      const nextLabel = labelOf(next).trim();
      if (isFillable(next)) {
        // A new labelled field line belongs to that field, not this one.
        if (nextLabel && norm(nextLabel) !== norm(label)) break;
        group.push(paragraphs[j]);
        last = j;
        continue;
      }
      // Before the first fillable line a heading may be followed by a note explaining the field
      // ("(Patient's own words ...)"). Skip that prose, but stop at the next field or at any further heading.
      if (group.length || wanted.has(norm(nextLabel)) || j - i > 2) break;
    }
    if (!group.length) continue; // a heading or title of the same name, with nothing to fill

    let remaining = hit.value.ticked ?? [];
    let textLeft = hit.value.text;
    for (const part of group) {
      const before = textOf(part);
      const { text, unknown } = applyToLine(before, { ticked: remaining, ...(textLeft ? { text: textLeft } : {}) });
      if (text !== before) {
        setText(part, text);
        if (textLeft && text.includes(textLeft)) textLeft = undefined;
      }
      remaining = unknown;
      if (!remaining.length && !textLeft) break;
    }
    for (const o of remaining) unknownOptions.push({ field: hit.key, option: o });
    filled.add(hit.key);
    i = Math.max(i, last);
  }

  const unknownFields = Object.keys(values).filter((k) => !filled.has(k));
  if (opts.attention) appendAttention(doc, opts.attention);
  if (opts.banner !== false) insertBanner(doc);
  zip.file("word/document.xml", serializeDoc(doc));
  return {
    bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
    unknownOptions,
    unknownFields,
    filledFields: [...filled],
  };
}
