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

## Requirements

- Node.js 22 or newer, with npm available on your `PATH`.
- An MCP client that supports local stdio servers.
- An API key from [TypeSafe Console](https://console.typesafe.ai). Use an official TypeSafe key; OpenRouter and third-party gateway keys are not supported.

## Install from npm

The [npm package](https://www.npmjs.com/package/jev-decision-mcp) includes the built server. `npx` downloads it on first use and runs it without cloning or building:

```sh
npx -y jev-decision-mcp@0.1.3
```

Add the following to your MCP client's configuration, replacing `YOUR_TYPESAFE_API_KEY` with your key. For clients that use `mcpServers` JSON:

```json
{
  "mcpServers": {
    "jev": {
      "command": "npx",
      "args": ["-y", "jev-decision-mcp@0.1.3"],
      "env": {
        "TYPESAFE_API_KEY": "YOUR_TYPESAFE_API_KEY"
      }
    }
  }
}
```

Alternatively, set `TYPESAFE_API_KEY` in the environment that launches your client and omit `env` if the client forwards that variable. Restart or reload your client's MCP servers after saving the configuration; the tool appears as `jev_decide`.

If the host cannot resolve `npx`, use its platform-specific launcher or absolute path
as documented by that host. GUI applications may have a different `PATH` from
your terminal.

The server communicates over stdio; starting it in a terminal waits for an MCP
client rather than opening a web page. The npm installation does not read a
`.env` from the caller's working directory.

To install the executable globally instead:

```sh
npm install -g jev-decision-mcp@0.1.3
```

Then use `"command": "jev-decision-mcp"` with no arguments in your MCP client, and supply the same API key.

## Install via Glama

Open [Jev Decision MCP on Glama](https://glama.ai/mcp/servers/amidabuddha/jev-decision-mcp) to view its README, tool schema, and source. For local installation, use the [npm configuration above](#install-from-npm), or follow the listing's **GitHub Repository** link to download or clone the source and [build it below](#build-from-source). Glama lists this as a local stdio server; the listing URL is not an MCP connection endpoint.

## Connect to Codex

For the npm package, merge this into your Codex `config.toml`:

```toml
[mcp_servers.jev]
command = "npx"
args = ["-y", "jev-decision-mcp@0.1.3"]
env_vars = ["TYPESAFE_API_KEY"]
tool_timeout_sec = 45
```

Set `TYPESAFE_API_KEY` in the environment that launches Codex; `env_vars` forwards
its existing value to the server. Keep the host tool timeout above
`JEV_TIMEOUT_MS / 1000`. See [official Codex MCP configuration](https://developers.openai.com/codex/mcp).

## Build from source

Clone the repository, install its dependencies, and compile the server:

```sh
git clone https://github.com/amidabuddha/jev-decision-mcp.git
cd jev-decision-mcp
npm ci
npm run build
```

You can also download the repository with **Code → Download ZIP** on [GitHub](https://github.com/amidabuddha/jev-decision-mcp), extract it, and run `npm ci` and `npm run build` in the extracted directory.

Copy `.env.example` to `.env` in that directory and set `TYPESAFE_API_KEY`, or supply the key through your MCP client's environment. The source build reads this `.env` regardless of its working directory; existing environment variables take precedence. Restart the server after changing it. `.env` is excluded from Git.

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

For Codex, use the same `command` and `args` in the TOML example above. Keep `env_vars` only if you supply the key through Codex's environment instead of `.env`.

To verify your build, run `npm run check` (type checking and tests with mocked API responses; no TypeSafe calls). Use `npm run dev` for local development and rebuild with `npm run build` after source changes before restarting your MCP client.

## Configuration

Set these variables in your MCP client's server environment, or in `.env` for a source build:

| Variable | Default | Purpose |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | Required for calls | TypeSafe API credential |
| `TYPESAFE_DEFAULT_MODEL` | `jev-latest` | Default model; each call can override it |
| `JEV_TIMEOUT_MS` | `30000` | Total deadline including retries; 1–120000 ms |

Keep your client's tool timeout above `JEV_TIMEOUT_MS / 1000` seconds. `jev-latest` follows TypeSafe model updates; set a specific supported model version for repeatable evaluations.

The server starts without a key so a client can discover the tool, but decision calls then return `MISSING_API_KEY`. State and questions are sent to the official TypeSafe API and may incur API charges. `TYPESAFE_BASE_URL` does not override the API endpoint. The server does not persist inputs or decisions, and upstream error bodies are not exposed.

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

The response contains `model`, `answers`, and `usage`, both as MCP structured content and JSON text. Jev may round probabilities to two decimal places, so their sum can differ slightly from 1. The server allows the corresponding rounding margin (up to 0.005 per option) and preserves the returned values without normalization. Choice supports 1–255 named options. Instructions and descriptions may be strings, JSON objects, or arrays; choice descriptions may also be null. Noul accepts optional `criteria.true` and `criteria.false` descriptions.

Supply relevant facts, source text, and policies explicitly: Jev cannot see the caller's conversation or local files. Write complete judgments in `instructions`; IDs are only response keys. Include a no-match option when appropriate. Questions in one batch cannot see one another's answers. A noul near 0.5 is uncertainty about yes/no, not medium intensity. Confidence does not authorize actions or guarantee correctness; evaluate thresholds on representative data.

## Troubleshooting

If the tool does not appear after an update, restart the server and open a fresh client session. The configured server is named `jev`; its tool is `jev_decide`.

Service/configuration failures are MCP tool errors (`isError: true`), never invented decisions. Codes include `MISSING_API_KEY`, `INVALID_INPUT`, `INVALID_RESPONSE`, `API_ERROR`, `CONNECTION_ERROR`, `TIMEOUT`, and `CANCELLED`. Invalid arguments may also be rejected directly by the MCP SDK.

## References

- [TypeSafe HTTP API](https://docs.typesafe.ai/api)
- [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript)
- [Decision primitives and question design](https://docs.typesafe.ai/primitives)
- [Function-calling cookbook](https://docs.typesafe.ai/cookbooks/function_calling)
