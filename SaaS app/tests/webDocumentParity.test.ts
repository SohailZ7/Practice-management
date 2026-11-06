import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The web Notes board must offer what the Desktop app offers for documents (only Record is Desktop-only).
describe("web documents match Desktop", () => {
  const dlg = readFileSync("src/components/notes/DocumentDialog.tsx", "utf8");
  const board = readFileSync("src/components/notes/NotesBoard.tsx", "utf8");
  it("uses the same button wording as Desktop", () => {
    expect(dlg).toContain("Save as new version");
    expect(dlg).toContain("Download PDF");
  });
  it("lets a provider generate, open and edit documents from a visit", () => {
    expect(board).toContain("GenerateDialog");
    expect(board).toContain("DocumentDialog");
    expect(dlg).toContain("Edit from this version");
  });
});
