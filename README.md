# Jev Decision MCP

A local stdio MCP server exposing one tool, **`jev_decide`**, for typed decisions through the official TypeSafe API. Written in TypeScript with the official MCP and TypeSafe SDKs.

Independent community project; not affiliated with TypeSafe. Licensed under [MIT](LICENSE).

| Question | Use it for | Result |
| --- | --- | --- |
| `choice` | Choose a label or candidate | Choice, probabilities, confidence |
| `score` | Rate a single dimension on 2–10 ordered levels | 0-based score, probabilities, legend, confidence |
| `noul` | Judge whether a condition holds | Probability of yes, from 0 to 1 |

Batch independent questions over the same context in one call. Answers retain their question IDs. The MCP returns judgments and token usage; the caller owns thresholds, escalation, and action execution.

## Setup

Requires Node.js 22 or newer.

```sh
git clone https://github.com/amidabuddha/jev-decision-mcp.git
cd jev-decision-mcp
npm ci
cp -n .env.example .env
# Edit .env and set TYPESAFE_API_KEY.
npm run build
```

Obtain the key from [TypeSafe Console](https://console.typesafe.ai). Use an official TypeSafe key, rather than an OpenRouter or third-party gateway key.

`.env` is excluded by `.gitignore`. The server reads the `.env` beside this README even when started from another working directory. Existing process environment variables take precedence. Restart the MCP server after editing `.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | Required for calls | TypeSafe API credential |
| `TYPESAFE_DEFAULT_MODEL` | `jev-latest` | Default model; each call can override it |
| `JEV_TIMEOUT_MS` | `30000` | Total deadline including retries; 1–120000 ms |

The server starts without a key so a host can discover the tool. Calls then return `MISSING_API_KEY`. API traffic is fixed to `https://api.typesafe.ai/v1/systemone`; `TYPESAFE_BASE_URL` does not override it. State and questions are sent to TypeSafe and may incur API charges. The server does not persist inputs or decisions and disables SDK logging. Upstream error bodies are not exposed because they may echo submitted data.

## Connect to Codex

After building, run:

```sh
codex mcp add jev -- "$(command -v node)" "$PWD/dist/index.js"
```

Run this command from the repository root. It registers the absolute paths to your Node executable and built server.

Alternatively, merge this into your Codex `config.toml`, replacing the example paths with your absolute paths:

```toml
[mcp_servers.jev]
command = "/opt/homebrew/bin/node"
args = ["/absolute/path/to/jev-decision-mcp/dist/index.js"]
tool_timeout_sec = 45
```

Keep the host tool timeout above `JEV_TIMEOUT_MS / 1000`. The key stays in `.env`; it need not appear in the command or MCP configuration. See [official Codex MCP configuration](https://developers.openai.com/codex/mcp).

For other stdio MCP hosts, configure your absolute paths similarly:

```json
{
  "mcpServers": {
    "jev": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/absolute/path/to/jev-decision-mcp/dist/index.js"]
    }
  }
}
```

The host starts the process and communicates over stdin/stdout. For interactive local development use `npm run dev`; this is not an HTTP server. No host configuration is modified by setup or tests.

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

The response contains `model`, `answers`, and `usage`, both as MCP structured content and JSON text. Choice supports 1–255 named options. Instructions and descriptions may be strings, JSON objects, or arrays; choice descriptions may also be null. Noul accepts optional `criteria.true` and `criteria.false` descriptions.

Supply relevant facts, source text, and policies explicitly: Jev cannot see the caller's conversation or local files. Write complete judgments in `instructions`; IDs are only response keys. Include a no-match option when appropriate. Questions in one batch cannot see one another's answers. A noul near 0.5 is uncertainty about yes/no, not medium intensity. Confidence does not authorize actions or guarantee correctness; evaluate thresholds on representative data.

## Verify

```sh
npm run check       # Type checking + mocked API tests + real stdio MCP handshake
npm run test:live   # Explicit live API call using only the synthetic example
npm run test:codex  # Installed Codex schema parser + native MCP discovery, no model turn
# Add -- --live to test:codex to also call Jev through Codex's native MCP interface.
```

Normal tests use synthetic credentials and mocked HTTP responses; they do not contact TypeSafe. Tests cover mixed decisions, input/output validation, missing keys, authentication errors, rate-limit retries, deadlines, cancellation, and MCP discovery/calls. The stdio smoke test starts from another working directory and checks that stdout remains valid MCP.

The live test requires your key, starts the built MCP server, calls `jev_decide` through an MCP client, validates the response, and prints judgments, elapsed time, and token usage. A passing live smoke test verifies integration, not general decision quality. SDK retries can make up to three HTTP attempts for transient failures, bounded by the total deadline.

`test:codex` requires the Codex CLI. It uses an ephemeral diagnostic context without starting a model turn. It verifies that Codex rejects the original tuple-style score schema, accepts the repaired array schema, and discovers the MCP tool. Passing generic MCP client tests alone does not establish Codex compatibility.

If an older session cannot see the tool after a server update, start a fresh task so it loads the rebuilt server. The MCP server is named `jev` and its tool is `jev_decide`; `$Jev` is not an installed skill.

Service/configuration failures are MCP tool errors (`isError: true`), never invented decisions. Codes include `MISSING_API_KEY`, `INVALID_INPUT`, `INVALID_RESPONSE`, `API_ERROR`, `CONNECTION_ERROR`, `TIMEOUT`, and `CANCELLED`. Invalid arguments may also be rejected directly by the MCP SDK.

## References

Built using the `typesafe-ai` skill and official documentation, checked September 22, 2026:

- [TypeSafe HTTP API](https://docs.typesafe.ai/api)
- [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript)
- [Decision primitives and question design](https://docs.typesafe.ai/primitives)
- [Function-calling cookbook](https://docs.typesafe.ai/cookbooks/function_calling)
- [MCP server development](https://modelcontextprotocol.io/docs/develop/build-server)

`jev-latest` follows TypeSafe model updates. For repeatable evaluations, set a specific supported model version. SDK versions are recorded in `package-lock.json`.

## Releases and package publishing

GitHub releases provide source archives. The repository also includes npm packaging
and official MCP Registry metadata in `server.json`. npm and registry publication
are separate steps; a GitHub release does not imply that either listing is live.

To verify the publishable artifact locally, run `npm pack --dry-run`. The package
contains the compiled server, license, README, example input, and registry metadata.
Local `.env` files, tests, and development dependencies are not bundled.

After the npm package has been published, clients can launch it with
`npx -y jev-decision-mcp@0.1.0`. For that installation method, provide
`TYPESAFE_API_KEY` in the MCP host's environment; the package does not read a `.env`
from the caller's working directory. The clone-and-build setup above remains
available independently of npm publication.

## Container and Glama inspection

```sh
docker build -t jev-decision-mcp .
docker run --rm -i -e TYPESAFE_API_KEY jev-decision-mcp
```

The image runs as a non-root user and contains no `.env`. Supply credentials at
runtime. Without a key it still starts and supports MCP initialization and
`tools/list`; decision calls return `MISSING_API_KEY`.

Glama has its own build configuration. In the listing's Dockerfile admin page,
use build steps `npm ci` and `npm run build`, with CMD arguments
`["node", "dist/index.js"]`. Inspection does not need a real TypeSafe key. The
repository Dockerfile is also available for standard Docker builds.
