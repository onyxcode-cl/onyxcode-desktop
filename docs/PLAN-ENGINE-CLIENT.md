# Plan: etapa 0, capa `EngineClient` entre Lazunox y el motor

Fecha: 2026-10-22. Rama de partida: `feat/traducir-word`. Solo plan; no se tocó código. Contexto y motivos: `docs/INVESTIGACION-OPENCODE-2.md` (recomienda esperar a 2.x y hacer esta etapa 0 mientras tanto).

**Meta**: que `@opencode-ai/sdk` y las rutas HTTP del motor se importen en UN lugar por proceso, con tipos propios, SIN cambiar el comportamiento. Después, cambiar de motor es escribir un `Engine2Adapter`, no tocar 77 archivos.

**Ojo con el nombre**: todo el código importa de `@opencode-ai/sdk/v2/client`. Ese «v2» es el cliente generado de la API **1.19** (el motor que fijamos), no el motor 2.x. En este plan «motor 1» = 1.19 con ese cliente; «motor 2» = `@opencode/client` (rutas `/api/*`). Nunca nombrar a nada nuestro «v2» a secas.

## 1. Inventario real (archivo:línea)

Medido sobre la rama: 77 archivos no-test importan el SDK (63 solo `import type`, 14 con valor). Hay **3 consumidores independientes** del SSE (renderer, remoto, Telegram) y **4 sitios que crean cliente en main** más HTTP crudo en `tasks/`.

### 1.1 Creación de clientes y conexión (el valor, no solo tipos)

| Capa | Dónde | Qué hace |
| --- | --- | --- |
| renderer | `src/renderer/src/lib/opencode.ts:17` (`createClient`), `:25` (`startEventStream`, bucle SSE con reconexión), `:63` (`errorMessage`) | Cliente único + stream `global.event`; exporta `OcEvent`, `OpencodeClient` (se filtran a todo el renderer) |
| renderer | `src/renderer/src/stores/server.ts:22,41` (`onOpencodeEvent`, `onStreamReconnect`) | Fan-out del stream a `App.tsx:54`, `code/impl/client.ts:35`, `compare/store.ts:354` |
| renderer | `features/tasks/impl/store.ts:597` (segundo `createOpencodeClient`), `:836` (segundo `startEventStream`) | Tareas abre su propio cliente y stream |
| main | `scheduler/service.ts:881` (rutinas, con `createOpencodeClient`), `compare/engine.ts:68` (con `fetch` temporizado), `telegram/engine-link.ts:370`, `remote/index.ts:70,96`, `ipc/diagnostics.ts:32`, `computer/abort.ts:25` | 7 clientes con la misma receta `{baseUrl, Authorization}` |
| main (HTTP crudo, sin SDK) | `embedded-browser/owner.ts:55` (`GET /session/{id}`), `tasks/manager.ts:514` (`/session/status`), `tasks/auto-approver.ts:262` (`fetchJson` de `/session/{id}`), `tasks/monitor.ts:316,362,635,795` (`req`: `GET /session/{id}/message?limit=`, `GET`/`PATCH /session/{id}` para archivar), `util/net.ts:39` (`/global/health`), `ipc/extras-handlers.ts:101` (`POST /global/dispose`), `ipc/providers.ts:10` (`GET /provider`) | Es la parte más cara de migrar: no pasa por tipos |

### 1.2 Llamadas por operación (nº de sitios)

- **Mensajes** `session.messages` (12): `main/compare/engine.ts:101`, `remote/whitelist.ts:204`, `scheduler/service.ts:1135`, `telegram/engine-link.ts:496`; renderer `code/impl/store.ts:454`, `code/impl/export.ts:17`, `code/impl/pr/pr-ai.ts:95`, `compare/store.ts:228`, `search/search-service.ts:126`, `tasks/impl/search.ts:188`, `tasks/impl/store.ts:1034`, `stores/sessions.ts:271`. También `session.message` en `remote/whitelist.ts:292`.
- **Envío** `session.promptAsync` (9) + `session.command` (1): `compare/engine.ts:84`, `remote/whitelist.ts:230`, `scheduler/service.ts:1010`, `telegram/engine-link.ts:508`, `chat/actions.ts:237`, `code/impl/pr/pr-ai.ts:83`, `code/impl/store.ts:696` (+`:998` command), `tasks/impl/actions.ts:584,1173`. Hoy los cuatro de main y tres del renderer construyen a mano `{parts, model, agent, variant}`.
- **Abort** `session.abort` (14): `compare/engine.ts:95`, `computer/abort.ts:37`, `remote/whitelist.ts:244`, `scheduler/service.ts:954`, `chat/actions.ts:327,403`, `pr-ai.ts:104`, `code/impl/store.ts:1016,1060,1214`, `tasks/impl/actions.ts:243,668,748,1195`.
- **Ciclo de vida de sesión**: `create` (7: `compare/engine.ts:72`, `scheduler/service.ts:905`, `chat/actions.ts:215`, `pr-ai.ts:72`, `code/impl/store.ts:936`, `tasks/impl/actions.ts:558,1154`), `delete` (5), `update` (13, renombrar/archivar: `chat/actions.ts:408-447`, `code/impl/store.ts:649,1239-1321`, `tasks/impl/actions.ts:787-1211`), `get` (3), `list` (5: `remote/whitelist.ts:146`, `telegram/engine-link.ts:458`, `ProjectPicker.tsx:217`, `code/impl/store.ts:892`, `stores/sessions.ts:221`), `children` (2), `status` (13).
- **Fork/revert/resumen**: `session.fork` solo `code/impl/store.ts:1333`; `revert` (6: `chat/actions.ts:352`, `code/impl/store.ts:1030,1040,1070`, `tasks/impl/actions.ts:701,1063`); `unrevert` (4); `summarize` (3: `chat/actions.ts:392`, `code/impl/store.ts:1353`, `tasks/impl/actions.ts:1079`); `todo` (2).
- **Permisos y preguntas**: `permission.list` (7: `remote/whitelist.ts:191,253`, `scheduler/service.ts:1187`, `telegram/engine-link.ts:443,527`, `code/impl/store.ts:540`, `tasks/impl/store.ts:1073`), `permission.reply` (7: `whitelist.ts:258`, `scheduler/service.ts:1192,1208`, `engine-link.ts:429`, `code/impl/store.ts:1129`, `compare/store.ts:334`, `tasks/impl/actions.ts:753`), `question.list/reply/reject` (`chat/actions.ts:64-91`, `code/impl/store.ts:541,1145,1160`, `tasks/impl/actions.ts:765,776`, `scheduler/service.ts:1221,1224`). Auto-aprobación: `tasks/auto-approver.ts` (HTTP crudo, 416 líneas).
- **Config, proveedores, credenciales**: `config.providers` (6: `diagnostics.ts:33`, `scheduler/service.ts:1000`, `reconcileModels.ts:19,51`, `tasks/impl/actions.ts:533`, `stores/providers.ts:36`), `provider.list/auth` (`providerCatalog.ts:34`, `Wizard.tsx:107`), OAuth `provider.oauth.authorize/callback` (`providerCatalog.ts:172,187`), `auth.set/remove` (`providerCatalog.ts:88`, `ModelsSection.tsx:141`), `global.dispose` (`providerCatalog.ts:90,189`, `ModelsSection.tsx:143`), `mcp.status/connect/disconnect` (`useMcpConnections.ts:78`, `McpSection.tsx:106-107`).
- **Archivos/VCS/PTY**: `file.list/read/status` (`FilesPanel.tsx:397`, `ChangesPanel.tsx:120,148`), `pty.resize/write/kill` (`terminalRegistry.ts:143-175`).
- **SSE** `global.event` (8): `lib/opencode.ts:37`, `remote/events.ts:288`, `remote/index.ts:97`, `remote/sse-hub.ts:26`, `telegram/engine-link.ts:380`. Eventos que se manejan (por frecuencia): `message.part.updated/delta/removed`, `message.updated/removed`, `session.status/idle/updated/created/deleted/error/diff`, `permission.asked/replied`, `question.asked/replied/rejected`, `todo.updated`, `server.connected`, `file.edited`, `vcs.branch.updated`. Reductor: `renderer/src/lib/session-reducer.ts` (607 líneas) y los tres stores (`code/impl/store.ts`, `tasks/impl/store.ts`, `compare/store.ts`).

### 1.3 Tipos del SDK que se filtran (hacia UI y main)

Por frecuencia de import: `Session` (~25 archivos: sidebars, listas, export, búsqueda, `stores/sessions.ts:17`), `Part`/`ToolPart`/`TextPart`/`FilePart`/`ReasoningPart` (~25: `lib/conversation/*`, `MessageStream.tsx`, `ToolCard.tsx`, `ChatToolCall.tsx`, `shared/doc-files.ts:7`, `main/telegram/turn.ts:19`), `Message`/`AssistantMessage` (~12), `PermissionRequest` (~12 de tareas), `QuestionRequest`/`QuestionInfo`, `Todo`, `Provider`/`ProviderAuthMethod`/`ProviderAuthAuthorization`, `McpStatus`, `Command`, `FileNode`/`FileContent`, `PermissionRuleset` (`code/impl/permission-rules.ts:1`, `main/compare/engine.ts:5`), `SessionStatus`, `GlobalEvent['payload']` (`OcEvent`). Dos se filtran a **`src/shared/`**: `doc-files.ts:7` y `opencode-links.ts`; y a **fixtures de prueba**: `src/test/fixtures/events.ts:6`, `entries.ts:2`.

### 1.4 Capas que NO usan el SDK pero dependen de la forma del motor

- Control remoto: `remote/engine-proxy.ts` (762 líneas, regex sobre rutas del motor: `:107,159,160,525,542,692-732`) y `remote/policy.ts` (1588, tabla ruta→clase: `:859` `prompt_async`, `:995,1018,1176-1183`). Es el consumidor más atado a las **rutas** y no a tipos. Normalizadores previos útiles: `remote/events.ts` (`toRemoteMessage/Session/Permission`) y `telegram/engine-link.ts` (`EngineEvent`, ya con campo `api: 'v1'|'v2'` en `EnginePermission`).
- Plugins del motor: `tasks/opencode-config.ts:96,132,156,177` (`lazunox-env`, `lazunox-plan-gate`, `lazunox-session`, ganchos `shell.env`/`tool.execute.before`). **Zona intocable**.
- Sidecar: `opencode/server.ts`, `binary.ts`, `catalog-wait.ts`, `tasks/sandbox.ts`, `models-cache.ts`. Proceso y red, no la API; fuera de alcance.
- Contrato: `scripts/opencode-contract-lib.mjs`, `src/test/opencode-contract.test.ts`, `resources/opencode-bin/api-routes.json`. Fake: `e2e/fake-opencode/server.mjs` (1558 líneas).

## 2. Diseño propuesto

### 2.1 Principios

1. Interfaz **mínima y por casos de uso**, no un espejo del SDK. Los métodos son los de §1.2; nada más.
2. Tipos **propios y serializables** (JSON plano, sin clases) para poder cruzar IPC y PWA.
3. **Normalizar en el borde**: el adaptador traduce; el resto no ve `native`, `/api/*` ni rutas.
4. El detalle del motor que la UI necesita hoy (p. ej. `part.state.metadata`, `ToolPart.state`) se conserva en el tipo propio con la **misma forma** en la etapa 0, para que el cambio sea mecánico (alias, no rediseño). El rediseño de tipos se hace más tarde, por módulo.
5. Errores: `EngineError { kind: 'not-found'|'conflict'|'unauthorized'|'network'|'aborted'|'engine'; message; status? }`. Hoy hay `errorMessage()` (`lib/opencode.ts:63`) que adivina la forma; pasa al adaptador.

### 2.2 Dónde vive cada cosa

| Pieza | Ruta | Notas |
| --- | --- | --- |
| Tipos propios + contrato | `src/shared/engine/types.ts`, `src/shared/engine/client.ts` (interfaz `EngineClient`), `src/shared/engine/events.ts` (`EngineEvent`) | Sin importar el SDK. Importables por main, renderer y PWA. Si no cruzan IPC no necesitan schema |
| Adaptador motor 1 | `src/shared/engine/adapters/engine1.ts` (`Engine1Adapter`, única importación de `@opencode-ai/sdk/v2/client`) | `shared/` porque el renderer también habla HTTP directo con el sidecar (loopback con Authorization); el adaptador no usa nada de Node. Test de dependencia lo impide |
| Hueco motor 2 | `src/shared/engine/adapters/engine2.ts` (`Engine2Adapter`, lanza `EngineError('unsupported')`) | Solo esqueleto; ninguna importación de `@opencode/client` hasta decidir |
| Fábrica + selección | `src/shared/engine/index.ts` (`createEngineClient(conn, { kind })`), `kind` por defecto `'engine1'` | La bandera real (`engine: 'v1'|'v2'`) va en `feature-flags.ts` **más adelante**, no en la etapa 0 (zona intocable) |
| HTTP crudo de main | `src/main/opencode/engine/http.ts` (cliente fino con timeout, Basic Auth, JSON) | Sustituye los `fetch` de §1.1 (sin SDK) por métodos del mismo `EngineClient` |
| Streams | `src/main/opencode/engine/event-hub.ts` (un solo SSE en main) | Fase tardía: hoy hay 3 streams; objetivo, 1 en main que reparte a renderer (IPC), remoto y Telegram. NO en etapa 0 |
| Pruebas de contrato | `src/shared/engine/contract.ts` (+ `*.test.ts`) | Ver §4 |

### 2.3 Interfaz mínima (borrador)

```ts
// src/shared/engine/client.ts
export interface EngineClient {
  readonly kind: 'engine1' | 'engine2'
  sessions: {
    list(o?: { directory?: string; roots?: boolean; limit?: number }): Promise<Session[]>
    get(id: string, o?: Scope): Promise<Session>
    create(o: { directory: string; title?: string; parentID?: string; permission?: PermissionRule[] }): Promise<Session>
    update(id: string, p: { title?: string; archived?: number | null; permission?: PermissionRule[] }, o?: Scope): Promise<Session>
    remove(id: string, o?: Scope): Promise<void>
    children(id: string, o?: Scope): Promise<Session[]>
    status(o?: Scope): Promise<Record<string, SessionStatus>>
    todos(id: string, o?: Scope): Promise<Todo[]>
    messages(id: string, o?: Scope & { limit?: number; before?: string }): Promise<MessageWithParts[]>
    message(id: string, messageID: string, o?: Scope): Promise<MessageWithParts>
    send(id: string, i: PromptInput, o?: Scope): Promise<void>      // prompt_async
    runCommand(id: string, i: CommandInput, o?: Scope): Promise<void>
    abort(id: string, o?: Scope): Promise<void>
    fork(id: string, o?: Scope & { messageID?: string }): Promise<Session>
    revert(id: string, messageID: string, o?: Scope): Promise<Session>
    unrevert(id: string, o?: Scope): Promise<Session>
    summarize(id: string, m: ModelRef, o?: Scope): Promise<void>
  }
  permissions: { list(o?: Scope): Promise<PermissionRequest[]>; reply(id: string, r: 'once'|'always'|'reject', o?: Scope & { sessionID?: string; message?: string }): Promise<void> }
  questions:   { list(o?: Scope): Promise<QuestionRequest[]>; reply(id: string, answers: string[][], o?: Scope): Promise<void>; reject(id: string, o?: Scope): Promise<void> }
  providers:   { list(): Promise<ProviderInfo[]>; authMethods(): Promise<Record<string, AuthMethod[]>>; setKey(id: string, key: string): Promise<void>; removeKey(id: string): Promise<void>
                 oauthStart(id: string, method: number): Promise<OAuthStart>; oauthFinish(id: string, method: number, code?: string): Promise<void>; refresh(): Promise<void> /* global.dispose */ }
  mcp:         { status(o?: Scope): Promise<Record<string, McpStatus>>; connect(name: string, o?: Scope): Promise<void>; disconnect(name: string, o?: Scope): Promise<void> }
  files:       { list(path: string, o?: Scope): Promise<FileNode[]>; read(path: string, o?: Scope): Promise<FileContent>; status(o?: Scope): Promise<FileChange[]> }
  events: { subscribe(h: (e: EngineEvent) => void, o?: { onOpen?(): void; onError?(e: EngineError): void; signal?: AbortSignal }): () => void }
  health(): Promise<{ ok: boolean; version?: string }>
}
```

`Scope = { directory?: string }` (el motor 1 acepta `directory` por llamada; el motor 2 lo resolverá en el adaptador). PTY (`pty.*`) y `auth.set` quedan en un sub-objeto `terminal` en un paquete aparte (§6, P9).

`EngineEvent` (unión discriminada, valores ya normalizados): `session.created|updated|deleted`, `session.status`, `session.idle`, `session.error`, `session.diff`, `message.updated|removed`, `part.updated|delta|removed` (nombres propios; el adaptador 1 mapea `message.part.*`), `permission.asked|replied`, `question.asked|replied|rejected`, `todo.updated`, `file.edited`, `vcs.branch`, `connected`, y `unknown { raw }` para no perder eventos nuevos. Cada uno lleva `directory` (hoy `GlobalEvent.directory`).

### 2.4 IPC, seguridad e i18n (reglas de AGENTS.md)

- **El renderer sigue hablando con el sidecar por HTTP** (como hoy): la etapa 0 no crea canales IPC nuevos. Si más adelante el event-hub de main reenvía eventos al renderer, será un canal `opencode:event` con contrato en `src/shared/ipc.ts`, esquema estricto en `src/main/ipc/schemas.ts`, handler con `guardInvoke` y **clase en `src/main/remote/policy.ts`** (denegar por defecto; `remote:*` y canales nuevos son X salvo decisión).
- **Control remoto**: `policy.ts` y `engine-proxy.ts` clasifican **rutas**. Mientras el motor sea el 1, no cambian. Para el motor 2 hará falta una tabla paralela (`/api/*`) con clases R/M/D/X, probada por los tests que hoy exigen que cada ruta tenga clase. Fuera de la etapa 0; el remoto está pausado (memoria del proyecto).
- **Mensajes de error visibles** (`EngineError.message`) que lleguen a la UI van por `t('clave')`; el adaptador devuelve códigos, no frases. Claves nuevas en `src/shared/i18n/es/*` y `en/*`, y respetar `visible-terms` (sin nombrar productos de terceros).
- **Zonas intocables que no se tocan**: `tasks/sandbox*.ts`, `proxy.ts`, `provider-egress.ts`, `proxy-policy.ts`, `folder-policy*.ts`, `opencode-config.ts` y su uso en `manager.ts` (plugins y puerta del plan), `app-protocol.ts`, preloads secundarios, banderas Windows. `tasks/monitor.ts` y `auto-approver.ts` hacen HTTP crudo pero **no** son zona intocable; aun así el auto-aprobador decide permisos: cambiarlo exige revisión de seguridad y prueba específica.

## 3. Migración incremental (cada paso = 1 commit pequeño y reversible)

Regla: en cada paso el comportamiento no cambia, las pruebas existentes siguen verdes, y `git revert` del commit lo deshace.

| Paso | Qué | Por qué en este orden |
| --- | --- | --- |
| 0.1 | Crear `src/shared/engine/{types,client,events}.ts` con **alias** a los tipos del SDK (`export type Session = SdkSession`) y `EngineError`. Nada usa aún el módulo | Cero riesgo; fija el vocabulario |
| 0.2 | `Engine1Adapter` mínimo (sessions + permissions) y su contrato compartido (§4). Sin consumidores | Se prueba aislado contra el fake |
| 0.3 | **Primer módulo: `main/computer/abort.ts`** (1 cliente, 2 llamadas: `status`, `abort`) y `ipc/diagnostics.ts` | Los más pequeños y aislados; validan la fábrica |
| 0.4 | `main/compare/engine.ts` (`create/promptAsync/abort/messages/children/delete`, `PermissionRuleset`) | Cubre el ciclo completo en un archivo propio, con prueba existente |
| 0.5 | HTTP crudo de main: `embedded-browser/owner.ts`, `util/net.ts`, `ipc/providers.ts`, `ipc/extras-handlers.ts`, `tasks/manager.ts:514` → `main/opencode/engine/http.ts` | Quita el HTTP sin tipos; fáciles de probar con `http` falso |
| 0.6 | `scheduler/service.ts` (rutinas) y `telegram/engine-link.ts` + `turn.ts` (ya normalizan: `EngineEvent` local pasa a ser el propio) | Main puro, sin renderer |
| 0.7 | Renderer, solo **tipos**: sustituir `import type … from '@opencode-ai/sdk/v2/client'` por `@shared/engine` (63 archivos, mecánico, por carpetas: `lib/` → `components/` → `stores/` → `settings` → `chat` → `code` → `tasks`) | Es cambio de ruta de import, sin lógica; se puede lotear |
| 0.8 | Renderer, valor: `lib/opencode.ts` y `stores/server.ts` usan `createEngineClient`; `startEventStream` pasa a `events.subscribe` | Aquí se centraliza; el store de Tareas (`store.ts:597,836`) deja de abrir su propio cliente |
| 0.9 | Renderer, llamadas: `chat/actions.ts`, `tasks/impl/actions.ts`, `code/impl/store.ts`, `compare/store.ts`, `stores/sessions.ts` de `client.session.x` a `engine.sessions.x` | Los más grandes y con más estado: al final |
| 0.10 | Regla ESLint/guardia en `src/test` que prohíbe `@opencode-ai/sdk` fuera de `src/shared/engine/adapters/` (excepción: `scripts/` y contrato) | Cierra la etapa 0 y evita regresiones |

**Lo último / no se toca en etapa 0**: `remote/engine-proxy.ts` + `policy.ts` (rutas), `remote/events.ts` + `sse-hub.ts` (SSE hacia el celular; se tocan tras el event-hub), `tasks/auto-approver.ts` y `tasks/monitor.ts` (decisión de seguridad; cambiar solo el transporte, con prueba de que los mismos casos producen las mismas respuestas), plugins, sandbox, proxies, `opencode-config.ts`, `server.ts`/`binary.ts`/`pin.json`.

## 4. Cómo se prueba

- **Por paso**: `npx vitest run <archivos del módulo>` más `npm run typecheck`. Nada de la suite completa ni Electron en el Mac de Ben (memoria «No saturar el Mac»: máx. 1-2 agentes pesados, load 60 con 5).
- **Suite completa, E2E y build**: al VPS (memoria «Pruebas en el VPS»), una vez por lote de pasos y antes de fusionar, con el cerrojo de build de AGENTS.md §3. Al cierre, `pgrep -fl "electron|opencode|vitest"`.
- **Contrato compartido** (clave): `src/shared/engine/contract.ts` exporta `runEngineContract(make: () => Promise<{ client: EngineClient; close(): void }>)` con casos: crear/listar/renombrar/archivar/borrar, enviar y recibir mensajes con partes, abortar, permiso pedido → responder `once/always/reject`, pregunta responder/rechazar, fork/revert/unrevert, reconexión del SSE y `connected`. Se ejecuta contra (a) `Engine1Adapter` + `e2e/fake-opencode/server.mjs` y, cuando exista, (b) `Engine2Adapter` + `fake-opencode-v2`. El fake pasa a ser **doble de pruebas del contrato**, no solo de la UI: `server.test.mjs` ya cubre rutas; se amplía con estos casos.
- **Pruebas existentes que sirven de red**: `src/test/opencode-contract.test.ts` (rutas usadas vs SDK; se **actualiza** para leer también `src/shared/engine/adapters/`), `remote/engine-proxy.test.ts` y policy tests (deben seguir intactos), `session-reducer` y fixtures (`src/test/fixtures/events.ts`).
- **Guardia de aislamiento**: test que recorre `src/` y falla si aparece `@opencode-ai/sdk` fuera de los permitidos, y otro que falla si se añade `fetch(` a rutas del motor fuera de `engine/`.
- **Motor real**: el fake no basta (memoria «Probar la app real por CDP»). Un único chequeo manual por lote grande: app real con modelo gratuito, enviar mensaje, abortar, permiso, renombrar, en Mac (CDP) y una pasada en Windows por Tailscale antes de cerrar la etapa.
- **Contrato por escrito**: añadir a `docs/VERIFICACION.md` la lista de qué cubre el contrato y qué solo cubre el motor real.

## 5. Riesgos

| Riesgo | Efecto | Mitigación |
| --- | --- | --- |
| Tipos propios «mejorados» antes de tiempo | Cambia el comportamiento sin querer (`part.state`, `time`, `metadata`) | En etapa 0 solo alias + copia exacta; rediseñar después, por módulo |
| Interfaz que es espejo del motor 1 y no sirve para el 2 | Se rehace dos veces | Contrato escrito por casos de uso y revisado contra la lista de rutas `/api/*` de la investigación (§1.1) antes del paso 0.8 |
| SSE: orden, duplicados y reconexión | Mensajes perdidos o dobles (hoy hay reducer sensible: `session-reducer.ts`) | El adaptador solo traduce nombres; reconexión y `connected` se copian tal cual; la prueba de contrato incluye corte y reconexión |
| `directory` implícito del motor 1 | Se pide la sesión en otra carpeta y devuelve 404 | `Scope` explícito y probado con dos carpetas |
| Errores del SDK (`{data:{message}}`) | La UI muestra otro texto o ninguno | Test de `errorMessage` con los 6 casos actuales |
| Auto-aprobador y monitor | Aprobar de más o perder un permiso | No se tocan hasta el final; si se tocan, mismo conjunto de casos con salidas idénticas |
| Control remoto (rutas) | Una ruta nueva sin clase = rechazo | El remoto sigue hablando rutas del motor 1; no se cambia en etapa 0 |
| Cliente único en renderer vs dos hoy (`tasks/store.ts:597`) | Dos streams pasan a uno: otro orden de eventos | Paso 0.8 aparte, con E2E de tareas en VPS |
| Bundle del renderer | Si el adaptador mete el SDK en más chunks | Medir tamaño del bundle antes y después (`npm run build`) |
| Mantener a la vez fake, contrato y `api-routes.json` | Divergencia | Una sola fuente: el contrato; `check:opencode` sigue como alarma de versión |
| Cambios en la rama `feat/traducir-word` | Mezclar trabajos | Rama propia `feat/engine-client`, un worktree por agente |

## 6. Esfuerzo y paquetes de trabajo paralelizables

Estimación en días-persona con agente (sin contar revisión del dueño ni pruebas del VPS en espera): total **≈ 10-14 días** repartibles; con 2 agentes en paralelo, ~1 semana de calendario.

| Paquete | Archivos propios (sin solaparse) | Dependencias | Esfuerzo |
| --- | --- | --- | --- |
| P0 Núcleo: tipos, interfaz, `EngineError`, `Engine1Adapter` (sessions, permissions, questions), fábrica, hueco `Engine2Adapter` | `src/shared/engine/**` | — | 2-3 d |
| P1 Contrato + fake: `contract.ts`, ampliar `server.test.mjs`, guardias de aislamiento | `src/shared/engine/contract*`, `e2e/fake-opencode/server.test.mjs`, `src/test/engine-isolation.test.ts` | P0 (interfaz) | 1-2 d |
| P2 Main pequeño: `computer/abort.ts`, `ipc/diagnostics.ts`, `compare/engine.ts` | esos 3 archivos | P0 | 1 d |
| P3 HTTP crudo de main: `embedded-browser/owner.ts`, `util/net.ts`, `ipc/providers.ts`, `ipc/extras-handlers.ts`, `main/opencode/engine/http.ts` | esos + sus tests | P0 | 1 d |
| P4 Rutinas y Telegram: `scheduler/service.ts`, `telegram/engine-link.ts`, `telegram/turn.ts` | esos | P0 | 1,5 d |
| P5 Renderer tipos (mecánico): lotes por carpeta `lib/`+`components/`+`stores/`; `settings/`+`personalizacion/`+`search/`+`compare/`; `chat/`; `code/`; `tasks/`; `shared/doc-files.ts`, `shared/opencode-links.ts`, fixtures | cada lote es una carpeta distinta | P0 (alias) | 1-2 d en 5 lotes independientes |
| P6 Renderer cliente y stream: `lib/opencode.ts`, `stores/server.ts`, `tasks/impl/store.ts:597,836` | esos 3 | P0, P5 de `lib/` | 1,5 d |
| P7 Renderer llamadas: `chat/actions.ts` / `code/impl/{store,client}.ts, pr-ai.ts` / `tasks/impl/actions.ts, store.ts` / `compare/store.ts`, `stores/sessions.ts` (3-4 sub-lotes por carpeta) | uno por carpeta | P6 | 3-4 d |
| P8 Proveedores y MCP: `settings/impl/providerCatalog.ts`, `ModelsSection.tsx`, `ProviderKeyForm.tsx`, `McpSection.tsx`, `useMcpConnections.ts`, `onboarding/Wizard.tsx`, `stores/providers.ts` | esos | P0 (providers/mcp) | 1,5 d |
| P9 PTY, archivos/VCS: `code/impl/panels/{terminalRegistry,FilesPanel,ChangesPanel}` | esos | P0 (files/terminal) | 1 d |
| P10 Cierre: regla de aislamiento activada, actualizar `opencode-contract.test.ts`, `docs/VERIFICACION.md`, `CHANGELOG-FASE8.md` (ID `F8-B<n>`) | tests y docs | todos | 0,5 d |
| **Aparte, no etapa 0**: event-hub único en main; remoto (`engine-proxy`, `policy`, `events`, `sse-hub`); `auto-approver`/`monitor`; plugins del motor 2 | — | decisión del dueño | ver investigación §4.2 |

Paralelización segura: P0 primero (un agente). Luego **P1, P2, P3, P4, P8, P9 y los lotes de P5** pueden ir a la vez en archivos disjuntos (máx. 2 agentes pesados a la vez por la carga del Mac; vitest dirigido, resto al VPS). P6 antes que P7; dentro de P7, los 4 sub-lotes no comparten archivos. Un solo agente toca `src/shared/engine/**` a la vez; si otro paquete necesita un método nuevo, lo pide a P0 en vez de editar la interfaz.
