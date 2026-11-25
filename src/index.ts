import { Plugin, Skill } from "@opencode/plugin";
import { AgentBus } from "./rpc.js";
import { fileURLToPath } from "node:url";
import {
  ANTI_POLLING_RULE,
  envelope,
  isBusMessage,
  parseHeader,
  sortAuditEntries,
} from "./protocol.js";

interface PendingMessage {
  id: string;
  to: string;
  subject: string;
  inboxID?: string;
  at: string;
}

type Delivery = "queue" | "steer";

interface BusOptions {
  aliases?: Record<string, string>;
  self?: string;
  defaultDelivery?: Delivery;
  injectInstructions?: boolean;
  registerSkill?: boolean;
  registerCommands?: boolean;
  requireEnvelope?: boolean;
  audit?: boolean;
  toolNamespace?: string;
}

const DEFAULTS: Required<Omit<BusOptions, "aliases">> = {
  self: "lead",
  defaultDelivery: "queue",
  injectInstructions: true,
  registerSkill: true,
  registerCommands: true,
  requireEnvelope: false,
  audit: true,
  toolNamespace: "bus",
};

const RULES = `AGENT BUS (plugin opencode-agentbus) — SOLO transporte; la fuente de verdad es el archivo de decisiones del proyecto. Usa bus_* para hablar con otros agentes (no reenvíes prompts por el humano). Sobre: [FROM … → TO … | ID | TYPE | REPLY-TO | SUPERSEDES]. Un mensaje = un asunto; confirma con REPORT + replyTo; mal enrutado → CORRECCIÓN con supersedes y steer. ${ANTI_POLLING_RULE} No cambies modelos por rate limit sin permiso.`;

function asOptions(raw: unknown): BusOptions {
  return (raw && typeof raw === "object" ? raw : {}) as BusOptions;
}

function isSessionID(value: string): boolean {
  return value.startsWith("ses_");
}

export default Plugin.define({
  id: "agentbus",
  async setup(ctx) {
    const options = { ...DEFAULTS, ...asOptions(ctx.options) };
    const projectKey = ctx.location.directory.replace(/[^A-Za-z0-9]/g, "_").slice(-80) || "root";
    const sk = (key: string): string => `${projectKey}/${key}`;
    const stored = (await ctx.storage.get(sk("aliases"))) as Record<string, string> | undefined;
    let aliases: Record<string, string> = { ...(stored ?? {}), ...(options.aliases ?? {}) };
    const storedRoles = (await ctx.storage.get(sk("roles"))) as Record<string, string> | undefined;
    let roles: Record<string, string> = { ...(storedRoles ?? {}) };
    const pending = new Map<string, PendingMessage>();

    const read = async (key: string): Promise<number> => {
      const value = await ctx.storage.get(sk(key));
      return typeof value === "number" ? value : 0;
    };

    const auditEntries = async (limit: number) => {
      const page = await ctx.storage.scan({ prefix: sk("delivered/"), limit: 200 });
      return sortAuditEntries(page.entries, limit).map((entry) => {
        const value =
          entry.value && typeof entry.value === "object"
            ? (entry.value as Record<string, unknown>)
            : {};
        return {
          key: String(entry.key),
          at: typeof value.at === "string" ? value.at : "",
          sessionID: typeof value.sessionID === "string" ? value.sessionID : "",
          inboxID: typeof value.inboxID === "string" ? value.inboxID : "",
          subject: typeof value.subject === "string" ? value.subject : "",
        };
      });
    };

    const reportText = async (format: "md" | "json"): Promise<string> => {
      const data = {
        project: ctx.location.directory,
        schemaHash: "agentbus-0.1.0",
        aliases: Object.entries(aliases).map(([alias, id]) => ({
          alias,
          sessionID: id,
          role: roles[alias] ?? "dev",
        })),
        counters: {
          sent: await read("stats/sent"),
          delivered: await read("stats/delivered"),
          reads: await read("stats/read"),
          pending: pending.size,
        },
        audit: await auditEntries(20),
      };
      if (format === "json") return JSON.stringify(data, null, 2);
      const lines = [
        "# Informe de Agent Bus",
        "",
        `Proyecto: \`${data.project}\``,
        "",
        "## Alias y roles",
        ...data.aliases.map((a) => `- **${a.alias}** (${a.role}) → \`${a.sessionID}\``),
        "",
        "## Contadores",
        `- enviados: ${data.counters.sent}`,
        `- entregados: ${data.counters.delivered}`,
        `- lecturas: ${data.counters.reads}`,
        `- pendientes: ${data.counters.pending}`,
        "",
        "## Últimas entregas",
        ...data.audit.map((a) => `- \`${a.at}\` · ${a.sessionID || "-"} · ${a.inboxID || "-"}`),
      ];
      return lines.join("\n");
    };

    const bump = async (key: string): Promise<number> => {
      const current = (await ctx.storage.get(sk(key))) as number | undefined;
      const next = (typeof current === "number" ? current : 0) + 1;
      await ctx.storage.set(sk(key), next);
      return next;
    };

    console.log(
      `[agentbus] setup id=agentbus aliases=${Object.keys(aliases).length} ` +
        `delivery=${options.defaultDelivery} skill=${options.registerSkill} ` +
        `audit=${options.audit} dir=${ctx.location.directory}`,
    );

    const resolve = (target: string): string | undefined => {
      if (isSessionID(target)) return target;
      return aliases[target];
    };

    const aliasList = async (): Promise<string> =>
      Object.entries(aliases)
        .map(([alias, id]) => `  ${alias} → ${id}`)
        .join("\n") || "  (sin alias: usa bus_alias para registrar uno)";

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: options.toolNamespace,
        description: "Mensajería asíncrona entre sesiones de OpenCode",
      });

      editor.add({
        name: "send",
        description:
          "Envía un prompt a otra sesión con sobre [FROM→TO|ID|TYPE]. Por defecto en cola; steer solo para correcciones/alertas.",
        input: {
          type: "object",
          properties: {
            to: { type: "string", description: "Alias o session ID" },
            type: {
              type: "string",
              enum: ["QUESTION", "REPORT", "DECISION", "CORRECCIÓN", "ALERT", "INFO"],
            },
            subject: { type: "string" },
            body: { type: "string" },
            from: { type: "string", description: "Alias del remitente (default: options.self)" },
            steer: { type: "boolean", description: "Entrega prioritaria (default: false)" },
            replyTo: { type: "string", description: "ID del mensaje respondido" },
            supersedes: { type: "string", description: "ID del mensaje inválido que se anula" },
          },
          required: ["to", "type", "subject", "body"],
          additionalProperties: false,
        },
        options: { namespace: options.toolNamespace, codemode: true },
        execute: async (input) => {
          const args = input as {
            to: string;
            type: string;
            subject: string;
            body: string;
            from?: string;
            steer?: boolean;
            replyTo?: string;
            supersedes?: string;
          };
          const sessionID = resolve(args.to);
          if (!sessionID) {
            return {
              content: `Alias desconocido: ${args.to}. Aliases:\n${await aliasList()}`,
              metadata: { error: "unknown_alias" },
            };
          }
          const from = args.from ?? options.self;
          const msg = envelope({
            from,
            to: args.to,
            type: args.type,
            subject: args.subject,
            body: args.body,
            replyTo: args.replyTo,
            supersedes: args.supersedes,
          });
          const delivery: Delivery = args.steer ? "steer" : options.defaultDelivery;
          // resume:true evita que un mensaje en cola se quede dormido en el inbox de una
          // sesión inactiva: la entrega se hace y la sesión se despierta.
          const admission = await ctx.session.prompt({
            sessionID,
            text: msg.text,
            delivery,
            resume: true,
          });
          const inboxID =
            typeof (admission as { id?: unknown })?.id === "string"
              ? (admission as { id: string }).id
              : undefined;
          const at = new Date().toISOString();
          pending.set(inboxID ?? msg.id, {
            id: msg.id,
            to: args.to,
            subject: args.subject,
            inboxID,
            at,
          });
          await ctx.storage.set(sk(`sent/${msg.id}`), {
            to: args.to,
            from,
            type: args.type,
            subject: args.subject,
            delivery,
            inboxID: inboxID ?? null,
            at,
          });
          await bump("stats/sent");
          return {
            content:
              `enviado ${msg.id} → ${args.to} (${args.type}, ${delivery})` +
              (inboxID ? ` · inbox ${inboxID}` : ""),
          };
        },
      });

      editor.add({
        name: "directory",
        description: "Lista alias registrados y sesiones descubiertas en este proyecto.",
        input: { type: "object", properties: {}, additionalProperties: false },
        options: { namespace: options.toolNamespace, codemode: true },
        execute: async () => {
          const lines = [`Aliases:\n${await aliasList()}`, "", "Sesiones del proyecto:"];
          try {
            const page = await ctx.session.list({
              directory: ctx.location.directory,
              limit: 100,
            });
            for (const session of page.data ?? []) {
              lines.push(`  ${(session as { id: string }).id} | ${(session as { title?: string }).title ?? ""}`);
            }
          } catch (error) {
            lines.push(`  (no se pudo listar: ${String(error)})`);
          }
          return { content: lines.join("\n") };
        },
      });

      editor.add({
        name: "read",
        description:
          "Lee mensajes del bus ya entregados en una sesión (transcripción). Los mensajes aún en buzón no son visibles desde el SDK.",
        input: {
          type: "object",
          properties: {
            who: { type: "string", description: "Alias o session ID (default: self)" },
            limit: { type: "number", description: "Últimos N mensajes (default 8)" },
          },
          additionalProperties: false,
        },
        options: { namespace: options.toolNamespace, codemode: true },
        execute: async (input) => {
          const args = input as { who?: string; limit?: number };
          const target = args.who ?? options.self;
          const sessionID = resolve(target) ?? sessionIDOfCurrentSession(ctx);
          if (!sessionID) return { content: `No se pudo resolver la sesión de ${target}` };
          const messages = await ctx.session.context({ sessionID });
          const headers: string[] = [];
          for (const message of messages) {
            const parts = (message as { parts?: Array<{ type?: string; text?: string }> }).parts ?? [];
            for (const part of parts) {
              if (typeof part.text === "string" && isBusMessage(part.text)) {
                const header = parseHeader(part.text);
                if (header) headers.push(header);
              }
            }
          }
          const limit = args.limit ?? 8;
          await bump("stats/read");
          return {
            content: headers.length
              ? headers.slice(-limit).join("\n")
              : "(sin mensajes de bus entregados)",
          };
        },
      });

      editor.add({
        name: "alias",
        description: "Registra o actualiza un alias → session ID (persistente en el plugin).",
        input: {
          type: "object",
          properties: {
            alias: { type: "string" },
            sessionID: { type: "string" },
            role: { type: "string", description: "lead | dev | reviewer (default: dev)" },
          },
          required: ["alias", "sessionID"],
          additionalProperties: false,
        },
        options: { namespace: options.toolNamespace, codemode: true },
        execute: async (input) => {
          const args = input as { alias: string; sessionID: string; role?: string };
          aliases = { ...aliases, [args.alias]: args.sessionID };
          roles = { ...roles, [args.alias]: args.role ?? "dev" };
          await ctx.storage.set(sk("aliases"), aliases);
          await ctx.storage.set(sk("roles"), roles);
          return {
            content: `alias ${args.alias} (${args.role ?? "dev"}) → ${args.sessionID} guardado`,
          };
        },
      });

      editor.add({
        name: "setup",
        description:
          "Registra un alias de la lista mostrada por /bus-wizard: índice, alias y rol",
        input: {
          type: "object",
          properties: {
            index: { type: "number", description: "Número de la sesión en /bus-wizard" },
            alias: { type: "string" },
            role: { type: "string", description: "lead | dev | reviewer" },
          },
          required: ["index", "alias", "role"],
          additionalProperties: false,
        },
        options: { namespace: options.toolNamespace, codemode: true },
        execute: async (input) => {
          const args = input as { index: number; alias: string; role: string };
          const cached = (await ctx.storage.get(sk("wizard/sessions"))) as
            | Array<{ index: number; id: string; title: string }>
            | undefined;
          const chosen = cached?.find((s) => s.index === args.index);
          if (!chosen) {
            return {
              content: "Ese número no está en la lista. Ejecuta /bus-wizard para verla.",
              metadata: { error: "bad_index" },
            };
          }
          aliases = { ...aliases, [args.alias]: chosen.id };
          roles = { ...roles, [args.alias]: args.role };
          await ctx.storage.set(sk("aliases"), aliases);
          await ctx.storage.set(sk("roles"), roles);
          return {
            content: `${args.alias} (${args.role}) → ${chosen.title} · ${chosen.id} guardado`,
          };
        },
      });

      editor.add({
        name: "inbox",
        description:
          "Lista mensajes enviados y aún no entregados (bajo demanda). No sondea el buzón en bucle.",
        input: { type: "object", properties: {}, additionalProperties: false },
        options: { namespace: options.toolNamespace, codemode: true },
        execute: async () => {
          if (pending.size === 0) return { content: "(sin mensajes pendientes)" };
          const lines = [...pending.values()]
            .sort((a, b) => a.at.localeCompare(b.at))
            .map((p) => `  ${p.id} → ${p.to} · ${p.subject}${p.inboxID ? ` · inbox ${p.inboxID}` : ""}`);
          return { content: `Pendientes (${pending.size}):\n${lines.join("\n")}` };
        },
      });

      editor.add({
        name: "status",
        description:
          "Healthcheck del plugin: versión, alias, contadores enviados/entregados/lecturas y configuración activa.",
        input: { type: "object", properties: {}, additionalProperties: false },
        options: { namespace: options.toolNamespace, codemode: true },
        execute: async () => {
          const lines = [
            "agentbus 0.1.0 — ACTIVO",
            `directorio: ${ctx.location.directory}`,
            `alias (${Object.keys(aliases).length}): ${Object.keys(aliases).join(", ") || "-"}`,
            `delivery por defecto: ${options.defaultDelivery}`,
            `enviados: ${await read("stats/sent")}`,
            `entregados (evento): ${await read("stats/delivered")}`,
            `lecturas bus_read: ${await read("stats/read")}`,
            `pendientes de entrega: ${pending.size}`,
            `hooks: context=${options.injectInstructions} prompt=${options.requireEnvelope}`,
            `skill=${options.registerSkill} commands=${options.registerCommands} audit=${options.audit}`,
            "regla anti-polling: activa (ver PROTOCOL.md)",
          ];
          return { content: lines.join("\n") };
        },
      });

      editor.add({
        name: "audit",
        description: "Devuelve el registro de mensajes entregados capturados por el plugin.",
        input: {
          type: "object",
          properties: { limit: { type: "number" } },
          additionalProperties: false,
        },
        options: { namespace: options.toolNamespace, codemode: true },
        execute: async (input) => {
          const limit = (input as { limit?: number }).limit ?? 10;
          const entries = await auditEntries(limit);
          return {
            content: entries.length
              ? entries
                  .map((e) => `${e.at} · sesión ${e.sessionID || "-"} · inbox ${e.inboxID || "-"}`)
                  .join("\n")
              : "(sin entregas registradas)",
          };
        },
      });
    });

    if (options.registerSkill) {
      await ctx.skill.transform((editor) => {
        const path = fileURLToPath(new URL("../PROTOCOL.md", import.meta.url));
        editor.add({
          id: Skill.ID.make("agent-bus"),
          name: Skill.Name.make("Agent Bus"),
          description: "Protocolo de comunicación asíncrona entre sesiones de OpenCode",
          path: Skill.Info.fields.path.make(path),
          content: RULES,
          // El context hook ya inyecta las reglas esenciales: evitar duplicarlas.
          autoinvoke: false,
        });
      });
    }

    if (options.injectInstructions) {
      await ctx.session.hook("context", (event) => {
        event.system.push({ type: "text", text: RULES });
      });
    }

    if (options.requireEnvelope) {
      await ctx.session.hook("prompt", (event) => {
        if (!isBusMessage(event.prompt.text)) {
          const msg = envelope({
            from: options.self,
            to: "peer",
            type: "QUESTION",
            subject: "(sin asunto)",
            body: event.prompt.text,
          });
          event.prompt.text = msg.text;
        }
      });
    }

    if (options.registerCommands) {
      await ctx.command.transform((editor) => {
        editor.add({
          name: "bus-help",
          description: "Muestra el protocolo del bus de agentes",
          execute: async ({ sessionID, delivery }) => {
            await ctx.session.prompt({
              sessionID,
              text: `Protocolo del bus de agentes:\n\n${RULES}`,
              delivery,
            });
          },
        });
        editor.add({
          name: "bus-report",
          description: "Escribe en la sesión un informe legible de aliases, contadores y auditoría",
          execute: async ({ sessionID, delivery }) => {
            await ctx.session.prompt({
              sessionID,
              text: await reportText("md"),
              delivery,
            });
          },
        });
        editor.add({
          name: "bus-wizard",
          description: "Guía paso a paso para configurar alias y roles del bus desde la conversación",
          execute: async ({ sessionID, delivery }) => {
            const page = await ctx.session.list({
              directory: ctx.location.directory,
              limit: 100,
            });
            const sessions = (page.data ?? []).map((s, i) => {
              const item = s as { id: string; title?: string };
              return {
                index: i + 1,
                id: item.id,
                title: item.title ?? "(sin título)",
              };
            });
            await ctx.storage.set(sk("wizard/sessions"), sessions);
            await ctx.session.prompt({
              sessionID,
              text: [
                "# Asistente de Agent Bus",
                "",
                "**Tú eliges.** Elige un número de la lista y responde en este mismo chat con:",
                "",
                "`número  alias  rol`   (rol = `lead`, `dev` o `reviewer`)",
                "",
                "Ejemplo: `1 lead lead`. Repite para cada agente; yo registro los alias con `bus.setup`.",
                "Cuando termines, usa `/bus-report` para verificar.",
                "",
                "## Sesiones del proyecto",
                ...sessions.map((s) => `${s.index}. ${s.title} · \`${s.id}\``),
                "",
                "## Configuración actual",
                await reportText("md"),
              ].join("\n"),
              delivery,
            });
          },
        });
      });
    }

    const rpcRegistration = await ctx.rpc.register(AgentBus, {
      overview: async () => {
        const page = await ctx.session.list({
          directory: ctx.location.directory,
          limit: 100,
        });
        return {
          directory: ctx.location.directory,
          delivery: options.defaultDelivery,
          self: options.self,
          aliases: Object.entries(aliases).map(([alias, id]) => ({
            alias,
            sessionID: id,
            role: roles[alias] ?? "dev",
          })),
          sessions: (page.data ?? []).map((session) => ({
            id: String((session as { id: string }).id),
            title: String((session as { title?: string }).title ?? ""),
          })),
          counters: {
            sent: await read("stats/sent"),
            delivered: await read("stats/delivered"),
            reads: await read("stats/read"),
            pending: pending.size,
          },
        };
      },
      setAlias: async (input, context) => {
        const args = input as { alias: string; sessionID: string; role: string };
        if (!args.sessionID.startsWith("ses_")) {
          throw new Error("El sessionID debe empezar por ses_");
        }
        aliases = { ...aliases, [args.alias]: args.sessionID };
        roles = { ...roles, [args.alias]: args.role || "dev" };
        await ctx.storage.set(sk("aliases"), aliases);
        await ctx.storage.set(sk("roles"), roles);
        await rpcRegistration.events.emit("changed", { kind: "alias" });
        return { ok: true };
      },
      audit: async (input) => {
        const limit = typeof (input as { limit?: unknown })?.limit === "number"
          ? Number((input as { limit: number }).limit)
          : 10;
        return { entries: await auditEntries(limit) };
      },
      report: async (input) => {
        const format = (input as { format?: string })?.format === "json" ? "json" : "md";
        return { text: await reportText(format) };
      },
    });

    const controller = new AbortController();
    if (options.audit) {
      void (async () => {
        for await (const event of ctx.event.subscribe({
          types: [
            "session.inbox.enqueued",
            "session.inbox.delivered",
            "session.inbox.cancelled",
          ],
          signal: controller.signal,
        })) {
          try {
            const raw = event as unknown as Record<string, unknown>;
            const inboxID = typeof raw.inboxID === "string" ? raw.inboxID : null;
            if (event.type === "session.inbox.delivered" || event.type === "session.inbox.cancelled") {
              if (inboxID) pending.delete(inboxID);
            }
            if (event.type !== "session.inbox.delivered") continue;
            await ctx.storage.set(
              sk(`delivered/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
              {
                at: new Date().toISOString(),
                sessionID: typeof raw.sessionID === "string" ? raw.sessionID : null,
                inboxID,
                raw: JSON.stringify(raw),
              },
            );
            await bump("stats/delivered");
          } catch {
            // La auditoría nunca debe romper el flujo de mensajería.
          }
        }
      })();
    }

    return () => {
      controller.abort();
      void rpcRegistration.dispose();
    };
  },
});

function sessionIDOfCurrentSession(_ctx: unknown): string | undefined {
  // El SDK no expone la sesión actual en el contexto del plugin; el caller debe
  // pasar `who` o configurar un alias propio. Se mantiene esta función para
  // hacer explícita la limitación.
  return undefined;
}
