import { authenticateApi, handle, json } from "@/lib/mcpApi/http";
import { ledgerOptionsOut } from "@/lib/mcpApi/ledgerService";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const { user, tokenId } = await authenticateApi(req, { scope: "ledger", level: "view" });
  return json(await ledgerOptionsOut(user, tokenId));
});
