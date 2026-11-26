# Agent Bus — protocolo de comunicación entre sesiones

Este skill lo inyecta el plugin `opencode-agentbus`. El objetivo: que varios agentes trabajen en
paralelo **sin que el humano haga de cartero** y sin interrumpirlo salvo fail-closed.

**Idiomas:** [English](PROTOCOL.md) · [Español](PROTOCOL_ES.md) · [Français](PROTOCOL_FR.md) · [中文](PROTOCOL_ZH.md)

## 1. Transporte

El bus usa la API de OpenCode (`session.prompt`) para entregar prompts a otras sesiones. El plugin
registra las herramientas `bus_*`; el API es transporte, **no fuente de verdad**. Los acuerdos se
escriben en el archivo de decisiones del proyecto (por ejemplo `FEEDBACK.md` o `DECISIONS.md`).

## 2. Sobre obligatorio

Todo mensaje empieza por una línea con el nombre de quien habla:

```
[FROM @lead → TO @beam | 2026-11-24T10:00:00Z | ID MSG-... | TYPE DECISION | REPLY-TO MSG-... | SUPERSEDES MSG-...]
<asunto>

<cuerpo>

— @lead
```

`TYPE` ∈ `QUESTION | REPORT | DECISION | CORRECCIÓN | ALERT | INFO`.

## 3. Entrega

- `queue` (por defecto): el mensaje espera en el buzón y se entrega de uno en uno cuando el agente
  termina su trabajo actual.
- `steer`: interrumpe el trabajo en curso. Solo para `CORRECCIÓN` y `ALERT`.

La herramienta `bus_send` acepta `steer: true` para elegir prioridad.

## 4. Reglas

1. **Un mensaje, un asunto.** No mezclar temas de dos destinatarios: es la causa más común de
   enrutado equivocado.
2. **Confirmar recepción** con `REPORT` y `replyTo` apuntando al ID recibido.
3. **Mensaje mal enrutado**: no lo ejecutes; avisa y reenvía con `supersedes` apuntando al ID
   inválido y prioridad `steer`.
4. **NO POLLING, NO BUCLES DE MONITORIZACIÓN.** El prompt se inyecta directamente en la sesión y la
   despierta: no hace falta sondear el buzón ni reenviarse mensajes a sí mismo. Quédate **inactivo**
   cuando no tengas trabajo; no escribas entradas periódicas de «monitorización final» ni repitas
   tu estado. `bus_read` es solo bajo demanda. Esto ahorra tokens e inferencia.
5. **Fail-closed con criterio:** si un gate falla o un mensaje URGENTE no se atiende, escala al
   humano. No escales por «no hay mensajes nuevos»: eso es funcionamiento normal.
6. **No esperes al humano**: pregunta por el bus y sigue con otra tarea independiente.
7. **El transporte no cambia la propiedad de archivos ni los gates.** Nunca uses `--no-verify` ni
   edites contratos congelados por un mensaje.
8. **No cambies el modelo de una sesión** por rate limit o retry salvo autorización explícita del
   humano; reporta el incidente y espera.

## 5. Cola de trabajo

Cada agente mantiene su propia cola (por ejemplo `docs/LEAD_QUEUE.md`) con ítems
`DONE / NEXT / BLOCKED / ABIERTO`. El bus solo transporta; la cola es el registro durable.

## 6. Historial y auditoría

El plugin guarda los eventos `session.inbox.delivered` en su almacenamiento (`bus_audit`). El buzón
se vacía con la API `/api/session/{id}/inbox` cuando los mensajes ya están registrados en el repo.
