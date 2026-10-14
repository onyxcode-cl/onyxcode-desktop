# Migración a OpenCode 2.0.28: equivalencias de API, eventos y riesgos

Evaluación de solo lectura (no se tocó código de la app). Compara lo que Lazunox usa hoy de OpenCode 1.x
(binario fijado 1.18.33, SDK `@opencode-ai/sdk` 1.18.32, 44 rutas usadas) con OpenCode **2.0.28**.

## Cómo se obtuvo esto

- **Spec**: `openapi-v2.json` (OpenAPI 3.1, título "opencode HttpApi", ~120 operaciones, todas bajo `/api`, salvo
  `GET /auth/connect/{code}`). Los schemas de los eventos NO vienen en la spec (el SSE se declara como un string JSON).
- **Binario real**: se levantó `opencode serve` 2.0.28 (darwin-arm64) con `HOME`/`XDG_*` aislados, puerto libre y
  loopback. Se probaron sesiones, prompt, permisos, preguntas (formularios), revert, fork, patch, fs, listados y el SSE,
  usando el modelo gratuito público `cat-jam-free` (clave `public` del propio proveedor, sin credenciales reales).
  Los dos servidores de prueba se detuvieron al terminar y no queda ningún proceso vivo.
- En la tabla, la columna **Verif.** dice `E` si se comprobó contra el servidor en ejecución, `S` si solo se leyó de la
  spec. Los nombres de eventos que no se vieron en vivo salen de `strings` del binario y van marcados como "inferido".
- Aviso de nombres: el `@opencode-ai/sdk/v2/client` que usa Lazunox hoy es la segunda generación del cliente **de la
  API v1**. La API "v2" de OpenCode 2.0 es otra cosa: otro paquete (`@opencode/sdk` es un host en proceso; el cliente
  HTTP es `@opencode/client`, dependencia que no se descargó ni se revisó) y otro protocolo.

## Hallazgos de base (afectan a todo)

1. **Las rutas v1 ya no existen.** `/global/health`, `/session`, `/global/event`, `/config`, etc. devuelven el HTML de
   la SPA web, no un error JSON. Un cliente que use una ruta v1 puede recibir HTML con "éxito" aparente.
2. **Autenticación**: Basic con usuario fijo `opencode`. La contraseña `OPENCODE_SERVER_PASSWORD` SÍ se respeta
   (si no se pasa, el servidor genera una al azar y la imprime). `OPENCODE_SERVER_USERNAME` se **ignora** (con
   `lazunox:<clave>` da 401). Hoy `src/main/tasks/sandbox.ts` y `opencode-config.ts` fijan usuario propio.
3. **Directorio / proyecto**: ya no hay `directory` ni header por llamada. Las rutas de sesión usan el `location`
   guardado en la sesión (se fija al crearla: `POST /api/session` con `location:{directory}`). El resto de rutas
   aceptan `?location[directory]=/ruta` (deepObject; probado) y, si falta, usan el directorio de arranque del servidor.
   `GET /api/session` acepta `directory`, `project`, `subpath`, `parentID`, `search`, `limit`, `cursor`, `order`.
4. **Respuestas**: casi todo viene envuelto en `{data: ...}` (y `{location, data}` en rutas por directorio); las
   mutaciones devuelven 204 sin cuerpo; los errores son `{_tag, message, ...}` (p. ej. `SessionNotFoundError`),
   no `{name, data}`. Las listas largas usan `cursor: {previous, next}`; `limit` es un string.
5. **Salud**: no hay `/global/health`. El equivalente es `GET /api/info` (`{version, pid, urls, paths, capabilities}`),
   que también exige auth. `/api/health` da 404.
6. **El prompt ya no lleva modelo/agente/variante/`system` por mensaje** (ver la fila de `prompt_async`). Es el
   cambio de modelo mental más grande para Lazunox.
7. `serve` conserva `--port`, `--hostname`, `--cors` (repetible); añade `--service` y `--stdio`.
   `OPENCODE_CONFIG_CONTENT` se acepta, pero el documento de config tiene otra forma (p. ej. el modelo pasa de
   `"opencode/exo-free"` a `{providerID, model}` en `GET /api/config`). Hay que revisar `src/main/tasks/opencode-config.ts`.

## Tabla de las 44 rutas v1

Convención: `{sid}` = sessionID. `loc` = `?location[directory]=...` opcional. "Sin equivalente" = no existe en la spec ni se
vio en el binario.

| # | Ruta v1 (uso en Lazunox) | Equivalente v2 | Diferencias de cuerpo / respuesta | Verif. |
|---|---|---|---|---|
| 1 | `DELETE /auth/{providerID}` | `GET /api/credential` para hallar el `credentialID` del `integrationID` y luego `DELETE /api/credential/{credentialID}` | v1 borra por proveedor; v2 por id de credencial (hay que listar antes). Otra opción: no hay "desconectar integración" directo. Ojo: `GET /api/credential` devuelve los **valores** (claves, tokens) en `value`. 204. | S |
| 2 | `DELETE /session/{sessionID}` | `DELETE /api/session/{sid}` | Igual de simple; 204 sin cuerpo; 404 `SessionNotFoundError`. | S |
| 3 | `GET /command` | `GET /api/command` | `{location, data:[{name, description?}]}`. v1 traía además `template`/`agent`/`model`/`source`; v2 solo nombre y descripción. | E |
| 4 | `GET /config` | `GET /api/config` | Devuelve un **array** de documentos `{type:"directory", path}` / `{type:"document", info:{...}}`, no un objeto de config único. Esquema del documento distinto (p. ej. `model:{providerID, model}`). Ajuste: `PATCH /api/experimental/config` (experimental). | E |
| 5 | `GET /config/providers` | `GET /api/provider` + `GET /api/model` (+ `GET /api/model/default`) | v1 devolvía proveedores con sus modelos anidados y `default`. v2 los separa: proveedor `{id, name, activation, package, settings}` y modelo `{id, modelID, providerID, name, variants[], capabilities{tools,input,output}, cost[], limit{context,output}, status, enabled}`. Las variantes (`low/medium/high/...`) vienen como `variants:[{id, settings}]`. | E |
| 6 | `GET /experimental/session` | `GET /api/session` (sin `directory`) y/o `GET /api/experimental/session/stats` | Paginación por `cursor`/`limit`. Para el medidor de uso (`UsageSection`, `UsageMeter`) `stats` ya da tokens, costo, modelos y actividad agregados por rango (`from`,`to`,`project`,`tools`), lo que evita recorrer todas las sesiones. Que sin `directory` liste todos los proyectos: por verificar. | S/E |
| 7 | `GET /file` | `GET /api/fs/list?path=` | `{location, data:[{path, type:"file"\|"directory"}]}`; v1 traía `name`, `absolute`, `ignored`. | E |
| 8 | `GET /file/content` | `GET /api/fs/read/{ruta}` | Devuelve el **archivo crudo** (`application/octet-stream`), no `{type, content, encoding}`. El cliente debe decidir texto/binario por su cuenta. | E |
| 9 | `GET /file/status` | `GET /api/vcs/status` | `{file, additions, deletions, status:"added"\|"deleted"\|"modified"}` (parecido al v1; verificar paths relativos). | S |
| 10 | `GET /find/file` | `GET /api/fs/find?query=&type=file\|directory&limit=` | `type` es obligatorio. En la prueba `query=env` no encontró `.env` aunque `fs/list` sí lo lista (posible filtrado de ocultos/ignorados). | E |
| 11 | `GET /global/event` | `GET /api/event` | Ver la sección de eventos: otro envoltorio y otros tipos. Sigue siendo un solo stream global. | E |
| 12 | `GET /global/health` | `GET /api/info` | `{version, pid, urls, paths:{tmp}, capabilities:{persistentPty}}`. Ya no hay `{healthy:true}`; el chequeo de `util/net.ts` debe mirar HTTP 200 + JSON con `version`. | E |
| 13 | `GET /mcp` | `GET /api/mcp` | `[{name, status:{connected\|pending\|disabled\|failed\|needs_auth variants}, integrationID?}]`. Los estados son uniones de objetos, no strings planos. | E |
| 14 | `GET /permission` | `GET /api/permission/request` (global por location) y `GET /api/session/{sid}/permission` | Campos: `{id, sessionID, action, resources[], save[], metadata?, source:{type:"tool", messageID, id}, message?}` frente a v1 `{permission, patterns, always, tool:{messageID, callID}}`. | E |
| 15 | `GET /provider` | `GET /api/provider` | Proveedores sin modelos anidados; `activation: auto\|enabled\|disabled` reemplaza a `connected[]`/`all[]`. El estado "conectado" sale de `GET /api/integration` (`connections[]`). | E |
| 16 | `GET /provider/auth` | `GET /api/integration` | `[{id, name, methods[], connections[]}]`. v1 daba `{providerID: [{type:"oauth"\|"api", label}]}`. | S |
| 17 | `GET /question` | `GET /api/form` y `GET /api/session/{sid}/form` | Las preguntas ahora son **formularios**: `{id:"frm_..", sessionID, title:"Questions", metadata:{kind:"question", tool:{messageID,id}}, fields:[{key:"q0", title, description, type:"string", options:[{value,label,description}], custom:true}]}`. La antigua `questions[]` (header/question/options/multiple) pasa a `fields[]` (`key` = `q<índice>`). | E |
| 18 | `GET /session` | `GET /api/session` | Parámetros: `directory` (en v1 era el header/`directory`), `parentID=null` (equivale a `roots:true`), `search`, `limit` (string), `cursor`, `order`. Respuesta `{data, cursor}`. El objeto sesión cambia (ver "Sesión"). | E |
| 19 | `GET /session/status` | `GET /api/session/active` | Respuesta `{data:{...}}`; con 0 sesiones activas es `{data:{}}`. La forma por sesión ocupada **no se capturó**. v1 daba `{sid:{type:"busy"\|"idle"\|"retry"}}`; en v2 la fuente fiable son los eventos `session.execution.*`. | E (vacío) |
| 20 | `GET /session/{sessionID}` | `GET /api/session/{sid}` | `{data: Session.Info}`. | E |
| 21 | `GET /session/{sessionID}/children` | `GET /api/session?parentID={sid}` | Sin ruta propia; se filtra la lista. | E |
| 22 | `GET /session/{sessionID}/message` | `GET /api/session/{sid}/message` (alternativa: `/context`) | Orden por defecto **descendente** (`order=asc\|desc`); `limit`/`cursor`/`type`. Elementos planos por `type`, ya no `{info, parts}`. Ver "Mensajes". | E |
| 23 | `GET /session/{sessionID}/message/{messageID}` | `GET /api/session/{sid}/message/{messageID}` | Un elemento de la unión de mensajes. | S |
| 24 | `GET /session/{sessionID}/todo` | **Sin equivalente** | No hay ruta ni evento de todos en la spec ni en el binario. Habría que reconstruirlos leyendo las llamadas a la herramienta `todowrite` dentro de los mensajes del asistente (si la herramienta sigue existiendo; no se probó). | S |
| 25 | `GET /skill` | `GET /api/skill` | `{id, name, description?, autoinvoke?, path, content}`; ahora incluye el contenido. | E |
| 26 | `GET /vcs/diff/raw` | `GET /api/vcs/diff?mode=working\|branch\|committed&base=&context=` y `GET /api/session/{sid}/diff` | Devuelve **estructurado por archivo** `{file, patch, additions, deletions, status}`, no un unified diff único en texto; hay que concatenar los `patch` si se quiere el crudo. `mode` y `base` son obligatorios. 503 `ServiceUnavailable` posible. | S |
| 27 | `PATCH /session/{sessionID}` | `PATCH /api/session/{sid}` | Solo acepta `{title?, metadata?, permissions?}` (204). **Ya no acepta `time.archived`**: archivar/restaurar tareas (`actions.ts`, `code/impl/store.ts`) queda sin ruta directa; `Session.Info.time.archived` existe pero la spec no tiene cómo escribirlo. Alternativa: marcar en `metadata` y filtrar en Lazunox. `permission` se llama `permissions` y cambia de forma: `{action, resource, effect: allow\|deny\|ask}` en lugar de `{permission, pattern, action}`. | E |
| 28 | `POST /api/session/{sessionID}/permission/{requestID}/reply` (ya es de la API nueva dentro de 1.18) | `POST /api/session/{sid}/permission/{requestID}/reply` | Misma ruta. Cuerpo: `{decision:"once"\|"always"\|"reject", message?}` (v1.18 usaba `reply`). 204. | E |
| 29 | `POST /global/dispose` | `POST /api/location/reload` (recarga config) / `DELETE /api/debug/location` (expulsa un location cargado) | No es 1:1: v1 reiniciaba todas las instancias. Para "aplicar cambios de config" sirve `location/reload`. | S |
| 30 | `POST /mcp/{name}/auth/authenticate` | **Sin equivalente directo** | OAuth de MCP ahora cuelga del sistema de integraciones: el estado `needs_auth` trae `integrationID` y se conecta con `POST /api/integration/{id}/connect/oauth` (+ `GET/POST .../connect/oauth/{attemptID}` y `/complete`). Hay que rehacer el flujo (devuelve `{attemptID, url, mode:"auto"\|"code"}`). | S |
| 31 | `POST /mcp/{name}/connect` | `POST /api/experimental/mcp/{server}/connect` | Ruta marcada **experimental**. 204. | S |
| 32 | `POST /mcp/{name}/disconnect` | `POST /api/experimental/mcp/{server}/disconnect` | Idem. | S |
| 33 | `POST /permission/{requestID}/reply` | `POST /api/session/{sid}/permission/{requestID}/reply` | **Ahora exige `sessionID`** en la ruta (la solicitud trae `sessionID`). Cuerpo `{decision, message?}` en vez de `{reply, message?}`. | E |
| 34 | `POST /question/{requestID}/reject` | `DELETE /api/session/{sid}/form/{formID}?message=` | Cancelar el formulario; 409 `FormAlreadySettled` si ya se resolvió. Exige `sid`. | E (reply) / S (cancel) |
| 35 | `POST /question/{requestID}/reply` | `POST /api/session/{sid}/form/{formID}/reply` | Cuerpo `{answer:{q0:"A"}}`: objeto clave→valor por campo, en vez de `{answers: string[][]}`. Para elección múltiple la forma del valor no se probó. Efecto observado: evento `form.replied` y el modelo continúa. | E |
| 36 | `POST /session` | `POST /api/session` | Cuerpo `{id?, parentID?, title?, agent?, model?:{id, providerID, variant?}, location?:{directory}, metadata?, permissions?[]}`. Cambia: `directory`→`location.directory`; `model` usa `id` (no `modelID`); `permission`→`permissions` con `{action,resource,effect}`. Respuesta `{data: Session.Info}`. | E |
| 37 | `POST /session/{sessionID}/abort` | `POST /api/session/{sid}/interrupt` | Respuesta `{interrupted: boolean}`; query `resume=true\|false`. | S |
| 38 | `POST /session/{sessionID}/command` | `POST /api/session/{sid}/command` | Cuerpo `{name, text, files?, agents?, skills?, delivery?}`. v1: `{command, arguments, agent, model:"prov/mod"}`. El argumento pasa a `text`; **agente y modelo ya no se mandan por comando**. 204 (asíncrono, el resultado llega por eventos). | E (204) |
| 39 | `POST /session/{sessionID}/fork` | `POST /api/session/{sid}/fork` | Cuerpo `{before?: messageID}` (v1: `{messageID}`; hay que confirmar que `before` equivale a "hasta antes de"). Respuesta incluye `fork:{sessionID, boundary:{type:"before"\|"through", messageID}}` y título "… (fork #1)". Sin `before` bifurca "through" el final. | E |
| 40 | `POST /session/{sessionID}/prompt_async` | `POST /api/session/{sid}/prompt` | Ver detalle abajo: `{text, files?, agents?, skills?, metadata?, delivery?: steer\|queue, resume?, id?}`. **Sin `agent`, `model`, `variant`, `system`, `tools`, `noReply`, `parts[]`.** Responde 200 con el item de bandeja `{id, type:"user", payload, delivery}` (ya no 204). 409 `Conflict` posible. Es asíncrono, como `prompt_async`. | E |
| 41 | `POST /session/{sessionID}/revert` | `POST /api/session/{sid}/revert/stage` (+ `POST .../revert/commit`) | Cuerpo `{messageID, files?: boolean}` (sin `partID`). Es **dos fases**: `stage` marca el punto (los mensajes siguen en la lista, como en v1) y `commit` lo confirma. Respuesta `{data:{messageID, partID?, snapshot?, files?}}`. 409 `SessionBusy`. | E (stage) / S (commit) |
| 42 | `POST /session/{sessionID}/summarize` | `POST /api/session/{sid}/compact` | Cuerpo `{id?, delivery?}`. v1 pedía `providerID`/`modelID`; **v2 usa el modelo de la sesión** (cambiable antes con `POST .../model`). Responde el item `type:"compaction"`; progreso por eventos `session.compaction.*` (inferido). | E |
| 43 | `POST /session/{sessionID}/unrevert` | `DELETE /api/session/{sid}/revert` | 204. | E |
| 44 | `PUT /auth/{providerID}` | `POST /api/integration/{integrationID}/connect/key` (cuerpo `{key, label?, answer?}`) o `POST /api/credential` (`{integrationID, value:{type:"key", key}, activate?}`) | v1: `{type:"api", key}` por proveedor. v2 separa integración, método y credencial; `connect/key` es lo más cercano. **No se probó** (sin credenciales reales). | S |

### Rutas v2 que reemplazan funciones que v1 hacía de otra forma

- `POST /api/session/{sid}/model` y `POST /api/session/{sid}/agent`: cambiar modelo/agente de la sesión (204). Sustituyen al
  `model`/`agent` por prompt. Cada cambio queda como mensaje `model-switched` / `agent-switched` en el historial.
- `POST /api/session/{sid}/synthetic`: mensaje sintético (reemplaza las partes `text` con `synthetic:true` + `metadata`).
- `PUT /api/experimental/session/{sid}/instructions/entries/{key}`: instrucciones por sesión (experimental); candidato
  para reemplazar el `system` por prompt de `buildSystemPrompt()` / `buildCodeSystemPrompt()`. Límite de tamaño (413).
- `GET /api/session/{sid}/inbox` (+ `PATCH`/`DELETE .../inbox/{inboxID}`): cola de mensajes `steer`/`queue`.
- `POST /api/session/{sid}/shell`, `/api/shell*`, `/api/pty*`, `/api/worktree*`, `/api/vcs*`, `/api/project*`:
  superficie nueva que Lazunox no usa hoy.
- `POST /api/pair` y `GET /auth/connect/{code}`: códigos de emparejamiento de un solo uso (podrían interesar al control remoto).

## Eventos SSE: `GET /global/event` (v1) frente a `GET /api/event` (v2)

### Envoltorio

| | v1 `/global/event` | v2 `/api/event` (observado) |
|---|---|---|
| Línea SSE | `data: {"directory":"...","payload":{...}}` | `data: {"id":"evt_..","created":<ms>,"type":"...","location":{"directory":"..."},"data":{...},"durable":{"aggregateID":"ses_..","seq":N,"version":N}}` |
| Directorio | `directory` a nivel raíz | `location.directory` (ausente o `null` en eventos globales, p. ej. `project.updated`, `session.execution.*`, `session.usage.updated`) |
| Tipo y datos | `payload.type`, `payload.properties` | `type`, `data` |
| Id del evento | no | `id` `evt_...` en el cuerpo (no hay campo SSE `id:` ni `event:`) |
| Orden/reanudación | no | `durable.seq` por sesión (eventos persistidos); los deltas (`*.delta`) no son durables. Reanudar/repetir: `GET /api/experimental/session/{sid}/log?after=&follow=true` (experimental). |
| Primer evento | `server.connected` con `properties:{}` | `server.connected` con `data:{}`; después, una línea en blanco |
| Latido | `server.heartbeat` cada ~10 s | No se observó en una ventana corta; **por verificar** (afecta a la reconexión por silencio) |

### Correspondencia de tipos que Lazunox consume hoy

| Evento v1 | Evento v2 | Notas |
|---|---|---|
| `server.connected` | `server.connected` (E) | Igual. |
| `global.disposed` | `global.disposed` (inferido) | Sin probar. |
| `session.created` / `updated` / `deleted` | `session.created` (E), `session.updated`, `session.deleted`, `session.renamed`, `session.metadata.updated` (inferido) | `session.created` trae `{sessionID, slug, version, projectID, location, subpath, title, permissions, model}`, no el objeto sesión completo. |
| `session.status` (`busy`/`idle`/`retry`) | `session.execution.started` / `succeeded` / `failed` / `interrupted` (E los dos primeros), `session.retry.scheduled` (inferido) | No hay un evento único de estado: el cliente debe derivarlo. |
| `session.idle` | `session.execution.succeeded` (E) | También queda un mensaje `type:"idle"` con `outcome`. |
| `session.error` | `session.execution.failed`, `session.step.failed`, `session.tool.failed` (inferido) | Error: `{type, message, status?, response?}`. |
| `message.updated` (info de mensaje) | `session.step.started` (agente/modelo/`assistantMessageID`), `session.step.ended` (`finish`, `cost`, `tokens`), `session.usage.updated` (acumulado de sesión) (E) | El mensaje de usuario llega como `session.inbox.enqueued` + `session.inbox.delivered` (E). |
| `message.part.updated` (texto) | `session.text.started` / `delta` / `ended` (E) | |
| `message.part.updated` (razonamiento) | `session.reasoning.started` / `delta` / `ended` (E) | |
| `message.part.updated` (tool pending→running→completed/error) | `session.tool.input.started` → `input.delta` → `input.ended` → `session.tool.called` → `session.tool.progress` → `session.tool.success` / `session.tool.failed` (E salvo `input.delta`/`failed`) | Se identifica por `id` de llamada (`call-<uuid>`) dentro del `assistantMessageID`. |
| `message.part.delta` `{partID, field, delta}` | `session.text.delta` `{assistantMessageID, ordinal, delta}` (E) | No hay `partID`; los bloques se indexan por `ordinal` (y el contenido final está en `content[]`). |
| `message.part.removed` / `message.removed` | Sin evento equivalente visible; relacionados: `session.revert.staged` / `committed` / `cleared` (inferido) | Revisar cómo se refrescan los mensajes tras un revert. |
| `permission.asked` | `permission.asked` (E) | Cambian los campos (ver fila 14). |
| `permission.replied` | `permission.replied` (E) `{sessionID, requestID, reply}`; añade `permission.rejected` (inferido) | |
| `question.asked` | `form.created` (E) `{form:{...}}` | |
| `question.replied` | `form.replied` (E) `{id, sessionID, answer}` | |
| `question.rejected` | `form.cancelled` (inferido) | |
| `todo.updated` | **Sin equivalente** | Ver fila 24. |
| `session.diff` | **Sin equivalente como evento**; usar `GET /api/session/{sid}/diff` | Reconsultar al terminar un paso. |
| `file.edited` | `file.edited` (inferido) | |
| `file.watcher.updated` | **No aparece** en el binario | Ver riesgos (refresco del árbol de archivos). |
| `vcs.branch.updated` | `vcs.branch.updated` (inferido) | |
| (no existía) | `project.updated` (E), `shell.created` / `exited` (E), `session.instructions.updated` (E), `session.compaction.*`, `pty.*`, `worktree.*`, `mcp.status.changed`, `mcp.tools.changed`, `lsp.updated`, `credential.updated`, `integration.updated` | |

Secuencia observada para un turno con una herramienta (resumida): `session.inbox.enqueued` → `session.execution.started`
→ `session.instructions.updated` → `session.inbox.delivered` → `session.step.started` → `reasoning.*` →
`tool.input.started/ended` → `tool.called` → `shell.created` → `tool.progress` → `shell.exited` → `tool.success` →
`step.ended` → `usage.updated` → (segundo paso con `text.*`) → `execution.succeeded`.

Observación: la herramienta de terminal se llama `shell` (v1: `bash`) y `read` recibe `input.path` (v1: `filePath`).
Las reglas de permisos del agente por defecto ya incluyen `question: allow` y `read *.env: ask` (probado: pidió permiso).

## Mensajes y partes

### Sesión (`Session.Info`)

| v1 | v2 |
|---|---|
| `{id, slug, projectID, directory, parentID, title, version, summary{additions,deletions,files}, share, permission, time{created, updated, compacting, archived}, revert}` | `{id, parentID?, fork?{sessionID, boundary}, projectID, agent?, model?{id, providerID, variant}, cost, tokens{input, output, reasoning, cache{read,write}}, outcome?, time{created, updated, idle?, viewed?, archived?}, title?, subpath?, metadata?, permissions?, revert?{messageID, partID?, snapshot?, files?[]}, location:{directory}}` |

Cambios clave: `directory`→`location.directory`; ya no hay `summary` ni `share`; costo y tokens acumulados vienen en la propia
sesión (útil para el medidor de uso); `time.idle`/`viewed` y `outcome` nuevos; `view` (`POST .../view {idle}`) marca "visto".

### Mensajes

| Aspecto | v1 | v2 |
|---|---|---|
| Estructura | `[{info, parts[]}]` | Lista plana de objetos con `type` ∈ `user`, `assistant`, `synthetic`, `system`, `skill`, `shell`, `compaction`, `idle`, `agent-switched`, `model-switched`, `location-switched` |
| Usuario | `info.role="user"` + partes `text`/`file`/`agent`/`subtask` | `{type:"user", text, files?[], agents?[], skills?[], time}` (texto único; adjuntos aparte) |
| Asistente | `info.role="assistant"` (modelID, providerID, agent, tokens, cost, finish, path, error) + partes | `{type:"assistant", agent, model, content[], snapshot?, finish?, cost?, tokens?, error?, retry?, time{created, streamed, completed}}` |
| Partes | `text`, `reasoning`, `tool`, `file`, `step-start`, `step-finish`, `snapshot`, `patch`, `agent`, `retry`, `compaction`, `subtask`, cada una con `id` | Solo `content[]` con `text`, `reasoning`, `tool`; sin id propio. Lo de `step-*`, `snapshot`, `patch`, `retry` pasa a campos del mensaje. Los adjuntos van dentro del mensaje de usuario |
| Herramienta | `{type:"tool", callID, tool, state:{status: pending\|running\|completed\|error, input, output: string, title, metadata, time}}` | `{type:"tool", id:"call-…", name, executed?, state:{status: streaming\|running\|completed\|error, input, content: [texto\|archivo], metadata}, time{created, ran, completed}}` |
| Salida de herramienta | `state.output` (string) | `state.content[]` (p. ej. `[{type:"text", text:"hola\n"}]`), `metadata.exit` |
| Error | `info.error = {name, data:{message}}` | `error = {type, message, status?, response?{body}}` |
| Mensajes del sistema | partes `text` con `synthetic:true` | mensajes `synthetic` / `system` / `skill` separados; `description` opcional |
| Comandos `!` | n/d | mensaje `type:"shell"` con `shellID`, `command`, `status`, `exit`, `output` |
| Fin de turno | `session.idle` | mensaje `type:"idle"` con `outcome` y `error?` |
| Paginación | sin límite práctico | `order` por defecto `desc`; `cursor.previous/next`; filtro `type=` |
| Identificadores | `msg_`, `prt_`, `call_` | `msg_`, `ses_`, `per_` (permiso), `frm_` (formulario), `evt_`, `sh_`; llamadas `call-<uuid>`; `Session.Message.ID` debe empezar con `msg_` |

### Prompt (la mayor diferencia de contrato)

| v1 `prompt_async` | v2 `prompt` |
|---|---|
| `agent`, `model:{providerID, modelID}`, `variant`, `system`, `tools`, `noReply`, `messageID` | **No existen.** Agente: `POST .../agent`. Modelo/variante: `POST .../model {model:{id, providerID, variant?}}` o al crear la sesión. `system`: candidato `PUT /api/experimental/session/{sid}/instructions/entries/{key}` (por sesión, no por mensaje). `id?` opcional para el mensaje |
| `parts:[{type:"text", text, synthetic?, metadata?}, {type:"file", mime, url, filename}]` | `text` (un solo string) + `files:[{uri, name?, description?, mention?}]`, `agents:[{name}]`, `skills:[{id}]`, `metadata` (de todo el mensaje) |
| 204 sin cuerpo | 200 `{data:{id, sessionID, type:"user", payload, delivery}}` |
| Mensaje durante un turno: se encola | `delivery`: `steer` (por defecto, inyecta en el turno) o `queue` |

Impacto en Lazunox: los bloques de "elementos" (`ELEMENT_METADATA`, partes `text` con `synthetic:true`) y la marca por parte
dejan de existir; hay que llevarlos a `metadata` del mensaje o a `/synthetic`. Además el modo del agente
(`TASKS_AGENT_ID` / `COMPUTER_AGENT_ID` / `CHAT_AGENT`) pasaría a cambiarse con `POST .../agent` antes de cada envío
(o crear una sesión por agente). Los adjuntos de imagen/archivo van como `uri`; no se probó si acepta `data:` URIs.

## Riesgos

1. **Cambio de contrato, no de versión.** No es una actualización de dependencia: casi todas las 44 rutas cambian de
   ruta, cuerpo o forma de respuesta, y 3 no tienen equivalente (`todo`, `mcp auth` directo, archivar sesiones). Requiere
   una capa de adaptación en `lib/opencode.ts` y reescribir `actions.ts`, `code/impl/store.ts`, `chat/actions.ts`,
   `compare/store.ts`, `scheduler/service.ts`, `stores/sessions.ts` y los reductores de eventos.
2. **Reductor de eventos.** Hoy el estado se arma con `message.updated` / `message.part.updated` / `message.part.delta`
   y `session.status`. En v2 hay que reconstruir mensajes a partir de eventos de paso, texto, razonamiento y herramienta,
   sin `partID`, y derivar `busy/idle`. Los deltas no son durables; ante una reconexión hay que releer el historial
   (`GET .../message`) o usar el log experimental con `seq`.
3. **Control remoto (alto).** `src/main/remote/policy.ts` es una lista blanca por ruta y método; `event-trim.ts`,
   `engine-fetch.ts`, `events-hub.ts` y `engine-proxy.ts` filtran por tipo de evento v1 y por envoltorio
   `{directory, payload}`. Hay que reescribir toda la tabla de políticas, el recorte por ámbito (ahora por
   `location.directory`/`sessionID`) y el reenvío SSE. Además, la superficie nueva expone cosas peligrosas que la lista
   blanca debe negar explícitamente: `GET /api/credential` (devuelve claves y tokens en `value`), `POST /api/credential`,
   `/api/pty*`, `/api/shell*`, `/api/experimental/fs/write`, `PUT /api/session/{sid}/environment`, `/api/rpc/*`,
   `/api/experimental/mcp/*` (añadir MCP = ejecutar comandos) y `PATCH /api/experimental/config`.
   También cambia el modelo de credenciales de permisos: la respuesta a un permiso ahora exige `sessionID` en la ruta.
4. **Pérdida de funciones.** Sin `todo` (el panel de progreso `work-progress.ts` / `ProgressPanel.tsx` depende de
   `todo.updated`), sin evento `session.diff`, sin `file.watcher.updated` (refresco del árbol), sin `time.archived` en
   `PATCH` (archivar/restaurar tareas), sin `system` por mensaje (memoria aprendida, prompts de modo, sandbox de
   carpetas extra), sin variante/modelo/agente por prompt. Cada una requiere rediseño o sustituto.
5. **Cambio de modelo/agente como estado de sesión.** Hoy cada envío fija agente, modelo y variante; en v2 son estado
   de sesión con mensajes `model-switched`/`agent-switched` en el historial. Las carreras (dos envíos con modelos
   distintos desde escritorio y celular) cambian de semántica. Comparar modelos (`compare/store.ts`) y el programador
   (`scheduler/service.ts`) dependen de enviar modelo distinto por llamada.
6. **Rutas experimentales.** MCP connect/disconnect, instrucciones por sesión, config, `stats`, log de eventos, `wait`,
   fs/write y persistent PTY viven bajo `/api/experimental/...` y pueden romperse sin aviso. El título de la spec dice
   "Experimental HttpApi surface".
7. **Autenticación y arranque.** Usuario fijo `opencode`; `OPENCODE_SERVER_USERNAME` ignorado (hoy lo fija
   `sandbox.ts`/`opencode-config.ts`). La comprobación de salud pasa de `/global/health` a `/api/info`. Una ruta v1
   mal escrita devuelve HTML de la SPA, así que los clientes no deben fiarse solo del código HTTP: validar
   `content-type: application/json`. El servicio en segundo plano (`opencode service`, `serve --service`) es nuevo y
   podría compartir servidor entre apps; Lazunox debería seguir con su propio `serve`.
8. **Configuración y agentes.** `OPENCODE_CONFIG_CONTENT`, `OPENCODE_CONFIG_DIR` y `OPENCODE_AUTH_CONTENT` se usan
   para inyectar proveedores, agentes y prompts (`resources/opencode`). El esquema del documento de config cambió
   (modelo como objeto) y los agentes se listan con `permissions` en formato `{action,resource,effect}`; hay que
   revalidar los agentes Lazunox (tasks, computer, chat), el catálogo de proveedores (`providerCatalog.ts`) y los
   ajustes de permisos por modo (`rulesetFor`, `permissionMode`). Las reglas v1 `{permission, pattern, action}` no se
   aceptan tal cual.
9. **Autenticación de proveedores.** El flujo de claves pasa por integraciones/credenciales y OAuth por intentos
   (`attemptID`). La UI de `ProviderKeyForm`/`McpSection` y el guardado en el llavero deben rediseñarse; el listado de
   credenciales devuelve secretos en claro (cuidar logs y remoto). No se probó ningún flujo con credenciales reales.
10. **Cosas no verificadas** (hacerlas antes de decidir): forma de `GET /api/session/active` con sesiones ocupadas;
    latido SSE en conexiones largas; `GET /api/session` sin `directory` (todos los proyectos) y el orden por defecto;
    adjuntos por `data:` URI; respuestas múltiples en formularios; `commit` de revert y qué pasa si se envía un
    prompt con un revert en etapa; semántica exacta de `fork.before`; existencia y forma de las herramientas `todowrite`
    y `task` (subagentes) en v2; rendimiento y consumo de memoria (el binario pesa ~186 MB frente a ~46 MB de v1);
    empaquetado Windows (`win32-x64`) y rootfs WSL.
11. **Empaquetado.** El binario 2.0.28 darwin-arm64 pesa 186 MB (v1.18.33: 46 MB). `pin.json`, firmas/sha256, el
    actualizador (`swap.sh`/`swap.ps1`) y `docs/ACTUALIZAR-OPENCODE.md` suponen v1; el chequeo de `api-routes.json`
    (188 rutas v1) dejaría de tener sentido y habría que regenerarlo desde la spec v2.
12. **Datos existentes.** Existe `GET /api/experimental/migration/v1` (estado de migración de datos v1); no se probó, así
    que no se sabe si las sesiones actuales de los usuarios se importan, ni si la migración es reversible.

## Recomendación

No migrar de golpe. Orden sugerido: (1) probar `migration/v1` con una copia de datos reales y validar adjuntos,
`system`/instrucciones y `todowrite`; (2) construir una capa `engine` con interfaz propia (crear/enviar/interrumpir/
revertir/permisos/preguntas/eventos normalizados) con dos implementaciones, v1 y v2; (3) pasar primero el reductor de
eventos con grabaciones del SSE v2; (4) reescribir `policy.ts` y el recorte de eventos del remoto antes de exponer
nada; (5) mantener el pin 1.18.x hasta que los puntos sin equivalente (todo, archivar, system por mensaje) estén
resueltos. Es un cambio grande: conviene tratarlo como proyecto propio con rama larga, no como una actualización de pin.
