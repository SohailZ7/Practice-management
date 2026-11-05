import { authenticate } from "@/lib/desktop/api";
import { docRoutes } from "@/lib/notes/docRoutes";
export const dynamic = "force-dynamic";
const r = docRoutes(async (req, need) => (await authenticate(req, need)).user);
export const GET = r.one;
