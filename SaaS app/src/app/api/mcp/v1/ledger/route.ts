import { authenticateApi, handle, json, readJson } from "@/lib/mcpApi/http";
import { createLedger, listLedger } from "@/lib/mcpApi/ledgerService";

export const dynamic = "force-dynamic";

/** Ledger-scope token. ?from=&to=&category=&party=&method=&type=in|out&limit=. Newest first. Memos that look like patient info are withheld. */
export const GET = handle(async (req) => {
  const { user, tokenId } = await authenticateApi(req, { scope: "ledger", level: "view" });
  return json(await listLedger(user, tokenId, new URL(req.url).searchParams));
});

/** Amounts are whole cents. An exact duplicate is refused (409) unless force=true. */
export const POST = handle(async (req) => {
  const { user, tokenId } = await authenticateApi(req, { scope: "ledger", level: "edit" });
  return json(await createLedger(user, tokenId, await readJson(req)), 201);
});
