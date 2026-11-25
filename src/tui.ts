/** Parte TUI del plugin: asistente de configuración y panel de auditoría ligero. */
import { Plugin } from "@opencode/plugin/tui";
import { AgentBus } from "./rpc.js";

type AnyFn = (...args: any[]) => any;

async function configure(context: any, bus: AnyFn & Record<string, any>): Promise<void> {
  while (true) {
    const overview = await bus.overview();
    const choice = await context.ui.dialog.select({
      title: "Agent Bus · configuración",
      message: `${overview.aliases.length} alias · ${overview.counters.pending} pendientes · entrega ${overview.delivery}`,
      options: [
        {
          title: "Añadir o actualizar una sesión",
          value: "add",
          description: "Elige una sesión real y asígnale alias y rol",
        },
        { title: "Ver alias y roles", value: "view" },
        { title: "Ver auditoría reciente", value: "audit" },
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
    if (choice === "audit") {
      const audit = await bus.audit({ limit: 8 });
      const lines = audit.entries.map(
        (e: any) => `${e.at || "-"} · ${e.sessionID || "-"} · ${e.inboxID || "-"}`,
      );
      await context.ui.dialog.alert({
        title: "Agent Bus · últimas entregas",
        message: lines.length ? lines.join("\n") : "Sin entregas registradas todavía.",
      });
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
      placeholder: "beam",
      message: "Nombre corto para referirse a la sesión en el bus",
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
    const bus = (context.client as any).rpc(AgentBus) as AnyFn & Record<string, any>;
    context.ui.toast.show({
      title: "Agent Bus",
      message: "Asistente disponible: /bus-setup",
      variant: "info",
    });
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
            await configure(context, bus);
          },
        },
        {
          id: "agentbus.audit",
          title: "Agent Bus: ver auditoría reciente",
          palette: true,
          slash: { name: "bus-audit" },
          run: async () => {
            const audit = await bus.audit({ limit: 8 });
            const lines = audit.entries.map(
              (e: any) => `${e.at || "-"} · ${e.sessionID || "-"} · ${e.inboxID || "-"}`,
            );
            await context.ui.dialog.alert({
              title: "Agent Bus · últimas entregas",
              message: lines.length ? lines.join("\n") : "Sin entregas registradas todavía.",
            });
          },
        },
      ],
    }));
  },
});
