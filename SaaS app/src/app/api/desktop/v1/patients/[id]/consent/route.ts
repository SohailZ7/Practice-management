import { db } from "@/lib/db";
import { ApiError, authenticate, handle, json, readJson } from "@/lib/desktop/api";
import { activeConsent, setPatientConsent, withdrawPatientConsent } from "@/lib/consentService";
import { survivingPatientId } from "@/lib/patients";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

const failure = (errors: Record<string, string>) => {
  const [field, message] = Object.entries(errors)[0] ?? ["error", "Invalid"];
  return json({ error: "invalid", field, message }, field === "patient" ? 404 : 400);
};

export const GET = (req: Request, { params }: Ctx) =>
  handle(async () => {
    await authenticate(req, { module: "schedule", level: "view" });
    const id = await survivingPatientId(params.id);
    if (!id || !(await db.billingPatient.findUnique({ where: { id }, select: { id: true } }))) throw new ApiError(404, "not_found");
    const c = await activeConsent(id);
    return json({ patientId: id, active: !!c, consentDate: c?.consentDate ?? null });
  })(req);

export const PUT = (req: Request, { params }: Ctx) =>
  handle(async () => {
    const { user } = await authenticate(req, { module: "schedule", level: "edit" });
    const body = await readJson(req);
    const r = await setPatientConsent(user.email, params.id, { consentDate: body.consentDate, note: body.note });
    return r.ok ? json({ ok: true }) : failure(r.errors);
  })(req);

export const DELETE = (req: Request, { params }: Ctx) =>
  handle(async () => {
    const { user } = await authenticate(req, { module: "schedule", level: "edit" });
    const r = await withdrawPatientConsent(user.email, params.id);
    return r.ok ? json({ ok: true }) : failure(r.errors);
  })(req);
