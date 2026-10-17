# Jev Decision MCP

[![Jev Decision MCP – quality and maintenance score on Glama](https://glama.ai/mcp/servers/amidabuddha/jev-decision-mcp/badges/card.svg)](https://glama.ai/mcp/servers/amidabuddha/jev-decision-mcp)

A local stdio MCP server exposing one tool, **`jev_decide`**, for typed decisions through any SDK-compatible decision API endpoint. Point it at an endpoint with `BASE_URL` and `MODEL`; there is no provider preset, host allowlist, or model allowlist. Written in TypeScript with the official MCP SDK and the `@typesafe-ai/sdk` typed-decision SDK.

Independent community project; not affiliated with the SDK vendor. Licensed under [MIT](LICENSE).

| Question | Use it for | Result |
| --- | --- | --- |
| `choice` | Choose a label or candidate | Choice, probabilities, confidence |
| `score` | Rate a single dimension on 2–10 ordered levels | 0-based score, probabilities, legend, confidence |
| `noul` | Judge whether a condition holds | Probability of yes, from 0 to 1 |

Batch independent questions over the same context in one call. Answers retain their question IDs. The MCP returns judgments and token usage; the caller owns thresholds, escalation, and action execution.

## Requirements

- Node.js 22 or newer, with npm available on your `PATH`.
- An MCP client that supports local stdio servers.
- An API key for the decision endpoint you configure (`API_KEY`). It is required for decision calls only — the tool can be discovered without one.

**What "SDK-compatible" means here.** Compatibility is the typed-decision contract of the `@typesafe-ai/sdk`: the endpoint must implement the SystemOne request (`POST {BASE_URL}/v1/systemone`) that returns typed `choice`/`score`/`noul` answers with probability distributions and usage counts.

## Install from npm

The [npm package](https://www.npmjs.com/package/jev-decision-mcp) includes the built server. `npx` downloads it on first use and runs it without cloning or building:

```sh
npx -y jev-decision-mcp@0.3.0
```

Add the following to your MCP client's configuration, replacing the placeholders with your endpoint's values. For clients that use `mcpServers` JSON:

```json
{
  "mcpServers": {
    "jev": {
      "command": "npx",
      "args": ["-y", "jev-decision-mcp@0.3.0"],
      "env": {
        "API_KEY": "YOUR_API_KEY",
        "BASE_URL": "https://api.example.com/decisions",
        "MODEL": "your-model-name"
      }
    }
  }
}
```

Alternatively, set `API_KEY`, `BASE_URL`, and `MODEL` in the environment that launches your client and omit `env` if the client forwards those variables. Restart or reload your client's MCP servers after saving the configuration; the tool appears as `jev_decide`.

If the host cannot resolve `npx`, use its platform-specific launcher or absolute path
as documented by that host. GUI applications may have a different `PATH` from
your terminal.

The server communicates over stdio; starting it in a terminal waits for an MCP
client rather than opening a web page. The npm installation does not read a
`.env` from the caller's working directory.

To install the executable globally instead:

```sh
npm install -g jev-decision-mcp@0.3.0
```

Then use `"command": "jev-decision-mcp"` with no arguments in your MCP client, and supply the same `API_KEY`, `BASE_URL`, and `MODEL` values.

## Install via Glama

Open [Jev Decision MCP on Glama](https://glama.ai/mcp/servers/amidabuddha/jev-decision-mcp) to view its README, tool schema, and source. For local installation, use the [npm configuration above](#install-from-npm), or follow the listing's **GitHub Repository** link to download or clone the source and [build it below](#build-from-source). Glama lists this as a local stdio server; the listing URL is not an MCP connection endpoint.

## Endpoint configuration

`BASE_URL` and `MODEL` are required at startup and are fixed for the life of the process; tool calls can override only the model name. There is no runtime preset selector: the server never switches endpoints or credentials per call, and it applies no host or model allowlist beyond URL validation. `BASE_URL` is a prefix — the SDK appends `/v1/systemone` to it — so HTTP(S) URLs with custom path prefixes are supported.

**Reference endpoints (examples only; no provider is implied or endorsed).** These are known SDK-compatible endpoints you can copy into `BASE_URL`/`MODEL` with your own `API_KEY`:

| Example | `BASE_URL` | `MODEL` |
| --- | --- | --- |
| TypeSafe | `https://api.typesafe.ai` | `jev-latest` |
| Liquid | `https://api.liquid.ai/decisions` | `d1-ultra` |

**Two instances to compare endpoints.** Configure one instance per endpoint and send the same request to each instance's `jev_decide`:

```json
{
  "mcpServers": {
    "jev-a": {
      "command": "npx",
      "args": ["-y", "jev-decision-mcp@0.3.0"],
      "env": {
        "API_KEY": "YOUR_FIRST_API_KEY",
        "BASE_URL": "https://api.typesafe.ai",
        "MODEL": "jev-latest"
      }
    },
    "jev-b": {
      "command": "npx",
      "args": ["-y", "jev-decision-mcp@0.3.0"],
      "env": {
        "API_KEY": "YOUR_SECOND_API_KEY",
        "BASE_URL": "https://api.liquid.ai/decisions",
        "MODEL": "d1-ultra"
      }
    }
  }
}
```

Each instance stays on its own fixed endpoint, so a comparison always shows exactly one endpoint per call.

## Connect to Codex

For the npm package, merge this into your Codex `config.toml`:

```toml
[mcp_servers.jev]
command = "npx"
args = ["-y", "jev-decision-mcp@0.3.0"]
env_vars = ["API_KEY", "BASE_URL", "MODEL"]
tool_timeout_sec = 45
```

Set `API_KEY`, `BASE_URL`, and `MODEL` in the environment that launches Codex; `env_vars` forwards
their existing values to the server. Keep the host
tool timeout above `JEV_TIMEOUT_MS / 1000`. See [official Codex MCP configuration](https://developers.openai.com/codex/mcp).

## Build from source

Clone the repository, install its dependencies, and compile the server:

```sh
git clone https://github.com/amidabuddha/jev-decision-mcp.git
cd jev-decision-mcp
npm ci
npm run build
```

You can also download the repository with **Code → Download ZIP** on [GitHub](https://github.com/amidabuddha/jev-decision-mcp), extract it, and run `npm ci` and `npm run build` in the extracted directory.

Copy `.env.example` to `.env` in that directory and set `API_KEY`, `BASE_URL`, and `MODEL`, or supply them through your MCP client's environment. The source build reads this `.env` regardless of its working directory; existing environment variables take precedence. Restart the server after changing it. `.env` is excluded from Git.

Configure your MCP client to run the built entry point:

```json
{
  "mcpServers": {
    "jev": {
      "command": "node",
      "args": ["/absolute/path/to/jev-decision-mcp/dist/index.js"]
    }
  }
}
```

Replace the placeholder with your checkout's absolute path. Windows paths can use forward slashes, for example `C:/projects/jev-decision-mcp/dist/index.js`. If `node` is not on the client's `PATH`, use the absolute path to your Node executable.

For Codex, use the same `command` and `args` in the TOML example above. Keep `env_vars` only if you supply the configuration through Codex's environment instead of `.env`.

To verify your build, run `npm run check` (type checking and tests with mocked API responses; no network calls). Use `npm run dev` for local development and rebuild with `npm run build` after source changes before restarting your MCP client.

## Configuration

Set these variables in your MCP client's server environment, or in `.env` for a source build. Only these four are read:

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_KEY` | none | Bearer credential for the configured endpoint; required for decision calls, optional at startup for tool discovery |
| `BASE_URL` | none | Absolute http(s) API root prefix (the SDK appends `/v1/systemone`); required at startup |
| `MODEL` | none | Default model name for decision calls; required at startup |
| `JEV_TIMEOUT_MS` | `30000` | Total deadline per call including SDK retries; 1–120000 ms |

**Required vs optional.** `BASE_URL` and `MODEL` must be set explicitly at startup; the server exits with a configuration error otherwise and never falls back to SDK or vendor defaults. `API_KEY` is optional at startup so a client can discover `jev_decide` without a key; decision calls without it return `MISSING_API_KEY`. Whitespace-only values count as unset.

**Model precedence** (highest first): the per-call `model` argument, then `MODEL`. A blank or whitespace-only per-call `model` is rejected with `INVALID_INPUT`; it can never fall back to a blank or hidden default. A per-call model changes only the model name in the request; the credential and destination stay fixed.

**Endpoints are fixed by the operator, not by the tool.** The process sends every request to the configured `BASE_URL`; tool input cannot change the destination, and there is no provider host or model allowlist — `BASE_URL` accepts any host and any path prefix (including localhost for self-hosting). `BASE_URL` must be an absolute `http:`/`https:` URL without credentials, query, or fragment; values containing `?` or `#` are rejected at startup so no empty query or fragment delimiters can be appended. State and questions are sent to the configured endpoint and may incur API charges. The server does not persist inputs or decisions, and upstream error bodies are not exposed.

**Timeout.** `JEV_TIMEOUT_MS` is the total deadline for one decision call, including automatic SDK retries (individual attempts are capped at 10 seconds). Keep your client's tool timeout above `JEV_TIMEOUT_MS / 1000` seconds.

**Migrating from 0.1.3.** Version 0.1.3 read `TYPESAFE_API_KEY` and `TYPESAFE_DEFAULT_MODEL` (default `jev-latest`) and always sent requests to `https://api.typesafe.ai`. Rename `TYPESAFE_API_KEY` to `API_KEY` and `TYPESAFE_DEFAULT_MODEL` to `MODEL`; if you relied on the old default model, set `MODEL=jev-latest` explicitly. Add `BASE_URL=https://api.typesafe.ai` to keep the endpoint 0.1.3 used. Finally, update your pinned package configuration to `jev-decision-mcp@0.3.0` and restart or reload the host so the new process picks up the renamed variables.

## Call the tool

Call `jev_decide` with the JSON in [examples/decision.json](examples/decision.json). It combines a team choice, a refund yes/no judgment, and an urgency score. Smaller example:

```json
{
  "state": { "request": "Please refund the duplicate charge." },
  "questions": {
    "route": {
      "type": "choice",
      "instructions": "Which team should handle `request`?",
      "criteria": {
        "billing": "Charges, invoices, refunds",
        "technical": "Broken software or integrations",
        "other": "Neither billing nor technical"
      }
    }
  }
}
```

The response contains `model`, `answers`, and `usage`, both as MCP structured content and JSON text. Jev may round probabilities to two decimal places, so their sum can differ slightly from 1. The server allows the corresponding rounding margin (up to 0.005 per option) and never repairs returned values: everything is passed through exactly as the API sends it, probabilities are never renormalized, and token counts are never invented. A response with null usage counts is an incompatibility and is rejected as `INVALID_RESPONSE` rather than reporting fabricated zeros. Choice supports 1–255 named options.

The accepted input shapes are unchanged: instructions and descriptions may be strings, JSON objects, or arrays; choice descriptions may be null; `noul` accepts optional `criteria.true` and `criteria.false` descriptions, which may be null. On the request wire the server makes exactly one normalization: a `noul` criterion description of `null` is omitted from the outgoing request, and a `criteria` object with no remaining description is omitted entirely. This is a provider-agnostic canonical omission of unset optional descriptions — some endpoints reject a sent null `noul` description with HTTP 422 while reading an omitted description as undescribed (observed on the Liquid reference endpoint; omission resolved it). Everything else travels exactly as supplied: non-null `noul` descriptions, including structured objects and arrays with nested nulls, and all `choice` and `score` values, including null choice descriptions.

Supply relevant facts, source text, and policies explicitly: Jev cannot see the caller's conversation or local files. Write complete judgments in `instructions`; IDs are only response keys. Include a no-match option when appropriate. Questions in one batch cannot see one another's answers. A noul near 0.5 is uncertainty about yes/no, not medium intensity. Confidence does not authorize actions or guarantee correctness; evaluate thresholds on representative data.

## Troubleshooting

If the tool does not appear after an update, restart the server and open a fresh client session. The configured server is named `jev`; its tool is `jev_decide`. With the two-instance comparison setup both servers expose `jev_decide`; their server names (`jev-a`, `jev-b`) tell the instances apart.

Service/configuration failures are MCP tool errors (`isError: true`), never invented decisions. Codes include `MISSING_API_KEY`, `INVALID_INPUT`, `INVALID_RESPONSE`, `API_ERROR`, `CONNECTION_ERROR`, `TIMEOUT`, and `CANCELLED`. Invalid arguments may also be rejected directly by the MCP SDK. Startup fails with a configuration error when `BASE_URL` or `MODEL` is missing or malformed; the error names the variable but never echoes values.

## References

- [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript) — the `@typesafe-ai/sdk` used by this server
- [TypeSafe HTTP API](https://docs.typesafe.ai/api) — the typed-decision (SystemOne) request this server performs
- [Decision primitives and question design](https://docs.typesafe.ai/primitives)
- [Function-calling cookbook](https://docs.typesafe.ai/cookbooks/function_calling)
