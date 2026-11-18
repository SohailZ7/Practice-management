import { authenticateApi, handle, json, readJson } from "@/lib/mcpApi/http";
import { deleteLedger, getLedger, updateLedger } from "@/lib/mcpApi/ledgerService";

export const dynamic = "force-dynamic";

export const GET = handle(async (req, { params }) => {
  const { user, tokenId } = await authenticateApi(req, { scope: "ledger", level: "view" });
  return json(await getLedger(user, tokenId, params.id));
});

export const PATCH = handle(async (req, { params }) => {
  const { user, tokenId } = await authenticateApi(req, { scope: "ledger", level: "edit" });
  return json(await updateLedger(user, tokenId, params.id, await readJson(req)));
});

export const DELETE = handle(async (req, { params }) => {
  const { user, tokenId } = await authenticateApi(req, { scope: "ledger", level: "edit" });
  return json(await deleteLedger(user, tokenId, params.id));
});
