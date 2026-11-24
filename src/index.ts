import { Plugin, Skill } from "@opencode/plugin";
import { fileURLToPath } from "node:url";
import { ANTI_POLLING_RULE, envelope, isBusMessage, parseHeader } from "./protocol.js";

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
    const stored = (await ctx.storage.get("aliases")) as Record<string, string> | undefined;
    let aliases: Record<string, string> = { ...(stored ?? {}), ...(options.aliases ?? {}) };

    const bump = async (key: string): Promise<number> => {
      const current = (await ctx.storage.get(key)) as number | undefined;
      const next = (typeof current === "number" ? current : 0) + 1;
      await ctx.storage.set(key, next);
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
          await ctx.session.prompt({ sessionID, text: msg.text, delivery });
          await ctx.storage.set(`sent/${msg.id}`, {
            to: args.to,
            from,
            type: args.type,
            subject: args.subject,
            delivery,
            at: new Date().toISOString(),
          });
          await bump("stats/sent");
          return { content: `enviado ${msg.id} → ${args.to} (${args.type}, ${delivery})` };
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
          },
          required: ["alias", "sessionID"],
          additionalProperties: false,
        },
        options: { namespace: options.toolNamespace, codemode: true },
        execute: async (input) => {
          const args = input as { alias: string; sessionID: string };
          aliases = { ...aliases, [args.alias]: args.sessionID };
          await ctx.storage.set("aliases", aliases);
          return { content: `alias ${args.alias} → ${args.sessionID} guardado` };
        },
      });

      editor.add({
        name: "status",
        description:
          "Healthcheck del plugin: versión, alias, contadores enviados/entregados/lecturas y configuración activa.",
        input: { type: "object", properties: {}, additionalProperties: false },
        options: { namespace: options.toolNamespace, codemode: true },
        execute: async () => {
          const read = async (key: string): Promise<number> => {
            const value = await ctx.storage.get(key);
            return typeof value === "number" ? value : 0;
          };
          const lines = [
            "agentbus 0.1.0 — ACTIVO",
            `directorio: ${ctx.location.directory}`,
            `alias (${Object.keys(aliases).length}): ${Object.keys(aliases).join(", ") || "-"}`,
            `delivery por defecto: ${options.defaultDelivery}`,
            `enviados: ${await read("stats/sent")}`,
            `entregados (evento): ${await read("stats/delivered")}`,
            `lecturas bus_read: ${await read("stats/read")}`,
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
          const page = await ctx.storage.scan({ prefix: "delivered/", limit });
          return {
            content: page.entries.length
              ? page.entries
                  .map((entry) => `${entry.key}: ${JSON.stringify(entry.value)}`)
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
      });
    }

    const controller = new AbortController();
    if (options.audit) {
      void (async () => {
        for await (const event of ctx.event.subscribe({
          types: ["session.inbox.delivered"],
          signal: controller.signal,
        })) {
          try {
            const raw = event as unknown as Record<string, unknown>;
            await ctx.storage.set(
              `delivered/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              {
                at: new Date().toISOString(),
                sessionID: typeof raw.sessionID === "string" ? raw.sessionID : null,
                inboxID: typeof raw.inboxID === "string" ? raw.inboxID : null,
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

    return () => controller.abort();
  },
});

function sessionIDOfCurrentSession(_ctx: unknown): string | undefined {
  // El SDK no expone la sesión actual en el contexto del plugin; el caller debe
  // pasar `who` o configurar un alias propio. Se mantiene esta función para
  // hacer explícita la limitación.
  return undefined;
}
