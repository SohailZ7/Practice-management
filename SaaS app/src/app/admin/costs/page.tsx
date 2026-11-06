import { requireAdmin } from "@/lib/session";
import { CostsError, costsConfig, loadCosts, parseMonth, sampleCosts, summarize, type CostsData } from "@/lib/costs";
import { EnvCard } from "@/components/CostsView";
import { environmentLabel } from "@/lib/buildInfo";

export const dynamic = "force-dynamic";

const ENVS = [
  { project: "bbc-practice-mgmt", name: "Production" },
  { project: "bbc-practice-mgmt-staging", name: "Staging" },
];

export default async function Page({ searchParams }: { searchParams: { month?: string } }) {
  await requireAdmin();
  const month = parseMonth(searchParams.month);
  const cfg = costsConfig();
  let data: CostsData | null = null;
  let error = "";
  if (cfg) {
    try {
      data = await loadCosts(month, cfg);
    } catch (e) {
      error = e instanceof CostsError ? `The billing export could not be read (status ${e.status}). Check the setup steps in docs/costs-setup.md.` : "The billing export could not be read.";
    }
  } else if (environmentLabel() !== "PRODUCTION") {
    data = sampleCosts(month, ENVS.map((e) => e.project));
  }
  const shown = cfg ? ENVS.filter((e) => cfg.projects.includes(e.project)) : ENVS;

  return (
    <>
      <p className="muted">Monthly cloud cost per environment, in USD as billed (credits applied), from the Cloud Billing export. Billing data only, no patient information.</p>
      <form method="get" className="row">
        <label>Month <input type="month" name="month" defaultValue={month} max={parseMonth(undefined)} /></label>
        <button type="submit" className="secondary">Show</button>
      </form>
      {error ? <div className="error">{error}</div> : null}
      {!cfg && !data ? <div className="notice">Billing export not connected here. Costs for both environments are shown in the production app once it is set up (docs/costs-setup.md).</div> : null}
      {data?.sample ? <div className="notice">SAMPLE NUMBERS, not real costs. This environment has no billing export; the figures only show the layout. Real costs appear in the production app.</div> : null}
      {data ? (
        <>
          <p className="muted">
            {data.sample ? null : <>Data starts {data.span.firstUsage ? data.span.firstUsage.slice(0, 10) : "(no data yet)"}; last updated {data.span.lastExport ? `${data.span.lastExport.slice(0, 16).replace("T", " ")} UTC` : "unknown"}. The export only holds data from the day it was turned on; earlier months show zero.</>}
          </p>
          <div className="cost-grid">
            {shown.map((e) => <EnvCard key={e.project} name={e.name} s={summarize(e.project, data!.rows, data!.prior)} month={month} />)}
          </div>
        </>
      ) : null}
    </>
  );
}
