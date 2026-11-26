# Agent Bus — 会话间通信协议

> 语言版本：[English](PROTOCOL.md) · [Español](PROTOCOL_ES.md) · [Français](PROTOCOL_FR.md) · [简体中文](PROTOCOL_ZH.md)

本 skill 由插件 `opencode-agentbus` 注入。目标是让多个 agent 并行工作，**无需人类充当信使**，除 fail-closed 情况外不打扰人类。

## 1. 传输

总线使用 OpenCode 的 API（`session.prompt`）向其他会话投递 prompt。插件注册 `bus_*` 工具；API 只是传输，**不是事实来源**。协议内容写入项目的决策文件（例如 `FEEDBACK.md` 或 `DECISIONS.md`）。

## 2. 强制信封

每条消息都以一行标明发件人名称的内容开头：

```
[FROM @lead → TO @beam | 2026-11-24T10:00:00Z | ID MSG-... | TYPE DECISION | REPLY-TO MSG-... | SUPERSEDES MSG-...]
<asunto>

<cuerpo>

— @lead
```

`TYPE` ∈ `QUESTION | REPORT | DECISION | CORRECCIÓN | ALERT | INFO`.

## 3. 投递

- `queue`（默认）：消息在收件箱中等待，当 agent 完成当前工作后逐条投递。
- `steer`：中断正在进行的工作。仅用于 `CORRECCIÓN` 和 `ALERT`。

工具 `bus_send` 接受 `steer: true` 以选择优先级。

## 4. 规则

1. **一条消息，一个主题。** 不要把两个收件人的话题混在一起：这是错误投递最常见的原因。
2. 用指向所收到 ID 的 `REPORT` 和 `replyTo` **确认接收**。
3. **投递错误的消息**：不要执行；通知对方并使用指向无效 ID 的 `supersedes` 和 `steer` 优先级重新发送。
4. **不轮询、不写监控循环（NO POLLING, NO BUCLES DE MONITORIZACIÓN）。** prompt 会直接注入会话并将其唤醒：无需探测收件箱，也无需给自己转发消息。没有工作时应保持**空闲（inactivo）**；不要定期写“最终监控”之类的条目，也不要重复报告状态。`bus_read` 仅按需使用。这样可以节省 token 和推理开销。
5. **有判断力地使用 fail-closed：** 如果 gate 失败或 URGENTE 消息未得到处理，则升级给人类。不要因为“没有新消息”而升级：那是正常运行状态。
6. **不要等待人类**：通过总线询问，并继续处理另一项独立任务。
7. **传输不会改变文件所有权或 gates。** 绝不要使用 `--no-verify`，也不要因为一条消息就编辑已冻结的契约。
8. 除非人类明确授权，否则不要因 rate limit 或 retry 而**更改会话的模型**；报告该事件并等待。

## 5. 工作队列

每个 agent 维护自己的工作队列（例如 `docs/LEAD_QUEUE.md`），其中的条目状态为 `DONE / NEXT / BLOCKED / ABIERTO`。总线只负责传输；队列才是持久化记录。

## 6. 历史与审计

插件将 `session.inbox.delivered` 事件保存在其存储中（`bus_audit`）。当消息已在仓库中登记后，使用 API `/api/session/{id}/inbox` 清空收件箱。
