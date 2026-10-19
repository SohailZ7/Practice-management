import { audit } from "@/lib/audit";
import { ApiError, authenticate, handle, json, readJson } from "@/lib/desktop/api";
import { canRecord } from "@/lib/desktop/policy";
import { activeConsent } from "@/lib/consentService";
import { recordingCheck } from "@/lib/consent";
import { survivingPatientId } from "@/lib/patients";

export const dynamic = "force-dynamic";

// API-7, CON-4, CON-8: asked by the Desktop App every time before it records. The answer is allowed / not allowed plus a
// reason code, nothing more. Consent is never cached on the device.
export const POST = handle(async (req) => {
  const { user } = await authenticate(req, { module: "schedule", level: "view" });
  if (!canRecord(user)) throw new ApiError(403, "forbidden");
  const body = await readJson(req);
  const patientId = typeof body.patientId === "string" ? await survivingPatientId(body.patientId) : null;
  const consent = patientId ? await activeConsent(patientId) : null;
  const result = recordingCheck(patientId, consent ? [{ active: true, consentDate: consent.consentDate }] : []);
  await audit(user.email, "desktop.recording.check", `patient ${patientId ?? "none"} allowed=${result.allowed}`);
  return json(result);
});
