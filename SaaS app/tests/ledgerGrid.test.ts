// Regression guard for the Ledger table layout (the "wonky rows" bug): every row must have the same shape, nothing is
// left in an edit state while its neighbours are plain text, and there is no approval column. Runs under vitest
// (`npm test`, the same run as the pre-push / CI gate). It renders the real LedgerGrid to markup, no browser needed.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../src/app/ledger/actions", () => ({
  createLedgerEntry: vi.fn(), updateLedgerEntry: vi.fn(), deleteLedgerEntry: vi.fn(), listLedger: vi.fn(),
}));
const { LedgerGrid } = await import("../src/components/ledger/LedgerGrid");

const categories = [{ id: "c1", name: "Supplies" }, { id: "c2", name: "Rent" }];
const methods = [{ id: "m1", name: "ACH" }, { id: "m2", name: "Check" }];
const parties = [{ id: "p1", name: "Razak Ahmed" }];
const filters = { from: "2026-01-01", to: "", categoryId: "", methodId: "", partyId: "", type: "all" as const, q: "" };
// A mix on purpose: income, expense, no labels, empty comment, very long comment, and an old-style row that carries leftover approval data.
const rows = [
  { id: "r1", date: "2026-11-09", cashIn: 5092000, cashOut: 0, partyId: "p1", categoryId: "c1", methodId: "m1", comments: "Deposit" },
  { id: "r2", date: "2026-11-10", cashIn: 0, cashOut: 25000, partyId: null, categoryId: null, methodId: null, comments: "" },
  { id: "r3", date: "2026-11-12", cashIn: 0, cashOut: 663900, partyId: "p1", categoryId: "c2", methodId: "m2", comments: "x".repeat(400) },
  { id: "r4", date: "2026-11-13", cashIn: 0, cashOut: 1000, partyId: "p1", categoryId: "c1", methodId: "m1", comments: "legacy", approval: "approved", approvalNote: "old" },
] as any[];

function render(canEdit: boolean, list = rows) {
  return renderToStaticMarkup(createElement(LedgerGrid, { initialRows: list, initialFilters: filters, categories, methods, parties, canEdit, today: "2026-11-20" }));
}
const body = (html: string) => html.match(/<tbody>([\s\S]*?)<\/tbody>/)![1];
const trs = (html: string) => [...body(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
const tags = (cells: string) => [...cells.matchAll(/<(td|input|select|button)\b/g)].map((m) => m[1]).join(",");

describe("Ledger table layout", () => {
  it.each([true, false])("every row has the same shape (canEdit=%s)", (canEdit) => {
    const shapes = trs(render(canEdit)).map(tags);
    expect(shapes).toHaveLength(rows.length);
    expect(new Set(shapes).size).toBe(1);
  });

  it("has exactly the expected columns, and no Approval column", () => {
    const html = render(true);
    const head = [...html.match(/<thead>([\s\S]*?)<\/thead>/)![1].matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(head).toEqual(["Date", "Cash In", "Cash Out", "Transaction By", "Category", "Method", "Comments", ""]);
    expect(trs(html).every((r) => (r.match(/<td/g) ?? []).length === head.length)).toBe(true);
    expect(render(false).match(/<th[ >]/g)).toHaveLength(7);
    // One width per column, and the free-width column is Comments (the 7th), so Method is never squeezed.
    const widths = [...html.match(/<colgroup>([\s\S]*?)<\/colgroup>/)![1].matchAll(/<col([^>]*)\/>/g)].map((m) => m[1].match(/width:(\d+)/)?.[1] ?? "auto");
    expect(widths).toEqual(["130", "120", "120", "150", "170", "170", "auto", "38"]);
    expect(html).not.toMatch(/Approval|Pending|Approve|Reject|appr-/);
  });

  it("an editor sees an input in every row, a viewer sees plain text in every row (never a mix)", () => {
    for (const r of trs(render(true))) expect(r).toContain('type="date"');
    for (const r of trs(render(false))) expect(r).not.toMatch(/<(input|select|button)/);
  });

  it("every row of an editor has a delete button and nothing is shown as a draft", () => {
    const html = render(true);
    expect(html.match(/aria-label="Delete row"/g)).toHaveLength(rows.length);
    expect(html).not.toContain("xl-draft");
  });

  it("leftover approval data on an old row does not change it (not locked, not hidden)", () => {
    const list = trs(render(true));
    expect(list).toHaveLength(rows.length);
    expect(list[3]).toContain('value="2026-11-13"');
    expect(list[3]).toContain('value="legacy"');
    expect(list[3]).toContain("Delete row");
  });

  it("shows totals for all rows and the Add row button for editors only", () => {
    expect(render(true)).toContain("+ Add row");
    expect(render(false)).not.toContain("+ Add row");
    expect(render(true)).toMatch(/Entries<\/span><strong>4<\/strong>/);
  });

  it("shows the empty message spanning the table when there are no rows", () => {
    expect(render(true, [])).toContain('colSpan="8"');
    expect(render(false, [])).toContain('colSpan="7"');
  });
});
