import { describe, expect, it } from "vitest";
import { REF_DEFAULTS, docTypeForCode, isRefKind, missingDefaults } from "@/lib/refLists/defaults";
import { gateSchemaSql } from "@/lib/schemaGate";

describe("reference lists", () => {
  it("starting lists match the workbook lists", () => {
    const of = (k: string) => REF_DEFAULTS.filter((d) => d.kind === k).map((d) => d.value);
    expect(of("visit_type")).toEqual(["Psych Eval", "Admit+Follow", "FollowUp + Discharge", "FollowUp", "D/C Orders Only", "Admit Orders Only", "Step Up", "Step Down"]);
    expect(of("charge_code")).toEqual(["99203", "99213", "99238", "NB DC"]);
    expect(of("doc_type")).toEqual(["Eval", "PN", "DC SUM"]);
    expect(of("order_type")).toEqual(["Admit Order", "Discharge Order", "N/A"]);
    expect(REF_DEFAULTS.find((d) => d.value === "NB DC")?.nonBillable).toBe(true);
  });
  it("loading is idempotent and case-insensitive, never duplicates", () => {
    expect(missingDefaults([])).toHaveLength(REF_DEFAULTS.length);
    expect(missingDefaults(REF_DEFAULTS.map((d) => ({ kind: d.kind, value: d.value.toUpperCase() })))).toHaveLength(0);
    expect(missingDefaults([{ kind: "visit_type", value: "followup" }]).some((d) => d.value === "FollowUp")).toBe(false);
  });
  it("charge code suggests the documentation type", () => {
    const items = [{ value: "99213", docType: "PN" }, { value: "X", docType: null }];
    expect(docTypeForCode(items, " 99213 ")).toBe("PN");
    expect(docTypeForCode(items, "X")).toBe("");
    expect(docTypeForCode(items, "nope")).toBe("");
  });
  it("kinds are checked", () => {
    expect(isRefKind("charge_code")).toBe(true);
    expect(isRefKind("patients")).toBe(false);
  });
  it("the new table is additive for the schema gate", () => {
    const sql = `CREATE TABLE "RefItem" ("id" TEXT NOT NULL, "kind" TEXT NOT NULL, "nonBillable" BOOLEAN NOT NULL DEFAULT false, CONSTRAINT "RefItem_pkey" PRIMARY KEY ("id"));\nCREATE UNIQUE INDEX "RefItem_kind_value_key" ON "RefItem"("kind", "value");`;
    expect(gateSchemaSql(sql)).toEqual([]);
  });
});
