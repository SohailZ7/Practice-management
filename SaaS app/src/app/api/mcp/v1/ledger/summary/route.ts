import { authenticateApi, handle, json } from "@/lib/mcpApi/http";
import { summarizeLedger } from "@/lib/mcpApi/ledgerService";

export const dynamic = "force-dynamic";

/** Counts and totals only. ?from=&to=&category=&party=&method=&groupBy=category|party|method|month */
export const GET = handle(async (req) => {
  const { user, tokenId } = await authenticateApi(req, { scope: "ledger", level: "view" });
  return json(await summarizeLedger(user, tokenId, new URL(req.url).searchParams));
});
