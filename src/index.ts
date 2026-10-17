#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, loadProjectEnv, readConfig } from "./config.js";
import { createDecider } from "./decision.js";
import { createServer } from "./server.js";

try {
  loadProjectEnv();
  const config = readConfig();
  const server = createServer(createDecider(config), config);
  await server.connect(new StdioServerTransport());
} catch (error) {
  // stdout is reserved for MCP; never print environment values or error bodies.
  const detail = error instanceof ConfigError ? ` ${error.message}.` : "";
  console.error(`Jev MCP could not start.${detail} Check API_KEY, BASE_URL, MODEL, JEV_TIMEOUT_MS (1–120000) and .env readability.`);
  process.exitCode = 1;
}
