import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle, json, readJson } from "@/lib/desktop/api";
import { listConsent, parseConsent, saveConsent } from "./recordingConsent";
import type { Level } from "@/lib/access";

type Auth = (req: Request, need: { module: "notes"; level: Level }) => Promise<{ id?: string; email: string }>;

/** POST stores one confirmation for a visit; GET lists them. Same handlers serve the web (cookie) and Desktop (bearer). */
export function consentRoutes(auth: Auth, source: "web" | "desktop") {
  return {
    POST: (req: Request, { params }: { params: { id: string } }) =>
      handle(async () => {
        const user = await auth(req, { module: "notes", level: "edit" });
        const body = await readJson(req);
        const consent = parseConsent({ consent: body });
        if (!consent) throw new ApiError(400, "bad_consent");
        if (!(await db.visit.findUnique({ where: { id: params.id }, select: { id: true } }))) throw new ApiError(404, "not_found");
        const row = await saveConsent({ consent, user, source, visitId: params.id });
        await audit(user.email, `${source === "web" ? "notes" : "desktop.notes"}.recording_consent`, `visit ${params.id} given=${consent.given} v=${consent.textVersion}`);
        return json({ ok: true, id: row.id }, 201);
      })(req),
    GET: (req: Request, { params }: { params: { id: string } }) =>
      handle(async () => {
        await auth(req, { module: "notes", level: "view" });
        return json({ consents: await listConsent(params.id) });
      })(req),
  };
}
