# opencode-agentbus

> 语言版本：[English](README.md) · [Español](README_ES.md) · [Français](README_FR.md) · [简体中文](README_ZH.md)

**作者：** Tomás Díaz <tomas@bsv.direct> · 许可证：MIT

OpenCode V2 会话之间**可移植（portable）**的通信协议。源自一个真实的工作流：多个 agent 并行工作，通过 API 互相发送消息，无需人类充当信使。不使用轮询（polling），也没有监控循环：注入的 prompt 会唤醒会话。

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
| `bus_disconnect` | 从当前总线（或指定的 `bus`）断开某个别名 |
| `bus_status` | 健康检查：当前状态、别名、计数器、待处理项和配置 |
| `bus_audit` | 查看插件捕获的投递记录 |
| `bus_connect` | 将会话连接到具名共享总线，指定别名和角色 |
| `bus_use` | 选择本项目的当前总线 |
| `bus_buses` | 列出具名总线及其成员 |
| `bus_setup` | 用 `sessionID`（或缓存索引）、别名和角色注册别名 |

它还会注册 skill `agent-bus`（`autoinvoke: false`，通过 `@agent-bus` 加载），并且在每个会话的上下文中**只注入一次**规则。唯一的 slash 命令是 `/bus-connect`、`/bus-setup` 和 `/bus-report`。不要在项目的 skills 中重复该协议：插件是传输的来源，仓库中的决策文件是协议的来源。

## 面向用户的界面

TUI 部分（`./tui`）提供两个对话框式 slash 命令：它们打开模态框，从不向对话写入数据，也不消耗推理。

- **`/bus-setup`** — 根会话的编号列表；用户选择会话、别名和角色（`lead`、`dev` 或 `reviewer`）。同一对话框还能查看当前别名、查看完整报告以及断开别名。子 agent 被排除，已连接的会话有标记，顺序稳定。
- **`/bus-report`** — 完整状态：当前总线、别名/角色、计数器和最近的投递记录。`audit` 只是此报告中「仅投递记录」的子集。

`/bus-connect <bus> <alias> <role>` 把当前会话连接到具名共享总线。

对于外部工具，插件提供一个 RPC，包含 `overview`、`setAlias`、`disconnect`、`audit` 和 `report`：

```bash
opencode api post '/api/rpc/agentbus/report?location[directory]=/ruta/del/proyecto' \
  --data '{"input":{"format":"md"}}'
```

角色是面向用户和客户端的信息；传输仍然是协议信封，不会改变文件所有权或 gates。

## 共享命名总线

总线通过名称标识（例如 `team`），其成员可以来自多个项目。每个成员使用别名和角色连接：

```text
/bus-connect team lead lead
```

还有 `bus.connect`、`bus.use` 和 `bus.buses` 工具。**当前总线**按项目保存；各总线的成员则全局保存，因此其他项目可以执行 `bus.use("team")` 并与相同的别名通信。计数器和审计仍按项目分开。旧的无前缀条目保留为历史记录，不会自动迁移。

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


## 故障排查

- **TUI 部分无法加载（`Cannot find package 'solid-js'`）** — 显式安装 peer 依赖：
  `npm install solid-js @opentui/core @opentui/solid`。npm 通常会自动安装；只有在使用
  `legacy-peer-deps=true` 或 npm < 7 时才会出现此问题。
- **直接用 `node` 导入时出现 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`** — 入口点按设计是
  TypeScript，符合 OpenCode 插件约定。请从 OpenCode（Bun/tsx）加载插件，不要用 `node` 直接导入。
- **服务刚启动就出现 `RPC is unavailable: agentbus`** — 插件是异步加载的。稍等片刻后重试。
- **TUI 中出现 `rpc.unavailable: agentbus`** — RPC 按位置注册。请在项目的 `opencode.json(c)` 中配置插件（而不只是 `cli.json`）并重启。HTTP 查询不带 `location[directory]` 时也会返回 `rpc.unavailable`，这是正常现象。
