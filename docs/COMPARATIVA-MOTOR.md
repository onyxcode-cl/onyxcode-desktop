# Comparativa del motor de Lazunox con Claude Code, Codex y OpenCode 2.x

> **Desactualizado (2026-10-26).** Este informe es del 24-10 y varias de sus «brechas» ya se cerraron en el motor. El estado vigente y la matriz de paridad completa están en [`PLAN-MOTOR-OLA7.md`](./PLAN-MOTOR-OLA7.md).


> **Nota (2026-10-24, tarde):** el informe se escribió leyendo el `main` público del fork, que entonces estaba atrasado respecto a lo publicado. Correcciones: el shell en segundo plano **sí** funciona en Windows nativo desde `lazunox.5` (ítem 6 resuelto), y desde la rama `feat/ganchos-usuario` del fork ya existen los ítems 1 (rutas protegidas), 2 (ganchos `PreToolUse`/`PostToolUse` por comando), 3 (tope de ayudantes) y 4 (permisos «siempre» persistentes). Ver `docs/PLAN-MOTOR-PROPIO.md`.


Fecha: 2026-10-24. Solo lectura y web; no se tocó código ni git. Alcance: el **motor** (fork de OpenCode 1.19.0, `/Users/ben/Documents/lazunox-motor`), no la app de escritorio.

## Cómo leer este documento

- **Lo que dice cada competidor** viene de su documentación oficial, con la URL. Si no pude comprobarlo, dice «no verificado».
- **Lo que tiene el motor nuestro** viene de leer el código del fork (`packages/opencode/src`), no la documentación. Indico el archivo.
- Las páginas de Codex en `developers.openai.com/codex/...` hoy redirigen (308) a `learn.chatgpt.com/docs/...`. Usé esas URL de destino; la redirección la dio el servidor, no la verifiqué por otro medio.
- «App» = lo que ya resuelve la app de escritorio (puntos de restauración, puerta del plan, memoria, PTY, panel de trabajos, sandbox Seatbelt/WSL de la sesión, según `docs/ANALISIS-OPENCODE-2-FUNCIONES.md` y `docs/PLAN-MOTOR-PROPIO.md`). No cuento eso como brecha del motor, pero lo anoto.

## 1. Qué tiene hoy el motor nuestro (leído del código)

Herramientas registradas (`tool/registry.ts`, líneas 205-250): `invalid`, `question` (en app/cli/desktop), `shell`, `shell_wait`, `read` (lee imágenes y PDF como adjunto, `tool/read.ts:306`), `glob`, `grep`, `edit`, `write`, `task`, `webfetch`, `todowrite`, `websearch` (solo con ciertos proveedores/banderas), `skill`, `apply_patch` (solo modelos `gpt-*`; para los demás se usan edit/write), `execute` y `execute_wait` (Code Mode, solo con bandera), `lsp` (bandera experimental) y `plan` (bandera experimental y solo cliente `cli`).

Otras piezas verificadas en el código:

| Pieza | Evidencia en el fork |
|---|---|
| Ganchos de plugin (solo JavaScript, no comandos de usuario) | `plugin/index.ts` y el tipo `Hooks`: `tool.execute.before/after`, `permission.ask` (cableado por nosotros en `permission/index.ts:93`), `shell.env`, `command.execute.before`, `chat.message`, `experimental.session.compacting`, `experimental.compaction.autocontinue`, `tool.definition`. No hay configuración de ganchos tipo «ejecuta este comando» (`grep hook` en `config/config.ts` sin resultados). |
| Permisos | `permission/index.ts`: reglas por comodín, última que casa gana, por defecto `ask`; `external_directory` y `doom_loop` en `agent/agent.ts`. El «siempre» vive **en memoria** de la instancia. |
| Shell en segundo plano (nuestro) | `tool/shell.ts` + `tool/shell/background.ts`: `background:true`, `yield_ms`, `shell_wait` con lectura incremental y `terminate`, tope de vida 30 min, 3 por sesión y 6 en el motor. **Rechazado en Windows nativo** (`shell.ts:805-810`). Análisis de comandos con tree-sitter (`shell.ts:9`, `:317`). |
| Code Mode (nuestro) | `tool/code-mode.ts`: límites por defecto, pausa con `cell_id` y `execute_wait`, hasta 3 celdas. Solo herramientas MCP, sin `fetch`. |
| Subagentes | `tool/task.ts`: profundidad `subagent_depth`, segundo plano tras `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` (la app lo enciende), aviso sintético que despierta al padre. Agentes personalizados en `{agent,agents}/**/*.md` (`config/agent.ts:13`) con `steps` (`agent/agent.ts:54`). Integrados: `build`, `plan`, `general`, `explore`. |
| Skills | `skill/index.ts`: lee `SKILL.md` también desde `.claude/` (`CLAUDE_EXTERNAL_DIR`, línea 21). |
| Instrucciones | `session/instruction.ts:61-67`: `AGENTS.md`, también `CLAUDE.md` y `~/.claude/CLAUDE.md`; el primero a nivel proyecto gana. |
| Compactación | `session/compaction.ts`: automática por desborde, poda de salidas viejas de herramientas (`prune`), continuación automática. |
| Instantáneas y reversión | `snapshot/index.ts` (git propio, poda a 7 días) y `session/revert.ts`. |
| Worktrees | `worktree/index.ts` y rutas `/experimental/worktree`; **no** hay herramienta para que el modelo entre o salga de un worktree. |
| Sesión: continuar/bifurcar | `cli/cmd/run.ts`: `--continue`, `--session`, `--fork`. |
| MCP | `mcp/` con OAuth; el cliente tiene la capacidad `elicitation` comentada (`mcp/index.ts:44`): **sin formularios MCP**. |
| Formateo y LSP | `format/`, `lsp/` (herramienta LSP solo experimental). |
| Sin lo siguiente (no hay código) | sandbox propio del motor (lo da la app), protección de rutas sensibles en edit/write/apply_patch (sin coincidencias de `.git`/protegido en esas herramientas), búsqueda diferida de herramientas, programación de tareas (cron), memoria automática, auto-revisión de permisos. |

## 2. Qué tienen los otros, función por función

Leyenda: Sí = verificado en la fuente citada. Parcial = hay algo pero distinto. No ver. = no verificado.

### 2.1 Seguridad: sandbox, permisos y modos

| Función | Claude Code | Codex | OpenCode 2.x | Motor Lazunox hoy | Brecha |
|---|---|---|---|---|---|
| Sandbox del sistema operativo | Sí, apagado por defecto: Seatbelt en macOS, bubblewrap en Linux/WSL2; en Windows nativo no hay (https://code.claude.com/docs/en/sandboxing) | Sí: Seatbelt en macOS, `bwrap`+`seccomp` en Linux, MXC en Windows (https://learn.chatgpt.com/docs/security redirige a la guía de aprobaciones: https://learn.chatgpt.com/docs/agent-approvals-security) | No ver. | No lo hace el motor; la app lo aplica por sesión | Pequeña para el usuario, pero el motor depende 100 % de la app para esto. |
| Red con lista de dominios | Sí, proxy local con `allowedDomains`/`deniedDomains` (https://code.claude.com/docs/en/sandboxing) | Sí, función `network_proxy` con reglas de dominio; la red está apagada por defecto en `workspace-write` (https://learn.chatgpt.com/docs/agent-approvals-security) | No ver. | No | **Grande.** Hoy el shell dentro de la app sale a internet según el sandbox. |
| Rutas protegidas dentro de la carpeta de trabajo | Sí: `.claude/settings`, `.mcp.json`, hooks y archivos de arranque del shell (https://code.claude.com/docs/en/sandboxing) | Sí: `.git`, `.agents`, `.codex`, `.aws` solo lectura (https://learn.chatgpt.com/docs/agent-approvals-security) | No ver. | No en las herramientas de edición | **Media-grande.** Un modelo engañado puede reescribir `.git/hooks` o su propia configuración. |
| Modo de aprobación automática con revisor | Sí, `auto`: un clasificador revisa cada acción; pausa tras 3 bloqueos seguidos o 20 en total (https://code.claude.com/docs/en/permission-modes) | Sí, `approvals_reviewer = auto_review` y políticas `on-request`, `never`, `granular` (https://learn.chatgpt.com/docs/agent-approvals-security) | No ver. | No (la app tiene su propio modo automático en `src/main/tasks/auto-mode.ts`) | Media; hoy vive en la app. |
| Permisos «siempre» persistentes y editables | Sí, reglas en `settings` y «don't ask again» guardado (https://code.claude.com/docs/en/worktrees) | Parcial (reglas de ejecución; no ver. el detalle) | Sí: 2.0.28 «per-project auto-accept permissions» y 2.1.0 «editable saved permissions» (https://raw.githubusercontent.com/anomalyco/opencode/dev/CHANGELOG.md) | No: en memoria, se pierde al reiniciar | Media. |
| Modo plan | Sí, `plan` (https://code.claude.com/docs/en/permission-modes) | No ver. | No ver. | Parcial: herramienta `plan` solo con bandera y cliente `cli`; la puerta del plan es de la app | Cubierto por la app. |
| Modos `dontAsk` / `bypass` (CI) | Sí (https://code.claude.com/docs/en/permission-modes) | Sí: `never` y `--yolo` (https://learn.chatgpt.com/docs/agent-approvals-security) | No ver. | La app decide | Sin brecha relevante. |

### 2.2 Ganchos y extensibilidad

| Función | Claude Code | Codex | OpenCode 2.x | Motor hoy | Brecha |
|---|---|---|---|---|---|
| Ganchos configurables por el usuario (comando, HTTP, MCP) | Sí: 33 eventos y 5 tipos (`command`, `http`, `mcp_tool`, `prompt`, `agent`); `PreToolUse` puede permitir, denegar o reescribir la entrada; `onFailure: "block"` (https://code.claude.com/docs/en/hooks) | Sí: 12 eventos listados; solo `command` y `mcp_tool` corren; los ganchos no administrados deben revisarse y confiarse antes (https://learn.chatgpt.com/docs/hooks) | Sí, pero como plugins de código: `ctx.tool.hook("execute.before")`, `shell.create.before`, `permission.evaluate` (`docs/ANALISIS-OPENCODE-2-FUNCIONES.md` §2) | Solo plugins JS; sin ganchos por comando en configuración | **Grande.** Es lo que más usan los usuarios avanzados para bloquear y automatizar. |
| Skills | Sí: `SKILL.md`, carga progresiva, `context: fork`, `allowed-tools`, ganchos propios (https://code.claude.com/docs/en/skills) | No verificado (la aprobación de «scripts de skills» aparece en la política `granular`, https://learn.chatgpt.com/docs/agent-approvals-security, lo que sugiere que existen) | Sí (herramienta de skills; no ver. detalle) | Sí, herramienta `skill` y lectura de `.claude/` | Pequeña: faltan `allowed-tools`, `context: fork` y ganchos por skill. |
| Subagentes personalizados | Sí: archivos `.md` con `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `memory`, `isolation: worktree`, ganchos (https://code.claude.com/docs/en/sub-agents) | Sí: TOML en `.codex/agents/`, no pueden cambiar sandbox ni aprobaciones, que heredan (https://learn.chatgpt.com/docs/agent-configuration/subagents) | Sí (profundidad configurable, `v2` `subagent.ts`) | Sí, `.md` con `steps` y permisos | Media: faltan aislamiento por worktree, memoria por agente y tope de simultáneos. |
| Límite de simultáneos y herencia de sandbox | 20 por defecto (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`), profundidad 3 (https://code.claude.com/docs/en/sub-agents) | `max_concurrent_threads_per_session`; los subagentes heredan sandbox y aprobaciones (https://learn.chatgpt.com/docs/agent-configuration/subagents) | Profundidad 1 por defecto | Solo profundidad; **sin tope de simultáneos** (señalado en `ANALISIS-OPENCODE-2-FUNCIONES.md` §4) | Media (gasto y seguridad). |
| Plugins y paquetes | Sí (plugins, mods) | No ver. | Sí | Sí (plugins JS) | Sin brecha. |
| Memoria de proyecto (`CLAUDE.md`/`AGENTS.md`) | Sí, jerarquía, `@imports`, `.claude/rules/` con `paths`, auto memory de 200 líneas / 25 KB (https://code.claude.com/docs/en/memory) | Sí: global + de la raíz a la carpeta actual, `AGENTS.override.md`, tope 32 KiB (https://learn.chatgpt.com/docs/agent-configuration/agents-md) | Sí, 2.0.30 añade globs y URL en instrucciones | Sí `AGENTS.md`/`CLAUDE.md`; sin reglas por ruta ni auto memory | Cubierto por la app (memoria). |

### 2.3 Contexto, sesiones y segundo plano

| Función | Claude Code | Codex | OpenCode 2.x | Motor hoy | Brecha |
|---|---|---|---|---|---|
| Compactación | Automática y manual con foco; reinyecta CLAUDE.md, plan y habilidades; ganchos `PreCompact`/`PostCompact`; «summarize from here» (https://code.claude.com/docs/en/context-window) | Ganchos `PreCompact`/`PostCompact` con `trigger` manual/auto (https://learn.chatgpt.com/docs/hooks) | 2.1.4 añade compactación en segundo plano experimental (changelog) | Automática + poda de salidas; sin resumen parcial ni ganchos de usuario | Media. |
| Puntos de control / rewind | Sí, hasta 100 por sesión, restaura código y/o conversación; no sigue cambios de bash ni de subagentes (https://code.claude.com/docs/en/checkpointing) | No ver. | 2.0.30 «per-turn changed-files view» y `/diff` (changelog) | Hay `snapshot` y `revert`; la app tiene sus puntos de restauración | Cubierto por la app. |
| Worktrees para sesiones y subagentes | Sí: `--worktree`, `isolation: worktree`, `EnterWorktree`, bloqueos de aislamiento (https://code.claude.com/docs/en/worktrees) | No ver. | 2.0.27 «built-in worktree tools for Code Mode» (changelog) | Servicio y rutas, sin herramienta para el modelo | Media. |
| Comandos largos en segundo plano | Sí, y `Monitor` que devuelve cada línea de salida al modelo; `TaskStop` (https://code.claude.com/docs/en/tools-reference) | «Background terminals»: **no verificado** (la página de la CLI no los menciona) | 2.1.0 terminales persistentes en Windows (changelog) | Sí en Mac/Linux/WSL; **no en Windows nativo** | Media (Windows). |
| Subagentes en segundo plano | Sí, Ctrl+B, aviso al terminar (https://code.claude.com/docs/en/sub-agents) | Subagentes en paralelo; el panel web es de solo lectura (https://learn.chatgpt.com/docs/agent-configuration/subagents) | Sí | Sí, encendido por la app | Sin brecha. |
| Reanudar tras reinicio | Sí, `--resume`/`--continue`/`--fork-session` (https://code.claude.com/docs/en/headless) | `codex resume` (https://learn.chatgpt.com/docs/codex/cli); fork: no verificado en esa página | 2.x reanuda hijos con presupuesto de 10 intentos (`restart.ts`, según nuestro análisis) | Sesiones sí; trabajos de fondo se pierden al reiniciar | Media-pequeña. |
| Tareas programadas | `CronCreate`/`/loop` en sesión y rutinas en la nube (https://code.claude.com/docs/en/tools-reference) | `codex cloud` para tareas en la nube (https://learn.chatgpt.com/docs/codex/cli) | No ver. | No | Media; hay que hacerlo local. |
| Revisión de código | `/code-review` y herramienta `ReportFindings` | `/review` sobre cambios, commit o rama, sin tocar el árbol (https://learn.chatgpt.com/docs/codex/cli) | `review.txt` en comandos | `command/template/review.txt` existe | Pequeña. |

### 2.4 Herramientas y modelo

| Función | Claude Code | Codex | OpenCode 2.x | Motor hoy | Brecha |
|---|---|---|---|---|---|
| Búsqueda web | `WebSearch` y `WebFetch` | Modos `cached` (por defecto), `live`, `indexed`, `disabled` (https://learn.chatgpt.com/docs/agent-approvals-security) | Sí | Sí, pero depende del proveedor (Exa/Parallel/proxy de Lazunox); **es un servicio de terceros** | Revisar costo/privacidad. |
| `apply_patch` | `Edit`/`Write` | Sí, parche con ruta de ejecución sandboxeada (búsqueda web, fuente de terceros) | Sí | Sí, solo para modelos `gpt-*` | Sin brecha. |
| Entrada de imagen | Sí | `--image` y pegar (https://learn.chatgpt.com/docs/codex/cli) | Sí | Sí vía `read` | Sin brecha. |
| Salida estructurada y modo sin interfaz | `-p`, `--output-format json/stream-json`, `--json-schema`, `--max-budget-usd` (https://code.claude.com/docs/en/headless) | `codex exec` (https://learn.chatgpt.com/docs/codex/cli) | SDK y `serve` | `run` y `serve` existen; esquema JSON: no verificado | Poco valor para el usuario de la app. |
| LSP | Herramienta `LSP` | No ver. | Sí | Existe, **solo experimental** | Pequeña: encenderla probada. |
| Búsqueda diferida de herramientas (menos contexto con muchos MCP) | `ToolSearch` (https://code.claude.com/docs/en/tools-reference) | No ver. | No ver. | No | Media si el usuario conecta varios MCP. |
| Formularios MCP (elicitation) | Sí, ganchos `Elicitation` (https://code.claude.com/docs/en/hooks) | Parcial (`granular` incluye prompts MCP) | 2.1.4 «MCP input forms» (changelog) | Comentado en `mcp/index.ts:44` | Pequeña-media. |
| Memorias entre sesiones | Auto memory (https://code.claude.com/docs/en/memory) | Sí, `[memories]` según un artículo de terceros (https://mem0.ai/library/coding-agents/how-memory-works-in-codex-cli); oficial: no verificado | No ver. | No en el motor; la app tiene memoria | Cubierto por la app. |
| Notificaciones al usuario | `PushNotification`, `Notification` hook | No ver. | Acceso remoto y PWA | La app | Cubierto por la app. |

## 3. Dónde el motor ya está al nivel o por delante

- **Pausa y espera en Code Mode** (`execute`/`execute_wait`): combina lo mejor de Codex (pausar en vez de matar) con límites por defecto que ni OpenCode 1.19 ni 2.x fijan (`LAZUNOX.md`, §Code Mode).
- **Cero conexiones a servicios de OpenCode** y prueba automática que lo vigila (`test/lazunox/sin-red-de-opencode.test.ts`). Ni Claude Code ni Codex ofrecen una garantía equivalente sobre su propio origen.
- **Shell en segundo plano con topes** (30 min, 3 por sesión, 6 en el motor): 2.x no pone tiempo máximo en segundo plano.
- **Gancho `permission.ask` realmente disparado**: en OpenCode 1.19 estaba tipado y nunca se llamaba.
- **Sin APIs de pago obligatorias y modelos gratuitos**: ni Claude Code ni Codex funcionan sin cuenta de pago o suscripción (no verificado en detalle; es el modelo de negocio declarado de ambos). Para un proyecto sin fines de lucro esto es una ventaja real, pero es del producto, no del motor.

Para «superar» a los tres hay que ser honestos: en **seguridad en profundidad** (ganchos de bloqueo, rutas protegidas, red con lista de dominios, aprobación revisada) Claude Code y Codex están por delante del motor hoy. Donde se puede superar es en lo **local, gratis y en español**, y en que los límites sean seguros por defecto.

## 4. Tabla priorizada

Esfuerzo: S ≤ 1 semana, M 1-3 semanas, L > 3 semanas. Riesgo = riesgo de seguridad **de implementar** la función (no de no tenerla). Valor = para un usuario hispanohablante que usa la app a diario.

| # | Función | Quién la tiene | Esfuerzo | Riesgo de seguridad | Valor |
|---|---|---|---|---|---|
| 1 | Rutas protegidas en `edit`/`write`/`apply_patch`/shell (`.git`, `.opencode`, `.claude`, `.mcp.json`, archivos de arranque del shell: solo lectura salvo permiso explícito) | Claude Code, Codex | S | Bajo (solo restringe) | Alto: evita que un texto malicioso reescriba su propia configuración |
| 2 | Ganchos de usuario por comando en la configuración (`PreToolUse`, `PostToolUse`, `Stop`, `PermissionRequest`), con confianza previa de la carpeta y `onFailure: block` | Claude Code, Codex | M | Medio (ejecuta comandos; exigir revisión como Codex) | Alto |
| 3 | Límite de subagentes simultáneos y herencia estricta de permisos/sandbox del padre | Claude Code, Codex | S | Bajo | Alto (gasto y seguridad) |
| 4 | Permisos «siempre» persistentes por proyecto, revocables, nunca para acciones peligrosas | OpenCode 2.x, Claude Code | S-M | Medio (un «siempre» mal dado dura para siempre) | Alto |
| 5 | Red con lista de dominios para el shell (proxy local; lo no listado se pide o se niega) | Claude Code, Codex | L | Bajo (restringe), pero difícil de acertar en Windows | Alto |
| 6 | Shell en segundo plano en Windows nativo | Claude Code (PowerShell), OpenCode 2.1 | M | Medio (procesos huérfanos) | Alto si la mayoría usa Windows |
| 7 | Compactación mejor: resumen parcial («desde aquí»), reinyectar plan y habilidades, ganchos Pre/PostCompact | Claude Code, Codex, OpenCode 2.1.4 | M | Bajo | Medio-alto (sesiones largas) |
| 8 | Subagentes con `isolation: worktree`, herramienta de worktree para el modelo y `tools`/`disallowedTools` por agente | Claude Code | M | Medio | Medio |
| 9 | Tareas programadas locales (cron/`/loop`) dentro del motor, sin nube | Claude Code | M | Medio (corre sin supervisión; pasar por la puerta del plan) | Medio |
| 10 | Auto-revisión de permisos con modelo gratuito/local, con retroceso a preguntar (3 bloqueos seguidos o 20 en total, como Claude) | Claude Code, Codex | M-L | **Alto** (un revisor débil aprueba mal; empezar solo-sugerir) | Medio-alto |

Siguientes (no entran en el top 10): búsqueda diferida de herramientas (`ToolSearch`), formularios MCP (elicitation), `Monitor` (líneas de salida al modelo; canal de inyección, exigir marcar como no confiable), `LSP` estable, diff por turno (la app ya lo cubre con sus puntos de restauración), memoria automática (cubierta por la app), modo `--json-schema` y presupuesto máximo para el modo sin interfaz.

### Las 10 recomendadas, en orden

1. Rutas protegidas en las herramientas de edición y el shell.
2. Ganchos de usuario por comando con confianza previa.
3. Tope de subagentes simultáneos y herencia de permisos.
4. Permisos «siempre» persistentes y revocables.
5. Red con lista de dominios para el shell.
6. Shell en segundo plano en Windows nativo.
7. Compactación parcial, con reinyección y ganchos.
8. Aislamiento por worktree y herramientas por agente.
9. Tareas programadas locales.
10. Auto-revisión de permisos con modelo gratuito (primero en modo «solo sugerir»).

Criterio del orden: primero lo que **reduce riesgo con poco esfuerzo** (1, 3), luego lo que más piden los usuarios avanzados y cierra la mayor brecha frente a Claude Code y Codex (2, 4, 5), luego la paridad en Windows (6), y al final lo que añade capacidad con más superficie de riesgo (7-10). Todas respetan las restricciones del proyecto: nada de APIs de pago, todo local o gratis, y la seguridad antes que la comodidad.

## 5. Límites de esta comparativa

- No leí el código fuente de Claude Code (es cerrado) ni de Codex; solo su documentación. Que la documentación sea completa y esté al día no está garantizado: varias páginas se truncaron al ser muy largas (ganchos, modos de permisos, sandbox, subagentes, habilidades: leí unos 100 000 caracteres de cada una).
- Para OpenCode 2.x usé el `CHANGELOG.md` de su rama de desarrollo (2.0.26 a 2.1.4, hasta el 2026-10-23) y mi análisis previo del código en `docs/ANALISIS-OPENCODE-2-FUNCIONES.md`. La página de «releases» de GitHub solo mostraba la serie 1.x (última v1.19.4), por lo que no la usé para 2.x.
- Codex: no pude verificar «background terminals», bifurcar sesiones, memorias ni la fase de madurez de sus funciones en la documentación oficial. Lo único sobre memorias es un artículo de terceros, y el dato de `apply_patch` viene de espejos de commits de terceros: ambos son orientativos.
- No se ejecutó nada ni se probó nada en el motor; las afirmaciones sobre el fork son de lectura de código y pueden cambiar con cada versión `lazunox.N`.
- Esfuerzo y valor son estimaciones mías, no mediciones.
