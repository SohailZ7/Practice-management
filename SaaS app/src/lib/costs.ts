// Costs: monthly cloud cost per environment from the Cloud Billing export in BigQuery. Billing data is not PHI.
// Read-only. The app reads only the projects listed in COSTS_PROJECTS, from the table in COSTS_BQ_TABLE.
// Where no table is configured (staging), the page shows clearly labelled SAMPLE numbers so the layout can be checked.

import { serviceAccountToken } from "@/lib/notes/model";

export const CATEGORIES = ["Cloud Run compute", "Cloud SQL", "Vertex AI", "Cloud Storage", "Networking", "Secret Manager", "Other"] as const;
export type Category = (typeof CATEGORIES)[number];

export function categoryOf(service: string): Category {
  const s = service.toLowerCase();
  if (/^cloud run/.test(s)) return "Cloud Run compute";
  if (/cloud sql/.test(s)) return "Cloud SQL";
  if (/vertex ai|generative language|gemini/.test(s)) return "Vertex AI";
  if (/cloud storage/.test(s)) return "Cloud Storage";
  if (/networking|cloud dns|cloud nat|vpc|load balanc|cloud cdn/.test(s)) return "Networking";
  if (/secret manager/.test(s)) return "Secret Manager";
  return "Other";
}

export type CostRow = { project: string; service: string; sku: string; cost: number; credits: number };
export type DataSpan = { firstUsage: string | null; lastExport: string | null };

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const currentMonth = (now = new Date()) => `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
export function priorMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
}
export const parseMonth = (m: string | undefined) => (m && MONTH_RE.test(m) ? m : currentMonth());

export type EnvSummary = {
  project: string;
  total: number;
  priorTotal: number;
  byCategory: { category: Category; amount: number; prior: number }[];
  vertexSkus: { sku: string; amount: number }[];
  hasRows: boolean;
};

const net = (r: CostRow) => r.cost + r.credits;
const round = (n: number) => Math.round(n * 100) / 100;

export function summarize(project: string, cur: CostRow[], prior: CostRow[]): EnvSummary {
  const mine = cur.filter((r) => r.project === project);
  const prev = prior.filter((r) => r.project === project);
  const byCategory = CATEGORIES.map((category) => ({
    category,
    amount: round(mine.filter((r) => categoryOf(r.service) === category).reduce((a, r) => a + net(r), 0)),
    prior: round(prev.filter((r) => categoryOf(r.service) === category).reduce((a, r) => a + net(r), 0)),
  }));
  const sku = new Map<string, number>();
  for (const r of mine) if (categoryOf(r.service) === "Vertex AI") sku.set(r.sku, (sku.get(r.sku) ?? 0) + net(r));
  return {
    project,
    total: round(byCategory.reduce((a, c) => a + c.amount, 0)),
    priorTotal: round(byCategory.reduce((a, c) => a + c.prior, 0)),
    byCategory,
    vertexSkus: [...sku].map(([s, amount]) => ({ sku: s, amount: round(amount) })).sort((a, b) => b.amount - a.amount).slice(0, 8),
    hasRows: mine.length > 0,
  };
}

export const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export type CostsConfig = { table: string; projects: string[]; jobProject: string };

export function costsConfig(env: Record<string, string | undefined> = process.env): CostsConfig | null {
  const table = env.COSTS_BQ_TABLE?.trim();
  // project.dataset.table, restricted characters: it is placed into SQL text.
  if (!table || !/^[a-z0-9-]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(table)) return null;
  const projects = (env.COSTS_PROJECTS || "bbc-practice-mgmt,bbc-practice-mgmt-staging").split(",").map((p) => p.trim()).filter((p) => /^[a-z0-9-]+$/.test(p));
  return { table, projects, jobProject: env.COSTS_BQ_PROJECT?.trim() || table.split(".")[0] };
}

export function monthSql(table: string): string {
  return `SELECT project.id AS project, service.description AS service, sku.description AS sku,
  SUM(cost) AS cost,
  SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS credits
FROM \`${table}\`
WHERE invoice.month = @month AND project.id IN UNNEST(@projects)
GROUP BY project, service, sku`;
}
export function spanSql(table: string): string {
  return `SELECT CAST(MIN(usage_start_time) AS STRING) AS first_usage, CAST(MAX(export_time) AS STRING) AS last_export
FROM \`${table}\` WHERE project.id IN UNNEST(@projects)`;
}

export class CostsError extends Error {
  constructor(public status: number) {
    super(`billing export query failed (${status})`);
  }
}

type BqValue = { v: string | null };
async function query(cfg: CostsConfig, sql: string, params: { name: string; value: string | string[] }[]): Promise<BqValue[][]> {
  const token = await serviceAccountToken();
  const res = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${cfg.jobProject}/queries`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      query: sql,
      useLegacySql: false,
      parameterMode: "NAMED",
      queryParameters: params.map((p) =>
        Array.isArray(p.value)
          ? { name: p.name, parameterType: { type: "ARRAY", arrayType: { type: "STRING" } }, parameterValue: { arrayValues: p.value.map((value) => ({ value })) } }
          : { name: p.name, parameterType: { type: "STRING" }, parameterValue: { value: p.value } },
      ),
      timeoutMs: 20000,
    }),
  });
  if (!res.ok) throw new CostsError(res.status);
  const json = (await res.json()) as { jobComplete?: boolean; rows?: { f: BqValue[] }[] };
  if (json.jobComplete === false) throw new CostsError(504);
  return (json.rows ?? []).map((r) => r.f);
}

export type CostsData = { sample: boolean; rows: CostRow[]; prior: CostRow[]; span: DataSpan };

export async function loadCosts(month: string, cfg: CostsConfig): Promise<CostsData> {
  const projects = { name: "projects", value: cfg.projects };
  const asRows = (rs: BqValue[][]): CostRow[] =>
    rs.map((f) => ({ project: f[0].v ?? "", service: f[1].v ?? "", sku: f[2].v ?? "", cost: Number(f[3].v ?? 0), credits: Number(f[4].v ?? 0) }));
  const ym = (m: string) => m.replace("-", "");
  const [cur, prev, span] = await Promise.all([
    query(cfg, monthSql(cfg.table), [{ name: "month", value: ym(month) }, projects]),
    query(cfg, monthSql(cfg.table), [{ name: "month", value: ym(priorMonth(month)) }, projects]),
    query(cfg, spanSql(cfg.table), [projects]),
  ]);
  return { sample: false, rows: asRows(cur), prior: asRows(prev), span: { firstUsage: span[0]?.[0].v ?? null, lastExport: span[0]?.[1].v ?? null } };
}

/** Labelled sample numbers for an environment with no billing export (staging), so the layout can be checked. */
export function sampleCosts(month: string, projects: string[]): CostsData {
  const base: [string, string, number][] = [
    ["Cloud Run", "Cloud Run CPU Allocation Time", 18.4], ["Cloud SQL", "Cloud SQL for PostgreSQL: Standard instance", 41.2],
    ["Vertex AI", "Gemini input text tokens", 6.1], ["Vertex AI", "Gemini output text tokens", 9.8], ["Cloud Storage", "Standard Storage US", 0.9],
    ["Networking", "Network Egress", 1.4], ["Secret Manager", "Active secret versions", 0.3], ["Cloud Build", "Build time", 2.2],
  ];
  const mk = (k: number): CostRow[] => projects.flatMap((p, i) => base.map(([service, sku, c]) => ({ project: p, service, sku, cost: round(c * k * (i ? 0.3 : 1)), credits: 0 })));
  return { sample: true, rows: mk(1), prior: mk(0.85), span: { firstUsage: `${month}-01`, lastExport: null } };
}
