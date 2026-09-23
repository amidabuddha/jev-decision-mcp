# Jev Decision MCP

[![Jev Decision MCP – quality and maintenance score on Glama](https://glama.ai/mcp/servers/amidabuddha/jev-decision-mcp/badges/card.svg)](https://glama.ai/mcp/servers/amidabuddha/jev-decision-mcp)

A local stdio MCP server exposing one tool, **`jev_decide`**, for typed decisions through the official TypeSafe API. Written in TypeScript with the official MCP and TypeSafe SDKs.

Independent community project; not affiliated with TypeSafe. Licensed under [MIT](LICENSE).

| Question | Use it for | Result |
| --- | --- | --- |
| `choice` | Choose a label or candidate | Choice, probabilities, confidence |
| `score` | Rate a single dimension on 2–10 ordered levels | 0-based score, probabilities, legend, confidence |
| `noul` | Judge whether a condition holds | Probability of yes, from 0 to 1 |

Batch independent questions over the same context in one call. Answers retain their question IDs. The MCP returns judgments and token usage; the caller owns thresholds, escalation, and action execution.

## Install from npm

Requires Node.js 22 or newer. The published package runs without cloning or building:

```sh
npx -y jev-decision-mcp@0.1.0
```

Set `TYPESAFE_API_KEY` in your MCP host's environment. For hosts that use
`mcpServers` JSON configuration:

```json
{
  "mcpServers": {
    "jev": {
      "command": "npx",
      "args": ["-y", "jev-decision-mcp@0.1.0"]
    }
  }
}
```

Node.js and npm must be installed and available on the host's `PATH`. If the
host cannot resolve `npx`, use its platform-specific launcher or absolute path
as documented by that host. GUI applications may have a different `PATH` from
your terminal.

The server communicates over stdio; starting it in a terminal waits for an MCP
client rather than opening a web page. The npm installation does not read a
`.env` from the caller's working directory.

Package: [jev-decision-mcp on npm](https://www.npmjs.com/package/jev-decision-mcp).

## Connect to Codex

For the npm package, merge this into your Codex `config.toml`:

```toml
[mcp_servers.jev]
command = "npx"
args = ["-y", "jev-decision-mcp@0.1.0"]
env_vars = ["TYPESAFE_API_KEY"]
tool_timeout_sec = 45
```

Set `TYPESAFE_API_KEY` in the environment that launches Codex; `env_vars` forwards
its existing value to the server. Keep the host tool timeout above
`JEV_TIMEOUT_MS / 1000`. See [official Codex MCP configuration](https://developers.openai.com/codex/mcp).

## Setup from source

Requires Node.js 22 or newer.

```sh
git clone https://github.com/amidabuddha/jev-decision-mcp.git
cd jev-decision-mcp
npm ci
# Copy .env.example to .env and set TYPESAFE_API_KEY.
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

### Connect a local source build

After building, configure your host to run `node` with the absolute path to
`dist/index.js` as its argument. For Codex, replace the npm example's `command`
with `"node"` and `args` with `["/absolute/path/to/jev-decision-mcp/dist/index.js"]`.
That path is a placeholder: use your own checkout path. In TOML or JSON, Windows
paths can use forward slashes, for example `"C:/projects/jev-decision-mcp/dist/index.js"`.
If `node` is not on the host's `PATH`, use the absolute path to your Node executable.

The source build reads the repository's `.env`, so `env_vars` is only needed if
you supply the key through Codex's environment instead. For interactive local
development use `npm run dev`. No host configuration is modified by setup or tests.

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

Publishing a stable GitHub release triggers `.github/workflows/publish-npm.yml`.
The workflow checks that the release tag (`v` plus the package version) matches
`package.json` and `server.json`, runs the checks, and publishes to npm using
GitHub OIDC. It requires an npm trusted publisher configured for user
`amidabuddha`, repository `jev-decision-mcp`, workflow filename `publish-npm.yml`,
no environment name, and permission for direct `npm publish`. No npm token is needed.

For a new release, update `package.json`, `package-lock.json`, and all version
fields in `server.json` together, then publish a matching GitHub release from
that commit. Confirm the **Publish npm** workflow succeeds. Existing versions
cannot be published again; prereleases are not published by this workflow.

The official MCP Registry uses the separate, manually triggered **Publish MCP
Registry** workflow. Run it from `main` after the corresponding npm version is
available. GitHub release creation alone does not confirm either publication.

To verify the publishable artifact locally, run `npm pack --dry-run`. The package
contains the compiled server, license, README, example input, and registry metadata.
Local `.env` files, tests, and development dependencies are not bundled.

Clients can launch the published npm package with
`npx -y jev-decision-mcp@0.1.0`. For that installation method, provide
`TYPESAFE_API_KEY` in the MCP host's environment; the package does not read a `.env`
from the caller's working directory. The clone-and-build setup above remains
available independently of npm publication.

## Glama inspection

Glama's build configuration is managed in the listing's Dockerfile admin page.
Use build steps `npm ci` and `npm run build`, with CMD arguments
`["node", "dist/index.js"]`. No repository Dockerfile or TypeSafe key is needed
for inspection: the server starts without credentials and supports MCP
initialization and `tools/list`. Decision calls still require `TYPESAFE_API_KEY`.
