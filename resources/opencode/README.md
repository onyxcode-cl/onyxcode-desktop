Agentes y skills de OpenCode propios de la app (`agents/*.md` → `chat`, `tasks` y `computer`;
`skills/<nombre>/SKILL.md` → `docx`, `xlsx`, `pdf` y `pptx`).

Este directorio es SOLO LECTURA (va dentro del bundle firmado). Al arrancar, main copia `agents/` y
`skills/` a `userData/opencode-config/` (sobrescribe si cambia la versión de la app, y borra lo que
ya no exista en el bundle) junto con los plugins generados `plugins/onyxcode-env.js` y
`plugins/onyxcode-plan-gate.js`, y es ESE directorio el que se pasa como `OPENCODE_CONFIG_DIR`
(OpenCode escribe en su config dir: `node_modules`, `bun.lock`…). Ver
`src/main/tasks/opencode-config.ts`. Se fusiona con ~/.config/opencode del usuario. En el
empaquetado, `agents/**` y `skills/**` van en `asarUnpack` (`electron-builder.js`).

## Skills

Cada skill es una carpeta con `SKILL.md` (frontmatter `name` = nombre de la carpeta, en minúsculas y
guiones, y `description`) y, opcionalmente, plantillas (`*.py`) que el agente copia a `./.onyxcode/trabajo/` desde
el «Base directory for this skill» que le devuelve la herramienta `skill`. Verificado con opencode
1.18.32 en un servidor sandbox real: `GET /skill` lista las skills de `OPENCODE_CONFIG_DIR/skills`
(no hace falta `skills.paths`; `skillsInlineConfig()` queda como gancho vacío).

- Los comandos de cada skill están comprobados DENTRO del perfil Seatbelt real de las tareas
  (`sandbox-exec`). Si cambias una skill, vuelve a probarla ahí; no añadas comandos sin verificar.
- Herramientas que NO funcionan en el sandbox: `open`, `osascript`, `qlmanage`, `screencapture`.
- `textutil` no convierte a PDF, aplana las tablas HTML y no incrusta imágenes; `cupsfilter` no
  convierte HTML: el PDF maquetado sale del botón «Guardar como PDF» de Entregables.
- Colisiones: si el usuario tiene una skill con el mismo nombre en `~/.claude/skills`, OpenCode
  puede quedarse con cualquiera de las dos (el orden no es determinista). `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`
  en el entorno del servidor deja solo las de la app y las del proyecto.

## Agentes

`computer` (control del Mac) solo funciona en el servidor de las tareas de Control total del Mac
(`tasks:start { fullAccess: true }`, que exige `tasks:grantFullAccess` previo), que añade el
MCP `computer` (out/main/computer-mcp.js + resources/computer-use/bin/cu-helper). Los servidores
sandboxeados lo desactivan vía `OPENCODE_CONFIG_CONTENT` (`agent.computer.disable`).

En ese servidor, el plugin `onyxcode-plan-gate` exige un plan aprobado para TODA sesión (incluidas las
hijas de `task`, cuyo permiso está en `deny` para `computer`), no solo para las del agente `computer`.
