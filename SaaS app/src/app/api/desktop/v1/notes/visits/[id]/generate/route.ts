import { authenticate } from "@/lib/desktop/api";
import { docRoutes } from "@/lib/notes/docRoutes";
export const dynamic = "force-dynamic";
const r = docRoutes(async (req, need) => (await authenticate(req, need)).user);
// Writing a note can take a minute or more.
export const maxDuration = 300;
export const POST = r.generate;
