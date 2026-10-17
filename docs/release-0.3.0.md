# Release 0.3.0

Release candidate checklist for `jev-decision-mcp@0.3.0`: the single
`jev_decide` tool with fully generic endpoint configuration, accurate
installation/discovery/publication metadata, and reproducible live compatibility
tests. This document records what was prepared and verified locally; publication
itself is a deliberate maintainer step and remains pending.

## What ships

- **Generic configuration only:** `API_KEY`, `BASE_URL`, `MODEL`, and
  `JEV_TIMEOUT_MS`. There is no provider table, provider preset selector,
  host/model allowlist, alias, or legacy-variable fallback.
- `BASE_URL` and `MODEL` are required at startup with no vendor defaults;
  `API_KEY` is optional at startup (tool discovery works) and required for
  decision calls (`MISSING_API_KEY` otherwise).
- `BASE_URL` is a prefix: the SDK appends `/v1/systemone`, so HTTP(S) URLs with
  custom path prefixes are supported. Credentials, query, and fragment (including
  raw `?`/`#`) are rejected at startup. The operator fixes the endpoint for the
  process; tool input can change only the model name (per-call `model` >
  `MODEL`; a blank per-call override is rejected with `INVALID_INPUT`).
- `JEV_TIMEOUT_MS` remains the total deadline including automatic SDK retries
  (1–120000 ms). Raw value passthrough, rounding-tolerant probability checks,
  and rejection of null usage counts (`INVALID_RESPONSE`, never invented counts)
  are unchanged; returned values are never repaired or rewritten.
- One request-side normalization only: on the outgoing wire, a `noul` criterion
  description of `null` is omitted, and a `criteria` object with no remaining
  description is omitted entirely. This is a provider-agnostic canonical
  omission of unset optional descriptions, not an endpoint or model
  conditional. The MCP input contract is unchanged (nullable descriptions stay
  valid); non-null `noul` entries, including structured descriptions with
  nested nulls, and all `choice`/`score` values travel exactly as supplied.
- Compatibility is the typed-decision contract of the `@typesafe-ai/sdk`
  (SystemOne request/response), not OpenAI-completion compatibility. No
  Microsoft-specific or universal model support is claimed; the two reference
  endpoints below are the only live-tested configurations.
- Server name `jev-decision-mcp`, package/executable `jev-decision-mcp`, and
  tool name `jev_decide` are unchanged. Public metadata (README, `.env.example`,
  `server.json`, `package.json` description/keywords) is provider-neutral apart
  from clearly labeled example settings and migration notes.

## Version consistency (done in this changeset)

All pinned locations now read `0.3.0`: `package.json`, `package-lock.json` (root
entries), the MCP server identity in `src/server.ts`, `server.json` (top-level
and `packages[].version`), every pinned README example (`npx`, `npm install -g`,
Codex `args`), and the version assertion in `test/server.test.ts`. The npm
publish workflow re-checks tag ↔ `package.json` ↔ `server.json` version
agreement at release time.

## Environment-variable migration (0.2.0 candidate → 0.3.0)

The 0.2.0 candidate names `DECISION_PROVIDER`, `TYPESAFE_API_KEY`,
`LIQUID_API_KEY`, `DECISION_DEFAULT_MODEL`, and `TYPESAFE_DEFAULT_MODEL` are
removed. Map them to the generic variables:

| Old (0.2.0 candidate) | New (0.3.0) |
| --- | --- |
| `TYPESAFE_API_KEY` / `LIQUID_API_KEY` | `API_KEY` (the credential of your endpoint) |
| endpoint implied by `DECISION_PROVIDER` | `BASE_URL` (`https://api.typesafe.ai` or `https://api.liquid.ai/decisions` for the former providers) |
| `DECISION_DEFAULT_MODEL`, `TYPESAFE_DEFAULT_MODEL`, provider default | `MODEL` (`jev-latest` or `d1-ultra` for the former providers) |
| `JEV_TIMEOUT_MS` | `JEV_TIMEOUT_MS` (unchanged) |

No legacy name is read at runtime or listed in `server.json`/`.env.example`; the
mapping is documented only here and in the README. The local private `.env` was
migrated accordingly (active profile plus one fully commented alternate generic
profile); no credential backup files were created.

## Local verification performed (2026-10-16)

- `npm run check` — 37/37 tests (type check + test suite, mocked API
  responses), including the focused offline regression for the request
  conversion (schema still accepts null descriptions; outgoing `noul`
  both-null criteria omitted and mixed null/nonnull kept exactly; choice nulls
  and the caller's input untouched; nested nulls preserved; raw response values
  including zero token counts and null-usage rejection unchanged).
- `npm run check` under Node.js v22.23.3 (temporary runtime in `/tmp`, matching
  CI's Node 22 and the `engines: >=22` floor) — 37/37 tests.
- `npm pack --dry-run` — tarball `jev-decision-mcp-0.3.0.tgz` contains
  `dist/*`, `LICENSE`, `README.md`, `examples/decision.json`, `server.json`
  (10 files); no tests, scripts, or `.env` are packaged.
- Schema validation with the project's existing dependency tree (`ajv`, already
  present via the SDK dependency chain; no new permanent dependency):
  - `glama.json` is **valid** against `https://glama.ai/mcp/schemas/server.json`.
  - `server.json` is **valid** against
    `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`
    (the top-level `description` is capped at 100 characters by the schema).
- Opt-in live compatibility tests (`npm run test:live` artifact, built `dist/`
  MCP server, seven named cases per endpoint configuration, switched purely via
  in-memory `API_KEY`/`BASE_URL`/`MODEL` overrides). Named cases validate the
  live response contract and integration wiring, not judgment quality. All
  requests authenticate with `Authorization: Bearer <API_KEY>` and go to
  `{BASE_URL}/v1/systemone` (verified against the `@typesafe-ai/sdk` request
  construction); all 14 case calls returned HTTP success. Byte figures are the
  JSON-encoded MCP tool arguments the live script reports (`request_bytes`), not
  the outgoing wire request (which additionally carries the resolved `model`
  and applies the `noul` omission above). Usage counts below are the raw values
  the endpoints returned (for example Liquid reported `output_tokens=0`);
  nothing was normalized or invented.

  - **`https://api.liquid.ai/decisions`, model `d1-ultra`: 7/7 passed**

    | Case (MCP argument bytes) | Result | Answers | Usage in/out | ms |
    | --- | --- | --- | --- | --- |
    | mixed-question-types, all three types (830) | PASS | 3 | 306 / 0 | 1393 |
    | response-metadata (173) | PASS | 1 | 44 / 0 | 227 |
    | request-over-1kib (2382) | PASS | 3 | 1245 / 0 | 209 |
    | structured-json-state (300) | PASS | 1 | 103 / 0 | 187 |
    | structured-json-instructions, object and array (473) | PASS | 2 | 172 / 0 | 200 |
    | structured-json-criteria (310) | PASS | 1 | 83 / 0 | 190 |
    | null-criterion-descriptions (325) | PASS | 2 | 84 / 0 | 261 |

  - **`https://api.typesafe.ai`, model `jev-latest` (resolved `jev-1.13.0`): 7/7 passed**

    | Case (MCP argument bytes) | Result | Answers | Usage in/out | ms |
    | --- | --- | --- | --- | --- |
    | mixed-question-types, all three types (830) | PASS | 3 | 467 / 70 | 449 |
    | response-metadata (173) | PASS | 1 | 287 / 21 | 248 |
    | request-over-1kib (2382) | PASS | 3 | 722 / 70 | 274 |
    | structured-json-state (300) | PASS | 1 | 370 / 38 | 259 |
    | structured-json-instructions, object and array (473) | PASS | 2 | 402 / 32 | 257 |
    | structured-json-criteria (310) | PASS | 1 | 348 / 18 | 262 |
    | null-criterion-descriptions (325) | PASS | 2 | 326 / 55 | 247 |

- **Why the `noul` omission exists:** live probes showed the Liquid endpoint
  rejects a sent `noul` `criteria.true`/`criteria.false` of `null` with HTTP
  422, while choice null descriptions, omitted `noul` criteria, and non-null
  `noul` descriptions are accepted. Omitting only those null optional `noul`
  descriptions on the wire resolved the failure; `null-criterion-descriptions`
  now passes on both reference endpoints. MCP accepted shapes and returned
  values are unchanged, and upstream error bodies are never exposed.
- The optional Codex schema check (`npm run test:codex`) was **not** run: the
  locally configured Codex `jev` server points at the published npm package
  (npx 0.1.3), not at this candidate `dist/`, so the check would not test the
  candidate. The user's Codex configuration was not modified.

## Publication steps (maintainer actions, not yet performed)

1. **Commit and push** this release candidate to `main`.
2. **npm package release:** create a GitHub release with tag `v0.3.0`. The
   existing `publish-npm.yml` workflow verifies the tag matches `package.json`
   and both `server.json` version fields, runs `npm ci && npm run check`, then
   `npm publish --access public` via trusted publishing. (Manual alternative:
   `npm publish --access public` from a clean checkout after `npm run check`.)
3. **MCP Registry metadata:** dispatch the existing `publish-registry.yml`
   workflow to re-publish `server.json` (identical name, package identifier, and
   tool; versions now `0.3.0`; environment metadata now documents the generic
   `API_KEY`/`BASE_URL`/`MODEL`/`JEV_TIMEOUT_MS` variables).
4. **Glama listing refresh for the existing listing**
   (<https://glama.ai/mcp/servers/amidabuddha/jev-decision-mcp>): after the npm
   release, open the existing listing and verify it reflects the updated
   repository README — generic configuration (`API_KEY`, `BASE_URL`, `MODEL`,
   `JEV_TIMEOUT_MS`), example settings clearly labeled as examples, and the tool
   list showing **only `jev_decide`**. Per the [Glama MCP FAQ](https://glama.ai/mcp/faq),
   listings are indexed from the GitHub repository and
   [`glama.json`](https://glama.ai/mcp/schemas/server.json) metadata. Glama does
   not document an automatic synchronization guarantee for existing listings; if
   the listing is stale, inspect the existing listing for owner refresh controls
   offered by Glama and use them if present, or contact Glama support through the
   Discord channel documented in the FAQ. Do not resubmit the server via the Add
   MCP Server / submission path — that path is for new listings and would create
   a duplicate of the existing one. Exact UI actions are not asserted here
   because they were not verified.
5. **Verify only `jev_decide`** is exposed: the test suite asserts
   `tools/list` returns exactly `["jev_decide"]`; re-check the same on the
   refreshed Glama listing and in one connected client.

## Glama metadata decision

Unchanged from 0.2.0: the official schema at
`https://glama.ai/mcp/schemas/server.json` declares only `maintainers` (draft-07;
the FAQ text mentions display name, description, category, environment
variables, and build spec, but the published schema defines no such fields or
key names). To avoid unverified metadata, `glama.json` keeps exactly the
verified fields (`$schema`, `maintainers`) and the generic
description/environment metadata lives where it is schema-defined and consumed:
`server.json` (registry schema) and the README (Glama renders it for the
listing).

## Credentials

Endpoint keys were read only to execute the authorized local `.env` migration
and the opt-in live tests above. No key values or private configuration were
printed, committed, or copied to backup files; the credentials remain solely in
the ignored local `.env`, and live test output is limited to integration
summaries and sanitized MCP errors.
