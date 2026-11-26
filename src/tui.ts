/** Parte TUI del plugin: diálogos de configuración y auditoría, sin inyectar prompts. */
import { Plugin } from "@opencode/plugin/tui";
import { AgentBus } from "./rpc.js";

type AnyFn = (...args: any[]) => any;
type BusClient = AnyFn & Record<string, any>;

const describe = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

/** El RPC está registrado por ubicación: sin `location` cae en el directorio por
 * defecto del servidor y responde `rpc.unavailable`. */
const busFor = (context: any): BusClient => {
  const raw = context.client.rpc(AgentBus);
  const options = { location: context.location ?? context.data?.location?.default?.() };
  return {
    overview: (input: unknown = {}) => raw.overview(input as never, options),
    setAlias: (input: unknown) => raw.setAlias(input as never, options),
    disconnect: (input: unknown) => raw.disconnect(input as never, options),
    audit: (input: unknown) => raw.audit(input as never, options),
    report: (input: unknown) => raw.report(input as never, options),
  } as unknown as BusClient;
};

async function configure(context: any, bus: BusClient): Promise<void> {
  while (true) {
    const overview = await bus.overview();
    const choice = await context.ui.dialog.select({
      title: `Agent Bus · ${overview.aliases.length} alias · ${overview.counters.pending} pendientes · entrega ${overview.delivery}`,
      options: [
        {
          title: "Añadir o actualizar una sesión",
          value: "add",
          description: "Elige una sesión real y asígnale alias y rol",
        },
        { title: "Ver alias y roles", value: "view" },
        { title: "Ver informe del bus", value: "report" },
        { title: "Quitar una sesión del bus", value: "remove" },
        { title: "Terminar", value: "done" },
      ],
    });
    if (!choice || choice === "done") break;
    if (choice === "view") {
      const lines = overview.aliases.map(
        (a: any) => `${a.alias} (${a.role}) → ${a.sessionID}`,
      );
      await context.ui.dialog.alert({
        title: "Agent Bus · alias",
        message: lines.length ? lines.join("\n") : "Sin alias. Añade una sesión para empezar.",
      });
      continue;
    }
    if (choice === "report") {
      const report = await bus.report({ format: "md" });
      await context.ui.dialog.alert({ title: "Agent Bus · informe", message: report.text });
      continue;
    }
    if (choice === "remove") {
      const names = overview.aliases.map((a: any) => a.alias as string);
      if (names.length === 0) {
        await context.ui.dialog.alert({ title: "Agent Bus", message: "No hay alias conectados." });
        continue;
      }
      const alias = await context.ui.dialog.select({
        title: "Alias a desconectar",
        options: names.map((name: string) => ({ title: name, value: name })),
      });
      if (!alias) continue;
      await bus.disconnect({ alias });
      context.ui.toast.show({ title: "Agent Bus", message: `${alias} desconectado`, variant: "success" });
      continue;
    }
    const sessions = overview.sessions as Array<{ id: string; title: string }>;
    if (sessions.length === 0) {
      await context.ui.dialog.alert({
        title: "Agent Bus",
        message: "No hay sesiones en este proyecto. Abre una sesión y vuelve a intentarlo.",
      });
      continue;
    }
    const sessionID = await context.ui.dialog.select({
      title: "Sesiones del proyecto",
      options: sessions.map((s) => ({
        title: s.title || s.id,
        value: s.id,
        description: s.id,
      })),
      search: (query: string, options: Array<{ title: string; value: string }>) =>
        options.filter((o) => `${o.title} ${o.value}`.toLowerCase().includes(query.toLowerCase())),
    });
    if (!sessionID) continue;
    const alias = await context.ui.dialog.prompt({
      title: "Alias",
      description: "Nombre corto para referirse a la sesión en el bus",
      placeholder: "beam",
    });
    if (!alias) continue;
    const role = await context.ui.dialog.select({
      title: "Rol de este agente",
      options: [
        { title: "Lead · coordina y decide", value: "lead" },
        { title: "Dev · implementa su área", value: "dev" },
        { title: "Reviewer · revisa sin editar", value: "reviewer" },
      ],
    });
    if (!role) continue;
    await bus.setAlias({ alias, sessionID, role });
    context.ui.toast.show({
      title: "Agent Bus",
      message: `${alias} (${role}) → ${sessionID.slice(0, 18)}… guardado`,
      variant: "success",
    });
  }
}

export default Plugin.define({
  id: "agentbus.tui",
  setup(context) {
    context.keymap.layer(() => ({
      mode: "global" as const,
      priority: 10,
      commands: [
        {
          id: "agentbus.setup",
          title: "Agent Bus: configurar sesiones y roles",
          palette: true,
          slash: { name: "bus-setup" },
          run: async () => {
            try {
              const bus = busFor(context);
              await configure(context, bus);
            } catch (error) {
              await context.ui.dialog.alert({
                title: "Agent Bus · error",
                message: describe(error),
              });
            }
          },
        },
        {
          id: "agentbus.report",
          title: "Agent Bus: ver informe (alias, contadores, entregas)",
          palette: true,
          slash: { name: "bus-report" },
          run: async () => {
            try {
              const bus = busFor(context);
              const report = await bus.report({ format: "md" });
              await context.ui.dialog.alert({ title: "Agent Bus · informe", message: report.text });
            } catch (error) {
              await context.ui.dialog.alert({
                title: "Agent Bus · error",
                message: describe(error),
              });
            }
          },
        },
      ],
    }));
  },
});
