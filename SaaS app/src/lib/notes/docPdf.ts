// The filled PDF for one version of a document. Fillable templates are filled in place (the fields stay editable);
// section-based documents (Psych Eval, older notes) are typeset from scratch.

import { PDFDocument, PDFName, PDFCheckBox, PDFTextField, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { mirrorBase, schemaFor, templateBytes, TEMPLATES, type DocField, type DocValues } from "./docTemplates";

/** Standard PDF fonts cover Latin-1 only; anything else would make the PDF library throw. */
export const winAnsi = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[^\n\x20-\x7E\xA0-\xFF]/g, "?");

const shownDate = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v.slice(5, 7)}/${v.slice(8, 10)}/${v.slice(0, 4)}` : v);

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of winAnsi(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, size) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** Headings and wrapped text, one block per field. */
export async function typesetPdf(title: string, fields: DocField[], values: DocValues): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 792, M = 54, size = 10, lead = 13;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const room = (need: number) => {
    if (y - need < M) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
  };
  const draw = (t: string, f: PDFFont, s: number) => {
    room(lead);
    page.drawText(t, { x: M, y, size: s, font: f, color: rgb(0, 0, 0) });
    y -= s + 3;
  };
  draw(winAnsi(title), bold, 15);
  y -= 6;
  for (const f of fields) {
    const v = values[f.name];
    const text = typeof v === "boolean" ? (v ? "Yes" : "") : String(v ?? "");
    if (!text.trim()) continue;
    for (const l of wrap(f.label, bold, 10, W - 2 * M)) draw(l, bold, 10);
    for (const l of wrap(f.type === "date" ? shownDate(text) : text, font, size, W - 2 * M)) draw(l, font, size);
    y -= 7;
  }
  return pdf.save();
}

export async function fillPdf(templateId: string, title: string, fields: DocField[], values: DocValues): Promise<Uint8Array> {
  if (!TEMPLATES[templateId]?.file) return typesetPdf(title, fields, values);
  const pdf = await PDFDocument.load(templateBytes(templateId));
  const form = pdf.getForm();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const known = new Map(fields.map((f) => [f.name, f]));
  const valueOf = (name: string): { f: DocField; v: unknown } | null => {
    const f = known.get(name) ?? (mirrorBase(name) ? known.get(mirrorBase(name)!) : undefined);
    return f ? { f, v: values[f.name] } : null;
  };

  for (const field of form.getFields()) {
    const hit = valueOf(field.getName());
    if (!hit) continue;
    try {
      if (field instanceof PDFTextField) {
        const text = typeof hit.v === "string" ? (hit.f.type === "date" ? shownDate(hit.v) : hit.v) : "";
        field.setText(text ? winAnsi(text) : undefined);
      } else if (field instanceof PDFCheckBox) {
        const widgets = field.acroField.getWidgets();
        const chosen = hit.f.type === "select" ? (typeof hit.v === "string" ? hit.v : "") : hit.v === true ? "on" : "";
        let matched = false;
        for (const w of widgets) {
          const state = w.getOnValue()?.decodeText();
          const on = !!chosen && (hit.f.type === "select" ? state === chosen : !!state);
          if (on && state) {
            w.setAppearanceState(PDFName.of(state));
            if (!matched) field.acroField.dict.set(PDFName.of("V"), PDFName.of(state));
            matched = true;
          } else w.setAppearanceState(PDFName.of("Off"));
        }
        if (!matched) field.acroField.dict.set(PDFName.of("V"), PDFName.of("Off"));
      }
    } catch {
      // one stubborn field must not stop the whole document
    }
  }
  form.updateFieldAppearances(font);
  return pdf.save();
}

export { schemaFor };
