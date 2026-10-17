import assert from "node:assert/strict";
import test from "node:test";
import { ConfigError, readConfig } from "../src/config.js";
import { createDecider, DecisionError } from "../src/decision.js";
import { decisionInput, validateResponse } from "../src/schema.js";
import { config, configs, endpoint, input, output } from "./fixtures.js";

const fullEnv = {
  API_KEY: "  synthetic-key  ",
  BASE_URL: "https://api.invented.example/decisions",
  MODEL: "  judge-model-7  ",
  JEV_TIMEOUT_MS: "30000",
};

// Ambient legacy variables from older releases or the developer .env. They
// must never configure, default or satisfy anything.
const legacyEnv = {
  DECISION_PROVIDER: "liquid",
  TYPESAFE_API_KEY: "typesafe-secret",
  LIQUID_API_KEY: "liquid-secret",
  TYPESAFE_DEFAULT_MODEL: "jev-9.9.9",
  DECISION_DEFAULT_MODEL: "legacy-shared-model",
  TYPESAFE_BASE_URL: "https://api.typesafe.ai",
  TYPESAFE_LOG_LEVEL: "debug",
};

test("sends a mixed batch to the configured destination with auth, preserving typed results", async () => {
  const decide = createDecider(config, async (url, init) => {
    assert.equal(url, endpoint(config));
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-test-key");
    assert.deepEqual(JSON.parse(String(init?.body)), { ...input, model: "judge-model-7" });
    return Response.json(output);
  });
  assert.deepEqual(await decide(input), output);
});

test("small requests travel as plain JSON with exact routing and no Content-Encoding", async () => {
  // Rounded distribution deliberately sums to 0.99; it must reach callers unchanged.
  const urgency = { type: "score", score: 1.95, legend: { "0": "No response deadline or time pressure is stated", "1": "A response is requested within several days", "2": "A response is requested today or immediately" }, probabilities: { "0": 0.33, "1": 0.33, "2": 0.33 }, confidence: 0.9 };
  const rounded = { model: "judge-model-7", answers: {
    team: { type: "choice", choice: "billing", probabilities: { billing: 0.98, technical: 0.01, other: 0.01 }, confidence: 0.9 },
    refund_requested: { type: "noul", noul: 0.99 },
    urgency,
  }, usage: { input_tokens: 300, output_tokens: 50 } };
  const decide = createDecider(config, async (url, init) => {
    const headers = new Headers(init?.headers);
    const body = String(init?.body);
    assert.equal(url, endpoint(config));
    assert.equal(init?.method, "POST");
    assert.equal(headers.get("Authorization"), "Bearer synthetic-test-key");
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.equal(headers.get("Content-Encoding"), null);
    assert.ok(Buffer.byteLength(body, "utf8") <= 1024, "small fixture must stay below the 1 KiB compression threshold");
    assert.deepEqual(JSON.parse(body), { ...input, model: "judge-model-7" });
    return Response.json(rounded);
  });
  assert.deepEqual(await decide(input), rounded);
});

test("requests above one KiB are still sent as plain JSON with more than 1024 bytes on the wire", async () => {
  const large = decisionInput.parse({ ...input, state: "Synthetic long evidence block. ".repeat(80) });
  // Rounded distribution and usage must arrive exactly as sent, without renormalization.
  const rounded = { model: "judge-model-7", answers: {
    team: { type: "choice", choice: "billing", probabilities: { billing: 0.98, technical: 0.01, other: 0.01 }, confidence: 0.9 },
    refund_requested: { type: "noul", noul: 0.99 },
    urgency: { type: "score", score: 1.95, legend: { "0": "No response deadline or time pressure is stated", "1": "A response is requested within several days", "2": "A response is requested today or immediately" }, probabilities: { "0": 0.01, "1": 0.03, "2": 0.96 }, confidence: 0.9 },
  }, usage: { input_tokens: 28892, output_tokens: 2950 } };
  const decide = createDecider(config, async (url, init) => {
    const headers = new Headers(init?.headers);
    const body = String(init?.body);
    assert.equal(url, endpoint(config));
    assert.equal(init?.method, "POST");
    assert.equal(headers.get("Authorization"), "Bearer synthetic-test-key");
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.equal(headers.get("Content-Encoding"), null);
    // Establish that this test really pushed more than 1024 uncompressed bytes.
    assert.ok(Buffer.byteLength(body, "utf8") > 1024, "large request must exceed 1024 bytes on the wire");
    assert.deepEqual(JSON.parse(body), { ...large, model: "judge-model-7" });
    return Response.json(rounded);
  });
  assert.deepEqual(await decide(large), rounded);
});

test("honors explicit model override with arbitrary model names", async () => {
  for (const override of ["custom-model-42", "vendor/model-x", "model-a.b-c_3"]) {
    const decide = createDecider(config, async (_, init) => {
      assert.equal(JSON.parse(String(init?.body)).model, override);
      return Response.json(output);
    });
    await decide({ ...input, model: override });
  }
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
  // The original null-description shapes stay schema-valid, including a noul
  // with both descriptions null and nested nulls inside structured descriptions.
  assert.equal(decisionInput.safeParse({
    state: "Billing question about a duplicate charge.",
    questions: {
      explicit: { type: "noul", instructions: "Is a refund explicitly requested?", criteria: { true: null, false: null } },
      partial: { type: "noul", instructions: "Is the text about money?", criteria: { true: { note: ["mentions", null], meta: { blank: null } }, false: null } },
    },
  }).success, true);
});

test("omits only null optional noul criterion descriptions on the wire without touching caller input", async () => {
  const nulldesc = decisionInput.parse({
    state: "Billing question about a duplicate charge.",
    questions: {
      route: { type: "choice", instructions: "Which team handles this?", criteria: { billing: null, technical: "Software failures", other: null } },
      allnull: { type: "choice", instructions: "Pick a lane.", criteria: { a: null, b: null } },
      explicit: { type: "noul", instructions: "Is a refund explicitly requested?", criteria: { true: null, false: null } },
      partial: { type: "noul", instructions: "Is the text about money?", criteria: { true: { note: ["mentions", null], meta: { blank: null } }, false: null } },
    },
  });
  const before = structuredClone(nulldesc);
  const response = {
    model: "judge-model-7",
    answers: {
      route: { type: "choice", choice: "technical", probabilities: { billing: 0.2, technical: 0.7, other: 0.1 }, confidence: 0.8 },
      allnull: { type: "choice", choice: "a", probabilities: { a: 0.6, b: 0.4 }, confidence: 0.7 },
      explicit: { type: "noul", noul: 0.99 },
      partial: { type: "noul", noul: 0.95 },
    },
    usage: { input_tokens: 28892, output_tokens: 0 },
  };
  for (const cfg of configs) {
    const decide = createDecider(cfg, async (url, init) => {
      // The custom configured endpoint, credential and model are unaffected.
      assert.equal(url, endpoint(cfg));
      assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${cfg.apiKey}`);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, cfg.model);
      const { questions } = body;
      // Choice null descriptions travel unchanged, all-null and mixed alike.
      assert.deepEqual(questions.route.criteria, { billing: null, technical: "Software failures", other: null });
      assert.deepEqual(questions.allnull.criteria, { a: null, b: null });
      // Both-null noul criteria is omitted entirely; a mixed criterion keeps
      // the non-null entry exactly, including nested nulls in structured
      // descriptions.
      assert.equal("criteria" in questions.explicit, false);
      assert.deepEqual(questions.partial.criteria, { true: { note: ["mentions", null], meta: { blank: null } } });
      return Response.json(response);
    });
    // Raw response values, including zero output tokens, are returned unchanged.
    assert.deepEqual(await decide(nulldesc), response);
  }
  // The caller's input is unchanged by the request conversion.
  assert.deepEqual(nulldesc, before);
  // Response-side behavior is unchanged too: null usage is still an
  // INVALID_RESPONSE and is never repaired.
  const decide = createDecider(config, async () => Response.json({ ...response, usage: null }));
  await assert.rejects(decide(nulldesc), { code: "INVALID_RESPONSE" });
});

test("missing key returns actionable error naming API_KEY without network access", async () => {
  const decide = createDecider({ ...config, apiKey: undefined }, async () => { throw new Error("Should not call"); });
  await assert.rejects(decide(input), (error: unknown) => {
    assert.ok(error instanceof DecisionError);
    assert.equal(error.code, "MISSING_API_KEY");
    assert.match(error.message, /API_KEY/);
    return true;
  });
});

test("HTTP error does not expose upstream body or credentials", async () => {
  const decide = createDecider(config, async () => Response.json({ error: "synthetic-test-key private ticket" }, { status: 401 }));
  await assert.rejects(decide(input), (error: unknown) => {
    assert.ok(error instanceof DecisionError);
    assert.equal(error.code, "API_ERROR");
    assert.match(error.message, /Decision API HTTP 401/);
    assert.match(error.message, /API_KEY/);
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

test("preserves rounded probabilities and usage for a ten-question, twenty-choice batch", async () => {
  const labels = Array.from({ length: 20 }, (_, i) => `candidate_${i}`);
  const criteria = Object.fromEntries(labels.map((label) => [label, null]));
  const questions = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [
    `job_${i}`, { type: "choice", instructions: "Choose the best candidate for this synthetic job.", criteria },
  ]));
  const request = decisionInput.parse({ state: "Synthetic routing test", questions });
  // Minimal distribution from the failing live response; other labels are zero.
  for (const leading of [0.81, 0.83]) {
    const values = [leading, 0.11, 0.03, 0.02, 0.01, 0.01, ...Array(14).fill(0)];
    const probabilities = Object.fromEntries(labels.map((label, i) => [label, values[i]]));
    const response = {
      model: "judge-model-7",
      answers: Object.fromEntries(Object.keys(questions).map((id) => [id, {
        type: "choice", choice: "candidate_0", probabilities, confidence: 0.8,
      }])),
      usage: { input_tokens: 28892, output_tokens: 2950 },
    };
    const decide = createDecider(config, async () => Response.json(response));
    assert.deepEqual(await decide(request), response);
  }
});

test("accepts rounded score distributions without changing score, confidence or probabilities", () => {
  for (const probabilities of [{ "0": 0.33, "1": 0.33, "2": 0.33 }, { "0": 0.34, "1": 0.34, "2": 0.33 }]) {
    const response = { ...output, answers: { ...output.answers, urgency: {
      ...output.answers.urgency, probabilities,
    } } };
    assert.deepEqual(validateResponse(response, input), response);
  }
});

test("rejects probability errors beyond rounding, higher-precision errors and zero mass", async () => {
  for (const probabilities of [
    { billing: 0.3, technical: 0.3, other: 0.3 },
    { billing: 0.4, technical: 0.4, other: 0.4 },
    { billing: 0.8001, technical: 0.1001, other: 0.0898 },
    { billing: 0, technical: 0, other: 0 },
  ]) {
    const response = { ...output, answers: { ...output.answers, team: {
      ...output.answers.team, probabilities,
    } } };
    const decide = createDecider(config, async () => Response.json(response));
    await assert.rejects(decide(input), { code: "INVALID_RESPONSE" });
  }
});

test("config trims generic variables, normalizes trailing slashes and keeps API_KEY optional", () => {
  assert.deepEqual(readConfig(fullEnv), { apiKey: "synthetic-key", baseURL: "https://api.invented.example/decisions", model: "judge-model-7", timeoutMs: 30000 });
  // Trailing slashes are removed without dropping any path prefix.
  assert.equal(readConfig({ ...fullEnv, BASE_URL: "https://x.example///" }).baseURL, "https://x.example");
  assert.equal(readConfig({ ...fullEnv, BASE_URL: "https://x.example/a/b///" }).baseURL, "https://x.example/a/b");
  assert.equal(readConfig({ ...fullEnv, BASE_URL: "https://x.example" }).baseURL, "https://x.example");
  // The credential is optional: discovery works without it.
  assert.equal(readConfig({ ...fullEnv, API_KEY: "" }).apiKey, undefined);
  assert.equal(readConfig({ ...fullEnv, API_KEY: "   " }).apiKey, undefined);
  // Arbitrary model names are accepted with no allowlist.
  for (const model of ["local-eval-model", "model-a.b-c_3", "vendor/model-x", "MY-MODEL-2024"]) {
    assert.equal(readConfig({ ...fullEnv, MODEL: model }).model, model);
  }
});

test("BASE_URL and MODEL are explicit startup configuration without vendor defaults", () => {
  for (const env of [
    {},
    { ...fullEnv, BASE_URL: undefined },
    { ...fullEnv, BASE_URL: "" },
    { ...fullEnv, BASE_URL: "   " },
  ]) {
    assert.throws(() => readConfig(env), (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /BASE_URL/);
      return true;
    });
  }
  for (const env of [
    { ...fullEnv, MODEL: undefined },
    { ...fullEnv, MODEL: "" },
    { ...fullEnv, MODEL: "   " },
  ]) {
    assert.throws(() => readConfig(env), (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /MODEL/);
      return true;
    });
  }
});

test("BASE_URL accepts any host and path prefix but rejects credentials, query and fragment", () => {
  for (const value of [
    "https://api.invented.example",
    "https://api.invented.example/decisions/v2",
    "http://decisions.remote.example/judge",
    "http://127.0.0.1:8787/jev",
    "http://localhost:3000",
    "https://10.0.0.5:8443/x/y",
  ]) assert.equal(readConfig({ ...fullEnv, BASE_URL: value }).baseURL, value);
  for (const value of [
    "api.example",
    "/decisions",
    "//api.example/x",
    "ftp://api.example/x",
    "file:///tmp/x",
    "https://user:pass@api.example/x",
    "https://api.example/x?key=secret",
    "https://api.example/x#fragment",
    "https://",
    "constructor",
    "https://api.example:99999/x",
  ]) assert.throws(() => readConfig({ ...fullEnv, BASE_URL: value }), (error: unknown) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /BASE_URL/);
    // Startup errors never echo configured values.
    assert.equal(error.message.includes(value), false);
    return true;
  });
});

test("config timeout defaults and validation are unchanged", () => {
  assert.equal(readConfig(fullEnv).timeoutMs, 30000);
  assert.equal(readConfig({ ...fullEnv, JEV_TIMEOUT_MS: "1" }).timeoutMs, 1);
  assert.equal(readConfig({ ...fullEnv, JEV_TIMEOUT_MS: "120000" }).timeoutMs, 120000);
  for (const value of ["0", "NaN", "-1", "120001", "1.5"]) assert.throws(() => readConfig({ ...fullEnv, JEV_TIMEOUT_MS: value }), /JEV_TIMEOUT_MS/);
});

test("legacy provider variables are ignored and never provide defaults", () => {
  // With generic configuration present, ambient legacy variables change nothing.
  assert.deepEqual(readConfig({ ...fullEnv, ...legacyEnv }), readConfig(fullEnv));
  assert.equal(readConfig({ ...fullEnv, ...legacyEnv }).apiKey, "synthetic-key");
  // Legacy variables alone never fill in BASE_URL, MODEL or API_KEY.
  assert.throws(() => readConfig({ ...legacyEnv }), /BASE_URL/);
  assert.throws(() => readConfig({ ...legacyEnv, BASE_URL: "https://x.example" }), /MODEL/);
  assert.equal(readConfig({ ...fullEnv, ...legacyEnv, API_KEY: "" }).apiKey, undefined);
});

test("missing or blank API_KEY never networks even with ambient legacy keys", async () => {
  for (const env of [{ ...fullEnv, API_KEY: "" }, { ...fullEnv, API_KEY: "   " }]) {
    const cfg = readConfig({ ...env, ...legacyEnv });
    assert.equal(cfg.apiKey, undefined);
    let calls = 0;
    const decide = createDecider(cfg, async () => { calls++; throw new Error("must not network"); });
    await assert.rejects(decide(input), (error: unknown) => {
      assert.ok(error instanceof DecisionError);
      assert.equal(error.code, "MISSING_API_KEY");
      assert.match(error.message, /API_KEY/);
      // Legacy credential names and values are never echoed or used.
      assert.equal(error.message.includes("typesafe-secret"), false);
      assert.equal(error.message.includes("liquid-secret"), false);
      assert.equal(error.message.includes("TYPESAFE_API_KEY"), false);
      assert.equal(error.message.includes("LIQUID_API_KEY"), false);
      return true;
    });
    assert.equal(calls, 0);
  }
});

test("ambient SDK vendor environment variables never redirect key, destination or model", async () => {
  const names = ["TYPESAFE_API_KEY", "TYPESAFE_BASE_URL", "TYPESAFE_DEFAULT_MODEL", "TYPESAFE_LOG_LEVEL"] as const;
  const saved = names.map((name) => [name, process.env[name]] as const);
  Object.assign(process.env, {
    TYPESAFE_API_KEY: "ambient-vendor-key",
    TYPESAFE_BASE_URL: "https://ambient.example",
    TYPESAFE_DEFAULT_MODEL: "ambient-model",
    TYPESAFE_LOG_LEVEL: "debug",
  });
  try {
    const decide = createDecider(config, async (url, init) => {
      assert.equal(url, endpoint(config));
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-test-key");
      assert.equal(JSON.parse(String(init?.body)).model, "judge-model-7");
      return Response.json(output);
    });
    assert.deepEqual(await decide(input), output);
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test("arbitrary destinations receive plain JSON at exactly the composed route with their own key", async () => {
  const large = decisionInput.parse({ ...input, state: "Synthetic long evidence block. ".repeat(80) });
  for (const cfg of configs) {
    for (const [request, maxBytes] of [[input, 1024], [large, Infinity]] as const) {
      const decide = createDecider(cfg, async (url, init) => {
        const headers = new Headers(init?.headers);
        const body = String(init?.body);
        assert.equal(url, endpoint(cfg));
        assert.equal(init?.method, "POST");
        assert.equal(headers.get("Authorization"), `Bearer ${cfg.apiKey}`);
        assert.equal(headers.get("Content-Type"), "application/json");
        assert.equal(headers.get("Content-Encoding"), null);
        if (maxBytes === 1024) assert.ok(Buffer.byteLength(body, "utf8") <= 1024, "small fixture must stay below the 1 KiB compression threshold");
        else assert.ok(Buffer.byteLength(body, "utf8") > 1024, "large request must exceed 1024 bytes on the wire");
        assert.deepEqual(JSON.parse(body), { ...request, model: cfg.model });
        return Response.json(output);
      });
      assert.deepEqual(await decide(request), output);
    }
  }
});

test("trailing-slash BASE_URL composes the same route after normalization", async () => {
  const normalized = readConfig({ API_KEY: "synthetic-test-key", BASE_URL: "https://api.invented.example/decisions///", MODEL: "judge-model-7" });
  assert.equal(normalized.baseURL, "https://api.invented.example/decisions");
  const decide = createDecider(normalized, async (url, init) => {
    assert.equal(url, "https://api.invented.example/decisions/v1/systemone");
    assert.equal(JSON.parse(String(init?.body)).model, "judge-model-7");
    return Response.json(output);
  });
  assert.deepEqual(await decide(input), output);
});

test("model override keeps credential and destination fixed", async () => {
  for (const cfg of configs) {
    for (const override of ["custom-model-42", "  custom-model-42  "]) {
      const decide = createDecider(cfg, async (url, init) => {
        // The override changes only the model name in the body.
        assert.equal(url, endpoint(cfg));
        assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${cfg.apiKey}`);
        assert.equal(JSON.parse(String(init?.body)).model, "custom-model-42");
        return Response.json(output);
      });
      assert.deepEqual(await decide({ ...input, model: override }), output);
    }
    // A blank per-call model is invalid input, never a silent fallback.
    const decide = createDecider(cfg, async () => { throw new Error("must not network"); });
    await assert.rejects(decide({ ...input, model: "   " }), { code: "INVALID_INPUT" });
  }
});

test("model precedence: per-call override beats configured MODEL without redirecting", async () => {
  const seen: Array<{ url: string; model: string }> = [];
  const decide = createDecider(config, async (url, init) => {
    seen.push({ url, model: JSON.parse(String(init?.body)).model });
    return Response.json(output);
  });
  await decide(input);
  await decide({ ...input, model: "override-model" });
  assert.deepEqual(seen, [
    { url: endpoint(config), model: "judge-model-7" },
    { url: endpoint(config), model: "override-model" },
  ]);
});

test("mixed responses preserve raw values including zero output tokens", async () => {
  const mixed = { model: "judge-model-7", answers: {
    team: { type: "choice", choice: "billing", probabilities: { billing: 0.98, technical: 0.01, other: 0.01 }, confidence: 0.9 },
    refund_requested: { type: "noul", noul: 0.99 },
    urgency: { type: "score", score: 1.95, legend: { "0": "No response deadline or time pressure is stated", "1": "A response is requested within several days", "2": "A response is requested today or immediately" }, probabilities: { "0": 0.01, "1": 0.03, "2": 0.96 }, confidence: 0.9 },
  }, usage: { input_tokens: 4242, output_tokens: 0 } };
  const decide = createDecider(config, async () => Response.json(mixed));
  assert.deepEqual(await decide(input), mixed);
  assert.equal((await decide(input)).usage.output_tokens, 0);
});

test("null usage is an invalid response and counts are never invented", async () => {
  const broken = [
    { ...output, usage: null },
    { ...output, usage: { input_tokens: null, output_tokens: 50 } },
    { ...output, usage: { input_tokens: 300, output_tokens: null } },
    { ...output, usage: { input_tokens: null, output_tokens: null } },
  ];
  for (const response of broken) {
    const decide = createDecider(config, async () => Response.json(response));
    await assert.rejects(decide(input), { code: "INVALID_RESPONSE" });
  }
});

test("HTTP errors are sanitized without echoing bodies or credentials", async () => {
  for (const cfg of configs) {
    const decide = createDecider(cfg, async () => Response.json({ error: `${cfg.apiKey} private ticket` }, { status: 401 }));
    await assert.rejects(decide(input), (error: unknown) => {
      assert.ok(error instanceof DecisionError);
      assert.equal(error.code, "API_ERROR");
      assert.match(error.message, /Decision API HTTP 401/);
      assert.match(error.message, /API_KEY/);
      assert.equal(error.message.includes(String(cfg.apiKey)), false);
      assert.equal(error.message.includes("private ticket"), false);
      return true;
    });
  }
});
