# Plan maestro: el motor de Lazunox a la par de Claude Code, Codex y OpenCode 2.x

Fecha: 2026-10-26. Solo lectura + web; no se tocó código ni git. Motor: fork 1.19.0 en `/Users/ben/Documents/lzx-wt/integracion` (rama `feat/ola1` = `main` publicado, `lazunox.9`),
más las ramas en curso `feat/rebobinar` (`lzx-wt/r1-rebobinar`) y `feat/compactar-mejor` (`lzx-wt/c2-compactar`). Rutas del motor relativas a `packages/opencode/src/` salvo aviso.
Planes que este documento NO repite: `docs/PLAN-REBOBINAR-Y-COMPACTACION.md`, `docs/PLAN-HERRAMIENTAS-DIFERIDAS-Y-FORMULARIOS-MCP.md`. Marco: `docs/PLAN-MOTOR-PROPIO.md`.
Reglas: sin fines de lucro (nada de APIs de pago), seguridad primero (permisos, sandbox de la app, zonas intocables), lo pesado al VPS (`ssh -i ~/.ssh/lazunox_deploy_ed25519 root@72.60.55.136`).

**Abreviaturas de fuentes** (toda URL citada es prefijo + ruta):
`CC/` = https://code.claude.com/docs/en/ · `CX/` = https://learn.chatgpt.com/docs/ (destino del 308 de developers.openai.com/codex) · `GH/` = https://github.com/openai/codex/blob/main/ ·
`OC/` = https://opencode.ai/v2/docs/ · `OCL` = https://raw.githubusercontent.com/anomalyco/opencode/dev/CHANGELOG.md · `OCC` = https://opencode.ai/changelog.
Lo leído en la web lo leyeron tres sub-investigaciones el 2026-10-26; páginas largas salieron truncadas (p. ej. `CC/hooks`). «no ver.» = no verificado.

## 0. Resumen

- El motor ya está **a la par o por delante** en: Code Mode con pausa/espera, búsqueda diferida MCP, formularios MCP, shell de fondo con topes (también Windows), rutas protegidas,
  permisos «siempre» persistentes, tope de ayudantes, ganchos por comando, cero conexiones a OpenCode. Rebobinar y compactación mejor están en ramas.
- La brecha grande es de **orquestación**: no hay modo objetivo, ni plan con verificación por paso, ni espera/consulta de varios ayudantes, ni modelo barato automático
  para ayudantes de lectura, ni topes al resultado de un ayudante, y la poda de salidas viejas está **apagada**. Eso es lo que más gasta tokens y lo que peor llevan los modelos gratuitos.
- Propuesta: **5 olas** (más la ola 0 ya en curso), 4-5 tareas Sonnet en paralelo cada una + verificación con modelo real + revisión de seguridad. Antes de la ola 1 se monta el **banco de tareas** (§5) para medir.

## 1. Auditoría verificada

### 1.1 Lazunox hoy (leído en el código de `feat/ola1`)

| Pieza                                   | Evidencia                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subagentes definidos por el usuario     | Esquema `core/src/v1/config/agent.ts:14-38`: `model`, `variant`, `prompt`, `tools` (obsoleto → permisos), `permission`, `steps` (= máx. turnos), `mode`, `hidden`. Se leen de `{agent,agents}/**/*.md` (`config/agent.ts:12-30`). Se aplican en `agent/agent.ts:270-294`. **Faltan** `disallowed_tools` explícito, `background`, `skills`, `memory`, lectura de `.claude/agents/` |
| Modelo del ayudante                     | `tool/task.ts:200-205`: el del agente o **hereda el del padre**. `Provider.getSmallModel` existe (`provider/provider.ts:1961`) pero solo se usa para títulos (`session/prompt.ts:226`)                                                                                                                                                                                            |
| Topes de ayudantes                      | Simultáneos `LAZUNOX_MAX_SUBAGENTS`=8 (`tool/task.ts:26-28,109-113`); profundidad `subagent_depth`=1 (`:125-133`)                                                                                                                                                                                                                                                                 |
| Resultado del ayudante                  | Solo el último texto (`tool/task.ts:243`) envuelto en `<task … state>` (`:75-77`): **sin tope de tamaño y sin marca de «no confiable»**                                                                                                                                                                                                                                           |
| Máx. pasos                              | `agent.steps` → `MAX_STEPS_PROMPT` en el último (`session/prompt.ts:1184-1185,1288`)                                                                                                                                                                                                                                                                                              |
| Plan                                    | Agente `plan` sin edición (`agent/agent.ts:157-181`); herramienta `plan` solo con `OPENCODE_EXPERIMENTAL_PLAN_MODE` **y cliente `cli`** (`tool/registry.ts:254`): la app no la recibe                                                                                                                                                                                             |
| Lista de tareas                         | `todowrite` (`tool/todo.ts`, `session/todo.ts:11-17`); `general` la tiene denegada (`agent/agent.ts:189`). Reinyección tras compactar: rama `c2` (`<contexto-vigente>`)                                                                                                                                                                                                           |
| LSP                                     | `tool/lsp.ts`, solo con `OPENCODE_EXPERIMENTAL_LSP_TOOL` (`tool/registry.ts:253`); descarga de servidores apagada (`LAZUNOX.md` §Conexiones)                                                                                                                                                                                                                                      |
| Caché del prompt                        | Marcas en 2 mensajes de sistema + 2 últimos (`provider/transform.ts:357-390`); `promptCacheKey = sessionID` (`:1325,:1334,:1381`). Sistema = entorno (con fecha) + instrucciones + MCP + skills (`session/prompt.ts:1264-1276`, `session/system.ts:76-83`). Herramientas ordenadas (`session/tools.ts:166,249`)                                                                   |
| Truncado de salidas                     | Global 2000 líneas / 50 KB (`tool/truncate.ts:14-15`); `webfetch` hasta 5 MB (`tool/webfetch.ts:9`); sin tope por herramienta MCP ni en tokens                                                                                                                                                                                                                                    |
| Poda de salidas viejas                  | Existe (`session/compaction.ts:29-34,275-317`) pero **solo si `compaction.prune`** (`:277`); la app no la enciende (sin coincidencias en `src/main`)                                                                                                                                                                                                                              |
| Skills                                  | Frontmatter solo `name`/`description` (`skill/index.ts:53-57`); lista en el sistema (`:322-344`). Sin `allowed-tools`, `context: fork`, `model`, `paths`                                                                                                                                                                                                                          |
| Ganchos de usuario                      | `PreToolUse`, `PostToolUse`, `PreCompact`, `Stop` (`plugin/lazunox-ganchos.ts:14`); `PostCompact` en rama `c2`. `Stop` solo informa (`:126-131`)                                                                                                                                                                                                                                  |
| Headless                                | `run --format json` (`cli/cmd/run.ts:174-178`) emite `step_finish` con tokens (`:750`); salida estructurada interna `json_schema` (`session/prompt.ts:1278`) sin bandera en `run`                                                                                                                                                                                                 |
| Trabajos tras reinicio                  | Lápidas `<id>.perdido.json` para shells y celdas (`tool/shell/trabajos-disco.ts:44,176-198`, `tool/trabajos.ts`); ayudantes de fondo: no ver.                                                                                                                                                                                                                                     |
| Revisión                                | Plantilla `command/template/review.txt` (sin rúbrica ni salida estructurada)                                                                                                                                                                                                                                                                                                      |
| Programación / objetivo / auto-revisión | **No hay** en el motor. La app tiene Rutinas (`src/main/scheduler/`) y Modo auto **solo por reglas** (`src/main/tasks/auto-mode.ts:9`, decisión 2026-09-28)                                                                                                                                                                                                                       |

### 1.2 Los otros (web, 2026-10-26)

| Tema                       | Claude Code                                                                                                                                                                                                                | Codex CLI (0.164, 2026-10-23)                                                                                                                                                                                             | OpenCode 2.x (≤2.1.4)                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Subagentes definidos       | `.md` con `tools`, `disallowedTools`, `model` (`haiku`/`inherit`/ID), `permissionMode`, `maxTurns` (salida parcial reanudable), `memory`, `isolation: worktree`, `skills`, `hooks`, `background`, `effort` (CC/sub-agents) | TOML en `.codex/agents/`: `developer_instructions`, `model`, `model_reasoning_effort`, apagar herramientas; **no** pueden cambiar sandbox ni aprobaciones (CX/agent-configuration/subagents)                              | Modelo por agente `provider/model#variant`, hereda si falta (OC/agents)                            |
| Topes                      | 20 simultáneos, profundidad 3 (CC/sub-agents)                                                                                                                                                                              | `max_concurrent_threads_per_session`; código: 6 hilos, profundidad 1 (GH/codex-rs/core/src/config/mod.rs)                                                                                                                 | `experimental.subagent_depth`=1 (OC/config)                                                        |
| Qué devuelve el ayudante   | Solo el informe final, con cabecera de subagente y **escaneado** antes de leerlo; reanudable con `SendMessage` (CC/sub-agents)                                                                                             | `wait_agent`, `list_agents`, `close_agent`, `send_message`, `resume_agent` (GH/codex-rs/core/src/tools/handlers/multi_agents_spec.rs)                                                                                     | `subagent` con `background`, continuar por `sessionID` (OC/tools)                                  |
| Modelo barato              | `model: haiku` para subagentes simples; Explore de solo lectura (CC/costs, CC/sub-agents)                                                                                                                                  | Campo `model` por agente; recomendación oficial de «mini»: no ver.                                                                                                                                                        | Títulos con la variante más barata (OCL 2.1.3)                                                     |
| Plan                       | Modo `plan` + `EnterPlanMode`/`ExitPlanMode`, aprobar → auto o manual (CC/permission-modes, CC/tools-reference)                                                                                                            | `update_plan {step,status}` con 1 `in_progress`; `/plan` (GH/codex-rs/core/src/tools/handlers/plan_spec.rs)                                                                                                               | Agente `plan`, sin novedades en 2.x (OCC)                                                          |
| Objetivo / bucle           | `/goal <condición>`: modelo pequeño evalúa tras cada turno (cumplida/no/imposible), para si no usa herramientas, 3 reintentos; `/loop` con `ScheduleWakeup` (CC/goal, CC/scheduled-tasks)                                  | `/goal` estable: plantilla de continuación con **auditoría de evidencia por requisito**, `blocked` tras 3 turnos iguales, presupuesto de tokens → `budget_limited` (GH/codex-rs/ext/goal/templates/goals/continuation.md) | No oficial (plugins de terceros)                                                                   |
| Descomposición             | `/batch` 5-30 unidades en paralelo; Workflows (`agent/pipeline/parallel`); equipos de agentes **experimental**, ~7× tokens (CC/commands, CC/workflows, CC/agent-teams)                                                     | `spawn_agent` + `wait_agent` (GH/…/multi_agents_spec.rs)                                                                                                                                                                  | Comandos con `subagent: true` (OC/commands)                                                        |
| Compactación               | Reinyecta CLAUDE.md, plan, skills (5k c/u, 25k total), 5 archivos recientes (CC/context-window)                                                                                                                            | 90 % de la ventana; en segundo plano desde 0.164 (GH/codex-rs/protocol/src/openai_models.rs, CX/changelog)                                                                                                                | Resumen con lo reciente literal y caché estable (OCL 2.1.0); en segundo plano opcional (OCL 2.1.4) |
| Caché / tokens             | Prefijo exacto; se rompe al cambiar modelo, herramientas MCP sin búsqueda, o al compactar (CC/prompt-caching); Bash 30k caracteres, MCP 25k tokens (CC/tools-reference, CC/mcp)                                            | `tool_output_token_limit`, `output_token_limit` por MCP (CX/config-file/config-reference); orden estable de herramientas (CX/changelog 0.162)                                                                             | `compatibility.cacheFormat` (OCC 2.0.28); grep/glob 100 resultados (OC/tools)                      |
| Continuar al cortar salida | no ver.                                                                                                                                                                                                                    | no ver.                                                                                                                                                                                                                   | Sí, con reintentos acotados (OCC 2.0.29)                                                           |
| Skills                     | Carga progresiva (1536 car. en la lista), `allowed-tools`, `disallowed-tools`, `model`, `context: fork`, `paths`, `disable-model-invocation` (CC/skills)                                                                   | Lista ≤ 2 % del contexto, cuerpo al usar (CX/build-skills)                                                                                                                                                                | Sí; detalle no ver.                                                                                |
| Ganchos                    | 33 eventos; `Stop` con `decision:block` = **seguir trabajando**; `updatedInput` (CC/hooks)                                                                                                                                 | 12 eventos, `Stop`/`SubagentStop` block = seguir; hay que aprobarlos (CX/hooks)                                                                                                                                           | Plugins de código                                                                                  |
| Auto-revisión              | Modo `auto`: clasificador **sin resultados de herramientas**, pausa tras 3 bloqueos seguidos o 20 en total (CC/permission-modes)                                                                                           | `auto_review`: solo lo que ya pedía aprobación, falla cerrado (CX/agent-approvals-security)                                                                                                                               | No                                                                                                 |
| Revisión de código         | `/code-review` en subagente de fondo (CC/code-review-local)                                                                                                                                                                | `/review` sin tocar el árbol; rúbrica P0-P3, JSON `findings[]` (GH/codex-rs/prompts/templates/review/rubric.md)                                                                                                           | Plantilla                                                                                          |
| Headless                   | `-p --output-format json/stream-json --json-schema --max-budget-usd` (CC/headless)                                                                                                                                         | `exec --json --output-schema`, `exec resume` (CX/non-interactive-mode)                                                                                                                                                    | `run --format json` NDJSON (OC/cli/commands)                                                       |
| LSP                        | Herramienta con plugin; errores tras cada edición (CC/tools-reference)                                                                                                                                                     | no ver.                                                                                                                                                                                                                   | **Eliminado** en 2.0 (OC/migrate-v1)                                                               |
| Monitor                    | `Monitor`: cada línea de salida como evento (CC/tools-reference)                                                                                                                                                           | `/ps`, `/stop`, `exec_command yield_time_ms` (GH/…/shell_spec.rs)                                                                                                                                                         | Ctrl+B a fondo                                                                                     |
| Programación               | Cron en sesión (50, caducan a 7 días) + rutinas en nube (CC/scheduled-tasks)                                                                                                                                               | No local                                                                                                                                                                                                                  | No                                                                                                 |

## 2. Orquestación: cómo lo hacen y cómo lo haría Lazunox (local, gratis, modelos débiles)

Principio para modelos gratuitos: **pasos pequeños con prueba objetiva**. Un modelo débil se equivoca más al decidir «ya terminé» que al hacer un paso concreto;
por eso el término lo decide primero una **comprobación determinista** (comando, prueba, archivo existe) y solo después, si no la hay, un juez de modelo.
Esto es lo que nos deja **superar** a `/goal` de Claude (juez solo por modelo, sin herramientas) con modelos más débiles.

**(a) Plan y descomposición.** Claude: modo plan + `/batch`/Workflows; Codex: `update_plan` + `spawn_agent`/`wait_agent`. Lazunox:

1. `plan` para la app (P08): el agente planifica sin editar y guarda `.opencode/plans/<sesión>.md`; aprobar cambia a `build` con el plan inyectado.
2. **Plan ejecutable** (P09): `todowrite` gana `verificar` (comando o criterio) y estado `bloqueado`; máx. 1 `en_curso` (como Codex). El motor rechaza `completado` si `verificar` es comando y falla.
3. **Lote** (P12): comando `/lote` que pide al modelo N unidades independientes (≤ 8, el tope de ayudantes), lanza ayudantes de fondo y espera con `task_wait` (P13). Las unidades no comparten archivos (lo comprueba la instrucción y, después, el diff por turno de rebobinar).

**(b) Bucles largos.** Modo objetivo (P10) = `{ condición, verificar?: comando, presupuesto: { turnos, tokens, minutos } }`. Tras cada turno: (1) si hay `verificar`, se corre en el sandbox
de la sesión y su código decide; (2) si no, juez con el modelo pequeño leyendo solo los mensajes de la persona y del asistente (**sin** resultados de herramientas, como el clasificador de Claude, para que lo leído no lo manipule);
(3) continúa con una plantilla al estilo de Codex (evidencia por requisito) si no cumple; (4) para con `bloqueado` tras 3 turnos sin progreso (sin cambios de archivos ni de plan), al agotar el presupuesto, o a la primera petición de permiso sin respuesta.
Nunca aprueba permisos: un objetivo **no** convierte «preguntar» en «permitir». Se apoya en el gancho `Stop` con `block` (P20).

**(c) Ahorro de tokens**, por orden de rendimiento esperado (se mide con §5):

1. Poda de salidas viejas encendida (P03).
2. Tope al resultado del ayudante (P05: 4 KB por defecto, el resto en archivo).
3. Ayudantes de lectura con el modelo pequeño (P07).
4. No releer archivos sin cambios (P22).
5. Topes por herramienta y por MCP en tokens (P04).
6. Prefijo estable para la caché (P02).
7. Búsqueda diferida de herramientas: ya hecha.
8. Lista de skills con presupuesto (P15).
   Con proveedores gratuitos que no informan caché, lo que cuenta son 1-5.

**(d) Coherencia entre pasos.** Ya hay o viene: lista de tareas reinyectada al compactar (rama `c2`), AGENTS.md de subcarpetas reinyectado (rama `c2`), lápidas de trabajos.
Falta: el plan con `verificar` reinyectado igual, la condición del objetivo dentro del bloque `<contexto-vigente>` y los ayudantes vivos con su id para `task_wait`.
La memoria entre sesiones sigue siendo de la app.

## 3. Paquetes de trabajo

Esfuerzo: S ≤ 3 días, M ≤ 2 semanas, L más. Riesgo = riesgo de seguridad **de implementarlo**. Valor = para quien usa la app a diario (A alto, M medio, B bajo).

| #   | Paquete                                                                                                                                                                                                                           | Quién lo tiene                                                       | Lazunox hoy                                                                                                                 | Esf | Riesgo                              | Valor             | Dep               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------- | ----------------- | ----------------- |
| P01 | Banco de tareas y métricas (§5)                                                                                                                                                                                                   | — (propio)                                                           | `scripts/engine-probe/medir-herramientas.mjs` solo mide herramientas con modelo falso                                       | M   | Bajo                                | A (habilita todo) | —                 |
| P02 | Prefijo estable para la caché: fecha y entorno al final del sistema, marcas en partes estables, prueba de bytes idénticos entre pasos                                                                                             | CC/prompt-caching, CX/changelog 0.162                                | `session/prompt.ts:1270-1275`, `provider/transform.ts:357-390`                                                              | S   | Bajo                                | M                 | P01               |
| P03 | Poda de salidas viejas **encendida por defecto** + recorte previo si el resumen no cabe                                                                                                                                           | OCL 2.1.4                                                            | Apagada, `session/compaction.ts:277`                                                                                        | S   | Bajo                                | A                 | rama c2 fusionada |
| P04 | Topes por herramienta en tokens (shell 30k car., MCP 25k tokens, grep/glob 100) con el resto en archivo                                                                                                                           | CC/tools-reference, CC/mcp, CX/config-reference                      | Global 50 KB, `tool/truncate.ts:14-15`                                                                                      | S   | Bajo                                | A                 | —                 |
| P05 | Resultado de ayudante acotado y marcado «no confiable» (cabecera + resto en archivo legible)                                                                                                                                      | CC/sub-agents                                                        | Sin tope, `tool/task.ts:75-77,243`                                                                                          | S   | Bajo (cierra un canal de inyección) | A                 | —                 |
| P06 | Subagentes de usuario completos: `disallowed_tools`, `max_turns` (alias de `steps`, salida parcial marcada), `background`, `skills`, `model: small\|inherit\|id`; leer `.claude/agents/*.md`; **nunca** más permisos que el padre | CC/sub-agents, CX/agent-configuration/subagents                      | Parcial, `core/src/v1/config/agent.ts:14-38`, `agent/agent.ts:270-294`                                                      | M   | Medio                               | A                 | —                 |
| P07 | Modelo pequeño automático para ayudantes de solo lectura (`explore`, revisor, verificador)                                                                                                                                        | CC/costs, CC/sub-agents                                              | Hereda, `tool/task.ts:200-205`; `getSmallModel` sin usar aquí                                                               | S   | Bajo                                | A                 | P06               |
| P08 | Modo plan en el motor para la app (herramientas `plan_enter`/`plan_exit`, archivo de plan, aprobar → `build`)                                                                                                                     | CC/permission-modes                                                  | Solo CLI con bandera, `tool/registry.ts:254`                                                                                | M   | Medio (no debe abrir edición)       | A                 | —                 |
| P09 | Plan ejecutable: `todowrite` con `verificar` y `bloqueado`, máx. 1 en curso, `general` puede leerlo                                                                                                                               | GH/…/plan_spec.rs                                                    | `tool/todo.ts`; denegado a `general`, `agent/agent.ts:189`                                                                  | M   | Bajo                                | A                 | rama c2           |
| P10 | Modo objetivo con criterio de término (§2b)                                                                                                                                                                                       | CC/goal, GH/…/continuation.md                                        | No                                                                                                                          | M   | Medio (trabaja solo)                | A                 | P20, P35          |
| P11 | Continuar solo cuando la respuesta se corta por límite de salida (máx. 2 reintentos)                                                                                                                                              | OCC 2.0.29                                                           | no ver. (comprobar `finish: length` en `session/processor.ts`)                                                              | S   | Bajo                                | M                 | —                 |
| P12 | `/lote`: descomponer en unidades paralelas con verificación y resumen final                                                                                                                                                       | CC/commands (`/batch`), CC/workflows                                 | No                                                                                                                          | M   | Medio                               | M                 | P13, P09          |
| P13 | `task_wait` / `task_list` / `task_cancel` (esperar a varios, ver estado, cerrar)                                                                                                                                                  | GH/…/multi_agents_spec.rs, CC/sub-agents                             | Solo `extend` y aviso de fin, `tool/task.ts:286-337`                                                                        | S   | Bajo                                | A                 | —                 |
| P14 | Reanudar tras reinicio: lápida también para ayudantes de fondo + «Reanudar» (nuevo turno en la hija)                                                                                                                              | OC 2.x según `docs/ANALISIS-OPENCODE-2-FUNCIONES.md`                 | Shells y celdas sí (`tool/shell/trabajos-disco.ts`)                                                                         | S   | Bajo                                | M                 | —                 |
| P15 | Skills: `allowed-tools` **solo restringe**, `disallowed-tools`, `model`, `context: fork`, `paths`, `disable-model-invocation`, lista con presupuesto (≤ 2 % o 8 KB)                                                               | CC/skills, CX/build-skills                                           | `skill/index.ts:53-57`                                                                                                      | M   | Medio                               | M                 | P06               |
| P16 | LSP estable: diagnósticos tras `edit`/`write`, servidores solo locales (sin descarga salvo permiso), Windows                                                                                                                      | CC/tools-reference                                                   | Experimental, `tool/registry.ts:253`                                                                                        | M   | Medio (ejecuta binarios)            | M                 | —                 |
| P17 | Headless: `run --json-schema`, `--max-steps`, `--presupuesto-tokens`, `--permisos ninguno` (deniega en vez de preguntar)                                                                                                          | CC/headless, CX/non-interactive-mode                                 | `cli/cmd/run.ts:174-178`                                                                                                    | S   | Bajo                                | B (A para P01)    | —                 |
| P18 | Revisión de código: agente `revisor` de solo lectura, rúbrica P0-P3, JSON `findings[]`, sobre cambios/commit/rama sin tocar el árbol                                                                                              | GH/codex-rs/prompts/templates/review/rubric.md, CC/code-review-local | `command/template/review.txt`                                                                                               | S   | Bajo                                | A                 | P06, P07          |
| P19 | Auto-revisión de permisos en modo **«sugerir»**: el modelo pequeño propone permitir/negar con motivo; **nunca decide** (decisión 2026-09-28); sin resultados de herramientas en la entrada; falla cerrado                         | CC/permission-modes, CX/agent-approvals-security                     | No; gancho `permission.ask` cableado (`permission/index.ts:93`)                                                             | M   | **Alto**                            | M                 | P07               |
| P20 | Ganchos ampliados: `SessionStart`, `UserPromptSubmit`, `SubagentStop`, `Stop` con `block` = seguir (con tope), `updatedInput` en `PreToolUse`                                                                                     | CC/hooks, CX/hooks                                                   | 4 eventos, `plugin/lazunox-ganchos.ts:14`                                                                                   | M   | Medio                               | M                 | —                 |
| P21 | Agente `verificador`: solo lectura + shell, corre pruebas y devuelve PASA/FALLA con evidencia (≤ 2 KB)                                                                                                                            | CC/skills (`/verify`)                                                | No                                                                                                                          | S   | Bajo                                | A                 | P06, P07          |
| P22 | No releer: si `read` pide un archivo sin cambios (mtime+tamaño+hash) desde la última lectura completa del mismo turno o compactación, responde «sin cambios desde la lectura N»                                                   | — (propio)                                                           | No                                                                                                                          | S   | Bajo                                | A                 | —                 |
| P23 | Instrucciones por ruta (`paths:` en `.opencode/rules/*.md` y `.claude/rules/`) cargadas al tocar esos archivos                                                                                                                    | CC/memory                                                            | Subcarpetas al leer (rama c2)                                                                                               | S   | Bajo                                | M                 | rama c2           |
| P24 | Monitor: shell de fondo con `avisar_si` (regex) que despierta la sesión con la línea marcada no confiable                                                                                                                         | CC/tools-reference                                                   | `shell_wait` incremental, `tool/shell/background.ts`                                                                        | S   | Medio (inyección)                   | M                 | —                 |
| P25 | Presupuesto por sesión (tokens, pasos, minutos) con aviso al 80 % y corte limpio                                                                                                                                                  | CC/headless (`--max-budget-usd`), GH/…/budget_limit.md               | Solo `steps` por agente                                                                                                     | S   | Bajo                                | A (cuotas gratis) | —                 |
| P26 | Fork de sesión desde un mensaje en la app (el motor ya lo tiene: `run --fork`)                                                                                                                                                    | CX/developer-commands, CC/checkpointing                              | `cli/cmd/run.ts`; ruta HTTP de fork: no ver.                                                                                | S   | Bajo                                | M                 | rebobinar         |
| P27 | Llamadas de solo lectura en paralelo dentro de un paso                                                                                                                                                                            | CX/changelog 0.163                                                   | no ver. (medir con el arnés)                                                                                                | S   | Bajo                                | M                 | P01               |
| P28 | Compactación en segundo plano                                                                                                                                                                                                     | OCL 2.1.4, CX/changelog 0.164                                        | Descartada en el plan de rebobinar                                                                                          | M   | Medio                               | M                 | P01 + datos       |
| P29 | Rebobinar por turno                                                                                                                                                                                                               | CC/checkpointing                                                     | **En curso**: `PLAN-REBOBINAR-Y-COMPACTACION.md` §2.A                                                                       | —   | —                                   | A                 | —                 |
| P30 | Compactación parcial, reinyección, `PostCompact`                                                                                                                                                                                  | CC/context-window                                                    | **En curso**: mismo plan §2.B                                                                                               | —   | —                                   | A                 | —                 |
| P31 | Búsqueda diferida de herramientas + formularios MCP                                                                                                                                                                               | CC/mcp, OCL 2.1.4                                                    | **Hecho** (`lazunox.9`)                                                                                                     | —   | —                                   | —                 | —                 |
| P32 | Tope de ayudantes, rutas protegidas, permisos persistentes, ganchos básicos, shell de fondo en Windows                                                                                                                            | CC/sub-agents, CX/agent-approvals-security                           | **Hecho** (`lazunox.5-8`)                                                                                                   | —   | —                                   | —                 | —                 |
| P33 | Tareas programadas dentro del motor                                                                                                                                                                                               | CC/scheduled-tasks                                                   | **NO hace falta**: Rutinas de la app (`src/main/scheduler/`). El «despertar» dentro de la sesión queda cubierto por P10/P24 | —   | —                                   | —                 | —                 |
| P34 | Memoria automática en el motor                                                                                                                                                                                                    | CC/memory, CX/customization/memories                                 | **NO hace falta**: la memoria es de la app                                                                                  | —   | —                                   | —                 | —                 |
| P35 | Contador de progreso por turno (archivos cambiados, plan cambiado, herramientas usadas)                                                                                                                                           | GH/…/continuation.md («sin progreso»)                                | Diff por turno en rama r1 (`session/turnos.ts`)                                                                             | S   | Bajo                                | M (base de P10)   | rama r1           |
| P36 | Aviso de peso del contexto fijo (agentes + skills + MCP + instrucciones) por sesión, en la app                                                                                                                                    | CC/sub-agents (aviso de 15k tokens)                                  | No                                                                                                                          | S   | Bajo                                | M                 | P01               |

## 4. Olas

Ola 0 (en curso, fuera de este plan): fusionar `feat/rebobinar` y `feat/compactar-mejor` según su plan, publicar `lazunox.10`. **Las olas 1-5 empiezan sobre esa base**
(P03, P09, P23 y P35 tocan archivos que esas ramas cambian).

**Reglas comunes a toda tarea** (los briefs no las repiten):

- Rama propia en el fork `feat/oN-<letra>` desde la base de la ola y, si toca la app, rama propia en la app.
- Un commit por repo, revertible, con interruptor `LAZUNOX_<X>=0` cuando cambie el comportamiento.
- Nota en `LAZUNOX.md` del fork y en `docs/SEGURIDAD.md` de la app si toca permisos.
- Pruebas `bun test test/lazunox/<nuevo>.test.ts` **en el VPS** (`/opt/lzx-test.sh /opt/lzx-fork/src "<pruebas>"`); nunca la suite completa en el Mac.
- Comprobaciones nuevas en `scripts/engine-probe/run.mjs` (motor real, proveedor falso) agrupadas con `PROBE_ONLY=<grupo>`; las existentes siguen verdes.
- `npx vitest run <archivo>` en la app.
- Herramienta nueva = registrarla en la lista `builtin` (`tool/registry.ts`; ver `MANTENIMIENTO-MOTOR.md` §4).
- No tocar: `plugin/provider/opencode.ts`, `test/lazunox/sin-red-de-opencode.test.ts`, `permission/rutas-protegidas.ts` (solo añadir), ni zonas intocables de la app (`docs/zonas-intocables.json`) salvo con el procedimiento de `AGENTS.md` §7.
- **V (verificación real, en cada ola)**, tras fusionar las tareas: compilar en el VPS, `engine-probe` completo, banco §5 (3 corridas, modelo gratuito), y prueba en la app empaquetada por CDP con perfil temporal y modelo gratuito en Mac y en Windows (`memoria: probar-app-real-por-cdp`). Hecho = probe verde, banco sin caída de éxito (≤ 1 tarea) y la mejora de la ola visible en las métricas.
- **S (revisión de seguridad independiente, en cada ola)**: un agente que no escribió el código revisa el diff contra el modelo de amenazas de la ola. Hecho = hallazgos P0/P1 cerrados y anotados en el commit.

### Ola 1: medir y gastar menos (riesgo bajo, valor alto)

**1A Banco de tareas (P01 + P17).**

- Objetivo: medir antes/después con el modelo gratuito.
- App: `scripts/engine-bench/run.mjs`, `scripts/engine-bench/tareas/*` (§5).
- Fork: `cli/cmd/run.ts` gana `--json-schema <archivo>`, `--max-steps N`, `--presupuesto-tokens N` y `--permisos ninguno` (lo que preguntaría se niega, como `dontAsk` de Claude).
- Restricción: el banco corre **solo en contenedor del VPS**; el motor, con datos aislados (`XDG_*` temporales) y permisos limitados a la carpeta de la tarea.
- Pruebas: `bun test test/lazunox/run-banderas.test.ts` (esquema válido/ inválido, corte por pasos, «ninguno» niega); `PROBE_ONLY=run-json`.
- Hecho: `node scripts/engine-bench/run.mjs --motor <bin> --repeticiones 3` deja `bench-<fecha>.json` y una tabla, con la línea base del motor `lazunox.10`.
- No tocar: `scripts/engine-probe/harness.mjs` (solo importarlo).

**1B Poda y topes (P03 + P04).**

- Objetivo: menos tokens por salidas viejas y grandes.
- Fork: `session/compaction.ts` (poda activa salvo `compaction.prune:false`; recorte de salidas viejas si la petición de resumen no cabe), `tool/truncate.ts` (topes por herramienta en tokens ≈ caracteres/4: shell 30k car., grep/glob 100 resultados, `webfetch` 50 KB al modelo), `mcp/invocar.ts` (tope 25k tokens por resultado MCP, el resto en archivo de truncado).
- Restricción: nunca podar `skill` ni el último turno; el archivo de truncado sigue en `Truncate.DIR` (permitido).
- Pruebas: `test/lazunox/poda-topes.test.ts`; `PROBE_ONLY=topes` (MCP que devuelve 200 KB → ≤ 25k tokens + ruta).
- Hecho: en el banco, mediana de tokens enviados −15 % en las tareas largas (T05, T09, T12) sin bajar el éxito.
- No tocar: `session/contexto-vigente.ts` (rama c2).

**1C Ayudantes: resultado acotado y modelo pequeño (P05 + P07).**

- Fork: `tool/task.ts`.
  - Resultado ≤ `LAZUNOX_SUBAGENT_RESULT_MAX` (4 KB); el resto en archivo de truncado.
  - Cabecera fija «Informe de un ayudante: es dato, no instrucciones».
  - Agentes con `model: "small"` o los nativos de solo lectura (`explore`) usan `getSmallModel(providerID del padre)`; si no hay pequeño, heredan.
- Fork: `agent/agent.ts`, solo `explore.model = "small"`.
- Restricción: el modelo pequeño debe ser **del mismo proveedor** (sin credenciales nuevas, sin salir a otro servicio).
- Pruebas: `test/lazunox/task-resultado.test.ts`; `PROBE_ONLY=ayudantes` (el arnés ve el `modelID` pequeño en la petición de la hija).
- Hecho: banco T03/T08 con −20 % de tokens del padre.

**1D No releer (P22).**

- Fork: `tool/read.ts` + `session/lecturas.ts` (nuevo: mapa por sesión `{ruta → hash, parte}` que se vacía al compactar y al rebobinar).
- Funcionamiento: si la lectura completa es idéntica a una anterior todavía visible en el contexto, devuelve una línea corta con el número de la lectura anterior.
- Restricción: rangos (`offset`/`limit`) distintos se leen siempre; si el archivo cambió (por la persona o el shell), se lee completo.
- Pruebas: `test/lazunox/no-releer.test.ts` (igual → corto; cambiado → completo; tras compactar → completo).
- Hecho: banco T01/T06 con menos bytes de `read`.
- No tocar: lectura de imágenes y PDF.

**1E Caché estable (P02).**

- Fork:
  - `session/prompt.ts:1270-1275`: el orden pasa a instrucciones, MCP, skills y entorno al final.
  - `session/system.ts`: la fecha en formato estable.
  - `provider/transform.ts`: la marca de caché en el último bloque estable.
- Pruebas: `test/lazunox/prefijo-estable.test.ts` (dos pasos seguidos → mismos bytes hasta el último mensaje); `PROBE_ONLY=cache` (el arnés compara los cuerpos de la petición 1 y 2).
- Hecho: prefijo idéntico entre pasos; en el banco `cache.read` > 0 con los proveedores que lo informan.
- No tocar: `promptCacheKey` (`:1325`).

V1 + S1. Amenazas S1: archivos de truncado con datos sensibles fuera del sandbox de la sesión; un resultado de ayudante que aún cuela instrucciones; el modelo pequeño de otro proveedor (fuga).

### Ola 2: subagentes y plan (núcleo de la orquestación)

**2A Subagentes definidos por el usuario (P06).**

- Fork:
  - `core/src/v1/config/agent.ts`: `disallowed_tools`, `max_turns`, `background`, `skills` y `model: "small"|"inherit"`.
  - `config/agent.ts`: lee también `.claude/agents/*.md`, traduciendo `tools`/`disallowedTools`/`maxTurns` de Claude.
  - `agent/agent.ts:270-294`, `agent/subagent-permissions.ts`: los permisos de la hija = intersección con los del padre; `disallowed` va primero.
- App: pantalla «Ayudantes» en Ajustes (lista, crear y editar `.md` en `.opencode/agents/`), i18n es/en.
- Restricción: un agente **no** puede declarar `permission` que amplíe al padre ni cambiar el sandbox (como Codex); `max_turns` marca la salida «parcial».
- Pruebas: `test/lazunox/agentes-usuario.test.ts` (intersección, formato Claude, parcial); `PROBE_ONLY=agentes`; vitest de la pantalla.
- Hecho: un `.md` de Claude Code funciona sin cambios y no puede escribir donde el padre no puede.
- No tocar: `tool/task.ts`.

**2B Esperar y gestionar ayudantes (P13 + P14).**

- Fork: `tool/task-gestion.ts` (nuevo: `task_wait {ids, timeout ≤ 300 s}`, `task_list`, `task_cancel`), `tool/registry.ts` (registro; **2B es dueña de `registry.ts` en esta ola**), `background/job.ts` + `tool/shell/trabajos-disco.ts` (lápida de ayudantes de fondo).
- App: «Reanudar» en «Trabajos en segundo plano» para un ayudante perdido.
- Restricción: solo ayudantes de **esa** sesión; `task_wait` devuelve resultados ya acotados (1C).
- Pruebas: `test/lazunox/task-gestion.test.ts`, `trabajos-reinicio.test.ts` ampliado; `PROBE_ONLY=task-wait`.
- Hecho: el padre lanza 3 ayudantes de fondo y los espera con una sola llamada; tras reiniciar, aparecen como «perdido» con «Reanudar».

**2C Modo plan para la app (P08).**

- Fork: `tool/plan.ts`, `session/reminders.ts`, `session/prompt/plan*.txt`.
  - `plan_enter`/`plan_exit` disponibles para el cliente `app` con `LAZUNOX_PLAN=1`.
  - El plan se guarda en `.opencode/plans/<sesión>.md`; `plan_exit` emite `session.plan.listo` y espera la decisión de la persona.
- App: Code muestra el plan con «Aprobar y editar con preguntas» / «Seguir planificando».
- Restricción: el agente `plan` sigue sin `edit` salvo su archivo de plan (`agent/agent.ts:157-181` no se toca). **No tocar `src/main/tasks/opencode-config.ts` (zona intocable, puerta del plan de Tareas)**.
- Orden fijo: la línea `tool/registry.ts:254` la cambia 2C **después** de que 2B se fusione.
- Pruebas: `test/lazunox/plan-app.test.ts`; `PROBE_ONLY=plan` (con plan no hay `edit`, aprobar cambia a `build`).
- Hecho: flujo completo en la app real.

**2D Plan ejecutable (P09 + P35).**

- Fork:
  - `tool/todo.ts`, `tool/todowrite.txt`, `session/todo.ts`, esquema `SessionTodo` en `core`: campos `verificar?` y `bloqueado`, como mucho 1 `en_curso`.
  - Si `verificar` empieza con `$ ` se corre como `shell` **con permiso normal**; si falla, el estado queda `en_curso` y se informa.
  - `session/progreso.ts` (nuevo, puro: progreso por turno a partir de `session/turnos.ts`).
  - Leer las tareas se permite a `general` (`agent/agent.ts:189`); solo esa línea, coordinada con 2A (2D se fusiona después).
- Pruebas: `test/lazunox/plan-ejecutable.test.ts`; `PROBE_ONLY=todo-verificar`.
- Hecho: banco T10/T11 con mayor éxito que la línea base.

V2 + S2. Amenazas S2: escalada por agente definido en la carpeta (repo hostil con `.claude/agents/x.md` que pide más herramientas); `verificar` como vía para ejecutar comandos sin permiso; plan aprobado que abre edición fuera del proyecto.

### Ola 3: bucles largos y verificación

**3A Modo objetivo (P10).**

- Fork: `session/objetivo.ts` (nuevo: estado, juez, plantilla de continuación en español con auditoría de evidencia) y su llamada en el bucle de `session/prompt.ts` (**3A es dueña de `prompt.ts` en esta ola**).
- Rutas: `POST/DELETE /experimental/session/{id}/objetivo`.
- App: «Objetivo» en Code con condición, comando de verificación y presupuesto.
- Criterios de término: verificar OK → cumplido; juez (modelo pequeño, sin resultados de herramientas) «cumplido»/«imposible»; 3 turnos sin progreso (P35) → `bloqueado`; presupuesto (P25) → `presupuesto_agotado`; permiso o pregunta pendiente → pausa.
- Pruebas: `test/lazunox/objetivo.test.ts` con el proveedor falso (sigue, termina, bloquea, presupuesto); `PROBE_ONLY=objetivo`.
- Hecho: T13 «haz pasar las pruebas» termina solo con el modelo gratuito en ≥ 2 de 3 corridas.

**3B Presupuesto y continuación (P25 + P11).**

- Fork: `session/presupuesto.ts` (nuevo) y su llamada en `session/processor.ts` (tokens, pasos y minutos por sesión, aviso al 80 %, corte limpio con el mensaje «presupuesto agotado»); reintento si `finish = length` (máx. 2).
- App: el presupuesto en el menú de la sesión.
- Pruebas: `test/lazunox/presupuesto.test.ts`; `PROBE_ONLY=presupuesto`.
- Hecho: el corte no deja la sesión ocupada ni pierde partes.
- No tocar: `session/prompt.ts`.

**3C Verificador y revisor (P21 + P18).**

- Fork: `agent/agent.ts` (agentes nativos `verificador` y `revisor`, solo lectura + shell, `model: "small"`), `agent/prompt/{verificador,revisor}.txt`, `command/template/review.txt` (rúbrica P0-P3, solo bugs introducidos, JSON `findings[]` validado con `json_schema`).
- App: botón «Revisar cambios» en Code que pinta los hallazgos por archivo.
- Pruebas: `test/lazunox/revisor.test.ts` (no puede editar; salida válida); `PROBE_ONLY=revisor`.
- Hecho: banco T14 (bug sembrado) detectado en ≥ 2 de 3 corridas.

**3D Ganchos ampliados (P20).**

- Fork: `plugin/lazunox-ganchos.ts` y los tipos en `packages/plugin` (`SessionStart`, `UserPromptSubmit`, `SubagentStop`, `Stop` con `{"decision":"block","reason"}`, `updatedInput` en `PreToolUse`, validado contra el esquema de la herramienta).
- Interfaz fija para 3A: `experimental.session.stop → { continuar?: string }`; 3D implementa el gancho y 3A lo llama. Tope: 5 continuaciones seguidas por gancho.
- Restricción: el archivo sigue siendo **solo** el de la app (`LAZUNOX_HOOKS_FILE`); un proyecto no trae ganchos propios.
- Pruebas: `ganchos-usuario.test.ts` ampliado.

**3E Monitor (P24).**

- Fork: `tool/shell.ts` (parámetro `avisar_si` con regex ≤ 200 caracteres, validada; máx. 20 avisos por trabajo) y `tool/shell/background.ts`. El aviso despierta la sesión por el mismo canal de `lazunox-wake.ts`, con la línea (≤ 500 caracteres) marcada no confiable.
- Pruebas: `shell-wake.test.ts` ampliado; `PROBE_ONLY=monitor`.

V3 + S3. Amenazas S3: el objetivo como bucle infinito o caro; juez manipulado por texto de un archivo; un `Stop` hostil que nunca deja parar; regex catastrófica (ReDoS) en `avisar_si`.

### Ola 4: skills, LSP y trabajo en lote

**4A Skills completas (P15).**

- Fork: `skill/index.ts`, `tool/skill.ts`.
  - `allowed-tools`/`disallowed-tools` **solo restringen** durante la skill (más seguro que Claude, que preaprueba).
  - `model`; `context: fork` (corre como ayudante con P06); `paths`; `disable-model-invocation`.
  - Lista del sistema con presupuesto de 8 KB y descripciones de máx. 300 caracteres.
- Pruebas: `test/lazunox/skills-frontmatter.test.ts`.
- Hecho: una skill de Claude Code con `context: fork` corre en un ayudante.

**4B LSP estable (P16).**

- Fork: `tool/lsp.ts`, `lsp/*`, `tool/registry.ts` (**dueña en esta ola**: quitar la bandera tras `LAZUNOX_LSP=1`).
  - Diagnósticos del archivo tras `edit`/`write`, como máx. 20 líneas, en el resultado de la herramienta.
  - Solo servidores ya instalados en el PATH (sin descarga).
- Pruebas: `test/lazunox/lsp-diagnosticos.test.ts` (TypeScript); en Windows, `PROBE_ONLY=lsp`.
- No tocar: `tool/edit.ts`, salvo el enganche de una línea.

**4C `/lote` (P12).**

- Fork: `command/template/lote.txt` + registro en `command/index.ts`. El flujo: plan con unidades, comprobación de que no comparten archivos, ayudantes de fondo (≤ tope), `task_wait`, `verificador` por unidad y resumen.
- Pruebas: `test/lazunox/lote.test.ts` (proveedor falso: 3 unidades).
- Hecho: banco T15 (renombrar en 3 módulos) correcto en ≥ 2 de 3.

**4D Instrucciones por ruta y peso fijo (P23 + P36).**

- Fork: `session/instruction.ts` (reglas con `paths:` cargadas al leer o editar un archivo que coincide; las de `.claude/rules/` también).
- App: indicador «contexto fijo ≈ N tokens» en Code (dato de una ruta nueva `GET /experimental/session/{id}/contexto-fijo`).
- Pruebas: `test/lazunox/reglas-ruta.test.ts`.

V4 + S4. Amenazas S4: una skill que se escala con `model` de otro proveedor; un servidor LSP como binario del repo (solo el PATH, nunca la carpeta del proyecto); reglas por ruta fuera del proyecto.

### Ola 5: seguridad asistida y pulido (sale según los datos del banco)

**5A Sugerencia de permisos (P19).**

- Fork: `permission/sugerencia.ts` (nuevo), llamado desde el gancho `permission.ask`.
  - El modelo pequeño recibe la acción, la regla y el objetivo de la persona, **sin** salidas de herramientas.
  - Devuelve `{sugerencia: permitir|negar|preguntar, motivo ≤ 200}` como **dato** en la petición de permiso.
- App: la tarjeta de permiso muestra la sugerencia; ningún botón cambia y no se aprueba nada solo. Respeta la decisión 2026-09-28: el Modo auto sigue siendo solo por reglas (`src/main/tasks/auto-mode.ts`, que no se toca).
- Pruebas: `test/lazunox/sugerencia-permiso.test.ts` (fallo o tiempo → sin sugerencia); vitest de la tarjeta.

**5B Paralelo de solo lectura (P27).** Medir primero con el arnés si el motor ya ejecuta en paralelo las llamadas de un paso; si no, `session/processor.ts`.

**5C Compactación en segundo plano (P28).** Solo si el banco muestra esperas por compactar de más de 10 s.

**5D Fork de sesión en la app (P26).** Solo en la app, con la ruta del motor.

V5 + S5. Amenaza S5 principal: que la sugerencia se convierta en aprobación por la puerta de atrás.

**Estimación:** 5 olas. Con 4-5 agentes por ola, 2-4 días de código + 1-2 de V/S; unas 6-8 semanas en total, al ritmo del Mac (máx. 1-2 agentes pesados a la vez; lo pesado al VPS).

## 5. Medición: «el motor mejoró» sin APIs de pago

**Banco** (`scripts/engine-bench/`, en la app). Cada tarea es una carpeta `tareas/TNN-nombre/` con `inicio/` (archivos), `pedido.txt` y `verificar.sh` (código 0 = éxito; determinista, sin red).

| #   | Tarea                                                                          | Qué mide                            |
| --- | ------------------------------------------------------------------------------ | ----------------------------------- |
| T01 | Arreglar un bug con prueba que falla (JS)                                      | Lectura justa, edición              |
| T02 | Añadir función + prueba (Python)                                               | Plan corto                          |
| T03 | «¿Dónde se valida X?» en un repo de 60 archivos (respuesta en `respuesta.txt`) | Ayudante de lectura, modelo pequeño |
| T04 | Renombrar símbolo en 5 archivos                                                | Ediciones múltiples                 |
| T05 | Leer un log de 3 MB y escribir la causa                                        | Truncado y poda                     |
| T06 | Refactor que obliga a releer el mismo archivo                                  | No releer                           |
| T07 | Arreglar error de tipos (TS)                                                   | LSP (ola 4)                         |
| T08 | Resumir 3 módulos con 3 ayudantes en paralelo                                  | Ayudantes, resultado acotado        |
| T09 | Sesión larga: 8 pedidos encadenados                                            | Compactación, coherencia            |
| T10 | Tarea de 6 pasos con lista de tareas                                           | Plan ejecutable                     |
| T11 | Migración con verificación por paso                                            | Plan ejecutable                     |
| T12 | Usar un conector MCP de prueba con 40 herramientas                             | Búsqueda diferida, topes MCP        |
| T13 | «Haz pasar las pruebas» (3 fallos)                                             | Modo objetivo                       |
| T14 | Revisar un diff con un bug sembrado                                            | Revisor                             |
| T15 | Lote: 3 módulos independientes                                                 | `/lote`                             |
| T16 | Oficina: CSV de gastos → resumen en `informe.md` con totales exactos           | Datos                               |
| T17 | Oficina: corregir acentos y formato de una carta `.md`                         | Edición de texto en español         |
| T18 | Oficina: ordenar 30 archivos en carpetas por fecha                             | Shell con cuidado                   |

**Ejecutor.** `node scripts/engine-bench/run.mjs --motor <bin> [--tareas T01,T05] [--repeticiones 3] [--modelo opencode/<gratuito>] [--env K=V]`. Para cada corrida:

1. Copia `inicio/` a una carpeta temporal y hace `git init` con un commit.
2. Arranca el motor con datos aislados (`XDG_DATA_HOME`, `XDG_CONFIG_HOME` y `XDG_CACHE_HOME` temporales) y `OPENCODE_CONFIG_CONTENT` con permisos: `edit`/`bash` permitidos dentro de la carpeta y `external_directory: deny`.
3. Llama a `opencode run --format json --permisos ninguno --max-steps 60 --presupuesto-tokens 400000 "$(cat pedido.txt)"`, con 15 min de tope.
4. Lee el NDJSON: suma `tokens.input`, `tokens.output` y `tokens.cache.read` de cada `step_finish`, y cuenta pasos, llamadas por herramienta y bytes de resultados.
5. Corre `verificar.sh` y mide el tiempo de reloj.

Salida: `bench-<motor>-<fecha>.json` + tabla Markdown comparando con una corrida anterior (`--comparar <json>`).
Corre **solo en el VPS**, en contenedor `oven/bun:1.3.14`, con el modelo gratuito que usa la app (sin claves de pago).

**Métricas por tarea** (mediana de 3): éxito (k de 3), tokens enviados (`input + cache.read`), tokens de salida, `cache.read` / enviados, pasos, llamadas, minutos, tokens por éxito.
**Agregados**: tasa de éxito, mediana de tokens por éxito, p90 de minutos.

**Criterio por ola**: éxito total no baja más de 1 tarea; la métrica objetivo de la ola mejora lo dicho en sus briefs; ninguna tarea pasa de éxito estable (3/3) a 0/3.

**Mitad determinista** (sin modelo real, exacta): en `engine-probe` un grupo `PROBE_ONLY=bytes` que, con el proveedor falso y guiones fijos de llamadas, mide bytes de cada petición (herramientas, sistema, mensajes) y si el prefijo se repite entre pasos. Esta mitad sirve de guardia en la CI; la otra, de prueba real.

**Ruido de los modelos gratuitos**: si el proveedor limita la cuota, se reintenta 1 vez con espera y se marca `cuota`, que no cuenta como fallo; se fija el modelo por ID y se anota la fecha (los gratuitos cambian).

## 6. Riesgos y descartes

**Riesgos**

- **Ejecutar sin supervisión** (objetivo, lote, monitor, `Stop` que continúa): se acotan con presupuesto, tope de continuaciones y «no aprueba permisos». El riesgo es de gasto y de bucle, no de escalada.
- **Inyección por canales nuevos** (resultado del ayudante, aviso del monitor, juez del objetivo, sugerencia de permisos): todo va marcado como dato y el juez y el sugeridor no ven salidas de herramientas.
- **Repos hostiles**: `.claude/agents`, `.claude/rules` y skills con frontmatter que pide más. Por eso las herramientas permitidas solo restringen, y un agente nunca supera al padre.
- **Modelos gratuitos inestables** (cambian o desaparecen): el banco fija el ID; el modelo pequeño cae a heredar si no existe.
- **Conflictos entre ramas**: dueños de archivo por ola (`registry.ts`: 2B y 4B; `prompt.ts`: 3A; `agent/agent.ts`: 2A, luego 2D, en orden). Las olas 1+ empiezan después de fusionar r1 y c2.
- **Zonas intocables**: ninguna tarea las necesita. 2C y 5A lo dicen expresamente (`opencode-config.ts`, `auto-mode.ts` no se tocan). Si una lo necesitara: procedimiento de `AGENTS.md` §7.
- **Carga del Mac**: banco y `bun test` al VPS; en el Mac solo vitest dirigido y la prueba por CDP.

**Descartado (con razón)**

| Qué                                                 | Por qué                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subagentes con worktree propio                      | La hija viviría en otra carpeta; sus eventos y permisos saldrían por un canal que la app no escucha (decisión 2026-10-24, `PLAN-MOTOR-PROPIO.md`) |
| Proxy con lista de dominios para el shell           | Falsa seguridad fuera del sandbox; Overdrive ya tiene proxy de salida (misma decisión)                                                            |
| Equipos de agentes                                  | Experimental en Claude Code y unas 7 veces más tokens (CC/agent-teams); no encaja con modelos gratuitos ni con el tope de 8                       |
| Tareas programadas y memoria en el motor            | Las tiene la app (Rutinas, memoria); duplicarlas abre dos fuentes de verdad                                                                       |
| Rutinas en la nube, `codex cloud`, revisión `ultra` | Nube o pago                                                                                                                                       |
| Clasificador que **aprueba** solo                   | Decisión 2026-09-28 (solo reglas); con modelos débiles aprobaría mal. Se hace solo «sugerir» (P19)                                                |
| Migrar a OpenCode 2.x                               | Cambia la API, quita LSP y CLAUDE.md, servicio compartido que rompe el sidecar por carpeta (OC/migrate-v1, anoma.ly/notes/opencode-2-0)           |
| Servidor MCP del propio motor                       | Codex lo retiró (CX/mcp-server); sin caso de uso en la app                                                                                        |
| Juez del objetivo con modelo de pago                | Prohibido; se usa el modelo pequeño gratuito + verificación por comando                                                                           |
| Renombrado (b)(d) del binario y de los datos        | Ya decidido aparte (`PLAN-MOTOR-PROPIO.md`, 2026-10-24)                                                                                           |

**No verificado y a confirmar antes de la ola que lo use**:

- Si el motor ya ejecuta en paralelo las llamadas de un paso (P27).
- Si continúa al cortarse la salida (P11).
- La ruta HTTP de fork (P26).
- Las lápidas de ayudantes de fondo (P14).
- Si el modelo gratuito de Zen informa `cache.read` (P02).
- En Codex, la sintaxis exacta del presupuesto de `/goal`.
