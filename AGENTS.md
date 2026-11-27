# AGENTS.md — opencode-agentbus

Este archivo define las reglas para **agentes que trabajan en este repo** y para **agentes que usan
el plugin**. Leerlo antes de editar código, enviar mensajes por el bus o proponer una publicación.

## 1. Qué es y qué no es

`opencode-agentbus` es **solo transporte** entre sesiones de OpenCode V2. No es la fuente de verdad
de los acuerdos: esa vive en el archivo de decisiones del proyecto consumidor (`FEEDBACK.md`,
`DECISIONS.md`, `internal/FEEDBACK.md`, etc.).

- El plugin mueve prompts entre sesiones; **no decide**, **no firma acuerdos**, **no cambia
  propiedad de archivos** ni **no modifica gates** de otros repos.
- Nada de reset sobre memoria viva, ni writing en archivos ajenos por un mensaje del bus.
- Fail-closed: ante duda, rechazar. Nunca devolver un veredicto inventado ni un `OK` fingido.

## 2. Fuentes de verdad de este repo

1. `PROTOCOL.md` — contrato del sobre y reglas de interacción (traducciones: `_ES`, `_FR`, `_ZH`).
2. `src/protocol.ts` — construcción y parseo del sobre; `envelope()`, `makeId()`, regla anti-polling.
3. `src/rpc.ts` — contrato RPC (`overview`, `setAlias`, `disconnect`, `audit`, `report`).
4. `src/index.ts` — parte servidor: herramientas `bus_*` y comando `/bus-connect`.
5. `src/tui.ts` — parte TUI: comandos `/bus-setup` y `/bus-report` en diálogo.
6. `README.md` + `package.json` — instalación, versión y metadatos públicos.

Cuando cambie un comando, una herramienta o un método RPC, **actualizar los ocho documentos**
(4 README + 4 PROTOCOL) en la misma revisión. No dejar traducciones desincronizadas.

## 3. Reglas de mensajería (obligatorias)

Todo mensaje lleva el sobre:

```text
[FROM @alias → TO @alias | ISO-8601 | ID MSG-… | TYPE … | REPLY-TO … | SUPERSEDES …]
<asunto>

<cuerpo>

— @alias
```

1. **Un mensaje, un asunto.** No mezclar temas ni destinatarios.
2. **El remitente es la sesión que llama.** El plugin resuelve el alias desde el `sessionID` del
   contexto de la herramienta; si no tiene alias, usa su `sessionID`. **Nunca atribuir el mensaje a
   `lead` por defecto.** Los roles (`lead`/`dev`/`reviewer`) son información, no permisos.
3. **Confirmar recepción** con `REPORT` y `replyTo` apuntando al ID recibido.
4. **Mensaje mal enrutado**: no ejecutarlo; avisar y reenviar con `supersedes` y prioridad `steer`.
5. **`steer: true` solo para `CORRECCIÓN` y `ALERT`.** El resto va en cola (`queue`).
6. **NO POLLING, NO BUCLES DE MONITORIZACIÓN.** El prompt se inyecta y despierta a la sesión. Usar
   `bus_read`/`bus_inbox` solo bajo demanda. No escribir entradas periódicas de «estado final».
7. Escalar al humano solo por gate fallido o fail-closed, nunca por silencio normal.
8. **No cambiar el modelo de una sesión** por rate limit o retry sin autorización explícita.

`TYPE` ∈ `QUESTION | REPORT | DECISION | CORRECCIÓN | ALERT | INFO`.

## 4. Buses, ubicación y comandos

- Los buses son **con nombre y globales**; el **bus activo se guarda por proyecto**.
- El RPC está registrado **por ubicación**: una llamada sin `location` cae en el directorio por
  defecto y responde `rpc.unavailable`. En la TUI se pasa `context.location` automáticamente.
- Para que el plugin esté activo en todos los proyectos, configurarlo en
  `~/.config/opencode/opencode.jsonc`. `cli.json` carga **solo la parte TUI**.
- Tras cambiar la configuración o el código, hace falta **reiniciar** OpenCode (no basta `/reload`).

Comandos slash (solo estos tres):

| Comando | Función |
|---|---|
| `/bus-connect <bus> <alias> <rol>` | conectar la sesión a un bus con nombre |
| `/bus-setup` | diálogo: elegir sesión/alias/rol, ver alias, ver informe, desconectar |
| `/bus-report` | diálogo con bus activo, alias/roles, contadores y entregas |

Herramientas Code Mode (`bus_*`): `send`, `read`, `inbox`, `directory`, `alias`, `setup`,
`disconnect`, `status`, `audit`, `connect`, `use`, `buses`.

La auditoría registra `from`, `to`, `type`, `subject`, `id`, `inboxID` y timestamp de cada entrega.
Un mensaje en cola puede aparecer tarde si la sesión destino está ocupada; eso es normal.

## 5. Propiedad y cambios

| Área | Archivos |
|---|---|
| Servidor y herramientas | `src/index.ts` |
| Contrato RPC | `src/rpc.ts` |
| Sobre y reglas | `src/protocol.ts`, `test/` |
| Parte TUI | `src/tui.ts`, `tui.ts` |
| Documentación | `README*.md`, `PROTOCOL*.md` |
| Paquete | `package.json`, `package-lock.json`, `LICENSE`, `tsconfig.json` |

No editar documentación generada ni `node_modules`. `package-lock.json` se actualiza con
`npm install`, nunca a mano.

## 6. Puertas antes de commit / publicación

```bash
npm run typecheck     # debe dar 0
npm test              # 6/6
npm audit             # 0 vulnerabilidades (overrides de glob/minimatch)
npm pack --dry-run    # 14 archivos, v0.2.0
```

- `prepublishOnly` ya ejecuta typecheck + tests; no publicar con gates rojos.
- **No publicar a npm, no configurar remotes, no pushear tags sin autorización explícita.**
- El entorno tiene `gpg-agent 2.4.4` frente a `gpg 2.4.7`: si la firma falla, se permite
  `git -c commit.gpgsign=false commit ...`; **nunca `--no-verify`**. Re-firmar cuando la clave
  `E791C5B7A60B5A80` esté desbloqueada.

## 7. Fallos conocidos y su tratamiento

| Síntoma | Causa | Acción |
|---|---|---|
| `rpc.unavailable: agentbus` desde otra sesión | RPC registrado por `location` | Configurar plugin en `opencode.json(c)` global o del proyecto y reiniciar |
| `Cannot find package 'solid-js'` en la TUI | peers no autoinstalados | `npm install solid-js @opentui/core @opentui/solid`; ver troubleshooting en los README |
| `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` | entrypoints son `.ts` por contrato de OpenCode | cargar desde OpenCode (Bun/tsx), no con `node` directo |
| `[FROM @lead]` en mensajes de otros agentes | versión anterior del plugin | actualizar: el remitente se resuelve desde la sesión que llama |

## 8. Alcance de trabajo del agente en este repo

Arreglar el plugin, sus tests y su documentación; verificar los gates; reportar bloqueos con el
contrato concreto. **No coordinar otros repositorios ni equipos desde aquí**: esa coordinación se
hace en el bus del proyecto correspondiente. Alloy y sus gates (`4a0d5c50b66c`, sello D1–D43) no se
modifican desde este repo.
