import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDecider } from "../src/decision.js";
import { createServer } from "../src/server.js";
import { config, input, output } from "./fixtures.js";

const builtServer = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

async function connect(upstream: () => Promise<Response>) {
  const server = createServer(createDecider(config, upstream), config);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

// Codex cannot deserialize tuple-style (array) `items`, so scan the real tools/list payload.
const hasTupleItems = (value: unknown): boolean => Array.isArray(value) ? value.some(hasTupleItems)
  : typeof value === "object" && value !== null && Object.entries(value).some(([key, child]) => (key === "items" && Array.isArray(child)) || hasTupleItems(child));

test("MCP server lists jev_decide with its schema, serves a call end to end and reports failures as sanitized tool errors", async () => {
  let calls = 0;
  let respond = async () => Response.json(output);
  const { client, close } = await connect(() => { calls++; return respond(); });
  try {
    assert.equal(client.getServerVersion()?.name, "jev-decision-mcp");
    assert.equal(client.getServerVersion()?.version, version);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), ["jev_decide"]);
    const tool = tools[0]!;
    for (const text of [tool.title!, tool.description!]) {
      assert.ok(text.includes(config.baseURL), "reports the configured destination");
      assert.doesNotMatch(text, /TypeSafe|Liquid|provider/i);
    }
    assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true });
    assert.ok(tool.inputSchema.properties?.questions);
    assert.ok(tool.outputSchema);
    assert.equal(hasTupleItems(tool.inputSchema), false);
    const result = await client.callTool({ name: "jev_decide", arguments: input });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, output);
    assert.deepEqual(JSON.parse((result.content as Array<{ text: string }>)[0]!.text), output);
    assert.equal((await client.callTool({ name: "jev_decide", arguments: { ...input, questions: {} } })).isError, true);
    assert.equal(calls, 1, "invalid input never reaches the upstream");
    respond = async () => Response.json({ error: `${config.apiKey} do not expose` }, { status: 401 });
    const failed = await client.callTool({ name: "jev_decide", arguments: input });
    assert.equal(failed.isError, true);
    assert.match(JSON.stringify(failed.content), /API_ERROR/);
    assert.doesNotMatch(JSON.stringify(failed), new RegExp(`${config.apiKey}|do not expose`));
  } finally { await close(); }
});

// Both built-process tests set every generic variable so the developer .env (which the server loads) cannot influence them.
const stdioEnv = (overrides: Record<string, string> = {}): Record<string, string> => ({
  API_KEY: "", BASE_URL: "https://stdio.example.test/jev", MODEL: "stdio-model", JEV_TIMEOUT_MS: "30000",
  TYPESAFE_API_KEY: "legacy-secret", ...overrides, // a legacy key in the environment must not satisfy the credential
});

test("built stdio server starts from another cwd with a clean protocol stream and no API key", async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [builtServer], cwd: "/tmp", env: stdioEnv(), stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", (data) => { stderr += data.toString(); });
  const client = new Client({ name: "stdio-test", version: "1.0.0" });
  const protocolErrors: Error[] = [];
  client.onerror = (error) => protocolErrors.push(error); // anything but JSON-RPC on stdout lands here
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), ["jev_decide"]); // discovery needs no key
    const result = await client.callTool({ name: "jev_decide", arguments: input });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /MISSING_API_KEY/);
    assert.deepEqual(protocolErrors, []);
    assert.equal(stderr, "");
  } finally { await client.close(); }
});

test("built server exits 1 on invalid startup configuration without echoing configured values", () => {
  for (const [name, value] of [
    ["BASE_URL", "https://user:pass@api.example/x?key=secret"],
    ["BASE_URL", ""],
    ["MODEL", "   "],
    ["JEV_TIMEOUT_MS", "9999999"],
  ] as const) {
    const result = spawnSync(process.execPath, [builtServer], { cwd: "/tmp", env: stdioEnv({ [name]: value }), encoding: "utf8", stdio: ["ignore", "ignore", "pipe"], timeout: 15000 });
    assert.equal(result.status, 1, name);
    assert.match(result.stderr, new RegExp(`${name} must`));
    if (value.trim()) assert.equal(result.stderr.includes(value), false);
  }
});
