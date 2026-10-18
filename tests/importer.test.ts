import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseOutpatientBoard, parseDateCell, type Grid } from "../src/lib/import/outpatientBoard";
import { matchProvider } from "../src/lib/import/match";
import { listSheets, readGrid } from "../src/lib/import/workbook";
import { excelSerialToISO } from "../src/lib/dates";

// All names and values below are synthetic.
const SERIAL = 46244; // 2026-08-10

function syntheticGrid(): Grid {
  const g: Grid = [];
  const set = (r: number, c: number, v: unknown) => {
    g[r] = g[r] ?? [];
    g[r][c] = v;
  };
  // providers table at B1:H4
  ["Providers", "Contact #", "NPI #", "Zoom ID", "Password", "Schedule"].forEach((h, i) => set(0, 1 + i, h));
  [
    ["Dr. Ada Example", "555-0100", "NPI 1000000001", "https://example.test/j/1", "None", ""],
    ["Bo Sample, ARNP", "555-0101", "NPI 1000000002", "https://example.test/j/2", "1234", "M, T 8-2:00"],
  ].forEach((row, r) => row.forEach((v, i) => set(1 + r, 1 + i, v)));
  // board header
  ["Date", "Time", "Type", "Client Info", "Absent", "Canceled", "Provider", "Completed", "Missed"].forEach(
    (h, i) => set(9, 1 + i, h),
  );
  // day 1 (date repeated on every row, as merged cells are read)
  const day1 = [
    ["Psych Eval 9:00", "Provider Zoom", "Test Client One/30F", 0, 0, "Dr. Ada Example", 1, 0],
    ["PE: Select Time ", "Select Type", "", 0, 0, "Select Provider", 0, 0],
    ["Tracks", "Type", "Client Info", "Absent", "Canceled", "Provider", "Complete", "Column1"],
    [" Track 1 IOP   8:30 - 11:00", "Follow-up ", "Test Client Two", 1, 0, "Bo Sample, ARNP", 0, 0],
    ["PM IOP   1:00-3:30", "DC Orders Only ", "Test Client Three", 0, 0, "Someone Else", 0, 1],
  ];
  day1.forEach((row, i) => {
    set(10 + i, 1, SERIAL);
    row.forEach((v, c) => set(10 + i, 2 + c, v));
  });
  // day 2 starts with a new date, so the section resets to Psych Eval
  set(15, 1, SERIAL + 1);
  ["Psych Eval 10:30", "Asses:PT Onsite", "Test Client Four", 0, 1, "Dr. Ada Example", 0, 0].forEach((v, c) =>
    set(15, 2 + c, v),
  );
  return g;
}

describe("parseOutpatientBoard", () => {
  const parsed = parseOutpatientBoard(syntheticGrid());

  it("reads the providers table", () => {
    expect(parsed.providers.map((p) => p.name)).toEqual(["Dr. Ada Example", "Bo Sample, ARNP"]);
    expect(parsed.providers[0].zoomPassword).toBe(""); // "None" is not a password
    expect(parsed.providers[1].hours).toBe("M, T 8-2:00");
  });

  it("converts Excel serial dates", () => {
    expect(excelSerialToISO(SERIAL)).toBe("2026-08-10");
    expect(parsed.entries[0].date).toBe("2026-08-10");
  });

  it("skips empty template slots and counts them", () => {
    expect(parsed.entries).toHaveLength(4);
    expect(parsed.skipped).toBe(1);
  });

  it("switches to the Track section at the Tracks sub-header", () => {
    expect(parsed.entries.map((e) => e.section)).toEqual(["PSYCH_EVAL", "TRACK", "TRACK", "PSYCH_EVAL"]);
  });

  it("starts the next day in Psych Eval and keeps merged-date repeats in the same block", () => {
    const last = parsed.entries[3];
    expect(last.date).toBe("2026-08-11");
    expect(last.section).toBe("PSYCH_EVAL");
  });

  it("splits the track name from its time window and trims text", () => {
    const track = parsed.entries[1];
    expect(track.trackName).toBe("Track 1 IOP");
    expect(track.timeLabel).toBe("Track 1 IOP 8:30 - 11:00");
    expect(track.typeName).toBe("Follow-up");
    expect(parsed.entries[2].trackName).toBe("PM IOP");
  });

  it("reads the status flags", () => {
    const [a, b, c, d] = parsed.entries;
    expect(a.completed).toBe(true);
    expect(b.absent).toBe(true);
    expect(c.missed).toBe(true);
    expect(d.canceled).toBe(true);
  });

  it("produces stable dedupe keys, unique within the sheet", () => {
    const keys = new Set(parsed.entries.map((e) => e.dedupeKey));
    expect(keys.size).toBe(4);
    expect(parseOutpatientBoard(syntheticGrid()).entries.map((e) => e.dedupeKey)).toEqual(
      parsed.entries.map((e) => e.dedupeKey),
    );
  });

  it("warns instead of throwing when the layout is not recognized", () => {
    const r = parseOutpatientBoard([["nothing", "here"]]);
    expect(r.entries).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/board header/);
  });

  it("flags rows with an unreadable date", () => {
    const g = syntheticGrid();
    g[10][1] = "not a date";
    const r = parseOutpatientBoard(g);
    expect(r.warnings.some((w) => w.includes("could not read date"))).toBe(true);
  });
});

describe("parseDateCell", () => {
  it("accepts serials, Date objects, ISO and US strings", () => {
    expect(parseDateCell(SERIAL)).toBe("2026-08-10");
    expect(parseDateCell(new Date(Date.UTC(2026, 7, 10)))).toBe("2026-08-10");
    expect(parseDateCell("2026-08-10")).toBe("2026-08-10");
    expect(parseDateCell("8/10/2026")).toBe("2026-08-10");
    expect(parseDateCell("13/40/2026")).toBeNull();
    expect(parseDateCell("hello")).toBeNull();
    expect(parseDateCell(5)).toBeNull();
  });
});

describe("matchProvider", () => {
  const list = [
    { id: "1", name: "Dr Khalid" },
    { id: "2", name: "Bo Sample" },
  ];
  it("matches by token subset ignoring titles", () => {
    expect(matchProvider("Dr. Khalid Ahmed", list)).toBe("1");
    expect(matchProvider("Bo Sample, ARNP", list)).toBe("2");
  });
  it("returns null when nothing or several match", () => {
    expect(matchProvider("Someone Else", list)).toBeNull();
    expect(matchProvider("", list)).toBeNull();
    expect(
      matchProvider("Sam", [
        { id: "a", name: "Sam Lee" },
        { id: "b", name: "Sam Ray" },
      ]),
    ).toBeNull();
  });
});

describe("xlsx round trip", () => {
  it("reads a generated workbook, including merged date cells and hidden sheets", async () => {
    const wb = new ExcelJS.Workbook();
    const hidden = wb.addWorksheet("Old", { state: "hidden" });
    hidden.getCell("A1").value = "x";
    const ws = wb.addWorksheet("Board");
    const grid = syntheticGrid();
    grid.forEach((row, r) =>
      (row ?? []).forEach((v, c) => {
        if (v !== undefined && !(c === 1 && r >= 10 && r <= 14)) ws.getCell(r + 1, c + 1).value = v as ExcelJS.CellValue;
      }),
    );
    ws.getCell(11, 2).value = SERIAL;
    ws.mergeCells("B11:B15"); // merged date block
    ws.getCell(16, 2).value = SERIAL + 1;
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const sheets = await listSheets(buffer);
    expect(sheets).toEqual([
      { name: "Old", hidden: true },
      { name: "Board", hidden: false },
    ]);

    const parsed = parseOutpatientBoard(await readGrid(buffer, "Board"));
    expect(parsed.entries).toHaveLength(4);
    expect(parsed.entries.map((e) => e.date)).toEqual(["2026-08-10", "2026-08-10", "2026-08-10", "2026-08-11"]);
    expect(parsed.entries[1].section).toBe("TRACK");
  });
});
