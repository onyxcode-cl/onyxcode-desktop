Directorio de configuración de OpenCode propio de la app (se pasa como `OPENCODE_CONFIG_DIR`).
`agents/*.md` → agentes `chat`, `cowork` y `computer`. Se fusiona con ~/.config/opencode del usuario.

`computer` (control del Mac) solo funciona en el servidor de Cowork de acceso completo
(`cowork:start { fullAccess: true }`), que añade el MCP `computer` (out/main/computer-mcp.js +
resources/computer-use/bin/cu-helper). Los servidores sandboxeados lo desactivan vía
`OPENCODE_CONFIG_CONTENT` (`agent.computer.disable`).
