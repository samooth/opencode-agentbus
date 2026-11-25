/** Contrato RPC del plugin: el TUI y clientes externos pueden preguntar al servidor. */
import { Rpc } from "@opencode/plugin/rpc";

const aliasSchema = {
  type: "object",
  properties: {
    alias: { type: "string" },
    sessionID: { type: "string" },
    role: { type: "string" },
  },
  required: ["alias", "sessionID", "role"],
  additionalProperties: false,
};

const sessionSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
  },
  required: ["id", "title"],
  additionalProperties: false,
};

const auditSchema = {
  type: "object",
  properties: {
    key: { type: "string" },
    at: { type: "string" },
    sessionID: { type: "string" },
    inboxID: { type: "string" },
    subject: { type: "string" },
  },
  required: ["key", "at"],
  additionalProperties: false,
};

export const AgentBus = Rpc.define({
  id: "agentbus",
  methods: {
    overview: {
      input: { type: "object", additionalProperties: false },
      output: {
        type: "object",
        properties: {
          directory: { type: "string" },
          delivery: { type: "string" },
          self: { type: "string" },
          aliases: { type: "array", items: aliasSchema },
          sessions: { type: "array", items: sessionSchema },
          counters: {
            type: "object",
            properties: {
              sent: { type: "number" },
              delivered: { type: "number" },
              reads: { type: "number" },
              pending: { type: "number" },
            },
            required: ["sent", "delivered", "reads", "pending"],
            additionalProperties: false,
          },
        },
        required: ["directory", "delivery", "self", "aliases", "sessions", "counters"],
        additionalProperties: false,
      },
    },
    setAlias: {
      input: {
        type: "object",
        properties: {
          alias: { type: "string" },
          sessionID: { type: "string" },
          role: { type: "string" },
        },
        required: ["alias", "sessionID", "role"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    },
    audit: {
      input: {
        type: "object",
        properties: { limit: { type: "number" } },
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { entries: { type: "array", items: auditSchema } },
        required: ["entries"],
        additionalProperties: false,
      },
    },
    report: {
      input: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["md", "json"] },
        },
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  events: {
    changed: {
      schema: {
        type: "object",
        properties: { kind: { type: "string" } },
        required: ["kind"],
        additionalProperties: false,
      },
    },
  },
});
