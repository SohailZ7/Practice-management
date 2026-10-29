// Low-level Word document helpers shared by the narrative filler (docxFill) and the form filler (formFill).

import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

export const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export type El = Element;

export const parseDoc = (xml: string) => new DOMParser().parseFromString(xml, "text/xml") as unknown as Document;
export const serializeDoc = (doc: Document) => new XMLSerializer().serializeToString(doc as unknown as Node);

export const children = (el: El): El[] => Array.from(el.childNodes).filter((n): n is El => n.nodeType === 1);
export const textOf = (el: El) => Array.from(el.getElementsByTagNameNS(W, "t")).map((t) => t.textContent ?? "").join("");

/** Rewrites an element's text, keeping the first run's formatting and emptying the rest. */
export function setText(el: El, next: string) {
  const ts = Array.from(el.getElementsByTagNameNS(W, "t"));
  if (!ts.length) return;
  ts[0].setAttribute("xml:space", "preserve");
  ts[0].textContent = next;
  for (const t of ts.slice(1)) t.textContent = "";
}

export function makeRun(doc: Document, text: string, opts: { bold?: boolean; highlight?: boolean } = {}): El {
  const r = doc.createElementNS(W, "w:r");
  if (opts.bold || opts.highlight) {
    const rPr = doc.createElementNS(W, "w:rPr");
    if (opts.bold) rPr.appendChild(doc.createElementNS(W, "w:b"));
    if (opts.highlight) {
      const h = doc.createElementNS(W, "w:highlight");
      h.setAttributeNS(W, "w:val", "yellow");
      rPr.appendChild(h);
    }
    r.appendChild(rPr);
  }
  const t = doc.createElementNS(W, "w:t");
  t.setAttribute("xml:space", "preserve");
  t.appendChild(doc.createTextNode(text));
  r.appendChild(t);
  return r;
}

export function makeParagraph(doc: Document, runs: El[], style?: string | null): El {
  const p = doc.createElementNS(W, "w:p");
  if (style) {
    const pPr = doc.createElementNS(W, "w:pPr");
    const ps = doc.createElementNS(W, "w:pStyle");
    ps.setAttributeNS(W, "w:val", style);
    pPr.appendChild(ps);
    p.appendChild(pPr);
  }
  for (const r of runs) p.appendChild(r);
  return p;
}

export const DRAFT_BANNER =
  "DRAFT. Written by AI from the visit recording. Not reviewed. Check every section, then delete this line.";

/** Puts the draft warning at the very top of the body, where it cannot be missed. */
export function insertBanner(doc: Document, text = DRAFT_BANNER) {
  const body = doc.getElementsByTagNameNS(W, "body")[0] as unknown as El;
  const p = makeParagraph(doc, [makeRun(doc, text, { bold: true, highlight: true })]);
  body.insertBefore(p, body.firstChild);
}

/**
 * Appends the "Needs your attention" list: the one place a provider can see what the recording could not settle
 * (desktop spec DOC-8). Written even when the list is empty, so its absence always means something went wrong.
 */
export function appendAttention(doc: Document, items: string[]) {
  const body = doc.getElementsByTagNameNS(W, "body")[0] as unknown as El;
  const sectPr = children(body).find((n) => n.localName === "sectPr") ?? null;
  const add = (el: El) => (sectPr ? body.insertBefore(el, sectPr) : body.appendChild(el));

  add(makeParagraph(doc, [makeRun(doc, "", {})]));
  add(makeParagraph(doc, [makeRun(doc, "Needs your attention", { bold: true })], "Heading1"));
  if (!items.length) {
    add(makeParagraph(doc, [makeRun(doc, "Nothing was flagged. Review the whole document anyway.")]));
    return;
  }
  for (const item of items) add(makeParagraph(doc, [makeRun(doc, `• ${item}`)]));
}
