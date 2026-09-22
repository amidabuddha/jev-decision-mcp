import assert from "node:assert/strict";
import test from "node:test";
import { readConfig } from "../src/config.js";
import { createDecider, DecisionError } from "../src/decision.js";
import { decisionInput, validateResponse } from "../src/schema.js";
import { config, input, output } from "./fixtures.js";

test("sends a mixed batch to the official API with auth, preserving typed results", async () => {
  const decide = createDecider(config, async (url, init) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-test-key");
    assert.deepEqual(JSON.parse(String(init?.body)), { ...input, model: "jev-latest" });
    return Response.json(output);
  });
  assert.deepEqual(await decide(input), output);
});

test("honors explicit model override", async () => {
  const decide = createDecider(config, async (_, init) => {
    assert.equal(JSON.parse(String(init?.body)).model, "jev-1.13.0");
    return Response.json(output);
  });
  await decide({ ...input, model: "jev-1.13.0" });
});

test("rejects malformed requests before sending anything", async () => {
  let calls = 0;
  const decide = createDecider(config, async () => { calls++; return Response.json(output); });
  const invalid = [
    { ...input, questions: {} },
    { ...input, state: 5 },
    { ...input, questions: { x: { type: "noul", instructions: "" } } },
    { ...input, questions: { x: { type: "choice", instructions: "Choose", criteria: {} } } },
    { ...input, questions: { x: { type: "choice", instructions: "Choose", criteria: Object.fromEntries(Array.from({ length: 256 }, (_, i) => [String(i), null])) } } },
    { ...input, questions: { x: { type: "score", instructions: "Rate", criteria: ["Low"] } } },
    { ...input, questions: { x: { type: "score", instructions: "Rate", criteria: Array(11).fill("Level") } } },
    { ...input, questions: { x: { type: "noul", instructions: "Check", criteria: { yes: "yes" } } } },
    { ...input, endpoint: "https://example.com" },
  ];
  for (const request of invalid) await assert.rejects(decide(request), { code: "INVALID_INPUT" });
  assert.equal(calls, 0);
});

test("supports nested JSON state, structured questions and null choice descriptions", () => {
  assert.equal(decisionInput.safeParse({
    state: [{ document: { text: "Evidence", tags: [1, true, null] } }],
    questions: { x: { type: "choice", instructions: { question: "Choose", examples: ["a"] }, criteria: { a: null, b: { description: "Other" } } } },
  }).success, true);
});

test("missing key returns actionable error without network access", async () => {
  const decide = createDecider({ ...config, apiKey: undefined }, async () => { throw new Error("Should not call"); });
  await assert.rejects(decide(input), { code: "MISSING_API_KEY" });
});

test("HTTP error does not expose upstream body or credentials", async () => {
  const decide = createDecider(config, async () => Response.json({ error: "synthetic-test-key private ticket" }, { status: 401 }));
  await assert.rejects(decide(input), (error: unknown) => {
    assert.ok(error instanceof DecisionError);
    assert.equal(error.code, "API_ERROR");
    assert.match(error.message, /401/);
    assert.doesNotMatch(error.message, /synthetic-test-key|private ticket/);
    return true;
  });
});

test("SDK retries a rate limit and preserves the same request", async () => {
  let calls = 0;
  const decide = createDecider(config, async () => ++calls === 1
    ? Response.json({}, { status: 429, headers: { "retry-after-ms": "1" } }) : Response.json(output));
  assert.deepEqual(await decide(input), output);
  assert.equal(calls, 2);
});

test("deadline cancels a stalled API request", async () => {
  const decide = createDecider({ ...config, timeoutMs: 25 }, async (_, init) => new Promise((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
  }));
  await assert.rejects(decide(input), { code: "TIMEOUT" });
});

test("caller cancellation reaches the upstream request", async () => {
  const controller = new AbortController();
  const decide = createDecider(config, async (_, init) => new Promise((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
    controller.abort();
  }));
  await assert.rejects(decide(input, controller.signal), { code: "CANCELLED" });
});

test("malformed response is never returned as a decision", async () => {
  const broken = [
    {},
    { ...output, answers: {} },
    { ...output, answers: { ...output.answers, extra: { type: "noul", noul: 0.5 } } },
    { ...output, answers: { ...output.answers, team: { type: "noul", noul: 0.9 } } },
    { ...output, answers: { ...output.answers, refund_requested: { type: "noul", noul: 1.5 } } },
    { ...output, answers: { ...output.answers, team: { ...output.answers.team, choice: "unknown" } } },
    { ...output, answers: { ...output.answers, team: { ...output.answers.team, probabilities: { billing: 0.8, technical: 0.1 } } } },
    { ...output, answers: { ...output.answers, team: { ...output.answers.team, probabilities: { billing: 0.8, technical: 0.8, other: 0.8 } } } },
    { ...output, answers: { ...output.answers, urgency: { ...output.answers.urgency, score: 4 } } },
    { ...output, answers: { ...output.answers, urgency: { ...output.answers.urgency, legend: { "0": "Low" } } } },
  ];
  for (const response of broken) {
    const decide = createDecider(config, async () => Response.json(response));
    await assert.rejects(decide(input), { code: "INVALID_RESPONSE" });
  }
  assert.deepEqual(validateResponse(output, input), output);
});

test("config defaults and timeout validation", () => {
  assert.deepEqual(readConfig({}), { apiKey: undefined, model: "jev-latest", timeoutMs: 30000 });
  assert.equal(readConfig({ TYPESAFE_API_KEY: "  test  " }).apiKey, "test");
  for (const value of ["0", "NaN", "-1", "120001", "1.5"]) assert.throws(() => readConfig({ JEV_TIMEOUT_MS: value }));
});
