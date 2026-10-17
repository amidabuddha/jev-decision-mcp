import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadProjectEnv, readConfig, type Config } from "../src/config.js";
import { decisionInput, validateResponse, type DecisionInput } from "../src/schema.js";

// Explicit opt-in live command only (`npm run test:live`); the normal test
// suite never touches the network. The cases below validate the live response
// contract and integration wiring, not judgment quality. Output is limited to
// safe integration summaries and sanitized MCP errors: the API key is forwarded
// to the built server but never printed.

let config: Config;
try {
  loadProjectEnv();
  config = readConfig();
} catch (error) {
  // ConfigError messages are static and never echo values; nothing exists yet
  // to redact.
  const detail = error instanceof Error ? error.message : "unknown error";
  console.error(`Live MCP test cannot start: ${detail}`);
  process.exit(1);
}

// Only the four generic configuration variables (API_KEY, BASE_URL, MODEL,
// JEV_TIMEOUT_MS) are forwarded to the built server, and all four are pinned
// here to the resolved values so the child targets exactly what this script
// reports.
const CONTROLLED_ENV = ["API_KEY", "BASE_URL", "MODEL", "JEV_TIMEOUT_MS"] as const;

// Defense in depth: never echo the credential even inside unexpected errors.
const redact = (text: string): string =>
  config.apiKey ? text.split(config.apiKey).join("[redacted]") : text;

console.log(`Live target: model=${config.model} destination=${config.baseURL}`);
if (!config.apiKey) {
  console.error("LIVE PENDING: no API_KEY. Add it to the project .env or the process environment, then run npm run test:live again.");
  process.exit(1);
}

const pinned: Record<(typeof CONTROLLED_ENV)[number], string> = {
  API_KEY: config.apiKey,
  BASE_URL: config.baseURL,
  MODEL: config.model,
  JEV_TIMEOUT_MS: String(config.timeoutMs),
};
const childEnv: Record<string, string> = Object.fromEntries(CONTROLLED_ENV.map((name) => [name, pinned[name]]));

const client = new Client({ name: "jev-live-smoke-test", version: "1.0.0" });
const transport = new StdioClientTransport({
  // The built distribution is what npm ships; test exactly that artifact.
  command: process.execPath,
  args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
  env: childEnv,
  stderr: "inherit",
});

const fixture = decisionInput.parse(JSON.parse(await readFile(new URL("../examples/decision.json", import.meta.url), "utf8")));
const over1KiB = decisionInput.parse({ ...fixture, state: "Synthetic evidence block for the large-request live case. ".repeat(30) });

// Named cases isolate failures to one live capability each and cover all three
// question types, response metadata, a request above 1 KiB, structured JSON
// state, structured JSON instructions (objects and arrays), structured JSON
// criteria and null criterion descriptions. Each structured case varies exactly
// one shape so a failure diagnoses one API compatibility point.
const cases: Array<{ name: string; input: DecisionInput }> = [
  { name: "mixed-question-types", input: fixture },
  {
    name: "response-metadata",
    input: decisionInput.parse({
      state: { ticket: "Please refund the duplicate charge today." },
      questions: { refund_requested: { type: "noul", instructions: "Does the text explicitly request a refund?" } },
    }),
  },
  { name: "request-over-1kib", input: over1KiB },
  {
    name: "structured-json-state",
    input: decisionInput.parse({
      state: [{ document: { text: "Duplicate charge reported.", tags: ["billing", 2, true], nested: { refunded: false } } }],
      questions: { team: { type: "choice", instructions: "Route the document to a team and answer with its label.", criteria: { billing: "Refunds", technical: "Software", other: "Other" } } },
    }),
  },
  {
    name: "structured-json-instructions",
    input: decisionInput.parse({
      state: "The customer was charged twice for order A-104 and asks for a refund today.",
      questions: {
        urgency: {
          type: "score",
          instructions: { question: "How time-sensitive is the response?", scale: "0-based, low to high" },
          criteria: ["No deadline stated", "Within days", "Today or immediately"],
        },
        effort: {
          type: "score",
          instructions: [{ task: "Estimate the reply effort" }, { scale: "0-based, low to high" }],
          criteria: ["One sentence", "Short review", "Full investigation"],
        },
      },
    }),
  },
  {
    name: "structured-json-criteria",
    input: decisionInput.parse({
      state: "The customer was charged twice for order A-104 and asks for a refund today.",
      questions: {
        urgency: {
          type: "score",
          instructions: "How time-sensitive is the response? Score 0-based, low to high.",
          criteria: [{ level: "No deadline stated" }, { level: "Within days" }, { level: "Today or immediately" }],
        },
      },
    }),
  },
  {
    name: "null-criterion-descriptions",
    input: decisionInput.parse({
      state: "Billing question about a duplicate charge.",
      questions: {
        route: { type: "choice", instructions: "Which team handles this?", criteria: { billing: null, technical: "Software failures", other: null } },
        explicit: { type: "noul", instructions: "Is a refund explicitly requested?", criteria: { true: null, false: null } },
      },
    }),
  },
];

let passed = 0;
try {
  await client.connect(transport);
  for (const testCase of cases) {
    const bytes = Buffer.byteLength(JSON.stringify(testCase.input), "utf8");
    const started = performance.now();
    try {
      const response = await client.callTool({ name: "jev_decide", arguments: testCase.input });
      const elapsed = Math.round(performance.now() - started);
      if (response.isError) {
        // The server returns sanitized {error, message} payloads only.
        console.error(`FAIL ${testCase.name}: ${redact(JSON.stringify(response.content))} (${elapsed} ms)`);
        continue;
      }
      const result = validateResponse(response.structuredContent, testCase.input);
      console.log(`PASS ${testCase.name}: model=${result.model} answers=${Object.keys(result.answers).length} input_tokens=${result.usage.input_tokens} output_tokens=${result.usage.output_tokens} request_bytes=${bytes} elapsed_ms=${elapsed}`);
      passed++;
    } catch (error) {
      // Contract or transport failure; keep the message short and redacted.
      const detail = error instanceof Error ? error.message : "unknown error";
      console.error(`FAIL ${testCase.name}: ${redact(detail)}`);
    }
  }
  console.log(`${passed}/${cases.length} live cases passed for model ${config.model} at ${config.baseURL}. This checks live integration and the response contract, not judgment quality.`);
  if (passed !== cases.length) process.exitCode = 1;
} catch (error) {
  const detail = error instanceof Error ? error.message : "unknown error";
  console.error(`Live MCP test failed before the cases ran: ${redact(detail)}`);
  process.exitCode = 1;
} finally { await client.close(); }
