import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadProjectEnv, readConfig } from "../src/config.js";
import { decisionInput, validateResponse } from "../src/schema.js";

// Explicit live command only: normal tests never send data to TypeSafe.
loadProjectEnv();
if (!readConfig().apiKey) {
  console.error("Add TYPESAFE_API_KEY to the project .env, then run npm run test:live again.");
  process.exit(1);
}
const client = new Client({ name: "jev-live-smoke-test", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
  // Forward only these overrides; the child also loads the project .env.
  env: Object.fromEntries(Object.entries(process.env).filter(([key, value]) =>
    ["TYPESAFE_API_KEY", "TYPESAFE_DEFAULT_MODEL", "JEV_TIMEOUT_MS"].includes(key) && value !== undefined)) as Record<string, string>,
  stderr: "inherit",
});
try {
  await client.connect(transport);
  const input = decisionInput.parse(JSON.parse(await readFile(new URL("../examples/decision.json", import.meta.url), "utf8")));
  const started = performance.now();
  const response = await client.callTool({ name: "jev_decide", arguments: input });
  if (response.isError) {
    console.error(JSON.stringify(response.content));
    process.exitCode = 1;
  } else {
    const result = validateResponse(response.structuredContent, input);
    console.log(JSON.stringify({ elapsed_ms: Math.round(performance.now() - started), ...result }, null, 2));
    console.log("Live MCP smoke test passed. Inspect the judgments; this checks integration, not general model accuracy.");
  }
} catch {
  console.error("Live MCP test failed. Check the build, network access and local configuration.");
  process.exitCode = 1;
} finally { await client.close(); }
