import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { decisionInput, validateResponse } from "../src/schema.js";

// Opt-in compatibility test against the installed Codex parser. No turn is
// started, no model is called, and the diagnostic context is ephemeral.
const child = spawn("codex", [
  "-c", "mcp_servers.openaiDeveloperDocs.enabled=false",
  "-c", "mcp_servers.node_repl.enabled=false",
  "app-server", "--stdio",
], { stdio: ["pipe", "pipe", "pipe"] });
let nextId = 0;
type Reply = { result?: Record<string, unknown>; error?: { message: string } };
const pending = new Map<number, { resolve: (value: Reply) => void; reject: (error: Error) => void }>();
const lines = createInterface({ input: child.stdout });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  const waiter = pending.get(message.id);
  if (waiter) { pending.delete(message.id); waiter.resolve(message); }
});
// Drain diagnostics without printing environment or configuration details.
child.stderr.resume();
child.on("error", (error) => { for (const waiter of pending.values()) waiter.reject(error); });
child.on("exit", () => { for (const waiter of pending.values()) waiter.reject(new Error("Codex diagnostic process exited")); });
function request(method: string, params: unknown): Promise<Reply> {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 30000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
}
try {
  const initialized = await request("initialize", {
    clientInfo: { name: "jev_schema_diagnostic", version: "0.1.0" },
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  assert.equal(initialized.error, undefined);
  child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  const fixed = z.toJSONSchema(decisionInput, { target: "draft-7" });
  const original = structuredClone(fixed);
  // Reproduce the original tuple representation while keeping every other
  // part of the actual schema identical to the fixed version.
  let tupleCount = 0;
  function restoreTuple(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(restoreTuple); return; }
    const schema = value as Record<string, unknown>;
    if (schema.type === "array" && schema.minItems === 2 && schema.maxItems === 10) {
      const item = schema.items;
      schema.items = [item, structuredClone(item)];
      schema.additionalItems = structuredClone(item);
      tupleCount++;
      return;
    }
    Object.values(schema).forEach(restoreTuple);
  }
  restoreTuple(original);
  assert.equal(tupleCount, 1);
  const parameters = (inputSchema: unknown) => ({
    ephemeral: true,
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    dynamicTools: [{ type: "function", name: "jev_schema_probe", description: "Schema compatibility probe only", inputSchema }],
  });
  const baseline = await request("thread/start", parameters(original));
  assert.match(baseline.error?.message ?? "", /AdditionalProperties|schema/i, "Expected the original tuple schema to fail in Codex");
  console.log("Confirmed: installed Codex rejects the original tuple schema.");
  const repaired = await request("thread/start", parameters(fixed));
  assert.equal(repaired.error, undefined, repaired.error?.message);
  const thread = repaired.result?.thread as { id: string };
  const status = await request("mcpServerStatus/list", { threadId: thread.id, detail: "toolsAndAuthOnly", limit: 100 });
  assert.equal(status.error, undefined);
  const servers = status.result?.data as Array<{ name: string; tools: Record<string, unknown>; toolsError: string | null }>;
  const jev = servers.find((server) => server.name === "jev");
  assert.ok(jev && Object.hasOwn(jev.tools, "jev_decide"), "Native Codex MCP discovery must include jev_decide");
  assert.equal(jev.toolsError, null);
  console.log("Passed: installed Codex accepts the repaired schema and discovers jev_decide through MCP.");
  if (process.argv.includes("--live")) {
    const input = decisionInput.parse(JSON.parse(await readFile(new URL("../examples/decision.json", import.meta.url), "utf8")));
    const started = performance.now();
    const response = await request("mcpServer/tool/call", {
      threadId: thread.id, server: "jev", tool: "jev_decide", arguments: input,
    });
    assert.equal(response.error, undefined);
    assert.notEqual(response.result?.isError, true, "Live MCP tool call failed");
    const result = validateResponse(response.result?.structuredContent, input);
    console.log(JSON.stringify({ elapsed_ms: Math.round(performance.now() - started), ...result }, null, 2));
    console.log("Passed: live tool call through Codex's native MCP interface.");
  }
  await request("thread/unsubscribe", { threadId: thread.id });
} finally {
  lines.close();
  child.stdin.end();
  child.kill();
}
