# Agent Bus — inter-session communication protocol

This skill is injected by the `opencode-agentbus` plugin. Goal: several agents work in parallel
**without the human acting as a courier** and without interrupting them except on fail-closed.

**Languages:** [English](PROTOCOL.md) · [Español](PROTOCOL_ES.md) · [Français](PROTOCOL_FR.md) · [中文](PROTOCOL_ZH.md)

## 1. Transport

The bus uses the OpenCode API (`session.prompt`) to deliver prompts to other sessions. The plugin
registers the `bus_*` tools; the API is transport, **not the source of truth**. Agreements are
written to the project's decision file (for example `FEEDBACK.md` or `DECISIONS.md`).

## 2. Mandatory envelope

Every message starts with a line naming the sender:

```
[FROM @lead → TO @beam | 2026-11-24T10:00:00Z | ID MSG-... | TYPE DECISION | REPLY-TO MSG-... | SUPERSEDES MSG-...]
<subject>

<body>

— @lead
```

`TYPE` ∈ `QUESTION | REPORT | DECISION | CORRECCIÓN | ALERT | INFO`.

## 3. Delivery

- `queue` (default): the message waits in the inbox and is delivered one at a time when the agent
  finishes its current work.
- `steer`: interrupts current work. Only for `CORRECCIÓN` and `ALERT`.

The `bus_send` tool accepts `steer: true` to choose priority.

## 4. Rules

1. **One message, one subject.** Do not mix topics for two recipients: it is the most common cause
   of misrouting.
2. **Confirm receipt** with `REPORT` and `replyTo` pointing to the received ID.
3. **Misrouted message:** do not act on it; warn and resend with `supersedes` pointing to the invalid
   ID and `steer` priority.
4. **NO POLLING, NO MONITORING LOOPS.** The prompt is injected directly into the session and wakes
   it: there is no need to poll the inbox or send messages to yourself. Stay **idle** when you have
   no work; do not write periodic "final monitoring" entries or repeat your status. `bus_read` is
   on demand only. This saves tokens and inference.
5. **Fail-closed with judgement:** escalate to the human if a gate fails or an URGENT message goes
   unattended. Do not escalate for "no new messages": that is normal operation.
6. **Do not wait for the human**: ask over the bus and move on to another independent task.
7. **Transport does not change file ownership or gates.** Never use `--no-verify` or edit frozen
   contracts because of a message.
8. **Do not change a session's model** because of rate limits or retries without explicit human
   authorization; report the incident and wait.

## 5. Work queue

Each agent keeps its own queue (for example `docs/LEAD_QUEUE.md`) with
`DONE / NEXT / BLOCKED / ABIERTO` items. The bus only transports; the queue is the durable record.

## 6. History and audit

The plugin stores `session.inbox.delivered` events in its storage (`bus_audit`). The inbox is
drained with the `/api/session/{id}/inbox` API once the messages are recorded in the repo.
