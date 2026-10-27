# Análisis de OpenCode 2.x frente al motor de Lazunox

Fecha: 2026-10-27. Solo lectura: no se ejecutó ningún binario de terceros ni se llamó a ningún modelo.

- **Fuente 2.x**: clon de OpenCode 2.x (MIT). Rutas `core/...` = `packages/core/src/...`.
- **Nuestro motor**: `~/Documents/lzx-wt/ola7-final/packages/opencode/src` (rama `feat/ola7-final`, commit 87ff019). Rutas `lzx/...` = ese directorio.
- **Medidas del banco**: `scripts/engine-bench/linea-base/comparativo-motores-2026-10-27/proxy.jsonl` (peticiones reales del comparativo, modelo `deepseek-v4.1-flash`).
- **Trabajo de a26b1e6b50fc34569** (`feat/ola7-tokens`): mirado en `~/Documents/lzx-wt/ola7-tokens` (6 commits más cambios sin confirmar). Esta tabla marca qué cubre él y qué no.

## 1. Resumen en español simple (10 líneas)

1. OpenCode 2.x gasta menos porque casi todo lo que manda en cada paso es **mínimo**: un prompt de sistema de unos 1 500 caracteres (el nuestro por defecto: 8 258; el de Claude: 7 779; el de GPT: 9 283 contra 2 572 de ellos).
2. Las descripciones de sus herramientas son cortas: las 12 principales suman unos **5 300 caracteres**; las nuestras, unos **16 900** (solo la de `bash` pasa de 4 000 con su plantilla y su bloque de git). La diferencia son unos 2 900 tokens por paso.
3. Sus herramientas MCP **no van sueltas**: entran todas por una sola herramienta `execute` (Code Mode) con un catálogo de máximo 2 000 tokens y un `search` para el resto. Eso explica 7 500 contra 22 800 tokens por paso con 40 herramientas MCP.
4. En el banco, nuestra búsqueda diferida de herramientas MCP estaba **apagada por defecto** (`tool-search.ts:41`), y Code Mode es experimental. Por eso «no se notó». Lo que a26b… hace con `busqueda` lo arregla; hay que confirmar con el banco T12.
5. Todo lo que cambia durante la sesión (fecha, entorno, lista de habilidades, catálogo de MCP, AGENTS.md) va como **mensajes de aviso con diferencias**, y el sistema y la lista de herramientas quedan fijos. Nosotros ya hicimos algo parecido (7.9), pero la fecha y el entorno siguen dentro del sistema.
6. Nuestro **caché ya está bien cuidado** (herramientas ordenadas, bloques de sistema estables, marcas en primer y último bloque). Pero en el banco la primera petición de cada sesión nuestra leyó de caché solo el **3,9 %**; OpenCode 2.x un 30 % y Codex un 70 %. Algo del comienzo de nuestra petición cambia entre sesiones y no sabemos qué (hipótesis abajo).
7. Su **compactación** pide el resumen con el mismo sistema, las mismas herramientas y el mismo historial que la conversación, así el proveedor lee el prefijo de su caché. La nuestra manda `tools: {}` y `system: []` (`lzx/session/compaction.ts:807-808`): paga el contexto entero a precio completo.
8. Tienen detalles baratos y buenos: comparten la clave de caché entre el agente principal y sus subagentes, topan el `retry-after` en 15 minutos (el nuestro no tiene tope) y recortan las imágenes antiguas sin romper el caché en cada paso.
9. En seguridad, lo nuestro (7.7 y 7.20) ya llega más lejos en el shell y en políticas duras; de ellos vale la idea de marcar un comando como «opaco» cuando no se puede analizar y preguntar siempre.
10. No conviene copiar: su arquitectura Effect v2 completa, el parser tree-sitter, las piezas atadas a la Consola de OpenCode (política gestionada, límites de uso), los «pings» de calentamiento de caché ni la búsqueda web de pago. MIT permite todo, pero hay que reimplementar o conservar el aviso.

## 2. Evidencia por pregunta

### 2.1 Prompt de sistema y lista de herramientas por paso

**Cómo lo arma OpenCode 2.x**

- Un solo prompt base mínimo: `core/session/runner/prompt/system.txt` (756 caracteres) con un hueco `${OPENCODE_TOOL_GUIDANCE}`. `core/session/system-prompt.ts:10-31` rellena ese hueco **solo con las líneas de las herramientas que existen** (shell, write, edit). Sin `shell`, no hay texto de shell.
- Por modelo solo hay pequeños añadidos (`core/plugin/optimize.ts:16-30`): GPT usa `gpt.txt` (2 572 caracteres) o `gpt-astra.txt` (3 825); Claude **añade** `anthropic.txt` (300) al base; Kimi (8 701), Trinity (7 684) y Meta (7 853) conservan prompts largos heredados. Todo el resto de modelos (DeepSeek incluido) usa solo el base.
- Las partes que cambian no van en el sistema: `baseTranscript` (`core/session/model-request.ts:92-112`) arma `system = [prompt, instrucciones iniciales]`. Las instrucciones son fuentes con clave y hash (`core/instructions/index.ts`), ordenadas «de más a menos compartido» (`core/session/context.ts:153-165`): catálogo Code Mode, MCP, referencias, habilidades, descubrimiento, fecha y entorno, AGENTS.md. Después de la línea base solo se envían **diferencias** como mensajes (`core/codemode/instructions.ts:32-124`, `core/skill/instructions.ts:35-64`, `core/mcp/instructions.ts`).
- Herramientas: las nativas (read, edit, write, shell, grep, glob, patch, todo, subagent, question, skill, webfetch, websearch) van directas y ordenadas por nombre (`core/tool.ts:~268-272`). Todo lo demás (**las MCP por defecto**, `core/tool/mcp.ts:52`; y las del espacio `opencode`) queda detrás de una única `execute` (`core/tool.ts:261-263`).
- Code Mode: la descripción de `execute` es fija (~1 100 caracteres, `core/codemode/tool.ts:71-78`). El catálogo se recorta con presupuesto de **2 000 tokens** (`core/codemode/catalog.ts:47-49`): cada herramienta sale como firma TypeScript + primera línea de descripción cortada a **120 caracteres**; se reparte por rondas entre espacios de nombres, primero las listas más cortas (`catalog.ts:114-126`). Lo que no cabe se busca con `search(...)` dentro del código. Hay marca `pinned` para las que siempre se muestran.
- Servidores que ya son Code Mode (executor, PostHog) se excluyen para no anidar (`core/plugin/mcp-codemode-defaults.ts`).

**Tamaños, en caracteres** (OpenCode 2.x contado de los archivos; nuestro de los `.txt` y plantillas actuales de `ola7-final`, **antes** de los recortes de a26b…)

| Pieza | OpenCode 2.x | Lazunox (ola7-final) |
|---|---|---|
| Prompt base (DeepSeek/otros) | 756 + ~750 de guía = ~1 500 | `default.txt` 8 258 |
| Prompt Claude | +300 | `anthropic.txt` 7 779 |
| Prompt GPT | 2 572 | `gpt.txt` 9 283 (`codex.txt` 7 389, `beast.txt` 11 079) |
| Prompt Gemini | no tiene propio | `gemini.txt` 15 371 |
| read | 505 | 1 158 |
| edit | 968 | 1 369 |
| write | 252 | 623 |
| grep / glob | 271 / 104 | 657 / 517 |
| shell (descripción) | ~530 | `shell.txt` 1 269 + `bashCommandSection` 2 844 + perfil ≈ 4 500 (`lzx/tool/shell/prompt.ts`) |
| todo | 512 | 2 622 |
| subagente / task | 669 (+ lista de agentes) | 2 305 |
| question / skill | 502 / 278 | 657 / 680 |
| webfetch / websearch | 466 / ~210 | 750 / 1 033 |
| Suma de las 12 principales | **~5 300** | **~16 900** |
| Otros nuestros sin equivalente | | lsp 1 303, cuaderno 678, plan-enter/exit ~1 200 |

Medido en el proxy (`proxy.jsonl`, 65 primeras peticiones de Lazunox y 65 de OpenCode 2.2.0): primera petición de 8 212 y 4 667 tokens; bytes de la petición 34 174 y 19 744; 10 y 9 herramientas. Es decir, **no es que tengamos más herramientas, sino que cada una pesa más** (descripción y esquema de parámetros: la `shell` nuestra lleva además `background`, `yield_ms`, `avisar_si` y `workdir`, cada uno con descripción larga).

**Lo que el otro agente (a26b…) ya cubre**: `bash`, `task`, `todo`, `read/edit/write/glob/grep` más cortos, `default-compacto.txt` (7 389 caracteres: **solo −10 %** sobre `default.txt`) y `busqueda` (búsqueda diferida automática).

**Lo que a26b… no mira y OpenCode sí**

1. El prompt base sigue ~5× más grande que el de ellos. El corte de 10 % no alcanza para igualar los ~1 700 tokens que sobran. Hace falta el patrón de OpenCode: base mínimo + guía por herramienta presente + reglas de git/seguridad movidas a la descripción de la herramienta que las necesita.
2. Los prompts por modelo `anthropic.txt`, `gpt.txt`, `gemini.txt`, `codex.txt`, `beast.txt` no tienen versión compacta (el banco usó DeepSeek, que cae en `default`, pero Ben usa también Claude y GPT).
3. Herramientas fuera de su lista: `question`, `skill` (`skill.txt:1-5` repite tres veces «listadas en el prompt del sistema»), `webfetch`, `websearch`, `lsp`, `cuaderno`, `plan-enter/exit`.
4. Peso del **esquema** de parámetros, no solo de la descripción (shell y task).
5. Habilidades: `lzx/session/system.ts:144` las manda en modo «verbose» dentro del sistema; ellos solo `id`, `name`, `description`.
6. El presupuesto de catálogo: primera línea ≤120 caracteres y tope 2 000 tokens también para `tool_search`.

### 2.2 Caché de prompt

**OpenCode 2.x**

- Política automática: marcas de caché en la **última herramienta**, el **primer y el último bloque de sistema** y el **final de la conversación**, máximo 4 (`ai/src/cache-policy.ts:5-12`). Para pasarelas (OpenRouter, Vercel) **solo marca si el origen es Anthropic o Qwen**, porque en Gemini «escribe un caché nuevo en cada paso y cuesta más que no marcar» (`cache-policy.ts:70-75`).
- Clave de caché y afinidad: `promptCacheKey` y cabeceras `x-session-affinity`, `X-Session-Id` usan la sesión **raíz**: los hijos usan la del padre y las bifurcaciones la de la sesión origen (`core/session/affinity.ts:6`, `core/session/model-request.ts:293-294`). Hay también `cache.ttl` por modelo.
- Imágenes: `boundImages` (`model-request.ts:195-215`) quita las más antiguas con **histéresis** (dispara a 25 MiB, baja a 15 MiB), de modo que el prefijo solo cambia cada ~10 MiB y no en cada petición.
- En el paso límite mantiene las herramientas y usa `toolChoice: "none"` para no romper el prefijo (`core/session/runner/llm.ts:243`).
- Compactación: no cambia el prefijo hasta que sea necesario (`core/session/compaction.ts:332-337`, ver 2.3).
- Opcional: `WarmingPlugin` manda un «ping» cada 4 minutos durante 30 (`core/plugin/warming.ts`).

**Lo nuestro, ya bien**: herramientas ordenadas por nombre (`lzx/session/llm/request.ts:212-213`); bloques de sistema con entorno al final (`lzx/session/system.ts:56-65`); marcas en primer y último bloque (`lzx/provider/transform.ts:358-360`); avisos con diferencias (7.9, `session/instrucciones-diff.ts`).

**Lo que rompemos o perdemos**

- La fecha y el entorno siguen dentro del sistema (`system.ts:110`): cambian a medianoche y por carpeta. Pequeño.
- La clave de caché y la afinidad usan la sesión propia incluso en subagentes (`lzx/provider/transform.ts:1328,1337,1384`, `lzx/session/llm/request.ts:199`). Los subagentes de Lazunox (explore, revisor, verificador) comparten herramientas casi iguales y no se encaminan al mismo nodo de caché que el padre.
- Marcas de caché también para OpenRouter con cualquier origen (`transform.ts:367-370`).
- No acota imágenes (`grep IMAGE_BYTES` en nuestro motor: sin resultados).
- **Dato del banco**: leyeron de caché en la primera petición de cada sesión: OpenCode 2.2.0 **29,9 %**, Codex **69,7 %**, Lazunox **3,9 %**. En el resto de pasos están parejos (89 %, 91 %, 92 %). Entre tareas distintas el prefijo (sistema + herramientas) debería ser igual; el nuestro no lo es. **Hipótesis sin probar** (hay que comparar byte a byte las dos primeras peticiones de dos sesiones): (a) el texto específico de la carpeta (AGENTS.md, entorno con directorio) cae antes de las herramientas en la plantilla del modelo; (b) cambian por sesión los avisos que cuelgan de variables (`LAZUNOX_*`, modo, habilidades del proyecto); (c) la lista de ayudantes en la descripción de `task`. Es investigación, no cambio.

### 2.3 Bucle del agente

| Tema | OpenCode 2.x | Lazunox | Observación |
|---|---|---|---|
| Reintentos | Exponencial desde 2 s con tope 10 s por espera, 10 reintentos (~84 s), `retry-after` acotado a **15 min**, máximo 3 reintentos por *timeout* (`core/model-retry.ts:11-12,22-25,40`); gancho `retry` de plugin | 5 reintentos, tope 30 s sin cabeceras, **`retry-after` sin tope** (`lzx/session/retry.ts:29-31`) | Poner tope de 15 min. Cada reintento reutiliza el mismo prefijo de caché |
| Reparar entrada de herramientas | Plugin que repara por esquema: cadenas a objeto/número/booleano, `null` opcional, arreglos, tuplas, `$ref` (`core/plugin/tool-input-repair.ts:7-16`) | 7.13 (`lzx/tool/reparar-entrada.ts`), ya hecho | Paridad; falta comparar casos con su lista |
| Límite de pasos | Mensaje de asistente con texto estricto y `toolChoice: none`, herramientas se mantienen (`runner/max-steps.ts`, `runner/llm.ts:243`) | Solo aviso (6.3) | Paridad |
| Salida larga | 2 000 líneas / 50 KiB, guarda el archivo completo en `tool-output/`, conserva 7 días y muestra el **principio** (`core/tool-output.ts:13-15,88-92`); `shell` guarda la **cola** | Igual límite, igual retención de 7 días (`lzx/tool/truncate.ts:12-15`) | Paridad |
| Respuesta cortada por longitud | Mensaje «no te disculpes ni repitas, divide el trabajo» (`runner/llm.ts:38`) | 7.4 `SalidaCortada` | Paridad |
| Compactación: cuándo | Techo = ventana − max(15 %, 16 k); resumen **en segundo plano** a 85 % del techo si pasa de 64 k (`compaction.ts:118-121,325-375`) | Umbral fijo `limit.input − min(20 k, salida)` más umbral anticipado 6.2 (`lzx/session/overflow.ts:6-33`) | Nuestra poda sigue reescribiendo salidas antiguas |
| Compactación: cómo | Resumen sobre el **mismo prefijo** (sistema, herramientas, historial) más el prompt (`compaction.ts:437-441,497-503`); formato fijo con «Objetivo, Requisitos, Decisiones, Estado»; punto de control `<conversation-checkpoint>`; si el proveedor dice «demasiado largo» reintenta al 85 %, 70 %, 50 %, 35 % (`compaction.ts:112`) | Agente `compaction` con `tools: {}`, `system: []` (`lzx/session/compaction.ts:703,776-808`) y plantilla de `agent/prompt/compaction.txt` | **Mejora clara** |
| Ayudantes | Subagente en sesión hija con identificador reutilizable, primer plano o fondo; solo lista de agentes en la descripción (`core/tool/plugin/subagent.ts:55-62,297-303`) | `task` + 7.x (heredado, exhaustividad, esfuerzo) | Paridad o mejor |

### 2.4 Herramientas

- **Que ellos tienen y nosotros no, o mejor diseñadas**
  - `execute` + `search` (Code Mode por defecto para MCP): mejor para ahorrar tokens. Nosotros tenemos el mismo paquete `codemode` (`lzx/tool/code-mode.ts`) pero solo experimental (`lzx/effect/runtime-flags.ts:59`) y con otra receta (celdas, `execute_wait`). Falta el **catálogo con presupuesto**. Ver fila 2 de la tabla.
  - `patch` de formato «Begin Patch» (1 092 caracteres) frente a nuestro `apply_patch` (1 098): equivalentes.
  - `read` con soporte de directorios, imágenes y PDF en una herramienta (`core/tool/plugin/read.ts:18-23,44`); en `glob`/`grep` se quitó la descripción larga y se evalúa prescindir de ambos con Claude/GPT (código desactivado en `optimize.ts:35-49`, con el motivo escrito: falta una UX para mostrar muchos grep/glob por shell). **No copiar**.
  - `edit`: cascada de coincidencias por tolerancia (comillas tipográficas, guiones, espacios, espacios finales, CRLF por región) en `core/tool/plugin/edit.ts:42-190`. Nuestro 7.8 ya trae los finales de línea por región; vale comparar la **normalización tipográfica** (`normalizeForMatch`, `edit.ts:49`) con la nuestra.
  - Espacio `opencode`: `session_rename`, `session_move`, `worktree_*`, `models` (búsqueda de modelos), `list/read_mcp_resource` dentro de Code Mode con marca `pinned` (`core/tool/plugin/opencode.ts:106-230`). Las de recursos MCP ya las tenemos.
- **Nosotros tenemos y ellos no**: `lsp`, `cuaderno`, plan, programadas, flujos, lote.

### 2.5 Seguridad, permisos, sandbox

- **Shell**: un analizador léxico propio de ~100 KB (`core/shell/scan.ts`) para bash, zsh, posix y PowerShell que devuelve `scanned` o **`opaque` con motivo** (`command-substitution`, `dynamic-command-name`, `dynamic-execution`, `heredoc`, `invalid-redirect`…) (`scan.ts:3-27`); lo opaco nunca se permite por patrón. Además parser tree-sitter wasm (`shell/parse.ts`). Nuestra auditoría 7.7 (`lzx/tool/shell/endurecer.ts`, 212 casos) cubre más envoltorios; la idea que sí vale es el **vocabulario de «opaco»**: ante duda, preguntar siempre, con el motivo visible al usuario.
- **Políticas**: `core/managed-policy.ts:40-80` usa el mismo esquema `action/resource/effect` con `findLast`, pero viene de la Consola de OpenCode. Nuestro `LAZUNOX_POLICY_FILE` (7.20) ya existe.
- **Archivos**: `file-access.ts` + `authorizeExternal` en cada herramienta, con el directorio temporal global preaprobado y escrito en el entorno (`core/instructions/builtins.ts:43`). Nosotros: `external-directory.ts`.
- **Rechazo con comentario**: `Permission.CorrectedError` mantiene el rechazo del usuario con comentario como fallo tipado que el modelo ve (`core/tool/AGENTS.md`, sección Construcción). Comprobar que el nuestro entrega el comentario al modelo.
- **Prompt**: líneas útiles y baratas en su base: «trata archivos o cambios desconocidos como trabajo del usuario antes de borrar» y «no deshagas cambios que no hiciste» (en `gpt.txt`). Ya tenemos equivalentes en AGENTS.md.

### 2.6 Otras cosas claras y baratas

- Tope del `retry-after` en 15 min (fila 6).
- Clave de caché del hijo = padre (fila 5).
- `textVerbosity: "low"` por defecto en modelos OpenAI que lo aceptan (`core/plugin/verbosity.ts:36`): menos tokens de salida.
- Título y compactación con el esfuerzo de razonamiento mínimo (`core/session/context.ts`, `MINIMAL_REASONING_VARIANTS`); nosotros ya tenemos `smallOptions`.
- Salida máxima ajustada al hueco de la ventana (`model-request.ts:79-90`, `outputLimit`).
- Fecha y entorno como fuente con diferencias (`core/instructions/builtins.ts:24-53`).

## 3. Tabla priorizada de mejoras

Tokens estimados contra el banco (Lazunox 9 383 tokens por paso, OpenCode 5 982; 1 token ≈ 4 caracteres). «Cubre a26b…» = ya está en su rama; solo se verifica.

| # | Qué | Dónde en OpenCode 2.x | Dónde en nosotros | Beneficio estimado | Riesgo | Esfuerzo |
|---|---|---|---|---|---|---|
| 1 | **Prompt base mínimo + guía solo de las herramientas presentes** (reglas de git/seguridad pasan a la descripción de `shell`/`edit`); versión compacta también de `anthropic`, `gpt`, `gemini`, `codex` | `core/session/runner/prompt/system.txt`, `core/session/system-prompt.ts:10-31`, `core/plugin/optimize.ts:16-30` | `lzx/session/system.ts:27-47` (`provider()`), `lzx/session/prompt/*.txt`; a26b… ya trae `default-compacto.txt` (−10 %) | −1 300 a −1 700 tokens por paso (14-18 % de 9 383); por sí solo cierra la mitad de la brecha | Medio: pierde pautas de conducta; hay que probar éxito en el banco con n≥5 | M |
| 2 | **MCP por defecto sin sueltas**: la búsqueda diferida encendida en el motor (no solo en la app) y catálogo con **presupuesto 2 000 tokens**, firma + primera línea ≤120 caracteres, reparto por rondas | `core/codemode/catalog.ts:47-126`, `core/tool.ts:261-263`, `core/tool/mcp.ts:52` | `lzx/tool/tool-search.ts:41` (por defecto `off`); `lzx/effect/runtime-flags.ts:59`; a26b… `busqueda` | Con 40 herramientas: de ~22 800 a ~7 500 tokens por paso (−15 000). Sin MCP: 0 | Medio-bajo: el modelo debe aprender a buscar; ya hay `mcp_call` | S (cubre a26b…; falta verificar T12 y el tope de 2 000 tokens del índice) |
| 3 | **Resumen de compactación sobre el prefijo normal** (mismo sistema, mismas herramientas con `toolChoice: none`, mismo historial + prompt de resumen) | `core/session/compaction.ts:437-441,497-503` | `lzx/session/compaction.ts:703-808` (`tools: {}`, `system: []`) | En cada compactación el prefijo (cientos de miles de tokens en sesiones largas) se lee de caché: ahorro de ~80-90 % del costo de esa petición | Medio: proveedores que rechazan herramientas sin mensajes; resumen con otra personalidad | M |
| 4 | **Tope del `retry-after` (15 min) y de reintentos por timeout** | `core/model-retry.ts:11-12,40` | `lzx/session/retry.ts:29-31` (`RETRY_MAX_DELAY` ≈ 24 días) | No cuelga una sesión con un proveedor roto. 0 tokens | Muy bajo | S |
| 5 | **Clave de caché y afinidad del subagente = la del padre** (y de la bifurcación = la de su origen) | `core/session/affinity.ts:6`, `core/session/model-request.ts:293-294` | `lzx/session/llm/request.ts:199`, `lzx/provider/transform.ts:1328,1337,1384` | Más aciertos de caché entre padre e hijos con herramientas iguales (explore/revisor/verificador). Difícil de cifrar; ganancia mayor con OpenAI/DeepSeek | Bajo | S |
| 6 | **Investigar por qué la primera petición no lee caché** (3,9 % contra 30 % y 70 %): registrar el hash por sección (herramientas, sistema, instrucciones, entorno) en dos sesiones y buscar el primer byte distinto | Datos de `proxy.jsonl`; `core/session/context.ts:153-165` como modelo | `lzx/session/system.ts`, `lzx/session/prompt.ts:1627-1664`, `lzx/session/llm/request.ts` | Si se encuentra: hasta ~2 000-4 000 tokens por sesión a precio de caché; en sesiones cortas es lo mayor que queda | Ninguno (medición) | M |
| 7 | **Descripciones y esquemas de las herramientas que a26b… no toca** (`question`, `skill`, `webfetch`, `websearch`, `lsp`, `cuaderno`, `plan-*`) y parámetros de `shell` (`background`, `yield_ms`, `avisar_si`) | `core/tool/plugin/{question,skill,webfetch,websearch}.ts` (278-502 caracteres cada una) | `lzx/tool/*.txt`, `lzx/tool/shell/prompt.ts:16-34` | −500 a −900 tokens por paso | Bajo | S |
| 8 | **Compactación en segundo plano y con reintento escalonado** (precalcular a 85 %, reducir a 85/70/50/35 % si el proveedor rechaza) | `core/session/compaction.ts:112,118-121,325-375` | `lzx/session/compaction.ts`, `lzx/session/overflow.ts` | Quita la pausa al compactar; en la práctica evita errores de «contexto demasiado largo» | Alto: es un cambio grande de comportamiento | L |
| 9 | **Recorte de imágenes antiguas con histéresis** (25 MiB → 15 MiB) | `core/session/model-request.ts:42-44,195-215` | `lzx/session/llm/request.ts` / `lzx/session/message-v2.ts` (no existe) | Evita errores por tamaño en sesiones con capturas (CDP, app) y no rompe caché en cada paso | Bajo | S |
| 10 | **No poner marcas de caché a pasarelas cuyo origen no cachea** (Gemini en OpenRouter: sale más caro) y marca en la última herramienta | `ai/src/cache-policy.ts:5-12,70-75` | `lzx/provider/transform.ts:358-390` (`applyCaching`) | Evita pagar escrituras de caché inútiles con Gemini/otros por OpenRouter | Bajo | S |
| 11 | **Fecha y entorno como aviso con diferencias**, fuera del sistema | `core/instructions/builtins.ts:24-53` | `lzx/session/system.ts:56-65,110` | El sistema queda idéntico entre días y carpetas; ganancia pequeña pero acumulada | Bajo | S |
| 12 | **Vocabulario «opaco» en el shell**: cuando el comando no se puede analizar (sustitución, nombre dinámico, heredoc, ejecución dinámica) preguntar siempre y mostrar el motivo | `core/shell/scan.ts:3-27` | `lzx/tool/shell/endurecer.ts` | Calidad y confianza; no ahorra tokens | Medio: más preguntas al usuario | M |
| 13 | `textVerbosity: "low"` para GPT y reducir razonamiento en título y compactación | `core/plugin/verbosity.ts:36` | `lzx/provider/transform.ts` | Menos tokens de salida con OpenAI | Bajo: respuestas más secas | S |
| 14 | Comparar la normalización tipográfica del `edit` (comillas, guiones, espacios) con la nuestra | `core/tool/plugin/edit.ts:49,42-190` | `lzx/tool/edit.ts` | Menos fallos de `edit` con texto copiado de salidas formateadas | Bajo | S |

Orden recomendado para avanzar: 2 (confirmar con T12) → 1 → 3 → 6 → 4/5/7 en una sola tanda.

## 4. Lo que NO conviene copiar

- **La arquitectura Effect v2 completa** (`core/src/*`: Location, Instructions con hashes, bus, SQL de sesiones): es una reescritura; nuestro motor es el fork 1.19.0 congelado. Las ideas (instrucciones con diferencias, caché estable) se llevan sobre lo existente (ya hay 7.9).
- **El parser tree-sitter wasm** (`web-tree-sitter`, `tree-sitter-bash`, `tree-sitter-powershell`) y el escáner de 100 KB: dependencias nativas, más trabajo y superficie de ataque que nuestra batería 7.7. Solo la idea de «opaco» (fila 12).
- **`managed-policy.ts`, `usage-limits.ts`, `console-access.ts`, integración con la Consola**: dependen de servicios de OpenCode (nuestro fork quitó esas conexiones, ver `THIRD_PARTY_NOTICES.md`).
- **`WarmingPlugin`** (pings cada 4 min): gasta tokens sin que nadie pregunte; en proyecto sin fines de lucro y con planes gratis no conviene, y en modelos locales de un solo hueco compite con la petición real.
- **Búsqueda web con proveedor de pago** (`core/plugin/websearch`) y APIs de pago: la regla del proyecto es solo soluciones locales o gratis.
- **Prompts largos heredados de Kimi, Trinity y Meta**: ellos mismos los conservan sin recortar; no son mejores que los nuestros.
- **`glob`/`grep` quitados para Claude/GPT** (`optimize.ts:35-49`): está **desactivado** en su código por falta de UX. No imitar.
- **El prompt «no crear subagentes salvo que lo pida el usuario»** del prompt GPT: choca con nuestros ayudantes por diseño.

### Licencia

OpenCode es MIT. Copiar código literal exige conservar el aviso de copyright y el texto de licencia. `THIRD_PARTY_NOTICES.md` ya cubre el fork 1.19.0; **para la 2.x no hay aviso nuestro**. Regla: **reimplementar** a partir de la idea (presupuesto de catálogo, clave de afinidad, tope de `retry-after`, resumen sobre el prefijo) con código y textos propios. Si algún archivo se copia de verdad (por ejemplo `tool-input-repair.ts`, `catalog.ts`), mantener la cabecera con el aviso y añadir la entrada a `THIRD_PARTY_NOTICES.md`. Nota: `lzx/tool/tool-search.ts` ya declara que su puntuación léxica viene de `packages/codemode` (mismo repositorio, MIT).

## 5. Qué decirle a a26b1e6b50fc34569

- Su `default-compacto.txt` (7 389) baja solo 10 %; el objetivo comparable es ~1 500-2 500 caracteres con guía por herramienta presente.
- Falta tocar los prompts de `anthropic`, `gpt`, `gemini` y `codex`, y las herramientas `question`, `skill`, `webfetch`, `websearch`, `lsp`, `cuaderno`, `plan-*`.
- Contar también el **esquema** de parámetros (la `shell` nuestra tiene 6 parámetros con descripciones largas).
- En `busqueda`, comprobar contra T12 con 40 herramientas y limitar el índice a ~2 000 tokens; incluir descripciones de una línea de ≤120 caracteres.
- La brecha de caché de la primera petición (3,9 %) no es de tamaño: es de estabilidad del prefijo; pedirle que registre el hash por sección.

## 6. Límites de este análisis

- Todo es lectura de código. **No se midió** ninguna petición real de OpenCode 2.x más allá de lo que ya estaba en `proxy.jsonl`; los tamaños de las descripciones de OpenCode se contaron de las cadenas del código fuente (las de plantillas de Lazunox se contaron de los archivos, no de la petición real).
- Los ahorros son estimaciones de orden de magnitud (1 token ≈ 4 caracteres) sobre un solo modelo (DeepSeek) y un solo día; la hipótesis de la primera petición está sin comprobar.
- Se leyó la rama `feat/ola7-final` y la de `feat/ola7-tokens` tal como estaban; esta última tiene cambios sin confirmar que no se revisaron.
