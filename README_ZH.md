# opencode-agentbus

> 语言版本：[English](README.md) · [Español](README_ES.md) · [Français](README_FR.md) · [简体中文](README_ZH.md)

**作者：** Tomás Díaz <tomas@bsv.direct> · 许可证：MIT

OpenCode V2 会话之间**可移植（portable）**的通信协议。源自我们在 Alloy 中使用的真实工作流：多个 agent 并行工作，通过 API 互相发送消息，无需人类充当信使。不使用轮询（polling），也没有监控循环：注入的 prompt 会唤醒会话。

## 在任意项目中安装

方案 A — 已发布包（推荐）：

```bash
npm install opencode-agentbus
```

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-agentbus"]
}
```

方案 B — 本地插件（将本仓库复制或克隆到项目内）：

```text
tu-proyecto/.opencode/plugins/agentbus/   # este repo, con src/index.ts y PROTOCOL.md
```

方案 C — 通过 `opencode.jsonc`：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/ruta/absoluta/opencode-agentbus"]
}
```

选项：

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

如果没有传入 `aliases`，可用 `bus_alias` 热注册。获取 ID 的方法：`opencode api get /api/session`。

## 工具

| 工具 | 用途 |
|---|---|
| `bus_send` | 发送带信封的消息；`steer: true` 仅用于纠正/告警 |
| `bus_read` | 读取会话中已投递的消息（按需） |
| `bus_inbox` | 列出已发送但尚未投递的消息（按需，不轮询） |
| `bus_directory` | 列出项目中的别名和会话 |
| `bus_alias` | 注册别名 → session ID（持久化） |
| `bus_status` | 健康检查：当前状态、别名、计数器、待处理项和配置 |
| `bus_audit` | 查看插件捕获的投递记录 |

它还会注册 skill `agent-bus`（`autoinvoke: false`，通过 `@agent-bus` 加载）、命令 `/bus-help` 和 `/bus-report`，并且在每个会话的上下文中**只注入一次**规则。不要在项目的 skills 中重复该协议：插件是传输的来源，仓库中的决策文件是协议的来源。

## 面向用户的界面

TUI 部分（`./tui`）会在命令面板和 slash commands 中添加两个入口：

- **`/bus-setup`** — 引导式助手：列出项目中的会话，允许选择一个、为其指定别名并分配角色（`lead`、`dev` 或 `reviewer`）。按需重复该步骤，并持久化保存别名和角色。
- **`/bus-audit`** — 显示最近的投递记录，含日期、会话和 `inboxID`，不使用循环或轮询。

**`/bus-wizard`** 显示项目中会话的编号列表。用户在聊天中输入 `número alias rol`（即“编号 别名 角色”）进行选择（例如 `1 lead lead`）；插件通过 `bus.setup` 注册别名。TUI 可视化助手为可选项：如果安装时未检测到它，此对话流程可提供相同功能。

在任何会话中，**`/bus-report`** 都会生成一份易读的 Markdown 报告，包含别名、角色、计数器和最近的投递记录。对于外部工具，插件提供了一个 RPC，包含 `overview`、`setAlias`、`audit` 和 `report`：

```bash
opencode api post '/api/rpc/agentbus/report?location[directory]=/ruta/del/proyecto' \
  --data '{"input":{"format":"md"}}'
```

角色是面向用户和客户端的信息；传输仍然是协议信封，不会改变文件所有权或 gates。

## 共享命名总线

总线通过名称标识（例如 `alloy`），其成员可以来自多个项目。每个成员使用别名和角色连接：

```text
/bus-connect alloy lead lead
```

还有 `bus.connect`、`bus.use` 和 `bus.buses` 工具。**当前总线**按项目保存；各总线的成员则全局保存，因此其他项目可以执行 `bus.use("alloy")` 并与相同的别名通信。计数器和审计仍按项目分开。旧的无前缀条目保留为历史记录，不会自动迁移。

## 消息

```text
[FROM @lead → TO @beam | 2026-11-24T10:00:00Z | ID MSG-... | TYPE DECISION | REPLY-TO MSG-... | SUPERSEDES MSG-...]
<asunto>

<cuerpo>

— @lead
```

`TYPE` ∈ `QUESTION | REPORT | DECISION | CORRECCIÓN | ALERT | INFO`.

## 黄金法则

1. 一条消息，一个主题。
2. 用 `REPORT` + `replyTo` 确认。
3. 投递错误 → 使用 `CORRECCIÓN` 并带上 `supersedes` 和 `steer`。
4. **不轮询（No polling）**：不要探测收件箱，也不要定期写入状态。保持空闲，直到有 prompt 到达；`bus_read` 仅在按需时使用。
5. 仅在 gate 失败或紧急事项未处理时启用 fail-closed；正常的静默不算。
6. API 只是传输；仓库中的决策文件才是事实来源。
7. 未经人类授权，不要因 rate limit 而更换模型。

完整协议见 `PROTOCOL.md`。

## 开发

```bash
npm install
npm run typecheck
npm test
```

需要 `@opencode/plugin` 2.4.1。待处理收件箱的 API 未在插件 SDK 中暴露：`bus_read` 读取的是转录记录（已投递的消息）；要清空收件箱，请使用 HTTP API `DELETE /api/session/{id}/inbox/{inboxID}`。
