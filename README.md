# opencode-agentbus

Protocolo **portable** de comunicación entre sesiones de OpenCode V2. Extraído del flujo real que
usamos en Alloy: varios agentes trabajan en paralelo y se escriben por API sin que el humano haga
de cartero. Sin polling, sin bucles de monitorización: el prompt inyectado despierta a la sesión.

## Instalar en cualquier proyecto

Opción A — plugin local (copia este repo o clónalo dentro del proyecto):

```text
tu-proyecto/.opencode/plugins/agentbus/   # este repo, con src/index.ts y PROTOCOL.md
```

Opción B — desde `opencode.jsonc`:

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
    "package": "/ruta/opencode-agentbus",
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
| `bus_directory` | Listar alias y sesiones del proyecto |
| `bus_alias` | Registrar alias → session ID (persistente) |
| `bus_audit` | Ver entregas capturadas por el plugin |

También registra el skill `agent-bus`, el comando `/bus-help` y unas reglas inyectadas en el
contexto de cada sesión.

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
