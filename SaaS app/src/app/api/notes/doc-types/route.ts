import { webNotesAuth } from "@/lib/notes/webAuth";
import { docRoutes } from "@/lib/notes/docRoutes";
export const dynamic = "force-dynamic";
const r = docRoutes(webNotesAuth);
export const GET = r.docTypes;
