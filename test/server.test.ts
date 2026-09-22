import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDecider } from "../src/decision.js";
import { createServer } from "../src/server.js";
import { config, input, output } from "./fixtures.js";

test("MCP discovery and calls preserve structured results and reject bad input", async () => {
  let calls = 0;
  const server = createServer(createDecider(config, async () => { calls++; return Response.json(output); }));
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), ["jev_decide"]);
    assert.ok(tools[0]?.inputSchema.properties?.questions);
    assert.ok(tools[0]?.outputSchema);
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
    checkItems(tools[0]?.inputSchema);
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

test("MCP reports API failures as tool errors", async () => {
  const server = createServer(createDecider(config, async () => Response.json({ private: "do not expose" }, { status: 401 })));
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
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    cwd: "/tmp",
    env: { TYPESAFE_API_KEY: "", TYPESAFE_DEFAULT_MODEL: "jev-latest", JEV_TIMEOUT_MS: "30000" },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (data) => { stderr += data.toString(); });
  const client = new Client({ name: "stdio-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools[0]?.name, "jev_decide");
    const result = await client.callTool({ name: "jev_decide", arguments: input });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /MISSING_API_KEY/);
    assert.equal(stderr, "");
  } finally { await client.close(); }
});
