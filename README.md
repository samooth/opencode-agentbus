# opencode-agentbus

A **portable** agent-to-agent messaging protocol for OpenCode V2 sessions. It came out of the real
workflow we use in Alloy: several agents work in parallel and talk through the API instead of using
the human as a courier. No polling, no monitoring loops: an injected prompt wakes the target session.

**Languages:** [English](README.md) · [Español](README_ES.md) · [Français](README_FR.md) · [中文](README_ZH.md)

**Author:** Tomás Díaz <tomas@bsv.direct> · License: MIT

## Install in any project

Option A — published package (recommended):

```bash
npm install opencode-agentbus
```

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-agentbus"]
}
```

Option B — local plugin (copy or clone this repo into the project):

```text
your-project/.opencode/plugins/agentbus/   # this repo, with src/index.ts and PROTOCOL.md
```

Option C — from `opencode.jsonc` with a path:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-agentbus"]
}
```

Options:

```jsonc
{
  "plugins": [{
    "package": "opencode-agentbus",
    "options": {
      "self": "lead",
      "aliases": {
        "lead": "ses_...",
        "beam": "ses_...",
        "particle": "ses_..."
      },
      "defaultDelivery": "queue",
      "requireEnvelope": false,
      "injectInstructions": true,
      "registerSkill": true,
      "registerCommands": true,
      "audit": true,
      "toolNamespace": "bus"
    }
  }]
}
```

If you do not pass `aliases`, register them at runtime with `bus_alias`. To obtain session IDs:
`opencode api get /api/session`.

## Tools

| Tool | Use |
|---|---|
| `bus_send` | Send a message with an envelope; `steer: true` only for corrections/alerts |
| `bus_read` | Read messages already delivered to a session (on demand) |
| `bus_inbox` | List sent messages not yet delivered (on demand, no polling) |
| `bus_directory` | List aliases and sessions in the project |
| `bus_alias` | Register alias → session ID (persistent) |
| `bus_status` | Healthcheck: active, aliases, counters, pending and configuration |
| `bus_audit` | Show deliveries captured by the plugin |
| `bus_connect` | Connect a session to a named shared bus with alias and role |
| `bus_use` | Select the active bus for this project |
| `bus_buses` | List named buses and their members |
| `bus_setup` | Register an alias from the numbered wizard list |

The plugin also registers the `agent-bus` skill (`autoinvoke: false`, load it with `@agent-bus`),
the commands `/bus-help`, `/bus-report`, `/bus-wizard` and `/bus-connect`, and **one** injection of
the rules into each session's context. Do not duplicate the protocol in project skills: the plugin
owns transport, and the project's decision file owns the agreements.

## Interface for the human

The TUI part (`./tui`) adds palette entries and slash commands:

- **`/bus-setup`** — guided assistant: lists project sessions, lets the person pick one, give it an
  alias and assign a role (`lead`, `dev` or `reviewer`). Repeat as needed; aliases and roles persist.
- **`/bus-audit`** — shows recent deliveries with timestamp, session and `inboxID`, without loops.

**`/bus-wizard`** prints a numbered list of project sessions. The person chooses by typing
`number alias role` in the chat (for example `1 lead lead`); the plugin registers the alias with
`bus.setup`. The visual TUI assistant is optional: if it is not detected in the installation, this
conversational flow covers the same function.

In any session, **`/bus-report`** writes a readable Markdown report with aliases, roles, counters
and recent deliveries. For external tools, the plugin exposes an RPC with `overview`, `setAlias`,
`audit` and `report`:

```bash
opencode api post '/api/rpc/agentbus/report?location[directory]=/path/to/project' \
  --data '{"input":{"format":"md"}}'
```

Roles are information for humans and clients; transport is still the protocol envelope and does
not change file ownership or gates.

## Named shared buses

A bus is identified by name (for example `alloy`) and can have members from several projects.
Each member connects with an alias and a role:

```text
/bus-connect alloy lead lead
```

The tools `bus.connect`, `bus.use` and `bus.buses` are also available. The **active bus** is stored
per project; bus members are stored globally, so another project can call `bus.use("alloy")` and
talk to the same aliases. Counters and audit stay separated per project. Legacy entries without a
prefix remain historical and are not migrated automatically.

## Message

```text
[FROM @lead → TO @beam | 2026-11-24T10:00:00Z | ID MSG-... | TYPE DECISION | REPLY-TO MSG-... | SUPERSEDES MSG-...]
<subject>

<body>

— @lead
```

`TYPE` ∈ `QUESTION | REPORT | DECISION | CORRECCIÓN | ALERT | INFO`.

## Golden rules

1. One message, one subject.
2. Confirm with `REPORT` + `replyTo`.
3. Misrouted message → `CORRECCIÓN` with `supersedes` and `steer`.
4. **NO POLLING**: do not scan the inbox or write periodic status entries. Stay idle until a prompt
   arrives; use `bus_read` only on demand.
5. Escalate only on failed gates or unattended URGENT messages, never on normal silence.
6. The API is transport; the project's decision file is the source of truth.
7. Do not change a session's model because of rate limits without the human's authorization.

The full protocol is in [PROTOCOL.md](PROTOCOL.md).

## Development

```bash
npm install
npm run typecheck
npm test
```

Requires `@opencode/plugin` 2.4.1. The pending inbox API is not exposed in the plugin SDK:
`bus_read` reads the transcript (delivered messages); to drain the inbox use the HTTP API
`DELETE /api/session/{id}/inbox/{inboxID}`.
