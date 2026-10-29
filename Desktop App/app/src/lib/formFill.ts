// Fills the practice's checkbox forms (change request 9). These are different from the Word master template: almost all
// of the content is ticking boxes, and free text is a phrase rather than a paragraph (see docs/form-filling-style.md).
//
// A form is found by its field labels, which appear either in the first cell of a table row or at the start of a
// paragraph. Ticking turns "[ ]" into "[X]" next to the chosen option; free text replaces a run of underscores.
// Nothing is ticked that the model did not choose, because on these forms a blank box means "not assessed".

import JSZip from "jszip";
import { appendAttention, children, insertBanner, parseDoc, serializeDoc, setText, textOf, W, type El } from "./docxCore";

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

  // Paragraphs: "Label:  [ ] a   [ ] b   ____"
  for (const p of Array.from(doc.getElementsByTagNameNS(W, "p"))) {
    const el = p as unknown as El;
    // A table cell's paragraphs are part of a row that was already handled; the label cell would otherwise be read
    // as a field line of its own and every option would look missing.
    if (insideTableCell(el)) continue;
    const line = textOf(el);
    if (!line.trim()) continue;
    const label = labelOf(line);
    if (label) use(label, el, line);
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
