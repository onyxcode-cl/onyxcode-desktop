# Plan: búsqueda diferida de herramientas y formularios MCP

Fecha: 2026-10-25. Motor: fork 1.19.0 (`/Users/ben/Documents/lzx-wt/integracion`, rama base `feat/worktree-subagentes`). Ramas nuevas: `feat/tool-search` y
`feat/mcp-formularios` en el fork; `feat/tool-search` y `feat/mcp-formularios` en la app. Plan general: `docs/PLAN-MOTOR-PROPIO.md` (paso 4). Comparativa: `docs/COMPARATIVA-MOTOR.md` (filas 87-88).
Rutas del motor relativas a `packages/opencode/src/` salvo que se diga otra cosa. Todo es local y gratis; pruebas pesadas en el VPS (`/opt/lzx-test.sh`).

## 1. Estado actual (leído en el código)

### 1.1 Cómo viajan las herramientas
- `session/prompt.ts:1228-1243`: **en cada paso** del bucle (una llamada al modelo) se llama a `SessionTools.resolve(...)`, que arma el mapa completo de herramientas. `prompt.ts:1274-1288` lo pasa a `handle.process`.
- `session/tools.ts:92-134`: herramientas del registro (`tool/registry.ts:235-255`, lista `builtin`). `tools.ts:136-386`: tres herramientas de recursos MCP (solo si algún servidor tiene `resources`).
- `tools.ts:388`: **con Code Mode encendido se corta aquí**: las herramientas MCP no van sueltas, solo por `execute`.
- `tools.ts:390-490`: **cada herramienta de cada conector** se añade con nombre, descripción y esquema JSON completos (`McpCatalog.convertTool`, esquema por `ProviderTransform.schema`). Clave = `McpCatalog.toolName(servidor, herramienta)` (`mcp/index.ts:684`), saneada `[^a-zA-Z0-9_-]→_` (`src/shared/mcp-permissions.ts:5-12` de la app lo documenta).
- `session/llm/request.ts:210-216` (`resolveTools`): quita las que `Permission.disabled` niega con `*: deny` y las que el mensaje marca `user.tools[k] === false`. `request.ts:184`: se ordenan alfabéticamente (orden estable = bueno para el caché).
- `session/llm.ts:317-318`: `activeTools` + `tools` a `streamText`. `llm.ts:296-312`: `experimental_repairToolCall` manda un nombre desconocido a `invalid`.
- Caché del prompt: el bloque de herramientas va **antes** del sistema y los mensajes en todos los proveedores (Anthropic, OpenAI y DeepSeek con caché de prefijo). Cambiar la lista de herramientas a mitad de sesión invalida todo el caché.

### 1.2 Permisos de una herramienta MCP
- Directa: `tools.ts:402-406` dispara `tool.execute.before` con `tool: key` y `{ args }` (el MISMO objeto que luego va al servidor), y `tools.ts:408` hace `ctx.ask({ permission: key, patterns: ["*"], always: ["*"] })`.
- `permission/index.ts:73-155` (`ask`): reglas (última que casa), rutas protegidas, «siempre» de sesión/disco que nunca levanta un `deny`, gancho `permission.ask`. `permission/index.ts:258-273`: `disabled`/`visibleTools` (solo `*: deny` oculta).
- App: `mcp-permissions.ts:80-97` escribe `{'<servidor>_*': 'ask'|'allow'}` según «Sin preguntar en Code» (`codeTrustedMcp`); internos de confianza fija `browser`, `computer`.
- Ganchos que dependen del **nombre real**: puerta del plan `src/main/tasks/opencode-config.ts:65-76` (lista `PLAN_GATE_ALLOWED_TOOLS`) y `:213-226` (bloquea todo lo que no esté en la lista sin plan aprobado); inyección de `lazunox_session` en `computer_*` (`:217-219`) y `browser_*`/`bgshell_*` (`:249-252`) **mutando `output.args`**; ganchos de usuario `PreToolUse` por expresión regular sobre el nombre (`plugin/lazunox-ganchos.ts:46-50`).

### 1.3 Code Mode ya tiene búsqueda diferida
- `tool/registry.ts:286-295` y `:311-334`: la descripción de `execute` lleva el catálogo (`code-mode.ts:98-105`, `describeCatalog`).
- `packages/codemode/src/tool-runtime.ts:495-645` (`prepare`): catálogo con **presupuesto de ~2000 tokens** (chars/4) y `tools.$codemode.search` (`:386-449`, puntuación por ruta/descripción/parámetros). Las llamadas internas piden permiso con la misma clave (`code-mode.ts:174-187`).
- Conclusión: con Code Mode no hace falta nada nuevo; la mejora es para el camino directo (Code Mode está tras ajuste y muchos modelos gratuitos lo usan mal).

### 1.4 Formularios MCP
- `mcp/index.ts:39-50`: `elicitation: {}` comentado; solo `roots`. `mcp/index.ts:75-81` (`createClient`) solo registra `ListRootsRequestSchema`. SDK `@modelcontextprotocol/sdk` 1.29.0 (`package.json:83`).
- No hay registro de «qué sesión/llamada está usando este cliente»: el cliente MCP es por servidor y carpeta, no por sesión.
- Patrón existente a imitar: `question/index.ts:87-112` (pendientes + `Deferred` + eventos). **Ojo**: si la fibra se interrumpe, `Effect.ensuring` borra el pendiente pero no publica `Rejected` (la tarjeta quedaría huérfana); no repetirlo.
- App: Esc/Detener rechaza permisos pendientes (`src/renderer/src/features/code/impl/store.ts:1044-1070`, commit `e85d33c2`). Eventos: `src/shared/engine/adapters/engine1.ts:127-142`; respuestas `:259-271` (SDK fijado, sin rutas nuevas). Celular: `src/main/remote/event-trim.ts:90-92,127` deja pasar solo prefijos `session.`, `message.`, `permission.`, `question.`, `todo.`; rutas del motor `src/main/remote/policy.ts:1005` (`HTTP_X_ROUTES`, la prueba exige clasificar todo `api-routes.json`).

## 2. Decisiones de diseño

### A. Búsqueda diferida (`tool_search` + `mcp_call`)
1. **Dos herramientas fijas en vez de cargar esquemas en la lista.** Cuando se activa, las herramientas MCP «diferibles» salen de la lista y entran:
   - `tool_search { query: string, limit?: 1..10 (5) }`: texto libre o `select:a,b` (nombres exactos). Devuelve, como resultado de herramienta, nombre, descripción completa y esquema JSON de cada coincidencia (tope 16 KB). Su descripción lleva el índice compacto `servidor (N): nombre1, nombre2…`, ordenado.
   - `mcp_call { tool: string, arguments: object }`: ejecuta la herramienta MCP `tool` por **el mismo camino** que la llamada directa.
   El esquema «se carga» dentro de los mensajes (al final, solo se añade) y la lista de herramientas no cambia entre pasos: **el caché del prompt se conserva**. Solo cambia si cambia el conjunto de conectores (igual que hoy).
2. **Activación**: `LAZUNOX_TOOL_SEARCH=auto|on|off` (defecto `auto`). En `auto` se activa si las definiciones diferibles visibles suman ≥ `LAZUNOX_TOOL_SEARCH_MIN_TOKENS` (defecto 4000, chars/4 de `JSON.stringify({name,description,inputSchema})`). Nunca se difieren los servidores de `LAZUNOX_TOOL_SEARCH_KEEP` (la app pasa `browser,computer,bgshell`: los agentes y la puerta del plan cuentan con ellos). La decisión se recalcula por paso pero es determinista (mismo catálogo → mismo resultado). Con Code Mode no se activa.
3. **Un solo camino de ejecución**: se extrae el cuerpo de `tools.ts:398-488` a `mcp/invocar.ts` (`McpInvocar.run({ key, entry, args, opts, ctx })`) que usan la llamada directa y `mcp_call`. Ahí: gancho `tool.execute.before` con `tool: key` real y el mismo objeto `args` que va a `callTool`, `ctx.ask({ permission: key, … })`, ejecución, `tool.execute.after` con `key`. `mcp_call` no dispara ganchos con su propio nombre.
4. `mcp_call` rechaza (error para el modelo, sin ejecutar) si `tool` no está en el catálogo **recalculado en ese momento** con las reglas del agente y de la sesión (`Permission.visibleTools`) y `user.tools` del mensaje (hay que pasar `lastUser.tools` a `SessionTools.resolve`). Coincidencia exacta, sensible a mayúsculas, sin comodines. Comprueba `required` y tipos de primer nivel (el servidor sigue validando).
5. `Permission.disabled` (`permission/index.ts:258`): `tool_search`/`mcp_call` no se ocultan por un `*: deny` genérico (su contenido ya viene filtrado), solo por una regla con su nombre exacto. Si el catálogo diferido queda vacío, no se añaden.
6. Reparación (`llm.ts:296`): si el modelo llama directamente a una herramienta diferida (pasa tras leer su esquema), se reescribe a `mcp_call { tool, arguments }`, que aplica todo lo anterior. Así no se pierde el turno.
7. Subagentes: cada hija resuelve sus herramientas con su agente (`prompt.ts:1228`), así que su catálogo respeta sus permisos. No hereda lo buscado por la madre (sin estado): la hija busca o usa `select:`.
8. Puerta del plan: `tool_search` es solo lectura → se añade a `PLAN_GATE_ALLOWED_TOOLS` (**zona intocable**). `mcp_call` nunca; además la puerta ve el nombre real por el punto 3.
9. UI: el motor marca la parte con `title = key` y `metadata.lazunoxMcp = { tool: key, server }`. La app muestra `mcp_call` como la herramienta real y `tool_search` como una fila compacta «Buscó herramientas: …».

Descartado:
- **Cargar el esquema real en la lista** en el paso siguiente (como `ToolSearch` de Claude Code): exactitud nativa, pero cada carga rompe el caché entero (todos los proveedores ponen las herramientas al principio) y el conjunto crece sin parar en sesiones largas.
- **`defer_loading`/`tool_reference` de la API de Anthropic**: conserva el caché pero solo existe en ese proveedor y en modelos de pago; Lazunox usa sobre todo modelos gratuitos. Se pospone como optimización por proveedor.
- **Búsqueda semántica con embeddings**: coste, modelo extra o API. La puntuación léxica de Code Mode (`tool-runtime.ts:414-437`) basta; se reutiliza (mismo repositorio, MIT).
- **Siempre encendido**: con 1-2 conectores pequeños empeora la exactitud sin ahorro real; por eso el umbral.

### B. Formularios MCP (`elicitation/create`, modo formulario)
1. Capacidad `elicitation: { form: {} }` **solo si** `LAZUNOX_MCP_ELICITATION=1` (la app lo pone en los motores de Code y Chat; no en Tareas, Overdrive ni Rutinas: sin persona delante). Sin variable el servidor no ve la capacidad y, según la especificación, no debe pedir. El modo `url` se pospone (se responde `decline`).
2. **Atribución a la sesión**: registro `mcp/en-curso.ts` de llamadas vivas por cliente (`{ sessionID, messageID, callID, abort, pausar }`), alimentado por `McpInvocar.run` y por `invokeChildTool` de Code Mode. Una solicitud se atribuye a la llamada viva del mismo cliente; con 0 llamadas vivas, o con varias de **sesiones distintas**, se responde `decline` (sin adivinar).
3. Servicio `mcp/elicitation.ts` (`McpElicitation`), como `Question` pero con cierre explícito: `ask` publica `mcp.elicitation.asked`; termina por respuesta (`replied`), tiempo (`LAZUNOX_ELICITATION_TIMEOUT_MS`, defecto 600 000), cancelación del servidor (`extra.signal`) o aborto de la llamada (`ctx.abort`/señal de celda); en **todos** los cierres que no son respuesta publica `mcp.elicitation.rejected { reason }` y contesta `cancel` al servidor.
4. **Esquema permitido** (subconjunto plano de la especificación 2025-06-18): `string` (`minLength`, `maxLength` ≤ 4000, `format` ∈ `email|uri|date|date-time`), `number`/`integer` (`minimum`, `maximum`), `boolean`, `string` con `enum` (≤ 50, `enumNames`) u `oneOf` de `{const,title}`. Topes: ≤ 20 campos, título ≤ 120, descripción ≤ 500, mensaje ≤ 2000, solicitud ≤ 16 KB. Fuera de eso → `decline` y aviso.
5. **Secretos**: si un campo (nombre, título o descripción) casa con `contraseña|password|passcode|token|secret|api[ _-]?key|clave|pin|cvv|cvc|tarjeta|card|iban|otp|2fa|código de verificación` o trae `format: password` → `decline` automático **para cualquier servidor** y tarjeta informativa sin campos («Lazunox no envía contraseñas ni claves por formularios de conectores»). La especificación ya prohíbe pedir datos sensibles en modo formulario.
6. **Respuesta**: la valida el motor (tipos, `required`, rango, `enum`, longitudes; claves extra fuera). Los valores no se registran en los logs (solo nombres de campo) ni entran en la sesión; el modelo solo ve lo que el servidor devuelva.
7. **Tiempo de la llamada**: el `timeout` de `callTool` (30 s por defecto) cortaría la llamada mientras la persona escribe. `McpInvocar.run` usa un temporizador propio que se **pausa** mientras hay un formulario abierto para esa llamada (al SDK se le pasa un tope alto, 1 h, más la señal combinada).
8. Canal: rutas nuevas `GET /mcp/elicitation` y `POST /mcp/elicitation/{requestID}/reply { action: accept|decline|cancel, content? }` en `server/routes/instance/httpapi/groups/mcp.ts`; eventos en `packages/schema/src/mcp-event.ts`. La app ya escucha los eventos por carpeta. Prefijo `mcp.` → el celular no los recibe (`event-trim.ts:127`), y las dos rutas van a `HTTP_X_ROUTES` (clase X).
9. Abortar: Esc/Detener de la app responde `cancel` a los formularios pendientes de la sesión y de sus ayudantes (igual que `store.ts:1061-1066`); el motor además cancela por su cuenta al abortarse la llamada (punto 3).

Descartado:
- **Reusar `question.asked`**: el celular, el modo auto de Tareas y Comparar ya reaccionan a `question.*` (fuga y respuestas sin persona); pierde tipos y rangos.
- **Pasar el formulario por `permission.asked`**: mezcla aprobar con dar datos; «siempre» no tiene sentido aquí.
- **Atribuir por `relatedRequestId`/`_meta`**: los servidores no lo mandan siempre; mejor el registro de llamadas vivas y negar si es ambiguo.
- **Rellenar o responder solo** (modo auto, Rutinas, celular): nunca.

## 3. Modelo de amenazas

| Mejora | Amenaza | Defensa | Prueba |
|---|---|---|---|
| A | Una herramienta diferida corre sin aprobación (`x_*: ask` saltado) | Un solo camino `McpInvocar.run`; `mcp_call` recalcula catálogo y permisos al ejecutar | probe A-3..A-6 |
| A | La puerta del plan o `lazunox_session` no ven la herramienta real | Gancho con `key` real y el mismo `args` | probe A-7, A-8 |
| A | Nombre parecido/homónimo (`gmail_send` vs `gmail_send_message`) | Coincidencia exacta; error con sugerencias, sin ejecutar | unitaria |
| A | Hija con permisos recortados ve o llama herramientas de la madre | Catálogo por agente y sesión en cada paso | probe A-9 |
| A | Descripciones del servidor con instrucciones (inyección) | Igual que hoy (ya viajan); resultado con tope 16 KB y ≤ 10 herramientas | unitaria |
| B | Servidor pide contraseña o tarjeta (phishing) | Bloqueo de secretos para todos; tarjeta que dice el nombre del conector | unitaria + probe B-3 |
| B | Mensaje que se hace pasar por Lazunox | Texto plano, sin enlaces ni Markdown; cabecera fija «Formulario del conector X» | vitest |
| B | Respuesta sin persona (celular, auto, Rutinas) | Clase X, sin prefijo en `event-trim`, capacidad solo en Code/Chat | vitest policy/event-trim |
| B | Solicitud fuera de una llamada o ambigua | `decline` | probe B-4 |
| B | Inundación de formularios | 1 pendiente por servidor y sesión, 5 por llamada, tiempo máximo | unitaria |
| B | Aprobar tras Detener | Cancelación en motor y app | probe B-5 + vitest store |

## 4. Fases (cada una: un commit por repo, revertible con `git revert`; interruptor de emergencia por variable)

**A0. Medición (sin cambiar comportamiento).**
- App: `scripts/engine-probe/harness.mjs:41,64-66` guarda `toolsBytes` (`JSON.stringify(j.tools).length`) por petición; `probe-mcp.mjs` acepta `PROBE_MCP_MANY=<n>` (n herramientas con descripción y esquema realistas de ~800 caracteres). Script nuevo `scripts/engine-probe/medir-herramientas.mjs <motor>`: con 0, 1 y 3 conectores informa caracteres y tokens (chars/4).
- Hecho: el informe da cifras base; `run.mjs` sigue pasando entero. Revertir: borrar el script.

**A1. Motor: un solo camino MCP (refactor sin cambio visible).**
- Fork: `mcp/invocar.ts` (nuevo, cuerpo de `tools.ts:398-488`); `session/tools.ts` lo usa.
- `bun test`: `test/lazunox/mcp-invocar.test.ts` (gancho antes/después con `key`; mutar `args` en el gancho llega al cliente; `ask` con `key`; rechazo → no llama al servidor). Las pruebas existentes de `test/session/` y `test/tool/` pasan.
- Hecho: `run.mjs` igual que antes (29+ verdes). Revertir: commit único.

**A2. Motor: `tool_search` + `mcp_call` + umbral.**
- Fork: `tool/tool-search.ts` (nuevo: catálogo, umbral, `select:`, puntuación copiada de `codemode/src/tool-runtime.ts:365-437` con nota de origen), `session/tools.ts` (sustituir el bucle por diferidas cuando toca; recibir `userTools`), `session/prompt.ts:1228` (pasar `lastUser.tools`), `permission/index.ts:258` (excepción del punto A5), `session/llm.ts:296` (reescritura a `mcp_call`), `LAZUNOX.md` (sección nueva).
- `bun test` `test/lazunox/tool-search.test.ts`: umbral (por debajo/encima, `on`/`off`, `KEEP`), índice estable y ordenado, `select:` exacto, límite y tope de bytes, `mcp_call` con nombre inexistente/negado/`user.tools=false` no ejecuta, reparación de llamada directa, Code Mode encendido → no aparecen.
- Probe (app, `run.mjs`, con `PROBE_MCP_MANY=40` y `LAZUNOX_TOOL_SEARCH=on`): A-1 la lista ofrecida tiene `tool_search`/`mcp_call` y no `x_*`; A-2 `toolsBytes` baja ≥ 70 %; A-3 `x_*: ask` → pregunta `x_start` vía `mcp_call`; A-4 `x_*: deny` → denegada; A-5 `x_secret: deny` + `x_*: allow` → solo `secret` denegada; A-6 agente con `"*": deny`, `"x_start": allow` → `x_start` sí, `x_secret` no; A-7 plugin de prueba en `tool.execute.before` recibe `x_start` (no `mcp_call`); A-8 el plugin muta `args` y el eco del servidor lo refleja; A-9 subagente con `x_*: deny` no lo ve en `tool_search`.
- Hecho: todo lo anterior verde en el VPS + `run.mjs` completo. Revertir: commit; en caliente `LAZUNOX_TOOL_SEARCH=off`.

**A3. App: interruptor, tarjetas y puerta del plan.**
- `src/shared/engine-experiments.ts` (`ENGINE_ENV_TOOL_SEARCH`, ajuste `toolSearch: 'auto'|'off'` en Code y Chat, Tareas `off`; clave nueva con normalización y prueba de migración: los ajustes guardan los valores por defecto en disco), `src/main/opencode/server.ts` (variables `LAZUNOX_TOOL_SEARCH`, `LAZUNOX_TOOL_SEARCH_KEEP=browser,computer,bgshell`), Ajustes › Funciones experimentales (texto), `features/code/impl/ToolCard.tsx:346` (filas `tool_search` y `mcp_call` → nombre real y servidor), equivalente en Chat si muestra herramientas, i18n `es/en` (`code.tool.toolSearch*`), `src/main/tasks/opencode-config.ts:65-76` (+`'tool_search'`; **ZONA INTOCABLE**: revisión independiente y `npm run zonas:actualizar -- "tool_search es de solo lectura"`), `CHANGELOG-FASE8.md`, `docs/SEGURIDAD.md`.
- vitest: `engine-experiments.test.ts`, `server.engine-flags.test.ts`, `ToolCard` (render de las dos filas), `opencode-config` (lista), `zonas-intocables.test.ts`, guardias de `src/test`.
- Hecho: pruebas dirigidas verdes + `typecheck`/`lint`/`build`. Revertir: commit (la zona vuelve con otro `zonas:actualizar`).

**B1. Motor: servicio de formularios y validación (sin conectarlo al cliente).**
- Fork: `mcp/elicitation.ts` (servicio, eventos, tiempo, topes, cierre con `rejected` siempre), `mcp/elicitation-esquema.ts` (validar esquema, detectar secretos, validar respuesta: funciones puras), `packages/schema/src/mcp-event.ts` (+3 eventos) y su inventario.
- `bun test` `test/lazunox/mcp-elicitation.test.ts`: tipos permitidos y rechazados, topes, secretos (lista de casos en español e inglés), respuesta inválida, tiempo agotado y aborto publican `rejected`, un pendiente por servidor y sesión.
- Hecho: pruebas verdes; sin cambio observable. Revertir: commit.

**B2. Motor: cliente MCP, llamadas vivas, temporizador y rutas.**
- Fork: `mcp/en-curso.ts`, `mcp/invocar.ts` (registrar llamada, temporizador pausable), `tool/code-mode.ts:174-200` (registrar en `invokeChildTool`), `mcp/index.ts:39-50,75-81` (capacidad condicionada + `setRequestHandler(ElicitRequestSchema)`), `server/routes/instance/httpapi/groups/mcp.ts` + handler.
- `bun test`: atribución (0, 1, varias sesiones), `url` → `decline`, pausa del temporizador, cancelación por `notifications/cancelled`.
- Probe (app): `probe-mcp.mjs` con herramienta `form` que manda `elicitation/create` y devuelve lo recibido; `harness.mjs` permite responder formularios. B-1 sin variable: el servidor no ve la capacidad; B-2 aceptar → el eco trae los valores; B-3 campo `password` → `decline` sin evento `asked`; B-4 solicitud sin llamada viva → `decline`; B-5 abortar la sesión con formulario abierto → `rejected` y el servidor recibe `cancel`; B-6 formulario de 45 s con `timeout` de 30 s → la llamada no se corta.
- Hecho: todo verde en el VPS. Revertir: commit; en caliente, quitar `LAZUNOX_MCP_ELICITATION`.

**B3. App: tarjeta de formulario.**
- `src/shared/engine/types.ts` + `adapters/engine1.ts` (eventos y `elicitations.list/reply` por `fetch` crudo: el SDK fijado no trae las rutas), `resources/opencode-bin/api-routes.json` (regenerar con el motor nuevo), stores de Code y Chat (estado, eventos, `abort()` cancela), `features/code/impl/ElicitationCard.tsx` (nuevo; Chat lo reutiliza), `MessageStream.tsx:683` (junto a `QuestionCard`), i18n `code.elicitation.*`, `src/main/remote/policy.ts:1005` (+2 rutas X), `engine-experiments.ts`/`server.ts` (`LAZUNOX_MCP_ELICITATION=1` solo Code/Chat), `CHANGELOG-FASE8.md`, `docs/SEGURIDAD.md`.
- Tarjeta: cabecera fija con nombre del conector y si es de confianza (`codeTrustedMcp`), mensaje en texto plano, campos por tipo con validación local, botones «Enviar a X» / «No enviar»; Esc = cancelar; foco atrapado; accesible (axe); nada se rellena salvo `default` del esquema.
- vitest: render y validación de la tarjeta, `abort()` cancela formularios de la sesión y de las hijas, `event-trim` descarta `mcp.elicitation.*`, `policy.test.ts` cubre las rutas, contrato del adaptador, guardias i18n.
- Hecho: dirigidas + `typecheck`/`lint`/`build`/`test:transform` y el E2E de Code afectado. Revertir: commit.

**V. Verificación final con modelo real** (sección 6).

## 5. Tareas para agentes en paralelo

Orden: T1 → (T2, T3, T4 en paralelo) → T5 → T6. Cada agente en su worktree y rama, `git add` por rutas, commit en español con su prueba; pruebas del fork en el VPS (`rsync` excluyendo `.github`, luego `/opt/lzx-test.sh /opt/lzx-fork/src "<pruebas>"`); nada de `bun test` completo ni compilaciones en el Mac.

**T1 — Motor: un solo camino MCP + `tool_search`/`mcp_call` (fases A1+A2).** Sin dependencias.
- Objetivo: secciones 2.A.1-7 y fases A1, A2. Dos commits (refactor, función).
- Archivos: `mcp/invocar.ts` (nuevo), `tool/tool-search.ts` (nuevo), `session/tools.ts`, `session/prompt.ts:1228`, `permission/index.ts:258-268`, `session/llm.ts:296-312`, `LAZUNOX.md`, pruebas en `test/lazunox/`.
- Restricciones: nombres exactos `tool_search`, `mcp_call`, `metadata.lazunoxMcp = { tool, server }`, variables `LAZUNOX_TOOL_SEARCH`, `LAZUNOX_TOOL_SEARCH_MIN_TOKENS`, `LAZUNOX_TOOL_SEARCH_KEEP`. `McpInvocar.run` debe aceptar un parámetro opcional `onCall` (entrar/salir de llamada viva) que T4 usará: déjalo como no-op.
- El gancho `tool.execute.before` se dispara SOLO con la clave real y el MISMO objeto `args` que va a `callTool`.
- Pruebas: las de A1 y A2 (sección 4). No toques Code Mode salvo para comprobar que no se activa con él.
- NO tocar: `mcp/index.ts`, registro `builtin` (estas herramientas no van ahí: dependen de MCP y se añaden en `session/tools.ts`), app.
- Hecho: `bun test` dirigido verde en el VPS y la lista de la prueba A2 en verde.

**T2 — App: medición y comprobaciones del motor real (fases A0 y probe de A2).** Depende de T1 solo para que pasen; se escribe en paralelo.
- Archivos: `scripts/engine-probe/harness.mjs`, `probe-mcp.mjs`, `run.mjs`, `medir-herramientas.mjs` (nuevo).
- Restricciones: sin red ni modelo; `PROBE_ONLY=tool-search` para correr solo las nuevas; las comprobaciones existentes no cambian de resultado.
- Pruebas: A-1..A-9 de la fase A2 con el binario del VPS (`linux-x64`) allí mismo.
- NO tocar: `src/`, el fork.
- Hecho: `node scripts/engine-probe/run.mjs <motor de T1>` todo verde; informe de bytes antes/después pegado en el commit.

**T3 — App: interruptor, tarjetas y puerta del plan (fase A3). TOCA ZONA INTOCABLE (`src/main/tasks/opencode-config.ts`).** Depende de T1 (nombres fijados arriba; puede empezar ya).
- Archivos: `src/shared/engine-experiments.ts`, `src/main/opencode/server.ts`, Ajustes › Funciones experimentales, `features/code/impl/ToolCard.tsx`, i18n `es/en`, `opencode-config.ts:65-76`, `CHANGELOG-FASE8.md` (ID `F8-B<n>`), `docs/SEGURIDAD.md`.
- Restricciones: la única línea en la zona es añadir `'tool_search'` a `PLAN_GATE_ALLOWED_TOOLS`; pedir revisión independiente (otro agente) y `npm run zonas:actualizar -- "tool_search es de solo lectura"`. Tareas queda en `off`. Clave de ajuste nueva con normalización y prueba de que un `settings.json` viejo la recibe.
- Pruebas: vitest dirigidas de la fase A3 + `src/test`.
- NO tocar: `mcp-permissions.ts`, el remoto, el fork.
- Hecho: dirigidas verdes, `typecheck`, `lint`, `build`.

**T4 — Motor: formularios MCP (fases B1+B2).** B1 sin dependencias; B2 depende de T1 (`mcp/invocar.ts`).
- Objetivo: secciones 2.B.1-8. Dos commits.
- Archivos: `mcp/elicitation.ts`, `mcp/elicitation-esquema.ts`, `mcp/en-curso.ts` (nuevos), `mcp/index.ts:39-50,75-81`, `mcp/invocar.ts` (usar `onCall`, temporizador pausable), `tool/code-mode.ts:174-200`, `packages/schema/src/mcp-event.ts`, `server/routes/instance/httpapi/groups/mcp.ts` + handler, `LAZUNOX.md`.
- Contrato fijo: eventos `mcp.elicitation.asked { id, sessionID, server, callID?, message, fields[], expiresAt }`, `mcp.elicitation.replied { id, sessionID, action }`, `mcp.elicitation.rejected { id, sessionID, reason: 'timeout'|'abort'|'server-cancel'|'secret'|'schema'|'ambiguous' }`; rutas `GET /mcp/elicitation`, `POST /mcp/elicitation/{requestID}/reply`; variables `LAZUNOX_MCP_ELICITATION`, `LAZUNOX_ELICITATION_TIMEOUT_MS`.
- Restricciones: todo cierre que no sea respuesta publica `rejected` (no copiar `question/index.ts:106-111`). No registrar valores. Modo `url` → `decline`.
- Pruebas: las de B1 y B2 (`bun test`).
- NO tocar: `session/tools.ts` (salvo lo que pida `invocar.ts`), la app.
- Hecho: dirigidas verdes en el VPS; compilación `linux-x64` en el contenedor para T6.

**T5 — App: tarjeta de formulario y cancelación (fase B3).** Depende del contrato de T4 (puede empezar con datos falsos; `api-routes.json` al final, con el motor de T4).
- Archivos: los de la fase B3.
- Restricciones: texto plano; sin enlaces activos; Chat reutiliza la tarjeta; el celular NO la recibe (añadir prueba explícita a `event-trim` y las dos rutas a `HTTP_X_ROUTES`); `abort()` cancela formularios de la sesión detenida y de sus ayudantes; Tareas, Overdrive y Rutinas sin la variable.
- Pruebas: vitest de la fase B3 y el E2E de Code con el OpenCode falso (añadir el evento al falso de `e2e/fake-opencode`).
- NO tocar: zonas intocables, preloads, CSP.
- Hecho: dirigidas + `typecheck`/`lint`/`build`/`test:transform` + spec E2E.

**T6 — Comprobaciones B y verificación final (fases B2-probe y V).** Depende de T4 y T5.
- Archivos: `scripts/engine-probe/probe-mcp.mjs`, `harness.mjs`, `run.mjs` (B-1..B-6), y solo la nota de resultados en este documento.
- Restricciones: sigue la receta de la sección 6; no publicar nada; matar los procesos propios al terminar.
- Hecho: `run.mjs` completo verde con el motor nuevo; checklist de la sección 6 cumplido en Mac (y Windows si Ben lo pide).

## 6. Verificación final con modelo real

Receta (Mac; Windows igual con `scripts/win/`):
1. Motor compilado en el VPS (`targets.sh darwin-arm64` en el contenedor `oven/bun:1.3.14`), `node scripts/engine-probe/run.mjs <motor>` verde.
2. App de desarrollo con perfil temporal (`--user-data-dir=$(mktemp -d)`, borrarlo al terminar; nunca el perfil real) y `LAZUNOX_TEST_BUNDLED_DIR` apuntando al motor nuevo; `--remote-debugging-port=9333`.
3. Proveedor gratuito (OpenCode Zen, modelo gratuito) desde Ajustes. Conectores: `context7` y `cloudflare-docs` (remotos sin cuenta), el navegador integrado, y dos fixtures locales: `muchas` (40 herramientas, `PROBE_MCP_MANY=40`) y `formulario` (la herramienta `form` de T6).
4. Por CDP: «busca en muchas la herramienta para crear un ticket y créalo con título hola» → se ve la fila `tool_search`, luego la tarjeta de permiso con `muchas_create_ticket`; rechazar → no se ejecuta; repetir y aprobar → se ejecuta. Con «Sin preguntar» en `muchas` → no pregunta.
5. «usa formulario.form» → tarjeta «Formulario del conector formulario»; enviar → el resultado trae lo escrito. Repetir y pulsar Detener → la tarjeta desaparece y el motor registra `rejected/abort`. Fixture con campo `password` → aviso sin campos.
6. Conectar el celular de pruebas solo si Ben lo pide: comprobar que no aparece el formulario.

Medición de ahorro (anotar aquí al terminar): tokens ≈ caracteres/4 de `JSON.stringify` de `{name, description, inputSchema}` de las herramientas MCP, medidos con `medir-herramientas.mjs` y con `toolsBytes` del arnés, para: context7 + cloudflare-docs; + navegador integrado; + `google-workspace` (~30 herramientas de Gmail/Calendar) si se puede listar sin cuenta o con la cuenta de prueba de Ben.
Estimación previa, a confirmar: una herramienta de Gmail ocupa ~600-1200 caracteres (150-300 tokens); 30 → 4500-9000 tokens por petición. Con diferidas: `tool_search` (~250 tokens + ~5 por nombre ≈ 400) + `mcp_call` (~120) ≈ 500 tokens fijos, más ~300 por herramienta realmente buscada (una vez, en el historial). Ahorro esperado ≥ 85 % por petición con 30+ herramientas; criterio de éxito: ≥ 70 % (prueba A-2).

## 7. Riesgos y lo que se pospone

Riesgos:
- Modelos gratuitos pequeños pueden llamar peor por `mcp_call` (argumentos anidados). Mitigación: umbral, reescritura de llamada directa (2.A.6), interruptor por modo; medir en la verificación con 2 modelos gratuitos. Si falla, dejar `auto` solo en Chat.
- Tool-choice de proveedores que exigen esquemas estrictos: `mcp_call.arguments` es `object` libre; OpenAI ya va con `strict: false` (`request.ts:152-158`).
- El temporizador propio de B cambia cómo se cortan las llamadas MCP: si sale mal, todas las llamadas largas cambian. Por eso va en su propia prueba (B-6) y detrás de la variable.
- Rutinas en el mismo motor que Code: si una rutina llama a un conector que pide formulario, espera hasta el tiempo máximo. Mitigación inicial: la app no pone la variable en motores de rutinas; si comparten motor, bajar el tiempo para sesiones sin ventana (pendiente de comprobar en `src/main/scheduler/`).
- Atribución por llamada viva: dos sesiones usando el mismo conector a la vez → `decline` (seguro pero molesto). Aceptado.

Se pospone: modo `url` de los formularios; formularios en Tareas/Overdrive (necesita revisar el modo auto y la puerta del plan); `defer_loading` nativo de Anthropic; arrays/selección múltiple en formularios; ganchos de usuario `Elicitation`; mostrar en el celular un aviso «hay un formulario en el Mac» (sin datos).
