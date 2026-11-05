import { webNotesAuth } from "@/lib/notes/webAuth";
import { docRoutes } from "@/lib/notes/docRoutes";
export const dynamic = "force-dynamic";
const r = docRoutes(webNotesAuth);
// Writing a note can take a minute or more.
export const maxDuration = 300;
export const POST = r.generate;
