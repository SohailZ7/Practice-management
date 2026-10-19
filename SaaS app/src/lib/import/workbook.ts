import ExcelJS from "exceljs";
import type { Grid } from "./outpatientBoard";

export type SheetInfo = { name: string; hidden: boolean };

async function load(buffer: Buffer | ArrayBuffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // exceljs's types predate newer @types/node Buffer generics; it accepts both at runtime.
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return wb;
}

export async function listSheets(buffer: Buffer | ArrayBuffer): Promise<SheetInfo[]> {
  const wb = await load(buffer);
  return wb.worksheets.map((ws) => ({ name: ws.name, hidden: ws.state !== "visible" }));
}

function plain(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if ("result" in value) return plain((value as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ("richText" in value) return (value as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
    if ("text" in value) return String((value as ExcelJS.CellHyperlinkValue).text);
    if ("error" in value) return null;
  }
  return value;
}

/** Reads one sheet into a 0-based grid of plain values (merged cells repeat the master value). */
export async function readGrid(buffer: Buffer | ArrayBuffer, sheetName: string): Promise<Grid> {
  const wb = await load(buffer);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`Sheet "${sheetName}" not found`);
  const grid: Grid = [];
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cells[colNumber - 1] = plain(cell.value);
    });
    grid[rowNumber - 1] = cells;
  });
  return grid;
}
