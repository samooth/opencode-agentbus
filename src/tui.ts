/** Parte TUI del plugin.
 *
 * Los comandos `/bus-setup` y `/bus-audit` se registran en la parte del servidor
 * (`src/index.ts`) para que funcionen en la conversación aunque esta parte no se
 * detecte. Mantenerlos también aquí producía comandos duplicados.
 */
import { Plugin } from "@opencode/plugin/tui";

export default Plugin.define({
  id: "agentbus.tui",
  setup() {},
});
