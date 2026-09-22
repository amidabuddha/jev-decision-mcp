#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadProjectEnv, readConfig } from "./config.js";
import { createDecider } from "./decision.js";
import { createServer } from "./server.js";

try {
  loadProjectEnv();
  const server = createServer(createDecider(readConfig()));
  await server.connect(new StdioServerTransport());
} catch {
  // stdout is reserved for MCP; never print environment values or error bodies.
  console.error("Jev MCP could not start. Check .env readability and JEV_TIMEOUT_MS (1–120000).");
  process.exitCode = 1;
}
