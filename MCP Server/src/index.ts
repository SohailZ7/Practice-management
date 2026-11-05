#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, makeClient } from "./client.js";
import { createServer } from "./tools.js";

async function main() {
  const server = createServer(makeClient(loadConfig()));
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  // stderr only (stdout is the protocol). The message never contains the token.
  console.error(e instanceof Error ? e.message : "failed to start");
  process.exit(1);
});
