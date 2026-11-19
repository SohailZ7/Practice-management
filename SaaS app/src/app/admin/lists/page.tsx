import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { Banner } from "@/components/Banner";
import { REF_KINDS } from "@/lib/refLists/defaults";
import { addRefItem, loadStarting, saveRefItem } from "./actions";

export default async function ListsPage({ searchParams }: { searchParams: { error?: string; notice?: string } }) {
  await requireAdmin();
  const items = await db.refItem.findMany({ orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { value: "asc" }] });
  return (
    <>
      <Banner error={searchParams.error} notice={searchParams.notice} />
      <h2>Lists</h2>
      <p className="muted small">Dropdown lists for the schedule tracker and billing. Renaming an item changes it for new rows only; days already saved keep the old text. Turn an item off to hide it from dropdowns.</p>
      <form action={loadStarting}><button className="btn secondary" type="submit">Load starting lists</button></form>
      {REF_KINDS.map((k) => (
        <section key={k.kind} style={{ marginTop: "1.5rem" }}>
          <h3>{k.label}</h3>
          <table>
            <thead><tr><th>Value</th>{k.kind === "charge_code" && <><th>Documentation type</th><th>Non-billable</th></>}<th>On</th><th /></tr></thead>
            <tbody>
              {items.filter((i) => i.kind === k.kind).map((i) => (
                <tr key={i.id}>
                  <td colSpan={1}>
                    <form action={saveRefItem} className="row" id={`f-${i.id}`}>
                      <input type="hidden" name="id" value={i.id} />
                      <input name="value" defaultValue={i.value} aria-label="Value" />
                    </form>
                  </td>
                  {k.kind === "charge_code" && (
                    <>
                      <td><input form={`f-${i.id}`} name="docType" defaultValue={i.docType ?? ""} aria-label="Documentation type" /></td>
                      <td><input form={`f-${i.id}`} type="checkbox" name="nonBillable" defaultChecked={i.nonBillable} aria-label="Non-billable" /></td>
                    </>
                  )}
                  <td><input form={`f-${i.id}`} type="checkbox" name="active" defaultChecked={i.active} aria-label="Active" /></td>
                  <td><button className="btn secondary" form={`f-${i.id}`} type="submit">Save</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <form action={addRefItem} className="row">
            <input type="hidden" name="kind" value={k.kind} />
            <input name="value" placeholder="New item" aria-label={`New ${k.label}`} />
            {k.kind === "charge_code" && (<><input name="docType" placeholder="Documentation type" /><label><input type="checkbox" name="nonBillable" /> Non-billable</label></>)}
            <button className="btn" type="submit">Add</button>
          </form>
        </section>
      ))}
    </>
  );
}
