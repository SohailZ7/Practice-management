// Fills the practice's Word template (desktop spec NOT-2, DOC-3). Sections are found by their Heading 1 style, so the
// template's layout, fonts, header and footer are kept. "fill" replaces a section's body, "drop" removes the section,
// "keep" leaves the blank form for the provider, "info" fills the encounter block from known facts.
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { DraftNote, DraftSection, Para } from "./types";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

type El = Element;

const children = (el: El): El[] => Array.from(el.childNodes).filter((n): n is El => n.nodeType === 1);
const local = (el: El) => el.localName;

function paragraphText(p: El): string {
  return Array.from(p.getElementsByTagNameNS(W, "t")).map((t) => t.textContent ?? "").join("").trim();
}

function headingLevel(el: El): 0 | 1 | 2 {
  if (local(el) !== "p") return 0;
  const style = el.getElementsByTagNameNS(W, "pStyle")[0]?.getAttributeNS(W, "val");
  return style === "Heading1" ? 1 : style === "Heading2" ? 2 : 0;
}

function makeRun(doc: Document, text: string, opts: { bold?: boolean; highlight?: boolean }): El {
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

function makeParagraph(doc: Document, para: Para, style: string | null): El {
  const p = doc.createElementNS(W, "w:p");
  if (style) {
    const pPr = doc.createElementNS(W, "w:pPr");
    const ps = doc.createElementNS(W, "w:pStyle");
    ps.setAttributeNS(W, "w:val", style);
    pPr.appendChild(ps);
    p.appendChild(pPr);
  }
  const flagged = !!para.flag;
  if (para.label) p.appendChild(makeRun(doc, `${para.label}: `, { bold: true }));
  p.appendChild(makeRun(doc, para.text, { highlight: flagged }));
  return p;
}

function setParagraphText(doc: Document, p: El, text: string) {
  const runs = Array.from(p.getElementsByTagNameNS(W, "r"));
  const ts = Array.from(p.getElementsByTagNameNS(W, "t"));
  if (ts.length === 0) {
    p.appendChild(makeRun(doc, text, {}));
    return;
  }
  ts[0].setAttribute("xml:space", "preserve");
  ts[0].textContent = text;
  for (const t of ts.slice(1)) t.textContent = "";
  void runs;
}

export type FillResult = { bytes: Uint8Array; missingHeadings: string[] };

export async function fillTemplate(templateBytes: Uint8Array | ArrayBuffer, note: DraftNote): Promise<FillResult> {
  const zip = await JSZip.loadAsync(templateBytes);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("Not a Word document: word/document.xml is missing");
  const xml = await file.async("string");
  const doc = new DOMParser().parseFromString(xml, "text/xml") as unknown as Document;
  const body = doc.getElementsByTagNameNS(W, "body")[0] as unknown as El;

  // Split the body into: preamble (before the first Heading 1), then one block per Heading 1.
  const blocks: { heading: El; nodes: El[] }[] = [];
  const preamble: El[] = [];
  let sectPr: El | null = null;
  for (const node of children(body)) {
    if (local(node) === "sectPr") {
      sectPr = node;
      continue;
    }
    if (headingLevel(node) === 1) blocks.push({ heading: node, nodes: [] });
    else if (blocks.length) blocks[blocks.length - 1].nodes.push(node);
    else preamble.push(node);
  }

  const bodyStyle = (() => {
    for (const b of blocks) for (const n of b.nodes) {
      const s = n.getElementsByTagNameNS(W, "pStyle")[0]?.getAttributeNS(W, "val");
      if (local(n) === "p" && s && headingLevel(n) === 0) return s;
    }
    return null;
  })();

  // Title of the document.
  const titleP = preamble.find((n) => local(n) === "p" && paragraphText(n));
  if (titleP) setParagraphText(doc, titleP, note.title);

  const byHeading = new Map<string, DraftSection>(note.sections.map((s) => [s.heading, s]));
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const title = paragraphText(block.heading);
    const section = byHeading.get(title);
    if (!section) continue;
    seen.add(title);
    if (section.action === "drop") {
      body.removeChild(block.heading);
      for (const n of block.nodes) body.removeChild(n);
    } else if (section.action === "fill" || section.action === "info") {
      for (const n of block.nodes) body.removeChild(n);
      const anchor = block.heading.nextSibling;
      for (const para of section.paragraphs) body.insertBefore(makeParagraph(doc, para, bodyStyle), anchor);
    }
  }
  for (const s of note.sections) if (!seen.has(s.heading)) missing.push(s.heading);
  void sectPr;

  zip.file("word/document.xml", new XMLSerializer().serializeToString(doc as unknown as Node));
  return { bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), missingHeadings: missing };
}

/** Plain text of a filled document, for the review screen and tests. */
export async function docxText(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")!.async("string");
  const doc = new DOMParser().parseFromString(xml, "text/xml") as unknown as Document;
  return Array.from(doc.getElementsByTagNameNS(W, "p")).map((p) => paragraphText(p as unknown as El)).filter(Boolean).join("\n");
}
