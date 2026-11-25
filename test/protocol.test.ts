import assert from "node:assert/strict";
import test from "node:test";
import {
  ANTI_POLLING_RULE,
  envelope,
  isBusMessage,
  makeId,
  parseHeader,
  sortAuditEntries,
} from "../src/protocol.ts";

test("envelope lleva FROM/TO/TYPE/ID y firma", () => {
  const msg = envelope({
    from: "lead",
    to: "beam",
    type: "DECISION",
    subject: "G0 cerrado",
    body: "Verificado",
    id: "MSG-1-1",
    now: new Date("2026-11-24T10:00:00Z"),
  });
  assert.equal(msg.id, "MSG-1-1");
  assert.match(
    msg.header,
    /^\[FROM @lead \| TO @beam \| .* \| ID MSG-1-1 \| TYPE DECISION\]$/,
  );
  assert.match(msg.text, /^\[FROM @lead/);
  assert.match(msg.text, /G0 cerrado/);
  assert.match(msg.text, /— @lead$/);
  assert.equal(isBusMessage(msg.text), true);
  assert.equal(parseHeader(msg.text), msg.header);
});

test("REPLY-TO y SUPERSEDES se incluyen cuando se aportan", () => {
  const msg = envelope({
    from: "hy4",
    to: "lead",
    type: "CORRECCIÓN",
    subject: "Mal enrutado",
    body: "Ignora el anterior",
    replyTo: "MSG-1-1",
    supersedes: "MSG-1-2",
  });
  assert.match(msg.header, /REPLY-TO MSG-1-1/);
  assert.match(msg.header, /SUPERSEDES MSG-1-2/);
});

test("los IDs generados son únicos aunque caigan en el mismo segundo", () => {
  const a = makeId(new Date("2026-11-24T10:00:00Z"));
  const b = makeId(new Date("2026-11-24T10:00:00Z"));
  const c = makeId();
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.notEqual(b, c);
});

test("texto normal no se confunde con mensaje del bus", () => {
  assert.equal(isBusMessage("Hola, ¿qué tal?"), false);
  assert.equal(parseHeader("Hola"), undefined);
});

test("la regla anti-polling prohíbe bucles de monitorización", () => {
  assert.match(ANTI_POLLING_RULE, /NO hagas polling/i);
  assert.match(ANTI_POLLING_RULE, /monitorización/i);
});

test("la auditoría se ordena por fecha y respeta el límite", () => {
  const entries = [
    { key: "a", value: { at: "2026-01-01T00:00:00Z" } },
    { key: "b", value: { at: "2026-03-01T00:00:00Z" } },
    { key: "c", value: { at: "2026-02-01T00:00:00Z" } },
  ];
  assert.deepEqual(
    sortAuditEntries(entries, 2).map((e) => e.key),
    ["b", "c"],
  );
  assert.equal(sortAuditEntries(entries, 999).length, 3);
});
