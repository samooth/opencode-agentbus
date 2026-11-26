# opencode-agentbus

Protocolo **portable** de comunicación entre sesiones de OpenCode V2. Extraído de un flujo de
trabajo real: varios agentes trabajan en paralelo y se escriben por API sin que el humano haga
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
| `bus_disconnect` | Desconectar un alias del bus activo (o del bus indicado en `bus`) |
| `bus_status` | Healthcheck: activo, alias, contadores, pendientes y configuración |
| `bus_audit` | Ver entregas capturadas por el plugin |
| `bus_connect` | Conectar una sesión a un bus con nombre, con alias y rol |
| `bus_use` | Seleccionar el bus activo de este proyecto |
| `bus_buses` | Listar los buses con nombre y sus miembros |
| `bus_setup` | Registrar un alias desde un `sessionID` (o un índice cacheado), alias y rol |

También registra el skill `agent-bus` (`autoinvoke: false`, se carga con `@agent-bus`) y **una sola**
inyección de reglas en el contexto de cada sesión. Los únicos slash commands son `/bus-connect`,
`/bus-setup` y `/bus-report`. No dupliques el protocolo en los skills del proyecto: el plugin es la
fuente de transporte y el archivo de decisiones del repo es la fuente de los acuerdos.

## Interfaz para la persona

La parte TUI (`./tui`) ofrece dos slash commands en diálogo: abren modales, nunca escriben datos en
la conversación y no consumen inferencia.

- **`/bus-setup`** — lista numerada de sesiones raíz; la persona elige sesión, alias y rol (`lead`,
  `dev` o `reviewer`). El mismo diálogo permite ver los alias actuales, ver el informe completo y
  desconectar un alias. Se excluyen los subagentes, se marcan las sesiones ya conectadas y el orden
  es estable.
- **`/bus-report`** — estado completo: bus activo, alias/roles, contadores y entregas recientes.
  `audit` es el subconjunto de entregas de este informe.

`/bus-connect <bus> <alias> <rol>` conecta la sesión que llama a un bus con nombre compartido.

Para herramientas externas, el plugin expone un RPC con `overview`, `setAlias`, `disconnect`, `audit`
y `report`:

```bash
opencode api post '/api/rpc/agentbus/report?location[directory]=/ruta/del/proyecto' \
  --data '{"input":{"format":"md"}}'
```

Los roles son información para la persona y los clientes; el transporte sigue siendo el sobre del
protocolo y no cambia la propiedad de archivos ni los gates.

## Buses con nombre compartido

Un bus se identifica por nombre (por ejemplo `team`) y puede tener miembros de varios proyectos.
Cada miembro se conecta con un alias y un rol:

```text
/bus-connect team lead lead
```

También están las herramientas `bus.connect`, `bus.use` y `bus.buses`. El **bus activo** se guarda
por proyecto; los miembros de cada bus se guardan de forma global, así que otro proyecto puede
`bus.use("team")` y hablar con los mismos alias. Contadores y auditoría siguen separados por
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


## Solución de problemas

- **La parte TUI no carga (`Cannot find package 'solid-js'`)** — instala explícitamente las peer
  dependencies: `npm install solid-js @opentui/core @opentui/solid`. npm las instala automáticamente
  de forma normal; esto solo ocurre con `legacy-peer-deps=true` o npm < 7.
- **`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` al importar con `node` directamente** — los
  entrypoints son TypeScript por diseño, según el contrato de plugins de OpenCode. Carga el plugin
  desde OpenCode (Bun/tsx), no con `node`.
- **`RPC is unavailable: agentbus` justo después de arrancar el servidor** — los plugins cargan de
  forma asíncrona. Espera un momento y repite.
- **`rpc.unavailable: agentbus` en la TUI** — el RPC se registra por ubicación. Configura el plugin en el `opencode.json(c)` del proyecto (no solo en `cli.json`) y reinicia. Una consulta HTTP sin `location[directory]` también devuelve `rpc.unavailable`; es normal.
