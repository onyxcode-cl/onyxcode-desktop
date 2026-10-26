# Plan de la Ola 6 del motor: lo que aún les falta a Lazunox frente a Claude Code, Codex y OpenCode 2.x

Fecha: 2026-10-26. Solo lectura del repositorio y web; no se tocó código ni git. Continúa `docs/PLAN-MAESTRO-MOTOR-PARIDAD.md` (olas 0-5) y no repite sus reglas comunes (§4: rama por tarea, interruptor `LAZUNOX_<X>=0`, pruebas en el VPS, V y S por ola, dueños de archivo).
Motor leído: `/Users/ben/Documents/lzx-wt/integracion` (rama `feat/ola3-integrada`, que ya integra las olas 1-4 hasta `6de6262`) y su `LAZUNOX.md`. Las ramas de la Ola 5 (`feat/sugerencia-permisos`, `feat/paralelo-fork`) aún no tienen commits propios.
Rutas del motor relativas a `packages/opencode/src/` salvo aviso.

**Prioridades de Ben**: gastar menos tokens, hilar mejor las ideas, subdividir las tareas. Además: modelos gratuitos débiles (DeepSeek Flash free, MiMo free) y nada de APIs de pago, nube de terceros ni telemetría.

**Abreviaturas de fuentes** (cada URL citada es prefijo + ruta):
- `CC/` = https://code.claude.com/docs/en/
- `CCL` = https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md (va por versiones, sin fechas)
- `CX/` = https://learn.chatgpt.com/docs/ (destino del 308 de developers.openai.com/codex)
- `GH/` = https://github.com/openai/codex/blob/main/
- `OC/` = https://opencode.ai/v2/docs/
- `OCL` = https://raw.githubusercontent.com/anomalyco/opencode/dev/CHANGELOG.md (cubre 2.0.26-2.1.4)
- `OCR/` = https://github.com/anomalyco/opencode/blob/dev/

## 0. Resumen

- Tras las olas 0-5, la **orquestación básica ya está al día**: plan, objetivo, lote, ayudantes de fondo con espera, verificador y revisor, ganchos, presupuesto y monitor.
- Lo que más gasta tokens con modelos débiles es otra cosa:
  - **Compactación tardía.** Solo se compacta con la ventana llena (`session/overflow.ts:10-34`). Con modelos de ventana grande, cada paso reenvía cientos de miles de tokens: T09 envió 333 065 tokens en 30 pasos.
  - **Ayudantes que cargan todo el contexto fijo.** Un `explore` o un `verificador` reciben AGENTS.md, la lista de skills, MCP y el prompt base de 1354 palabras (`session/prompt.ts:1554-1562`, `session/system.ts:44-50`).
- Lo que más falla con modelos débiles es esto:
  - **Ediciones.** Ninguno de los 9 *replacers* de `tool/edit.ts:695-703` normaliza comillas tipográficas ni guiones. Pesa más en textos en español (« », “ ”, —).
  - **Pérdida del hilo.** No se avisa cuando un archivo cambia por fuera ni qué tocó un comando, y la lista de tareas no tiene dependencias.
- **El banco está saturado.** La línea base real (`scripts/engine-bench/linea-base/real-lazunox9-2026-10-25.json`) dio 16 de 16 tareas bien, con 1 sola corrida, y T17 y T18 perdidas por cuota. Sin tareas más duras y sin 3 corridas, la Ola 6 no se puede medir. Por eso el **paquete 6.1 es el banco**.
- Propuesta: **10 paquetes**, en 3 tandas (§3), con V y S por tanda como en las olas anteriores.

## 1. Hallazgos verificados

Columnas:
- **Fuente**: dónde lo documentan.
- **Lazunox hoy**: lo comprobé leyendo el fork.
- **Débil**: por qué importa con modelos gratuitos débiles.
- **Esf**: S ≤ 3 días, M ≤ 2 semanas, L más.
- **Riesgo**: riesgo de seguridad de *implementarlo*.

### 1.1 Gastar menos tokens

| # | Hallazgo | Fuente | Qué hace | Lazunox hoy (verificado) | Débil | Esf | Riesgo |
|---|---|---|---|---|---|---|---|
| H1 | Umbral de compactación anticipado | `CC/sub-agents` (`autoCompactWindow` 100000-1000000), `CC/env-vars` (`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` 1-100: «Use lower values like `50` to compact earlier»); `CX/config-file/config-reference` y `GH/codex-rs/protocol/src/openai_models.rs` (`auto_compact_token_limit`, por defecto el 90 % de la ventana; alcance `total` o `body_after_prefix`) | Compacta antes de llenar la ventana; en Codex, el umbral es por modelo | No existe. `isOverflow` compara con `limit.input - reserved` (`session/overflow.ts:14-34`). La configuración solo tiene `auto`, `prune`, `tail_turns`, `preserve_recent_tokens` y `reserved` (`core/src/v1/config/config.ts:149-167`). La app no fija ninguno (sin coincidencias en `src/main`) | Un modelo débil pierde el hilo mucho antes de llenar la ventana nominal, y cada paso paga todo lo acumulado | S | Bajo |
| H2 | Valores por modelo (catálogo editable) | `CX/config-file/config-reference` (`model_catalog_json`: `context_window`, `truncation_policy`, umbral de compactación, `effective_context_window_percent` = 95) | Topes y compactación distintos para cada modelo | Solo hay valores globales y `limit` del catálogo `models.dev` | DeepSeek Flash y MiMo tienen ventanas y fallos distintos | S (dentro de 6.2) | Bajo |
| H3 | Ayudantes sin instrucciones del proyecto | `CC/sub-agents`: Explore no carga CLAUDE.md ni git status; campo `omitClaudeMd` («skip user, project, and local CLAUDE.md files») | La hija de solo lectura arranca con el contexto mínimo | Toda sesión, incluidas las hijas, recibe `instruction.system()`, `sys.skills`, `sys.mcp` y el prompt base (`session/prompt.ts:1554-1562`) | Es el 100 % del contexto fijo multiplicado por cada ayudante (T03, T08, T15, `/lote`) | S | Bajo-medio (AGENTS.md puede traer reglas de seguridad) |
| H4 | Explore con nivel de exhaustividad | `CC/sub-agents`: `quick`, `medium`, `very thorough` | Quien lanza al ayudante acota cuánto busca | El prompt `agent/prompt/explore.txt` menciona «thoroughness level», pero no hay parámetro ni topes | Un modelo débil sin tope explora de más | S (dentro de 6.3) | Bajo |
| H5 | Gancho que reemplaza la salida (`updatedToolOutput`) | `CC/hooks`: PostToolUse `updatedToolOutput` («replaces the result»); `CC/costs` usa ganchos para filtrar la salida de las pruebas | Un gancho de la app resume o filtra la salida (pruebas, logs) antes de que la vea el modelo | `PostToolUse` solo añade texto con código 2 (`plugin/lazunox-ganchos.ts:446-455`). Tampoco existen `PostToolUseFailure` ni `PermissionDenied` (sin coincidencias en el archivo) | La salida de `bun test` o `npm test` es lo más voluminoso en T13, T01 y T07 | S-M | Medio |
| H6 | Ayudante «fork» que hereda la conversación y la caché | `CC/sub-agents` (Fork the current conversation: «a fork costs less than a fresh subagent for tasks that need the same context»); `GH/codex-rs/core/src/tools/handlers/multi_agents_spec.rs` (`fork_turns` = `all`/`none`, `fork_context`) | Subdivide sin reexplicar el contexto; la primera petición de la hija lee la caché del padre | `task` crea una sesión hija solo con el prompt (`tool/task.ts`); no se puede heredar el historial | Zen informa caché leída (65-95 % en la línea base), así que un fork es barato. Explicarle todo a una hija es justo lo que un modelo débil hace mal | M | Medio |

### 1.2 Hilar mejor las ideas

| # | Hallazgo | Fuente | Qué hace | Lazunox hoy (verificado) | Débil | Esf | Riesgo |
|---|---|---|---|---|---|---|---|
| H7 | Resumen validado contra la plantilla | `OCR/packages/core/src/session/compaction.ts` y OCL 2.1.0: si el modelo no rellena la plantilla, recibe un recordatorio; al segundo fallo, error | Evita resúmenes vacíos o desordenados | La plantilla estructurada ya existe (Objective, Work State, Next Move, Relevant Files) y la actualización incremental con `<prior-summary>` también (`core/src/session/compaction.ts:16-46,160-174`). **No se valida** que la respuesta la siga | Un modelo débil se salta secciones o «continúa la conversación» | S | Bajo |
| H8 | El resumen dice qué herramientas se usaron y qué se descartó | CCL 2.1.304 (nombres de herramientas en el resumen) y 2.1.305 (avisar cuando el resumen deja fuera los mensajes viejos) | La sesión sabe qué se hizo y qué parte ya no ve | `ajustarConversacion` descarta los mensajes más viejos y solo lo registra en el log (`session/compaction.ts:126-140,715-717`). Que el modelo reciba ese aviso: no ver. | Sin aviso, el modelo cree que conserva todo | S (dentro de 6.4) | Bajo |
| H9 | Aviso de que un archivo leído cambió en disco | `CC/prompt-caching` y `CC/how-claude-code-works`: añade un `system-reminder` de que el archivo cambió, sin reescribir la lectura vieja (conserva la caché) | El modelo no trabaja sobre una copia vieja | `session/lecturas.ts` guarda el hash de cada lectura, pero solo lo usa para «no releer». Nadie avisa del cambio | Un modelo débil edita con un `oldString` viejo y falla en bucle | M | Bajo-medio |
| H10 | Diff de lo que cambió un comando shell | CCL 2.1.269: «Added a diff of the files a Bash command changed to the Bash tool result» (`bashEditDiffEnabled`) | El modelo ve los efectos de `sed`, `mv` o un generador | Hay diff por turno con `origen: comando` (`session/turnos.ts`, ruta `/turnos`), pero no entra al resultado de `shell` (sin coincidencias de `diff` en `tool/shell.ts`) | Un modelo débil no sabe qué tocó su comando y vuelve a leer todo | M (con H9) | Medio (fuga de secretos al contexto) |
| H11 | Tareas con dependencias | `CC/tools-reference` (TaskUpdate «updates task status, dependencies») y `CC/agent-teams` («a pending task with unresolved dependencies cannot be claimed»). En Claude Code, la lista va activa por defecto solo en modelos más débiles («On newer models, Claude keeps track… without a written checklist») | Un grafo `depende_de`: no se empieza una tarea bloqueada | `todowrite` tiene `verificar`, `bloqueado` y una sola tarea en curso (`schema/src/session-todo.ts:21`), pero no dependencias | Anthropic misma reconoce que los modelos débiles necesitan la lista. Las dependencias evitan el «hice el paso 4 antes del 2» | M | Bajo |

### 1.3 Subdividir y robustez con modelos débiles

| # | Hallazgo | Fuente | Qué hace | Lazunox hoy (verificado) | Débil | Esf | Riesgo |
|---|---|---|---|---|---|---|---|
| H12 | Coincidencia de edición con normalización Unicode | `GH/codex-rs/apply-patch/src/seek_sequence.rs`: 4 pasadas (exacta, sin espacios al final de línea, sin espacios a ningún lado, y guiones, comillas tipográficas y espacios raros pasados a ASCII); 0.162.0 conserva los finales de línea | Menos ediciones fallidas por `"` contra `“` o `-` contra `—` | Hay 9 *replacers* (`tool/edit.ts:244-703`: línea recortada, ancla de bloque, espacios, sangría, escapes…). Ninguno normaliza comillas, guiones ni NBSP (sin coincidencias de `‘`, `“` ni `NFKC`). Los finales de línea ya se normalizan (`:22,130`) | Los modelos débiles «limpian» las comillas al copiar `oldString`. Pasa mucho en cartas e informes en español (T17) | S | Bajo-medio (coincidencia equivocada) |
| H13 | Respaldo de modelo ante sobrecarga | `CC/model-config` y CCL 2.1.166: `fallbackModel`, hasta 3, solo ante sobrecarga o error del servidor no reintentable, y solo por ese turno («The switch lasts for the current turn only»). Claude **no** lo activa por límite de uso | No se pierde el turno cuando el modelo gratuito está caído | `session/retry.ts:26-82`: 5 reintentos con `retry-after`. No hay respaldo (sin coincidencias de `fallback_model`). En la línea base, T17 y T18 se perdieron por «Free usage exceeded» | Los gratuitos se caen o se agotan a menudo | M | Medio (cambio de modelo o proveedor) |
| H14 | Ganchos `prompt` con `ok`/`reason`/`impossible` | `CC/hooks-guide` (Prompt-based hooks: «the `reason` is fed back to Claude so it keeps working») | Un juez de modelo en `Stop` o `SubagentStop` que manda seguir o deja parar | Solo hay ganchos de tipo comando. El juez existe únicamente para el modo objetivo (`session/objetivo.ts`) | Revisaría cada ayudante al terminar (subdividir con control) | M | Medio |

### 1.4 Ya cubiertos (los hallazgos de la web no aportan nada nuevo)

- **Saneado del historial de herramientas** (`OCR/packages/ai/src/tool-history.ts`). Ya lo cubre `session/message-v2.ts:338-372`: las llamadas `pending`/`running` salen como `[Tool execution was interrupted]` y la salida vacía del shell es `(no output)` (`tool/shell.ts:689`).
- **Reparación de llamadas a herramientas**. Ya está `experimental_repairToolCall`, con minúsculas y paso a `invalid` (`session/llm.ts:297-326`).
- **Detección de bucles**. Ya está `DOOM_LOOP_THRESHOLD = 3` (`session/processor.ts:30,381-398`). OpenCode 2.x la quitó (`OC/permissions`), así que en esto vamos por delante.
- **Reintentos que respetan `retry-after`**. Ya en `session/retry.ts:47-77`.
- **Tramo reciente literal**. Ya están `preserve_recent_tokens` y `tail_turns` (`core/src/v1/config/config.ts:157-163`).
- **Modelo propio para compactar** (`OC/compaction`: `agents.compaction.model`). Ya existe el agente `compaction` con `model` configurable (`session/compaction.ts:664-667`). Falta documentarlo en la app.
- **Edición tolerante en general**. Nuestra 1.19 es **mejor** que la 2.x, cuyo `edit` es estricto: «the old text must match exactly once» (`OC/tools`).

### 1.5 Descartados

| Qué | Por qué |
|---|---|
| Memorias de Codex en dos fases (`CX/customization/memories`) y memoria por subagente de Claude (`memory:`) | La memoria es de la app (decisión del plan maestro, P34) |
| Workflows de Claude (`CC/workflows`: script con `agent()`/`parallel()`) | Esfuerzo L. Code Mode, `/lote` y `task_wait` cubren el 80 %. Se reconsidera si T21 sigue fallando |
| Inyección de comandos en skills (`` !`cmd` ``, `CC/skills`) | Una skill de un repo hostil ejecutaría comandos antes de que la vea el modelo. Contradice la «regla de oro» de 4A |
| `get_context_remaining`, `new_context` y `token_budget` (`GH/codex-rs/core/src/tools/handlers/get_context_remaining_spec.rs`, `codex-rs/features/src/lib.rs`) | En Codex están en *UnderDevelopment* y apagadas. Un recordatorio que cambia en cada paso rompe el prefijo de caché. Se reconsidera con datos de 6.2 |
| Estilo de salida conciso (`CC/output-styles`) | Los tokens de salida son ~1 % de los enviados en la línea base (T01: 361 frente a 41 601) |
| Prompt corto de sistema (`CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT`, `CC/env-vars`) y prompt único de OpenCode 2.x | Anthropic da el prompt **completo** a los modelos débiles. Solo se probaría como variante del banco, no como paquete |
| `/btw` y `/side`, `/recap` | Son de la interfaz (la app), no del motor. Encajan como tarea de la app sobre el fork de sesión (5D) |
| Gramática Lark de `apply_patch` | Exige que el proveedor admita herramientas con gramática (no confirmado para Zen, DeepSeek ni MiMo). Lo útil (H12) se toma aparte |
| Compactación por inactividad (CCL 2.1.299) | En la app de escritorio no aplica sin la compactación en segundo plano (5C). Se revisa después de 5C |
| Equipos de agentes, ultrareview, rutinas en la nube, Remote Control, Claude in Chrome, advisor, `auto_review` de Codex que aprueba, compactación remota de Codex, web search de OpenAI, `warming` de OpenCode, OpenTelemetry | Nube, pago, telemetría, unas 7 veces más tokens, o un aprobador automático (decisión 2026-09-28) |

## 2. Paquetes de la Ola 6

Reglas comunes: las de la §4 del plan maestro. Todo paquete trae `LAZUNOX_<X>=0`, nota en `LAZUNOX.md`, `bun test test/lazunox/<nuevo>.test.ts` en el VPS y un grupo `PROBE_ONLY=<x>` en `scripts/engine-probe/run.mjs`.

**«Banco» significa**: `node scripts/engine-bench/run.mjs --motor <bin> --repeticiones 3` con el modelo gratuito fijado por ID, en el contenedor del VPS, comparado con `--comparar` contra la nueva línea base de 6.1.

**Criterio general de cada paquete**: el éxito no baja más de 1 tarea, y ninguna tarea estable (3/3) cae a 0/3.

### 6.1 Banco más duro y línea base de 3 corridas (requisito previo)

**Por qué**: con 16/16 y n = 1 no se ve ninguna mejora.

**Tareas nuevas** (`scripts/engine-bench/tareas/`, mismo formato `TNN-*.mjs` con verificador determinista):

| Tarea | Qué pide | Qué mide |
|---|---|---|
| T19 | Sesión larga: 20 pedidos encadenados que se refieren a decisiones de los pedidos 2 y 5 («usa el nombre que elegimos antes»). El verificador comprueba esas referencias en el resultado final | Coherencia |
| T20 | Carta e informe en español con «», “” y —; el pedido obliga a editar frases que contienen esos signos | Edición tolerante (H12) |
| T21 | Migración de 5 pasos con dependencias reales (el paso 3 falla si no se hizo el 2) | Tareas con dependencias (H11) |
| T22 | Pruebas que emiten unas 20 000 líneas de salida con 1 fallo escondido | Ganchos de salida (H5) |
| T23 | Un archivo que un «otro proceso» del verificador cambia a mitad de la sesión (guion con `sleep` en un shell de fondo) | Avisos de cambio (H9/H10) |

**Métrica nueva** en el informe: `tokens_enviados_por_paso` (mediana y p90).

**Línea base**: `lazunox.10` más las olas 1-5 integradas, 3 corridas, repartidas en varios días para respetar la cuota gratuita: `--reanudar` ya existe. Se anotan la fecha y el ID del modelo, que cambian.

**Hecho cuando**: existe `linea-base/real-ola5-<fecha>.json` con n = 3 por tarea, `--autoprueba` pasa en T19-T23 (el verificador falla en la carpeta inicial y pasa con el guion), y al menos 2 de las 5 tareas nuevas **no** salen 3/3 con el motor actual. Si salen todas 3/3, se endurecen.

**Seguridad**: solo en el contenedor del VPS (el ejecutor ya se niega fuera de él). T23 no puede escribir fuera de su carpeta temporal.

### 6.2 Umbral de compactación anticipado y valores por modelo (H1 + H2)

**Fork**:
- `core/src/v1/config/config.ts`: `compaction.umbral`. Acepta un entero (tokens) o `"NN%"` de lo usable, con un mínimo de 16 000 y nunca por encima de lo usable.
- `session/overflow.ts`: `isOverflow` usa `min(usable, umbral)`. `usable()` no cambia, porque también lo usa el recorte del resumen.
- `compaction.por_modelo: { "<proveedor/modelo>": { umbral?, preserve_recent_tokens? } }`, que gana al valor global.
- El umbral se mide sobre lo que crece **después del prefijo fijo**: `tokens.total` menos el estimado de sistema y herramientas, como el alcance `body_after_prefix` de Codex. Así un contexto fijo grande no dispara compactaciones en bucle.

**App**: fija un valor por defecto para los gratuitos, por ejemplo `umbral: 96000`. Es una cifra **a calibrar con el banco** y no se publica sin datos.

**Restricción**: no compactar dos veces seguidas sin al menos 2 turnos nuevos. Si el resumen más la cola ya superan el umbral, no compactar y registrarlo.

**Pruebas**: `test/lazunox/umbral-compactacion.test.ts` (entero, porcentaje, por modelo, sin bucle). Con `PROBE_ONLY=umbral` y el proveedor falso devolviendo `usage` creciente, debe compactar al cruzar el umbral y no antes.

**Hecho cuando**:
- en el banco, `tokens_enviados_por_paso` p90 baja **−30 %** en T09 y T19, y los tokens enviados totales bajan −20 % en T09, T10 y T19;
- T19 no baja de éxito.

**Amenazas**: un umbral demasiado bajo cae en un bucle de compactaciones, lo que es gasto y negación de servicio (lo cubren el tope y la prueba). `por_modelo` solo se lee de la configuración global de la app, no del proyecto, igual que el comando de LSP en 4B: un repo hostil no puede fijar `umbral: 16000` para quemar la cuota.

### 6.3 Ayudantes con contexto mínimo (H3 + H4)

**Fork**:
- `core/src/v1/config/agent.ts`: campo `contexto: "completo" | "minimo"`. `omitClaudeMd: true` de Claude se traduce a `minimo` en `config/agent-claude.ts`.
- En `session/prompt.ts:1554-1562`, con `minimo` y una sesión hija:
  - no se cargan `instruction.system()` ni la lista de skills (`sys.skills`);
  - MCP solo si el agente tiene alguna herramienta MCP permitida;
  - el prompt base pasa a uno corto del agente (el suyo propio).
- Nativos con `minimo` por defecto: `explore`, `verificador`, `revisor`. Nunca `general` ni `build`.
- `task` gana `exhaustividad: "rapida" | "media" | "a_fondo"` solo para `explore`. Se traduce en `steps` (6, 15 y 40) y una línea en su prompt.

**Restricción**: `minimo` **no** quita las reglas por ruta (4D), que siguen adjuntándose al leer. Tampoco cambia los permisos. Si AGENTS.md declara algo como «no ejecutes X», el freno real sigue siendo el permiso.

**Pruebas**: `test/lazunox/contexto-minimo.test.ts`: el cuerpo de la petición de la hija no contiene el marcador de AGENTS.md ni `<available_skills>`, y el de `general` sí. Con `PROBE_ONLY=ayudantes2`, `GET .../contexto-fijo` de la hija baja.

**Hecho cuando**: en el banco, los tokens enviados de las hijas bajan **−35 %** en T03, T08 y T15, y T14 (revisor) mantiene el éxito.

**Amenazas**: un agente de un repo hostil se declara `minimo` para no ver AGENTS.md. Eso solo le quita contexto, nunca le da permisos, y se acepta. Riesgo de que un agente que **edita** pierda reglas del proyecto: `minimo` se niega (se registra y se ignora) si el agente tiene `edit` permitido.

### 6.4 Resumen robusto (H7 + H8)

**Fork** (`session/compaction.ts`):
- Tras el resumen, se comprueba que estén los 5 encabezados de `SUMMARY_TEMPLATE` (`core/src/session/compaction.ts:16-46`).
- Si faltan, se hace 1 reintento con un recordatorio fijo (sin texto del modelo). Si vuelve a fallar, se acepta el resumen tal cual con `metadata.lazunox_resumen = "incompleto"`. **Nunca falla la compactación**, a diferencia de OpenCode, que da error.
- El prompt del resumen gana una línea con las herramientas usadas en la parte resumida (nombre y número, sin contenido).
- Si `ajustarConversacion` descartó mensajes, se añade una nota fija al bloque `<contexto-vigente>`: «N mensajes antiguos no entraron en este resumen».

**Pruebas**: `test/lazunox/resumen-robusto.test.ts`, con el proveedor falso devolviendo primero un resumen sin secciones y después uno bueno, y otro caso que se descarta.

**Hecho cuando**:
- en `PROBE_ONLY=resumen` hay exactamente 2 peticiones de resumen en el caso malo;
- en el banco, T09 y T19 no bajan de éxito, y en T19 las 2 referencias a decisiones viejas se cumplen en ≥ 2 de 3 corridas.

**Amenazas**: el recordatorio no puede incluir texto de la conversación, para no amplificar una inyección. Los nombres de herramienta salen de la lista registrada; un nombre MCP hostil se neutraliza.

### 6.5 Edición tolerante a Unicode (H12)

**Fork**: `tool/edit.ts` gana un `UnicodeNormalizedReplacer`, el último antes de `MultiOccurrenceReplacer`.
- Normaliza, solo para **buscar**: `‘’‚‛` → `'`, `“”„‟«»` → `"`, `‐‑‒–—―` → `-`, NBSP y espacios finos → espacio, `…` → `...`.
- Se busca sobre las versiones normalizadas de `oldString` y del archivo, con un mapa de posiciones de la normalizada al original.
- Se reemplaza el **tramo original**, que conserva las comillas del archivo fuera del cambio.
- Solo vale con **una única** coincidencia.

**Restricción**:
- Nunca toca `newString`: si el modelo escribe `"` y el archivo usa «», queda lo que escribió el modelo, y el resultado de la herramienta lo dice en una línea.
- Nunca se aplica a archivos binarios.
- Pasa la comprobación existente de «tramo mucho mayor que `oldString`» (`tool/edit.ts:711`).

**Pruebas**: `test/lazunox/edit-unicode.test.ts`: comillas, guiones, NBSP, dos coincidencias (debe fallar) y la equivalencia con los demás *replacers* en sus casos.

**Hecho cuando**:
- en el banco, T20 pasa de su línea base a ≥ 2 de 3, y T17 se mantiene;
- en `PROBE_ONLY=bytes`, ninguna regresión en los guiones de edición existentes.

**Amenazas**: que coincida en el lugar equivocado. Lo frenan la unicidad y el tope de tamaño. No hay superficie nueva de permisos.

### 6.6 Lista de tareas con dependencias (H11)

**Fork**:
- `schema/src/session-todo.ts`, `session/todo.ts`, `tool/todo.ts` y `tool/todowrite.txt`.
- Campo `depende_de?: string[]`, con los `id` de tareas de la **misma** lista, máximo 10.
- `todowrite` rechaza la lista entera si hay:
  - ciclos;
  - ids inexistentes;
  - una tarea `in_progress` o `completed` con dependencias que no están `completed`.
- Migración en `packages/core`, como hizo 2D.
- `session/contexto-vigente.ts` reinyecta las dependencias al compactar.
- `command/template/lote.txt` (4C): las unidades con `depende_de` van en serie después de las suyas, y el resto en paralelo.

**Pruebas**: `test/lazunox/todo-dependencias.test.ts` (ciclo, inexistente, orden, compactación). En `PROBE_ONLY=todo-deps`, `GET .../todo` devuelve `depende_de`.

**Hecho cuando**: T21 ≥ 2 de 3 y T10/T11 sin bajar de éxito. En T15 (lote), ningún ayudante arranca antes que su dependencia (se mira el orden de los `parentID` y las horas).

**Amenazas**: casi ninguna. El `verificar` de 2D sigue pasando por el permiso de shell. Una lista enorme queda cortada por el tope de 10 dependencias por tarea y por el tope existente de la lista.

### 6.7 Avisos de cambios: archivo cambiado por fuera y diff del shell (H9 + H10)

**Fork**:
- **Aviso al empezar cada paso**. `session/lecturas.ts` gana `cambiadas(sessionID)`: comprueba `mtime` y tamaño, y el hash si cambiaron, de las rutas leídas que siguen visibles; máximo 50 rutas por paso.
- Si alguna cambió y la sesión no la editó, se añade **una** parte sintética persistida al mensaje de la persona en curso. Lleva solo las rutas, sin contenido: «Estos archivos cambiaron fuera de esta sesión desde que los leíste: … Vuelve a leerlos antes de editarlos». Al ser persistida, no rompe el prefijo.
- **Diff del shell**. Tras `shell` (no en segundo plano), si la instantánea del paso muestra archivos cambiados por el comando, se añade al resultado `Archivos que cambió el comando: <ruta> (+a −b)`: máximo 20 rutas, **sin el contenido del diff** por defecto. Con `LAZUNOX_SHELL_DIFF=contenido` se muestra el diff, hasta 4 KB.

**Restricción**:
- Ni el aviso ni el diff incluyen rutas de `permission/rutas-protegidas.ts` ni archivos que `read` pediría permiso para ver (`.env*`). Esas salen como «1 archivo protegido cambió».
- Las rutas se neutralizan, porque un nombre de archivo puede ser una inyección.

**Pruebas**: `test/lazunox/avisos-cambios.test.ts` (cambio externo, cambio propio sin aviso, `.env` oculto, nombre de archivo hostil). `PROBE_ONLY=cambios`.

**Hecho cuando**: T23 ≥ 2 de 3 frente a su línea base, y en T04/T06 baja el número de `read` repetidos (se mide con el informe, `herramientas.read`).

**Amenazas**:
- Fuga de secretos al contexto por el diff: por eso por defecto no hay contenido, y además se filtran las protegidas.
- Inyección por nombre de archivo: se neutraliza.
- Coste del `stat` en carpetas grandes: hay tope de rutas.

### 6.8 Ganchos de salida: `updatedToolOutput`, `PostToolUseFailure`, `PermissionDenied` (H5)

**Fork** (`plugin/lazunox-ganchos.ts`, tipos en `packages/plugin`):
- **`PostToolUse`** con código 0 y `{"updatedToolOutput": "<texto>"}` reemplaza `o.output`.
  - Es solo texto, hasta 64 KB.
  - Se conserva el original completo en `Truncate.DIR` y se añade la ruta, así el modelo puede leerlo si el filtro se equivocó.
  - Se aplica a herramientas nativas y MCP. Solo cambia el texto, nunca `metadata` ni archivos.
- **`PostToolUseFailure`**: el mismo evento cuando la herramienta falla. Solo informa o añade contexto, hasta 2000 caracteres.
- **`PermissionDenied`**: se dispara al negarse un permiso. Solo informa (stdin con la herramienta y la regla, sin argumentos sensibles). **No** se implementa el `retry: true` de Claude: reintentar algo negado sin una persona choca con la decisión 2026-09-28.

**Restricción**: el archivo de ganchos sigue siendo **solo** `LAZUNOX_HOOKS_FILE`, de la app. Ningún proyecto trae los suyos (hay prueba existente).

**Pruebas**: `ganchos-ampliados.test.ts` ampliado: reemplazo válido, salida gigante, código ≠ 0 (nada cambia), original en archivo, MCP.

**Hecho cuando**: en T22, con un gancho de ejemplo de la app que deja solo las líneas `FAIL|Error|✗` y el resumen final, los tokens enviados bajan **−40 %** y el éxito no baja. El gancho de ejemplo se publica en la documentación de la app, apagado por defecto.

**Amenazas**:
- Un gancho que **oculta** un fallo, de modo que el modelo cree que todo pasó. Lo mitiga el original en archivo con su ruta, y el `verificar`/objetivo, que corren su propio comando y no leen la salida filtrada.
- Superficie de ejecución: no hay nueva, porque es el mismo archivo de la app y los mismos topes de tiempo.

### 6.9 Ayudante «fork» que hereda la conversación (H6)

**Fork** (`tool/task.ts`, `tool/task.txt`):
- `task` gana `heredar: "nada" | "conversacion"`, con `nada` por defecto.
- Con `conversacion`, la sesión hija se crea copiando los mensajes **visibles** del padre hasta el turno actual. Usa la copia del fork de sesión (5D) y se marca `metadata.lazunox_fork_de = <padre>`.
- Se reutiliza el mismo modelo y el mismo sistema, para aprovechar la caché del padre.
- Al final se añade el prompt de la subtarea con una línea: «Eres un ayudante bifurcado: haz SOLO esto y devuelve un informe».
- Un fork no puede crear forks (profundidad efectiva 1 para `heredar`).
- Cuenta para `LAZUNOX_MAX_SUBAGENTS`. Permisos: los de 2A, es decir, la intersección con el padre y su sesión, y el tope del modo plan.

**Restricción**:
- No copia permisos «siempre» de la sesión que el padre obtuvo **después** de lanzar.
- No copia el estado del objetivo (3A) ni del presupuesto (3B). El presupuesto de la hija cuenta en el del padre, como hoy en `run`.
- Informe acotado (1C).

**Pruebas**: `test/lazunox/task-heredar.test.ts`: la hija ve los mensajes del padre, el cuerpo de su primera petición comparte el prefijo con la última del padre (comparación byte a byte del sistema y del prefijo de `messages`), no puede bifurcar otra vez y no supera los permisos.

**Hecho cuando**: con una variante de T08 («resume 3 módulos que ya leíste»), en ≥ 2 de 3 corridas los tokens **no cacheados** de las hijas bajan −40 % frente a `heredar: nada`, y `cache_leida/enviados` de las hijas ≥ 70 % con Zen.

**Amenazas**: el historial copiado contiene texto no confiable que ya leyó el padre. La hija no tiene más permisos que el padre, así que no hay escalada, pero el mismo contenido hostil se ejecuta dos veces. Por eso queda **apagado por defecto** y la plantilla de `/lote` no lo usa salvo petición expresa.

**Dependencia**: 5D (fork de sesión) fusionado.

### 6.10 Respaldo de modelo gratuito (H13)

**Fork** (`session/retry.ts`, `session/processor.ts`, configuración):
- `respaldo: ["<proveedor/modelo>", …]`, hasta 3, **solo en la configuración global de la app**.
- Se activa si el error es (a) sobrecarga o 5xx no reintentable, como en Claude, o (b) **cuota gratuita agotada** (el `retry` con `action`, o «Free usage exceeded», que `run` ya detecta: `LAZUNOX.md` §`run`). El caso (b) es extensión nuestra: Claude no conmuta por límite de uso.
- Dura **un turno**, como en Claude. Se registra en el mensaje del asistente (`metadata.lazunox_respaldo = {de, a, motivo}`) y la app lo muestra.

**Restricción**:
- Solo modelos de **coste cero** del catálogo, con `cost.input == 0` y `cost.output == 0` en `models.dev`, o la lista de gratuitos de la app. Así nunca se cae en un modelo de pago.
- Si el respaldo es de **otro proveedor**, hace falta que la persona lo haya activado en Ajustes con un aviso de que la conversación se envía a ese proveedor.
- El modelo pequeño (1C) **no** usa respaldo de otro proveedor: mantiene la regla del mismo proveedor.

**Pruebas**: `test/lazunox/respaldo-modelo.test.ts`, con un proveedor falso que responde 529 y luego cuota; un respaldo con coste mayor que 0 se rechaza, y con otro proveedor sin consentimiento no se conmuta.

**Hecho cuando**: en el banco, las corridas marcadas `cuota` bajan a 0 cuando hay un respaldo gratuito con cupo, y las tareas hechas con respaldo cuentan aparte en el informe (columna `respaldo`) para no mezclar modelos al comparar.

**Amenazas**:
- Fuga de datos a un proveedor no elegido: mitigada con mismo proveedor por defecto y consentimiento para otro.
- Gasto de pago accidental: mitigado por el filtro de coste cero, que se comprueba en cada conmutación y no solo al guardar.
- Un repo hostil no puede fijar `respaldo`.
- Comportamiento distinto entre corridas del banco: se separa en el informe.

## 3. Orden, dependencias y tandas

```
6.1 banco ──► todo lo demás (medición)
Tanda A (bajo riesgo, más ahorro):   6.2 umbral · 6.3 contexto mínimo · 6.5 edición Unicode · 6.4 resumen robusto (después de 6.2: comparten compaction.ts)
Tanda B (hilar y subdividir):        6.6 dependencias · 6.7 avisos de cambios · 6.8 ganchos de salida
Tanda C (riesgo medio):              6.9 fork heredado (necesita 5D) · 6.10 respaldo de modelo
```

**Dueños de archivo por tanda**:
- `session/compaction.ts`: primero 6.2 y después 6.4.
- `session/prompt.ts`: 6.3 en la tanda A, y 6.7 en la B para el aviso al empezar el paso.
- `tool/task.ts`: solo 6.9.
- `plugin/lazunox-ganchos.ts`: solo 6.8.
- `session/processor.ts`: solo 6.10. Atención: 5B (paralelo) también lo toca, así que 6.10 va después de que 5B se fusione.
- `tool/edit.ts`: solo 6.5.

**Antes de la tanda A**: que la Ola 5 esté fusionada. 5C (compactación en segundo plano) cambia cuándo se compacta, así que 6.2 se calibra **sobre** 5C.

**V y S por tanda**, como en el plan maestro. Amenazas que mira S:
- **S-A**: bucle de compactaciones y gasto (6.2); un agente que edita sin reglas (6.3); una coincidencia de edición equivocada (6.5).
- **S-B**: fuga de secretos por el diff (6.7); un gancho que oculta un fallo (6.8); una inyección por nombre de archivo (6.7).
- **S-C**: contenido hostil duplicado en la hija (6.9); fuga de datos a otro proveedor y gasto de pago (6.10).

**Estimación**: 6.1 son 2-3 días más varios días de cuota para la línea base. Las tandas A y B, unos 4-6 días de código cada una más 1-2 de V y S. La tanda C, 1 semana. En total, unas 4-5 semanas al ritmo del Mac (1-2 agentes pesados; lo pesado al VPS).

## 4. Límites de esta investigación

- **Cómo se leyó la web**: la leyeron tres sub-investigaciones el 2026-10-26 con WebFetch, que **resume** las páginas. Las citas de `CCL` y de `CC/sub-agents`, `CC/model-config` y `CC/skills` pasaron por ese resumidor y pueden diferir un poco del texto literal. Las de `CC/hooks-guide`, `CC/tools-reference`, `CC/prompt-caching`, `CC/memory` y `CC/interactive-mode` se tomaron del texto crudo.
- **Claude Code**:
  - el CHANGELOG no tiene fechas, así que **no pude separar lo publicado en 2026**;
  - se leyeron unos 900 000 de 1 084 701 caracteres, y lo más antiguo quedó sin leer;
  - `CC/hooks` se leyó hasta 200 000 de 282 000 caracteres (faltan los ganchos asíncronos);
  - `goal`, `permission-modes`, `headless`, `best-practices` y `settings` no se releyeron en esta pasada (ya estaban en el plan maestro).
- **Codex**:
  - el changelog se leyó desde 0.161 en adelante, y de 0.150-0.160 no se vio nada;
  - no se leyó la gramática `apply_patch.lark`;
  - la página de `goal` dio 404;
  - no se confirmó qué conserva `new_context` ni cuánto inyectan las memorias.
- **OpenCode**:
  - el CHANGELOG cubre solo 2.0.26-2.1.4, y no hay notas de 2.0.0-2.0.25;
  - el código de la v2 se movió a `packages/core` y `packages/ai`;
  - no confirmé que la v2 no tenga otra reparación de llamadas o detección de bucles en archivos que no se leyeron.
- **Fork**:
  - leí `feat/ola3-integrada` (olas 1-4). La Ola 5 no tiene commits, así que lo que hagan 5A-5D puede cambiar líneas citadas aquí (en especial `session/processor.ts` y `session/compaction.ts`);
  - no comprobé si `ajustarConversacion` avisa al modelo de los mensajes descartados (H8: «no ver.»);
  - no comprobé la ventana real de `deepseek-v4.1-flash-free` ni de MiMo en el catálogo: las cifras de umbral de 6.2 son **a calibrar**, no a copiar.
- **Cifras**: los porcentajes de los «hecho cuando» son objetivos propuestos, no mediciones. La línea base actual tiene n = 1, y 6.1 existe para fijarlos con n = 3.
