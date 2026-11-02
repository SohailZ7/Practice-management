// Turns a document's Markdown into a printable page. The browser's own "Save as PDF" makes the file, so no headless
// browser has to run on the server. Everything is escaped: a document is patient text, never markup to execute.

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A deliberately small Markdown subset: what these documents actually contain. */
export function markdownToHtml(markdown: string): string {
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    const inline = (t: string) =>
      escapeHtml(t)
        .replace(/==([^=]+)==/g, "<mark>$1</mark>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^_])_([^_]+)_/g, "$1<em>$2</em>");

    if (!line.trim()) {
      closeList();
      continue;
    }
    if (/^---+$/.test(line)) {
      closeList();
      out.push("<hr />");
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const task = /^\s*-\s*\[([ xX])\]\s*(.*)$/.exec(line);
    if (task) {
      if (!inList) {
        out.push('<ul class="tasks">');
        inList = true;
      }
      const ticked = task[1].toLowerCase() === "x";
      out.push(`<li><span class="box">${ticked ? "☒" : "☐"}</span> ${inline(task[2])}</li>`);
      continue;
    }
    const bullet = /^\s*-\s+(.*)$/.exec(line);
    if (bullet) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      closeList();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

export function markdownToPrintableHtml(markdown: string, title: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { margin: 18mm; }
  body { font: 11pt/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111; max-width: 190mm; margin: 0 auto; padding: 16px; }
  h1 { font-size: 17pt; margin: 0 0 10px; }
  h2 { font-size: 13pt; margin: 18px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
  h3 { font-size: 11.5pt; margin: 13px 0 4px; }
  p, li { margin: 3px 0; }
  ul { margin: 4px 0 8px; padding-left: 18px; }
  ul.tasks { list-style: none; padding-left: 4px; }
  ul.tasks .box { display: inline-block; width: 1.1em; }
  blockquote { margin: 8px 0; padding: 6px 10px; background: #fff8dc; border-left: 3px solid #d0a000; }
  mark { background: #fff2a8; }
  hr { border: 0; border-top: 1px solid #bbb; margin: 18px 0; }
  .hint { color: #666; font-size: 9pt; margin-bottom: 14px; }
  @media print { .hint { display: none; } }
</style></head>
<body>
<p class="hint">Use your browser's Print command, then "Save as PDF".</p>
${markdownToHtml(markdown)}
</body></html>`;
}
