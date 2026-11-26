# opencode-agentbus

Protocolo **portable** de comunicación entre sesiones de OpenCode V2. Extraído del flujo real que
usamos en Alloy: varios agentes trabajan en paralelo y se escriben por API sin que el humano haga
de cartero. Sin polling, sin bucles de monitorización: el prompt inyectado despierta a la sesión.

**Idiomas:** [English](README.md) · [Español](README_ES.md) · [Français](README_FR.md) · [中文](README_ZH.md)

**Autor:** Tomás Díaz <tomas@bsv.direct> · Licencia: MIT

## Instalar en cualquier proyecto

Opción A — paquete publicado (recomendado):

```bash
npm install opencode-agentbus
```

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-agentbus"]
}
```

Opción B — plugin local (copia este repo o clónalo dentro del proyecto):

```text
tu-proyecto/.opencode/plugins/agentbus/   # este repo, con src/index.ts y PROTOCOL.md
```

Opción C — desde `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/ruta/absoluta/opencode-agentbus"]
}
```

Opciones:

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

Si no pasas `aliases`, regístralos en caliente con `bus_alias`. Para obtener los IDs:
`opencode api get /api/session`.

## Herramientas

| Herramienta | Uso |
|---|---|
| `bus_send` | Enviar mensaje con sobre; `steer: true` solo para correcciones/alertas |
| `bus_read` | Leer mensajes ya entregados en una sesión (bajo demanda) |
| `bus_inbox` | Listar mensajes enviados y aún no entregados (bajo demanda, sin polling) |
| `bus_directory` | Listar alias y sesiones del proyecto |
| `bus_alias` | Registrar alias → session ID (persistente) |
| `bus_status` | Healthcheck: activo, alias, contadores, pendientes y configuración |
| `bus_audit` | Ver entregas capturadas por el plugin |

También registra el skill `agent-bus` (`autoinvoke: false`, se carga con `@agent-bus`), los comandos
`/bus-help` y `/bus-report`, y **una sola** inyección de reglas en el contexto de cada sesión. No
dupliques el protocolo en los skills del proyecto: el plugin es la fuente de transporte y el archivo
de decisiones del repo es la fuente de los acuerdos.

## Interfaz para la persona

La parte TUI (`./tui`) añade dos entradas en la paleta y como slash commands:

- **`/bus-setup`** — asistente guiado: lista las sesiones del proyecto, permite elegir una, darle un
  alias y asignar un rol (`lead`, `dev` o `reviewer`). Repite el paso las veces que haga falta y
  guarda los alias y roles de forma persistente.
- **`/bus-audit`** — muestra las últimas entregas con fecha, sesión e `inboxID`, sin bucles ni sondeo.

**`/bus-wizard`** muestra la lista numerada de sesiones del proyecto. La persona elige escribiendo
en el chat `número alias rol` (por ejemplo `1 lead lead`); el plugin registra el alias con
`bus.setup`. El asistente visual TUI queda como opcional: si no se detecta en la instalación, este
flujo conversacional cubre la misma función.

En cualquier sesión, **`/bus-report`** escribe un informe Markdown legible con alias, roles,
contadores y entregas recientes. Para herramientas externas, el plugin expone un RPC con
`overview`, `setAlias`, `audit` y `report`:

```bash
opencode api post '/api/rpc/agentbus/report?location[directory]=/ruta/del/proyecto' \
  --data '{"input":{"format":"md"}}'
```

Los roles son información para la persona y los clientes; el transporte sigue siendo el sobre del
protocolo y no cambia la propiedad de archivos ni los gates.

## Buses con nombre compartido

Un bus se identifica por nombre (por ejemplo `alloy`) y puede tener miembros de varios proyectos.
Cada miembro se conecta con un alias y un rol:

```text
/bus-connect alloy lead lead
```

También están las herramientas `bus.connect`, `bus.use` y `bus.buses`. El **bus activo** se guarda
por proyecto; los miembros de cada bus se guardan de forma global, así que otro proyecto puede
`bus.use("alloy")` y hablar con los mismos alias. Contadores y auditoría siguen separados por
proyecto. Las entradas antiguas sin prefijo quedan como históricas y no se migran automáticamente.

## Mensaje

```text
[FROM @lead → TO @beam | 2026-11-24T10:00:00Z | ID MSG-... | TYPE DECISION | REPLY-TO MSG-... | SUPERSEDES MSG-...]
<asunto>

<cuerpo>

— @lead
```

`TYPE` ∈ `QUESTION | REPORT | DECISION | CORRECCIÓN | ALERT | INFO`.

## Reglas de oro

1. Un mensaje, un asunto.
2. Confirmar con `REPORT` + `replyTo`.
3. Mal enrutado → `CORRECCIÓN` con `supersedes` y `steer`.
4. **No polling**: no sondees el buzón ni escribas estados periódicos. Quédate inactivo hasta que
   llegue un prompt; `bus_read` solo bajo demanda.
5. Fail-closed solo ante gates fallidos o urgentes no atendidos; no por silencio normal.
6. El API es transporte; el archivo de decisiones del repo es la fuente de verdad.
7. No cambies modelos por rate limit sin autorización del humano.

El protocolo completo está en `PROTOCOL.md`.

## Desarrollo

```bash
npm install
npm run typecheck
npm test
```

Requiere `@opencode/plugin` 2.4.1. La API del buzón pendiente no está expuesta en el SDK del
plugin: `bus_read` lee la transcripción (mensajes entregados); para vaciar el buzón usa la API HTTP
`DELETE /api/session/{id}/inbox/{inboxID}`.
