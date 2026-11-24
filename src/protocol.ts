/** Envelope del bus. Sin dependencias de OpenCode: portable y testeable. */

export type MessageType =
  | "QUESTION"
  | "REPORT"
  | "DECISION"
  | "CORRECCIÓN"
  | "CORRECCION"
  | "ALERT"
  | "INFO";

export interface EnvelopeInput {
  from: string;
  to: string;
  type: MessageType | string;
  subject: string;
  body: string;
  id?: string;
  replyTo?: string;
  supersedes?: string;
  now?: Date;
}

export interface Envelope {
  id: string;
  text: string;
  header: string;
}

let sequence = 0;

/** ID único incluso si se envían varios mensajes en el mismo segundo/proceso. */
export function makeId(now: Date = new Date()): string {
  sequence += 1;
  return (
    `MSG-${Math.floor(now.getTime() / 1000)}-${process.pid}` +
    `-${sequence.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  );
}

/** Construye el sobre `[FROM … → TO … | …]`, el cuerpo y la firma final. */
export function envelope(input: EnvelopeInput): Envelope {
  const now = input.now ?? new Date();
  const id = input.id ?? makeId(now);
  const parts = [
    `FROM @${input.from}`,
    `TO @${input.to}`,
    now.toISOString(),
    `ID ${id}`,
    `TYPE ${input.type}`,
  ];
  if (input.replyTo) parts.push(`REPLY-TO ${input.replyTo}`);
  if (input.supersedes) parts.push(`SUPERSEDES ${input.supersedes}`);
  const header = `[${parts.join(" | ")}]`;
  const text = [
    header,
    input.subject,
    "",
    input.body,
    "",
    `— @${input.from}`,
  ].join("\n");
  return { id, header, text };
}

/** Extrae el header de un mensaje ya entregado (para `bus_read`). */
export function parseHeader(text: string): string | undefined {
  const first = text.split("\n", 1)[0] ?? "";
  return first.startsWith("[FROM @") ? first : undefined;
}

export function isBusMessage(text: string): boolean {
  return parseHeader(text) !== undefined;
}

/**
 * Regla anti-ruido: con inyección directa el prompt despierta a la sesión.
 * No sondee el buzón en bucle ni escriba entradas de "monitorización" periódicas.
 */
export const ANTI_POLLING_RULE =
  "NO hagas polling del inbox ni escribas entradas de monitorización en bucle: " +
  "el prompt se inyecta directamente en la sesión y la despierta. Quédate inactivo " +
  "hasta que llegue un mensaje; usa bus_read solo bajo demanda.";
