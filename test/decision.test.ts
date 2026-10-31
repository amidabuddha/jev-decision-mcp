import assert from "node:assert/strict";
import test from "node:test";
import { ConfigError, readConfig } from "../src/config.js";
import { createDecider, type DecisionError } from "../src/decision.js";
import { decisionInput, validateResponse } from "../src/schema.js";
import { config, endpoint, input, output } from "./fixtures.js";

// A copy of the sample response with one answer changed.
const patch = (id: string, change: object) => ({ ...output, answers: { ...output.answers, [id]: { ...output.answers[id], ...change } } });
const env = { API_KEY: "  synthetic-key  ", BASE_URL: "https://api.invented.example/decisions", MODEL: "  vendor/model-x  ", JEV_TIMEOUT_MS: "30000" };

test("config: BASE_URL and MODEL are required, API_KEY is optional, legacy variables never fill in", () => {
  assert.deepEqual(readConfig(env), { apiKey: "synthetic-key", baseURL: env.BASE_URL, model: "vendor/model-x", timeoutMs: 30000 }); // any model name
  for (const API_KEY of [undefined, "", "   "]) assert.equal(readConfig({ ...env, API_KEY }).apiKey, undefined); // discovery works without a key
  for (const name of ["BASE_URL", "MODEL"]) for (const value of [undefined, "", "   "]) {
    assert.throws(() => readConfig({ ...env, [name]: value }), (error: unknown) => error instanceof ConfigError && error.message.includes(name));
  }
  // Ambient variables from older releases or a developer .env configure and default nothing.
  const legacy = { DECISION_PROVIDER: "liquid", TYPESAFE_API_KEY: "k", LIQUID_API_KEY: "k", TYPESAFE_DEFAULT_MODEL: "m", DECISION_DEFAULT_MODEL: "m", TYPESAFE_BASE_URL: "https://api.typesafe.ai" };
  assert.deepEqual(readConfig({ ...env, ...legacy }), readConfig(env));
  assert.equal(readConfig({ ...env, ...legacy, API_KEY: "" }).apiKey, undefined);
  assert.throws(() => readConfig(legacy), /BASE_URL/);
  assert.throws(() => readConfig({ ...legacy, BASE_URL: "https://x.example" }), /MODEL/);
});

test("config: BASE_URL and JEV_TIMEOUT_MS are validated and bad URLs are never echoed", () => {
  for (const [raw, expected] of [
    ["https://x.example/a/b///", "https://x.example/a/b"], // trailing slashes dropped, path prefix kept
    ["http://127.0.0.1:8787/jev", "http://127.0.0.1:8787/jev"], // any host, plain http allowed
  ]) assert.equal(readConfig({ ...env, BASE_URL: raw }).baseURL, expected);
  for (const value of [
    "api.example", "/decisions", "ftp://api.example/x", "file:///tmp/x", "https://", "constructor", "https://api.example:99999/x",
    "https://user:pass@api.example/x", "https://api.example/x?key=secret", "https://api.example/x#fragment",
  ]) {
    assert.throws(() => readConfig({ ...env, BASE_URL: value }), (e: unknown) => e instanceof ConfigError && /BASE_URL/.test(e.message) && !e.message.includes(value));
  }
  assert.equal(readConfig({ ...env, JEV_TIMEOUT_MS: undefined }).timeoutMs, 30000);
  for (const value of ["1", "120000"]) assert.equal(readConfig({ ...env, JEV_TIMEOUT_MS: value }).timeoutMs, Number(value));
  for (const value of ["0", "NaN", "-1", "120001", "1.5"]) assert.throws(() => readConfig({ ...env, JEV_TIMEOUT_MS: value }), /JEV_TIMEOUT_MS/);
});

test("input schema: accepts valid choice, score and noul, rejects unknown keys and criteria size violations", () => {
  const request = (question: object, extra: object = {}) => ({ state: "Evidence", questions: { x: { instructions: "Decide", ...question } }, ...extra });
  const options = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`o${i}`, null]));
  const levels = (n: number) => Array<string>(n).fill("Level");
  const noul = request({ type: "noul" });
  for (const valid of [
    request({ type: "choice", criteria: { a: null, b: { description: "Other" } } }), // null and structured descriptions
    request({ type: "choice", criteria: options(255) }),
    request({ type: "score", criteria: levels(2) }),
    request({ type: "score", criteria: levels(10) }),
    noul,
    { ...request({ type: "choice", instructions: { question: "Choose", examples: ["a"] }, criteria: { a: null } }), state: [{ text: "Evidence", tags: [1, true, null] }] },
  ]) assert.equal(decisionInput.safeParse(valid).success, true, JSON.stringify(valid).slice(0, 80));
  for (const invalid of [
    { ...noul, questions: {} },
    { ...noul, state: 5 },
    { ...noul, endpoint: "https://example.com" }, // unknown top-level key
    { ...noul, model: "   " },
    request({ type: "noul", instructions: "" }),
    ...[{ type: "choice", criteria: { a: null } }, { type: "score", criteria: levels(2) }, { type: "noul" }].map((question) => request({ ...question, extra: 1 })), // unknown question key
    request({ type: "noul", criteria: { yes: "yes" } }), // unknown criteria key
    request({ type: "choice", criteria: {} }),
    request({ type: "choice", criteria: options(256) }),
    request({ type: "score", criteria: levels(1) }),
    request({ type: "score", criteria: levels(11) }),
  ]) assert.equal(decisionInput.safeParse(invalid).success, false, JSON.stringify(invalid).slice(0, 80));
});

test("validateResponse: answer IDs, types, labels, choice and score range must match the questions", () => {
  const { answers } = output;
  assert.deepEqual(validateResponse(output, input), output);
  for (const score of [0, 2]) assert.doesNotThrow(() => validateResponse(patch("urgency", { score }), input));
  for (const [rule, response] of [
    [/Answer IDs/, { ...output, answers: { team: answers.team, refund_requested: answers.refund_requested } }],
    [/Answer IDs/, { ...output, answers: { ...answers, extra: { type: "noul", noul: 0.5 } } }],
    [/Answer type/, patch("team", { type: "noul", noul: 0.9 })],
    [/Probability labels/, patch("team", { probabilities: { billing: 0.8, technical: 0.2 } })],
    [/Probability labels/, patch("urgency", { probabilities: { "0": 0.01, "1": 0.03, x: 0.96 } })],
    [/Unknown choice/, patch("team", { choice: "unknown" })],
    [/Score or legend/, patch("urgency", { score: 3 })],
    [/Score or legend/, patch("urgency", { score: -1 })],
    [/Score or legend/, patch("urgency", { legend: { "0": "Low" } })],
    [/./, patch("refund_requested", { noul: 1.5 })],
    [/./, { ...output, usage: null }], // usage is never invented
    [/./, { ...output, usage: { input_tokens: null, output_tokens: 50 } }],
    [/./, {}],
  ] as const) assert.throws(() => validateResponse(response, input), rule);
});

test("validateResponse: probabilities sum to one, allowing two-decimal rounding but nothing looser", () => {
  const team = (probabilities: object) => patch("team", { probabilities });
  for (const response of [
    output,
    patch("urgency", { probabilities: { "0": 0.33, "1": 0.33, "2": 0.33 } }), // rounded down to 0.99
    team({ billing: 0.33, technical: 0.33, other: 0.33 }),
    team({ billing: 0.34, technical: 0.34, other: 0.33 }), // rounded up to 1.01
  ]) assert.deepEqual(validateResponse(response, input), response); // returned as sent, never normalized
  for (const probabilities of [
    { billing: 0.33, technical: 0.33, other: 0.32 }, // 0.98 is just beyond rounding error
    { billing: 0.3, technical: 0.3, other: 0.3 },
    { billing: 0.4, technical: 0.4, other: 0.4 },
    { billing: 0.8001, technical: 0.1001, other: 0.0898 }, // higher precision gets the tight tolerance
    { billing: 0, technical: 0, other: 0 }, // no mass
  ]) assert.throws(() => validateResponse(team(probabilities), input), /sum to one/);
});

test("decision call posts plain JSON with the key to the configured route; a model override changes only the model", async (t) => {
  // Ambient SDK vendor variables must never redirect key, destination or model.
  const ambient = { TYPESAFE_API_KEY: "ambient-key", TYPESAFE_BASE_URL: "https://ambient.example", TYPESAFE_DEFAULT_MODEL: "ambient-model" };
  const saved = Object.fromEntries(Object.keys(ambient).map((name) => [name, process.env[name]]));
  Object.assign(process.env, ambient);
  t.after(() => { for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  // A trailing-slash BASE_URL composes the same route after normalization.
  const cfg = readConfig({ API_KEY: config.apiKey, BASE_URL: `${config.baseURL}///`, MODEL: config.model });
  const large = decisionInput.parse({ ...input, state: "Synthetic long evidence block. ".repeat(80) });
  const sent: unknown[] = [];
  const decide = createDecider(cfg, async (url, init) => {
    const headers = new Headers(init?.headers);
    const body = String(init?.body);
    assert.equal(url, endpoint(config));
    assert.equal(init?.method, "POST");
    assert.equal(headers.get("Authorization"), `Bearer ${config.apiKey}`);
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.equal(headers.get("Content-Encoding"), null); // never compressed, even above the 1 KiB threshold
    assert.ok(Buffer.byteLength(body, "utf8") > 1024);
    sent.push(JSON.parse(body));
    return Response.json(output);
  });
  assert.deepEqual(await decide(large), output);
  for (const model of ["custom-model-42", "  vendor/model-x  "]) assert.deepEqual(await decide({ ...large, model }), output);
  assert.deepEqual(sent, ["judge-model-7", "custom-model-42", "vendor/model-x"].map((model) => ({ ...large, model })));
});

test("null noul criterion descriptions are omitted on the wire; caller input is untouched and raw results pass through", async () => {
  const request = decisionInput.parse({
    state: "Billing question about a duplicate charge.",
    questions: {
      route: { type: "choice", instructions: "Which team handles this?", criteria: { billing: null, technical: "Software failures" } },
      explicit: { type: "noul", instructions: "Is a refund explicitly requested?", criteria: { true: null, false: null } },
      partial: { type: "noul", instructions: "Is the text about money?", criteria: { true: { note: ["mentions", null] }, false: null } },
    },
  });
  const before = structuredClone(request);
  const response = { model: "judge-model-7", usage: { input_tokens: 28892, output_tokens: 0 }, answers: {
    route: { type: "choice", choice: "technical", probabilities: { billing: 0.2, technical: 0.8 }, confidence: 0.8 },
    explicit: { type: "noul", noul: 0.99 },
    partial: { type: "noul", noul: 0.95 },
  } };
  const decide = createDecider(config, async (_, init) => {
    const { questions } = JSON.parse(String(init?.body));
    assert.deepEqual(questions.route.criteria, { billing: null, technical: "Software failures" }); // choice nulls are untouched
    assert.equal("criteria" in questions.explicit, false);
    assert.deepEqual(questions.partial.criteria, { true: { note: ["mentions", null] } });
    return Response.json(response);
  });
  assert.deepEqual(await decide(request), response);
  assert.deepEqual(request, before);
});

test("errors are coded and never expose the API key or upstream response bodies", async () => {
  const idle = async (): Promise<Response> => { throw new Error("must not network"); };
  await assert.rejects(createDecider({ ...config, apiKey: undefined }, idle)(input), { code: "MISSING_API_KEY", message: /API_KEY/ });
  await assert.rejects(createDecider(config, idle)({ ...input, questions: {} }), { code: "INVALID_INPUT" });
  await assert.rejects(createDecider(config, async () => Response.json({ ...output, usage: null }))(input), { code: "INVALID_RESPONSE" });
  const unauthorized = createDecider(config, async () => Response.json({ error: `${config.apiKey} private ticket` }, { status: 401 }));
  const failure = await unauthorized(input).then(() => assert.fail("expected a rejection"), (error: DecisionError) => error);
  assert.equal(failure.code, "API_ERROR");
  assert.match(failure.message, /Decision API HTTP 401.*API_KEY/); // actionable guidance
  assert.doesNotMatch(failure.message, new RegExp(`${config.apiKey}|private ticket`));
});

test("request lifecycle: a rate limit is retried, a stalled request times out, caller abort is cancelled", { timeout: 5000 }, async () => {
  let calls = 0;
  const limited = createDecider(config, async () => ++calls === 1
    ? Response.json({}, { status: 429, headers: { "retry-after-ms": "1" } }) : Response.json(output));
  assert.deepEqual(await limited(input), output);
  assert.equal(calls, 2);
  const stalled = (timeoutMs: number, onFetch = () => {}) => createDecider({ ...config, timeoutMs }, (_, init) => new Promise((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
    onFetch();
  }));
  await assert.rejects(stalled(25)(input), { code: "TIMEOUT" });
  const controller = new AbortController();
  await assert.rejects(stalled(30000, () => controller.abort())(input, controller.signal), { code: "CANCELLED" });
});
