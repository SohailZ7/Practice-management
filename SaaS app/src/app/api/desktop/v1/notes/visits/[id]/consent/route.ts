import { authenticate } from "@/lib/desktop/api";
import { consentRoutes } from "@/lib/consent/consentRoutes";
export const dynamic = "force-dynamic";
const r = consentRoutes(async (req, need) => (await authenticate(req, need)).user, "desktop");
export const POST = r.POST;
export const GET = r.GET;
