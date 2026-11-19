import { describe, expect, it } from "vitest";

describe("approved ScheduleEntry drop (Release B2b)", () => {
  const diff = `-- DropForeignKey
ALTER TABLE "ScheduleEntry" DROP CONSTRAINT "ScheduleEntry_providerId_fkey";
-- DropForeignKey
ALTER TABLE "ScheduleEntry" DROP CONSTRAINT "ScheduleEntry_patientId_fkey";
-- DropTable
DROP TABLE "ScheduleEntry";`;
  it("is refused by the gate as it always was", async () => {
    const { gateSchemaSql } = await import("../src/lib/schemaGate");
    expect(gateSchemaSql(diff).length).toBeGreaterThan(0);
  });
  it("splits out exactly those three statements and nothing else", async () => {
    const { splitApprovedDrops, gateSchemaSql } = await import("../src/lib/schemaGate");
    const r = splitApprovedDrops(diff);
    expect(r.drops).toHaveLength(3);
    expect(gateSchemaSql(r.rest)).toEqual([]);
    const other = splitApprovedDrops(diff + '\nDROP TABLE "Patient";');
    expect(other.drops).toHaveLength(3);
    expect(gateSchemaSql(other.rest).length).toBeGreaterThan(0);
  });
});
