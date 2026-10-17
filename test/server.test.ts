import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDecider } from "../src/decision.js";
import { createServer } from "../src/server.js";
import { config, input, localhostConfig, output } from "./fixtures.js";

const builtServer = fileURLToPath(new URL("../dist/index.js", import.meta.url));

// Every built-process test sets all four generic configuration variables
// explicitly so the developer .env (which the server loads) can never
// influence these tests. Legacy variable names are always present too, set to
// values that must be ignored or must not satisfy the missing key.
function stdioEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    API_KEY: "",
    BASE_URL: "https://stdio.example.test/jev",
    MODEL: "stdio-model",
    JEV_TIMEOUT_MS: "30000",
    DECISION_PROVIDER: "liquid",
    DECISION_DEFAULT_MODEL: "legacy-shared-model",
    TYPESAFE_API_KEY: "legacy-secret-a",
    TYPESAFE_DEFAULT_MODEL: "legacy-model",
    TYPESAFE_BASE_URL: "https://legacy.example",
    LIQUID_API_KEY: "legacy-secret-b",
    ...overrides,
  };
}

// Codex's JsonSchema models `items` as one schema, not draft-07 tuples.
// Check the actual tools/list payload, including nested question schemas.
function checkItems(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach(checkItems); return; }
  for (const [key, child] of Object.entries(value)) {
    if (key === "items") assert.equal(Array.isArray(child), false, "Codex cannot expose tuple-style items schemas");
    checkItems(child);
  }
}

// Discovery reports the configured destination generically, with no brand claims.
function assertDiscovery(tools: Awaited<ReturnType<Client["listTools"]>>["tools"], baseURL: string): void {
  assert.deepEqual(tools.map((tool) => tool.name), ["jev_decide"]);
  assert.match(tools[0]!.title!, /Decision API/);
  assert.ok(tools[0]!.title!.includes(baseURL));
  assert.match(tools[0]!.description!, /Decision API/);
  assert.ok(tools[0]!.description!.includes(baseURL));
  assert.doesNotMatch(tools[0]!.title!, /TypeSafe|Liquid|provider/i);
  assert.doesNotMatch(tools[0]!.description!, /TypeSafe|Liquid|provider/i);
  assert.deepEqual(tools[0]?.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true });
  checkItems(tools[0]?.inputSchema);
}

test("MCP discovery and calls preserve identity, annotations and structured results", async () => {
  let calls = 0;
  const server = createServer(createDecider(config, async () => { calls++; return Response.json(output); }), config);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    assert.equal(client.getServerVersion()?.name, "jev-decision-mcp");
    assert.equal(client.getServerVersion()?.version, "0.3.0");
    const { tools } = await client.listTools();
    assertDiscovery(tools, config.baseURL);
    assert.ok(tools[0]?.inputSchema.properties?.questions);
    assert.ok(tools[0]?.outputSchema);
    const result = await client.callTool({ name: "jev_decide", arguments: input });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, output);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.equal(content.length, 1);
    assert.equal(content[0]?.type, "text");
    assert.deepEqual(JSON.parse(content[0]!.text), output);
    const invalid = await client.callTool({ name: "jev_decide", arguments: { ...input, questions: {} } });
    assert.equal(invalid.isError, true);
    assert.equal(calls, 1);
  } finally { await client.close(); await server.close(); }
});

test("discovery reports the configured destination for a localhost deployment", async () => {
  const server = createServer(createDecider(localhostConfig, async () => Response.json(output)), localhostConfig);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  try {
    assert.equal(client.getServerVersion()?.name, "jev-decision-mcp");
    const { tools } = await client.listTools();
    assertDiscovery(tools, localhostConfig.baseURL);
    const result = await client.callTool({ name: "jev_decide", arguments: input });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, output);
  } finally { await client.close(); await server.close(); }
});

test("MCP reports API failures as tool errors", async () => {
  const server = createServer(createDecider(config, async () => Response.json({ private: "do not expose" }, { status: 401 })), config);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  try {
    const result = await client.callTool({ name: "jev_decide", arguments: input });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /API_ERROR/);
    assert.doesNotMatch(JSON.stringify(result), /do not expose/);
  } finally { await client.close(); await server.close(); }
});

test("built stdio server starts from another cwd with protocol-clean stdout and no key", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [builtServer],
    cwd: "/tmp",
    env: stdioEnv(),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (data) => { stderr += data.toString(); });
  const client = new Client({ name: "stdio-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), ["jev_decide"]);
    const result = await client.callTool({ name: "jev_decide", arguments: input });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /MISSING_API_KEY/);
    assert.equal(stderr, "");
  } finally { await client.close(); }
});

test("built stdio server reports the configured destination and ignores ambient legacy variables", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [builtServer],
    cwd: "/tmp",
    env: stdioEnv({ BASE_URL: "https://stdio.example.test/custom/prefix", MODEL: "custom-stdio-model" }),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (data) => { stderr += data.toString(); });
  const client = new Client({ name: "stdio-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assertDiscovery(tools, "https://stdio.example.test/custom/prefix");
    const result = await client.callTool({ name: "jev_decide", arguments: input });
    assert.equal(result.isError, true);
    const text = JSON.stringify(result.content);
    assert.match(text, /MISSING_API_KEY/);
    assert.match(text, /API_KEY/);
    // Legacy keys present in the environment never satisfy the credential.
    assert.doesNotMatch(text, /legacy-secret-a|legacy-secret-b/);
    assert.doesNotMatch(text, /TYPESAFE_API_KEY|LIQUID_API_KEY|DECISION_PROVIDER/);
    assert.equal(stderr, "");
  } finally { await client.close(); }
});

function runBuiltServer(env: Record<string, string>): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [builtServer], { cwd: "/tmp", env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

test("built server rejects invalid startup configuration without leaking values", async () => {
  for (const value of [
    "not a url",
    "ftp://api.example/x",
    "https://user:pass@api.example/x",
    "https://api.example/x?key=secret",
    "https://api.example/x#fragment",
    "constructor",
  ]) {
    const result = await runBuiltServer(stdioEnv({ BASE_URL: value }));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /BASE_URL/);
    assert.match(result.stderr, /MODEL/);
    assert.match(result.stderr, /JEV_TIMEOUT_MS/);
    assert.equal(result.stderr.includes(value), false);
  }
  const badModel = await runBuiltServer(stdioEnv({ MODEL: "   " }));
  assert.equal(badModel.code, 1);
  assert.match(badModel.stderr, /MODEL/);
  const badTimeout = await runBuiltServer(stdioEnv({ JEV_TIMEOUT_MS: "9999999" }));
  assert.equal(badTimeout.code, 1);
  assert.match(badTimeout.stderr, /JEV_TIMEOUT_MS/);
  assert.equal(badTimeout.stderr.includes("9999999"), false);
});

test("built server requires explicit BASE_URL and MODEL with no vendor defaults", async () => {
  const missingBase = await runBuiltServer(stdioEnv({ BASE_URL: "" }));
  assert.equal(missingBase.code, 1);
  assert.match(missingBase.stderr, /BASE_URL/);
  assert.equal(missingBase.stderr.includes("legacy-secret-a"), false);
  const missingModel = await runBuiltServer(stdioEnv({ MODEL: "" }));
  assert.equal(missingModel.code, 1);
  assert.match(missingModel.stderr, /MODEL/);
  assert.match(missingModel.stderr, /BASE_URL/);
});
