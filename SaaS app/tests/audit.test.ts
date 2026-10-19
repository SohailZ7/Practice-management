import { describe, expect, it } from "vitest";
import { clip } from "../src/lib/audit";
import { parseSqlStatements } from "../src/lib/sqlStatements";
import { readFileSync } from "node:fs";

describe("clip", () => {
  it("flattens control characters and trims", () => {
    expect(clip("  a\nb\tc\u0000d  ")).toBe("a b c d");
  });
  it("limits length", () => {
    expect(clip("x".repeat(500), 120)).toHaveLength(120);
  });
});

describe("parseSqlStatements", () => {
  it("splits on the -- @@ marker and drops comments", () => {
    const sql = "-- header\nSELECT 1;\n-- @@\n-- note\nSELECT 2;\n-- @@\n\n";
    expect(parseSqlStatements(sql)).toEqual(["SELECT 1;", "SELECT 2;"]);
  });
  it("keeps a function body with semicolons in one statement", () => {
    const sql = readFileSync("prisma/sql/audit-append-only.sql", "utf8");
    const parts = parseSqlStatements(sql);
    expect(parts).toHaveLength(9);
    expect(parts[0]).toContain("RAISE EXCEPTION");
    expect(parts[0]).toContain("END;");
  });
  it("covers update, delete and truncate on both audit tables", () => {
    const all = parseSqlStatements(readFileSync("prisma/sql/audit-append-only.sql", "utf8")).join("\n");
    for (const table of ["AuditLog", "BillingHistory"]) {
      expect(all).toMatch(new RegExp(`BEFORE UPDATE OR DELETE ON "${table}"`));
      expect(all).toMatch(new RegExp(`BEFORE TRUNCATE ON "${table}"`));
    }
  });
});
