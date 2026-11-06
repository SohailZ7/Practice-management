import { describe, expect, it } from "vitest";
import { categoryOf, costsConfig, monthSql, parseMonth, priorMonth, sampleCosts, summarize } from "../src/lib/costs";
import { ADMIN_PAGES } from "../src/lib/adminNav";

describe("costs", () => {
  it("groups services into the seven categories", () => {
    expect(categoryOf("Cloud Run")).toBe("Cloud Run compute");
    expect(categoryOf("Cloud SQL")).toBe("Cloud SQL");
    expect(categoryOf("Vertex AI")).toBe("Vertex AI");
    expect(categoryOf("Cloud Storage")).toBe("Cloud Storage");
    expect(categoryOf("Networking")).toBe("Networking");
    expect(categoryOf("Secret Manager")).toBe("Secret Manager");
    expect(categoryOf("Cloud Build")).toBe("Other");
  });
  it("months", () => {
    expect(priorMonth("2026-01")).toBe("2025-12");
    expect(priorMonth("2026-11")).toBe("2026-10");
    expect(parseMonth("2026-13")).toMatch(/^\d{4}-\d{2}$/);
    expect(parseMonth("2026-03")).toBe("2026-03");
  });
  it("summarizes one environment only, credits applied, with prior month", () => {
    const cur = [
      { project: "p", service: "Cloud SQL", sku: "a", cost: 10, credits: -1 },
      { project: "p", service: "Vertex AI", sku: "in", cost: 2, credits: 0 },
      { project: "other", service: "Cloud SQL", sku: "a", cost: 99, credits: 0 },
    ];
    const s = summarize("p", cur, [{ project: "p", service: "Cloud SQL", sku: "a", cost: 5, credits: 0 }]);
    expect(s.total).toBe(11);
    expect(s.priorTotal).toBe(5);
    expect(s.byCategory.find((c) => c.category === "Cloud SQL")).toMatchObject({ amount: 9, prior: 5 });
    expect(s.vertexSkus).toEqual([{ sku: "in", amount: 2 }]);
  });
  it("config: refuses a table name that could inject SQL; queries are parameterized", () => {
    expect(costsConfig({ COSTS_BQ_TABLE: "p.d.t`; DROP" })).toBeNull();
    expect(costsConfig({})).toBeNull();
    const c = costsConfig({ COSTS_BQ_TABLE: "bbc-practice-mgmt.billing_export.gcp_billing_export_v1_X" })!;
    expect(c.projects).toEqual(["bbc-practice-mgmt", "bbc-practice-mgmt-staging"]);
    const sql = monthSql(c.table);
    expect(sql).toContain("@month");
    expect(sql).toContain("@projects");
  });
  it("sample data covers both environments and is flagged", () => {
    const d = sampleCosts("2026-11", ["a", "b"]);
    expect(d.sample).toBe(true);
    expect(summarize("b", d.rows, d.prior).hasRows).toBe(true);
  });
  it("is a tab in the Admin console", () => {
    expect(ADMIN_PAGES.some((p) => p.href === "/admin/costs")).toBe(true);
  });
});
