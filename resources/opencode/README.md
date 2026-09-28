Agentes de OpenCode propios de la app (`agents/*.md` → `chat`, `cowork` y `computer`).

Este directorio es SOLO LECTURA (va dentro del bundle firmado). Al arrancar, main copia
`agents/` a `userData/opencode-config/` (sobrescribe si cambia la versión de la app) junto con
el plugin generado `plugins/opendesk-env.js`, y es ESE directorio el que se pasa como
`OPENCODE_CONFIG_DIR` (OpenCode escribe en su config dir: `node_modules`, `bun.lock`…).
Ver `src/main/cowork/opencode-config.ts`. Se fusiona con ~/.config/opencode del usuario.

`computer` (control del Mac) solo funciona en el servidor de Cowork de acceso completo
(`cowork:start { fullAccess: true }`, que exige `cowork:grantFullAccess` previo), que añade el
MCP `computer` (out/main/computer-mcp.js + resources/computer-use/bin/cu-helper). Los servidores
sandboxeados lo desactivan vía `OPENCODE_CONFIG_CONTENT` (`agent.computer.disable`).
