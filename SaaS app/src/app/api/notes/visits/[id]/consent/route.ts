import { webNotesAuth } from "@/lib/notes/webAuth";
import { consentRoutes } from "@/lib/consent/consentRoutes";
export const dynamic = "force-dynamic";
const r = consentRoutes(webNotesAuth, "web");
export const POST = r.POST;
export const GET = r.GET;
