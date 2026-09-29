> Archivado: documento histórico; ver README.md y docs/FASE6-PLAN.md.

# Lote B de Cowork: plan de arquitectura

Leí los documentos obligatorios y todo el código de Cowork (main, renderer, agentes y scheduler). También inspeccioné el SDK 1.18.32 y el binario de `opencode` y comprobé qué herramientas existen en el Mac. No lancé la app ni `sandbox-exec`: la prueba B está descrita abajo para que la ejecute un paquete.

---

## A. Hallazgos verificados

✅ = ya hecho · ⚠️ = parcial · ❌ = falta. Las citas `archivo:línea` son del árbol actual.

### Carpetas y sandbox

- **1 Varias carpetas por tarea: ❌**
  - Hay un servidor por carpeta y modo (`manager.ts:60-62`).
  - El perfil tiene una sola carpeta escribible: `extraWritable` existe pero no se usa (`sandbox-profile.ts:181`, `sandbox.ts:86-94`).
  - Los permisos no se pueden ampliar en caliente: Seatbelt fija el perfil al lanzar el proceso, así que ampliar exige reiniciar el servidor, igual que ya hace `setDeleteGrant` (`manager.ts:168-183`).
  - Matiz importante: la **lectura** ya está permitida en todo el disco salvo secretos (`(allow default)`). "Solo lectura" es por tanto un asunto de permisos de OpenCode y de interfaz; la **escritura** es lo que impone Seatbelt.
- **2 Tarjeta de petición de carpeta: ❌.** Tenías razón. `PermissionPrompt.tsx:83-92` muestra una tarjeta genérica y el sandbox sigue negando la escritura.
  - Verificado en el binario: `external_directory` usa los patrones `["<dir>/*"]` y `always` igual, con `metadata {filepath, parentDir}` en las herramientas de archivos.
  - En bash usa `{command, directories, patterns}`.
- **3 Carpetas de confianza: ⚠️.** Solo existe la lista "Carpetas autorizadas" con "Olvidar" en `FolderMenu.tsx:86-120`. No hay lista de "no volver a preguntar" ni sección en Ajustes.
- **4 Carpetas de solo lectura: ❌.**
- **5 Carpetas prohibidas: ⚠️.** Corrijo parte de lo que suponías:
  - `~/Library` (y con él el userData de la app, que vive ahí) **ya se rechaza** en `manager.ts:98-99`, pero con un mensaje genérico.
  - Faltan: volúmenes de red (`/Volumes/<share>` smbfs/afpfs/nfs/webdav), `/private`, `/tmp`, `/var`, `/dev`, la Papelera, las rutas de secretos de `defaultDeniedReadPaths` y mensajes accionables.
  - iCloud Drive (dentro de `~/Library`) queda bloqueado sin explicarlo.

### Lista de tareas y ciclo de vida

- **6 Estados de tarea: ⚠️.** Hay `running/waiting/question/done/error/idle` (`util.ts:48-82`). Faltan `using_computer`, `plan_ready` y `archived`.
- **7 Gestión de la lista: ⚠️.** Fijar, renombrar, marcar no leída, archivar y eliminar ya existen (`TaskList.tsx:92-116`). Faltan grupos, "mover a grupo" y la vista de archivadas con restaurar (`selectSessionsForDirectory` oculta las archivadas, `sessions.ts:337`).
- **8 Vista unificada Fijadas / Activas / Programadas: ❌.** Lo fijado solo está en localStorage (`store.ts:103-121`).
- **9 Búsqueda: ⚠️.** Solo busca en títulos (`TaskList.tsx:156`).
- **10 Auto-archivo: ❌.**
- **52 Almacenamiento: ❌.**
- **53 Límite de servidores y parada por inactividad: ❌.** Es peor de lo que describías:
  - `connectFolder` **cierra el stream SSE** de la carpeta anterior (`store.ts:496-497`), así que no llega **ningún** evento de las demás carpetas. El filtro de `store.ts:408` casi no hace nada.
  - Además los estados `busy` de la carpeta anterior quedan congelados en `useSessions.status`, y `anyCoworkTaskRunning` (`store.ts:593-603`) los cuenta: el "mantener despierto" puede quedar activo hasta reiniciar la app.
- **26 Notificaciones por tipo: ⚠️.** Solo hay interruptor global y sonido (`GeneralSection.tsx:167-174`; `notify.ts` en main).

### Proyectos y contexto

- **11 Proyectos: ⚠️.** Hay nombre, instrucciones y memoria `.onyxcode/memoria.md` (`projects.ts`). Faltan enlaces e interruptor de memoria. Confirmado: las rutinas usan un `system` fijo (`scheduler/service.ts:411-413`) y `cowork.start(directory)` solo en sandbox (`:370`).
- **12 Contador y AGENTS.md: ⚠️.** El textarea tiene `maxLength` 20 000 pero no muestra contador (`ProjectPanel.tsx:156-162`). No hay editor de `AGENTS.md`.
- **55 Exportar transcripción: ❌.**
- **24 Consulta lateral: ❌.** El SDK tiene `session.fork` y `session.create({parentID, agent})`, y el agente `chat` existe en el sandbox.
- **25 Editar y reintentar: ⚠️.** Solo hay chips de seguimiento. El SDK tiene `session.revert({messageID})`.
- **23 Modelo por tarea: ⚠️.** `CoworkComposer.tsx:137` escribe el `defaultModel` global. Las sesiones ya guardan `model {id, providerID, variant}` y `promptAsync` acepta `variant`. `resolveModelForMode('cowork')` existe en `settings/impl/extras.ts:80` pero no se usa. `UsageMeter` sirve tal cual; el `EffortChip` de Code está atado a `useCode`, así que hay que hacer una versión genérica.

### Capacidades

- **20 MCP del usuario en Cowork: ❌.** Los servidores Cowork no reciben `OPENCODE_CONFIG` (solo el sidecar lo tiene), así que en sandbox no hay ningún MCP del usuario.
  - **Hallazgo extra:** el servidor de Control total usa el XDG real del usuario (`manager.ts:342-344`), así que carga el `~/.config/opencode` global (sus MCP y plugins) sin sandbox, y comparte `~/.local/share/opencode` con el sidecar.
  - Los MCP locales que lanza OpenCode probablemente heredan el entorno del servidor, incluida `OPENCODE_SERVER_PASSWORD`. No lo he verificado; se mitiga con `env -u` (ver C.6).
- **21 Skills: ❌.** El binario tiene la herramienta `skill`, que pide el permiso `skill` con el nombre como patrón (no es un problema: los agentes tienen `"*": allow`).
  - Rutas de descubrimiento según el binario: `.opencode/skill(s)/<n>/SKILL.md` del proyecto, `~/.config/opencode/skill(s)`, `~/.claude/skills`, `~/.agents/skills`, y las claves de config `skills.paths` y `skills.urls` (`OPENCODE_DISABLE_EXTERNAL_SKILLS`).
  - No está verificado que se escanee `OPENCODE_CONFIG_DIR/skills`; W2-F lo comprueba y, si no, usa `skills.paths`.
  - Herramientas en este Mac:
    - `python3` 3.9.6 es de Command Line Tools; en un Mac sin CLT lanza el instalador y falla dentro del sandbox.
    - En `~/Library/Python/3.9` (legible desde el sandbox) hay `openpyxl`, `pandas`, `pypdf`, `pdfplumber` y `PIL`. **No** hay `python-docx`, `python-pptx`, `reportlab`, `matplotlib`, `pandoc` ni LibreOffice.
    - `pip --user` escribe en `~/Library/Python`, que está **denegado** en el sandbox; solo funciona `pip install --target ./.cowork/pylib` con PyPI activado.
    - Están `textutil`, `zip`, `ditto`, `qlmanage`, `cupsfilter` y `sips`.
  - **Bug:** `cowork.md:83-84` manda usar `textutil -convert pdf`. **`textutil` no convierte a PDF** (solo txt, rtf, rtfd, html, doc, docx, odt, wordml y webarchive).
- **22 Lista mínima de skills instaladas: barata.** `client.app.skills({directory})` devuelve `{name, description, location}` en el SDK.
- **45 Navegador: ❌.**
- **18 Permisos recordados: ⚠️.** Existen una vez / siempre / rechazar, sin vista ni forma de revocar. El SDK trae `/api/permission/saved` (list/remove, por proyecto), pero no está verificado que 1.18.32 persista "siempre".
- **19 Modo auto: ❌.**
- **28 Rutinas: ⚠️.** Existen `originSessionId` y las ejecuciones en el panel (`ProgressPanel.tsx:208-252`). Faltan continuar la misma sesión, la lista blanca (hoy se rechaza todo, `service.ts:488-507`) y el Control total.
  - Útil: `session.create` acepta `permission: PermissionRule[]` (`{permission, pattern, action}`), es decir, reglas por sesión.
- **15 Entregables: ⚠️.** Hay vista previa de md/csv/txt/imágenes. Falta el zip y la vista de docx/xlsx/pdf.
- **39 Vista en vivo: ⚠️.** Solo miniaturas por herramienta.
- **40 Retención de capturas: ⚠️.** Se guardan las últimas 20 en `app.getPath('temp')/onyxcode-computer` (`service.ts:778`, `mcp-server.ts:557-561`) y nunca se borran. El diálogo dice que se envían al proveedor, pero no habla de retención.
- **46 Entregables HTML en la ventana de artifacts: ⚠️.** **Corrección:** `ArtifactButton` sí se usa ahora en `Markdown.tsx:113`, para los bloques ```html de los mensajes. Lo que falta es usarlo con los **archivos** HTML entregables.
- **49 Onboarding: ❌.**
- **50 Plantillas de inicio: ⚠️.** Hay 5 categorías y 20 plantillas (`Home.tsx:28-85`), sin el patrón "escanea → propone → actúa" ni opción de ocultar.
- **54 Política gestionada: ❌.**
- **56 Glosario: ⚠️.** Mezcla "Acceso total" (`ComputerAccess.tsx:80,138`, `ComputerSection.tsx:12`, `CoworkWorkspace.tsx:303`), "acceso total" (`PermissionPrompt.tsx:88`) y "Carpetas autorizadas" (`FolderMenu.tsx:86`).

### Seguridad y corrección

- **A: la puerta del plan se puede saltar. Confirmado.** `opencode-config.ts:151` hace `if (agentBySession.get(sessionID) !== 'computer') return`.
  - Antes de aprobar, `task` ya está bloqueado (no está en la lista de permitidas). Pero después de aprobar, una sesión hija (agente `general`) ejecuta bash/edit/write **sin puerta**, incluso después de "Revocar".
  - También queda sin puerta cualquier sesión `cowork` o `build` en el servidor de Control total: `manager.ts:328` solo niega `computer_*`.
  - `computer.md:20` tiene `task: allow`.
- **B: mover/renombrar en el sandbox.** Probable (mi conocimiento de Seatbelt dice que `rename` comprueba `file-write-unlink` sobre el origen), pero **sin verificar**; la prueba está en D (W2-A).
  - Hallazgo relacionado: truncar (`: > archivo`) **no** está protegido. La protección es contra borrar, no contra perder contenido. La red de seguridad son los snapshots de OpenCode (`session.revert`).
- **C: rutinas que fallan en silencio. Confirmado.** `service.ts:488-507` rechaza todo sin registrar qué ni avisar.

### Qué no se puede hacer

- #35 Background por AX, #42 helper firmado aparte, #43 Teach, #44 Record-a-skill y "ocultar otras apps" requieren cambiar `helper.swift`. **Aplazados**: recompilar cambia la firma y macOS olvida los permisos TCC. No encontré una vía solo-TS segura.
- #37 (enmascarar capturas) ya existe: `screenshot-sck` excluye las apps sin concesión.

---

## B. Alcance

| # | Decisión |
|---|---|
| 1, 2, 3, 4, 5 carpetas | **Entra** (W2-A main, W2-E estado, W3-B/C/E interfaz) |
| B rename, A puerta del plan, C rutinas | **Entra**, prioridad alta (W2-A, W2-F, W2-C) |
| 6, 7, 8, 9, 10 lista y ciclo de vida | **Entra** (W2-B monitor, W2-E, W3-A) |
| 52, 53, 26 servidores, almacenamiento, notificaciones | **Entra** (W2-B, W3-E) |
| 11, 12 proyecto, AGENTS.md | **Entra** (W2-D, W2-C para las rutinas) |
| 55, 24, 25 exportar, consulta lateral, editar y reintentar | **Entra** (W2-E, W3-B) |
| 23 modelo y esfuerzo por tarea + UsageMeter | **Entra** (W2-E, W3-C) |
| 20 MCP del usuario en Cowork | **Entra** (W2-D). Los remotos con OAuth no funcionan en sandbox (su XDG privado no tiene los tokens): se avisa en la interfaz |
| 21 skills docx/xlsx/pdf/pptx + "Crear skill de esta tarea" | **Entra** (W2-F, W3-B) |
| 22 lista mínima de skills | **Entra** (W2-D, en el panel de proyecto). **Marketplace fuera** |
| 18 permisos recordados | **Entra** (W2-D, W3-E) |
| 28 rutinas | **Entra** (W2-C) |
| 15, 39, 40, 46 entregables, vista en vivo, retención, artifacts | **Entra** (W3-D, W2-B, W3-F) |
| 49, 50 onboarding y plantillas | **Entra** (W3-C) |
| 54 `managed.json` mínimo | **Entra** (W2-A) |
| 56 glosario | **Entra**: constantes en W1-A; cada paquete corrige sus archivos; barrido final en W3-F |
| 45 navegador | **Aplazado.** Playwright descarga unos 150 MB de Chromium, y Chrome dentro de Seatbelt choca con su propio sandbox, perfiles y proxy. Opción mínima ya cubierta por #20: el usuario activa `chrome-devtools-mcp` como MCP "disponible en Cowork" en Control total |
| 19 modo auto | **Aplazado.** No es trivial: requiere otro modelo que clasifique cada permiso, con riesgo de inyección |
| 35, 42, 43, 44, ocultar apps | **Aplazado** (helper.swift, TCC) |
| 29 Dispatch, 30 nube, 48 Buddy, 47 simuladores | **Fuera** de alcance |
| Snapshots APFS "punto de restauración" | **Aplazado** (ver pregunta 2) |

---

## C. Decisiones de diseño y contratos

### C.1 `src/shared/ipc-cowork.ts` (W1-A; todo lo nuevo, opcional donde se indica)

```ts
// ── Carpetas ──
export type FolderAccessMode = 'rw' | 'ro'
export const FOLDER_MODE_LABEL_ES: Record<FolderAccessMode, string> = { rw: 'Lectura y escritura', ro: 'Solo lectura' }
export interface LinkedFolder { path: string; name: string; mode: FolderAccessMode; addedAt: number }
export interface TrustedFolder { path: string; name: string; mode: FolderAccessMode; addedAt: number }
export interface CoworkFolderSet {
  primary: string
  /** Vinculadas a este espacio (servidor de `primary`). */
  linked: LinkedFolder[]
  /** De confianza: todas las tareas, sin preguntar. */
  trusted: TrustedFolder[]
  /** false = el servidor sandbox en marcha arrancó con otro conjunto (falta reiniciar). */
  applied: boolean
}
export interface FolderCheck { ok: boolean; normalized: string; reason?: string }
// CoworkFolder: añadir  fullAccess?: boolean   (main lo rellena en listFolders)
// CoworkDeliverable: añadir  root?: string      (carpeta vinculada si no es la principal)
// CoworkProject: añadir  links?: string[]; memoryEnabled?: boolean
export interface CoworkAgentsMd { path: string; content: string; exists: boolean }

// ── Tareas / actividad ──
export interface CoworkTaskMeta {
  sessionId: string; folder: string; fullAccess: boolean; title: string
  pinned?: boolean; group?: string | null; updatedAt: number
}
export type CoworkTaskActivityState = 'running' | 'waiting' | 'question'
export interface CoworkTaskActivity {
  sessionId: string; folder: string; fullAccess: boolean; title: string
  state: CoworkTaskActivityState; since: number
}
export interface CoworkActivitySnapshot {
  at: number
  tasks: CoworkTaskActivity[]          // solo tareas raíz (las hijas se agregan a su raíz)
  servers: Array<{ folder: string; fullAccess: boolean; idleSince: number | null }>
}

// ── Preferencias ──
export interface CoworkNotifyPrefs { done: boolean; approval: boolean; question: boolean; error: boolean }
export interface CoworkPrefs { autoArchiveDays: number; idleStopMinutes: number; maxServers: number; notify: CoworkNotifyPrefs }
export const DEFAULT_COWORK_PREFS: CoworkPrefs = {
  autoArchiveDays: 0, idleStopMinutes: 15, maxServers: 4,
  notify: { done: true, approval: true, question: true, error: true }
}

// ── Almacenamiento ──
export interface CoworkStorageEntry { key: string; folder: string | null; bytes: number; cacheBytes: number; running: boolean }
export interface CoworkStorageReport { entries: CoworkStorageEntry[]; screenshotsBytes: number; totalBytes: number; at: number }

// ── Permisos recordados / MCP / política ──
export interface CoworkPermissionRule { id: string; folder: string; permission: string; pattern: string; createdAt: number }
export interface CoworkMcpInfo {
  name: string; type: 'local' | 'remote'; enabled: boolean
  cowork: boolean; askEachTool: boolean; hosts: string[]; oauth: boolean
}
export interface ManagedPolicy {
  source: string
  disableFullAccess?: boolean; allowedFolderRoots?: string[]; disableCustomHosts?: boolean
  extraAllowedHosts?: string[]; disableAlwaysAllow?: boolean; disableRoutines?: boolean; maxAutoArchiveDays?: number
}

// ── Rutinas ──
export type RoutineSessionMode = 'fresh' | 'continue'
export type RoutineOnAsk = 'reject' | 'wait'
export interface RoutineAllowRule { permission: string; pattern: string }
// RoutineInput y ScheduledRoutine: añadir
//   sessionMode?: RoutineSessionMode; onAsk?: RoutineOnAsk; allow?: RoutineAllowRule[]; allowHosts?: string[]
//   fullAccess?: boolean; fullAccessConsentAt?: number | null
// ScheduledRoutine: añadir  lastSessionId?: string | null
// RoutineRunRecord: añadir  rejected?: Array<{ permission: string; patterns: string[] }>
//   approved?: Array<{ permission: string; patterns: string[] }>; blockedHosts?: string[]; waiting?: boolean
```

**Canales invoke nuevos** (añadirlos también a `COWORK_INVOKE_CHANNELS`):

```ts
'cowork:folders:get':     { req: { folder: string }; res: CoworkFolderSet }
'cowork:folders:check':   { req: { path: string }; res: FolderCheck }
'cowork:folders:link':    { req: { folder: string; path: string; mode: FolderAccessMode; trust?: boolean; restart?: boolean }; res: CoworkFolderSet & { restarted: boolean } }
'cowork:folders:unlink':  { req: { folder: string; path: string; restart?: boolean }; res: CoworkFolderSet & { restarted: boolean } }
'cowork:trusted:list':    { req: void; res: TrustedFolder[] }
'cowork:trusted:set':     { req: { path: string; mode: FolderAccessMode }; res: TrustedFolder[] }
'cowork:trusted:remove':  { req: { path: string }; res: TrustedFolder[] }
'cowork:policy':          { req: void; res: ManagedPolicy | null }
'cowork:activity':        { req: void; res: CoworkActivitySnapshot }
'cowork:viewing':         { req: { folder: string | null; fullAccess?: boolean }; res: void }
'cowork:tasks:list':      { req: void; res: CoworkTaskMeta[] }
'cowork:tasks:setMeta':   { req: { sessionId: string; folder: string; fullAccess: boolean; title?: string; pinned?: boolean; group?: string | null }; res: CoworkTaskMeta }
'cowork:tasks:forget':    { req: { sessionId: string }; res: void }
'cowork:prefs:get':       { req: void; res: CoworkPrefs }
'cowork:prefs:set':       { req: { autoArchiveDays?: number; idleStopMinutes?: number; maxServers?: number; notify?: Partial<CoworkNotifyPrefs> }; res: CoworkPrefs }
'cowork:storage:report':  { req: void; res: CoworkStorageReport }
'cowork:storage:clean':   { req: { key: string; scope: 'cache' | 'all' }; res: CoworkStorageReport }
'cowork:storage:cleanScreenshots': { req: void; res: CoworkStorageReport }
'cowork:agentsMd:get':    { req: { folder: string }; res: CoworkAgentsMd }
'cowork:agentsMd:save':   { req: { folder: string; content: string }; res: CoworkAgentsMd }
'cowork:mcp:list':        { req: void; res: CoworkMcpInfo[] }
'cowork:mcp:set':         { req: { name: string; cowork?: boolean; askEachTool?: boolean }; res: CoworkMcpInfo[] }
'cowork:rules:list':      { req: { folder?: string }; res: CoworkPermissionRule[] }
'cowork:rules:add':       { req: { folder: string; permission: string; patterns: string[] }; res: CoworkPermissionRule[] }
'cowork:rules:remove':    { req: { id: string }; res: CoworkPermissionRule[] }
'cowork:zip':             { req: { paths: string[]; suggestedName?: string }; res: string | null }
'cowork:quickLook':       { req: { path: string }; res: void }
'cowork:exportMarkdown':  { req: { suggestedName: string; content: string }; res: string | null }
'cowork:htmlToPdf':       { req: { path: string }; res: CoworkDeliverable }
// 'cowork:project:save'.req: añadir  links?: string[]; memoryEnabled?: boolean
```

- **Evento nuevo:** `'cowork:activity': CoworkActivitySnapshot`.
- `src/shared/types.ts` (W1-A): `NotifyTarget` añade `fullAccess?: boolean`.

**Esquemas** (`schemas.ts`, W1-A):
- `host = str({max:255,min:1,pattern:/^[a-z0-9.-]+$/i})`
- `permName = str({max:200,min:1,pattern:/^[A-Za-z0-9_*.:-]+$/})`
- `pattern = str({max:2000,min:1})`
- `fileName = str({max:200,min:1,pattern:/^[^/\\:\0]+$/})`
- `folderMode = literal('rw','ro')`
- `group = nullable(str({max:80}))`
- `links = arr(str({max:2048,pattern:/^https?:\/\//i}),50)`
- `prefs:set` con `partial({autoArchiveDays: num({int:true,min:0,max:365}), idleStopMinutes: num({int:true,min:0,max:1440}), maxServers: num({int:true,min:1,max:12}), notify: partial({done:bool,approval:bool,question:bool,error:bool})})`
- `rules:list` con el mismo patrón opcional que `routines:history`
- `zip.paths = arr(absPath, 500)`
- `exportMarkdown.content = str({max:20*1024*1024})`
- `agentsMd.content = str({max:200_000})`
- Rutinas: `allow: optional(arr(obj({permission: permName, pattern}),50))`, `allowHosts: optional(arr(host,50))`, `sessionMode: optional(literal('fresh','continue'))`, `onAsk: optional(literal('reject','wait'))`, `fullAccess: optional(bool)`, `fullAccessConsentAt: optional(nullable(num({min:0})))`
- `notifyTarget` añade `fullAccess: optional(bool)`
- **`CHANNEL_ROLES` no se toca**: todos los canales son solo para la ventana principal.

### C.2 Módulos compartidos puros (W1-A)

`src/shared/cowork-prompt.ts`:

```ts
export const COWORK_INSTRUCTIONS_MAX = 20_000
export interface CoworkPromptInput {
  globalInstructions?: string | null
  project?: { name: string; instructions?: string; links?: string[]; memoryEnabled?: boolean } | null
  memory?: string | null
  folders?: Array<{ path: string; mode: FolderAccessMode; trusted?: boolean }>
  unattended?: boolean
}
export function buildCoworkSystemPrompt(i: CoworkPromptInput): string | undefined
```

Secciones unidas con `\n\n---\n\n`:
1. Instrucciones generales.
2. Instrucciones del proyecto "X".
3. `Enlaces de referencia del proyecto (consúltalos con webfetch si hace falta):` más la lista.
4. La memoria, solo si `memoryEnabled !== false` y no está vacía. Si es `false`: `La memoria del proyecto está desactivada: no leas ni escribas .onyxcode/memoria.md.`
5. `Carpetas adicionales de esta tarea:\n- <ruta> (lectura y escritura)` o `(solo lectura: no intentes modificarla)`.
6. Si `unattended`, el texto actual de `service.ts:411-413`.

Devuelve `undefined` si todo está vacío.

`src/shared/cowork-glossary.ts`:

```ts
export const COWORK_TERMS = { sandbox: 'Sandbox', fullControl: 'Control total del Mac', fullControlShort: 'Control total',
  workFolders: 'Carpetas de Cowork', trustedFolders: 'Carpetas de confianza', linkedFolders: 'Carpetas adicionales',
  readOnly: 'Solo lectura', readWrite: 'Lectura y escritura', deleteGrant: 'Permitir borrar, mover y renombrar',
  sideChat: 'Consulta lateral', routine: 'Rutina' } as const
```

A partir de aquí están prohibidos en la interfaz "Acceso total", "acceso completo" y "Carpetas autorizadas".

### C.3 Cableado de main (W1-B)

**`src/main/ipc/cowork-handle.ts`** (nuevo): mueve `Handler` y `handle` desde `cowork-handlers.ts` y exporta:

```ts
export type CoworkHandler<C extends CoworkInvokeChannel> = (req: CoworkRequest<C>, event: IpcMainInvokeEvent) => CoworkResponse<C> | Promise<CoworkResponse<C>>
export function makeCoworkHandle(ipcMain: IpcMain): <C extends CoworkInvokeChannel>(ch: C, fn: CoworkHandler<C>) => void
export interface CoworkIpcContext {
  handle: <C extends CoworkInvokeChannel>(ch: C, fn: CoworkHandler<C>) => void
  send: <C extends CoworkEventChannel>(ch: C, payload: CoworkEventContract[C]) => void
  getWindow: () => BrowserWindow | null
  cowork: CoworkManager; computer: ComputerService; scheduler: SchedulerService
  projects: CoworkProjectsStore; keepAwake: KeepAwakeService
}
export interface CoworkSubmodule { dispose?: () => void | Promise<void> }
```

**Ficheros de handlers nuevos** (en W1 son stubs). Cada uno exporta `registerX(ctx): CoworkSubmodule`:
- `cowork-folders-handlers.ts`: folders, trusted, policy.
- `cowork-lifecycle-handlers.ts`: activity, viewing, tasks, prefs, storage.
- `cowork-project-handlers.ts`: agentsMd, mcp, rules.
- `cowork-files-handlers.ts`: zip, quickLook, exportMarkdown, htmlToPdf.

Los stubs de lectura devuelven valores neutros: activity vacía, prefs por defecto, `[]`, `null`, `{primary, linked:[], trusted:[], applied:true}`. Los de escritura lanzan `'Función aún no disponible'`. `cowork-handlers.ts` crea el `ctx`, llama a los cuatro y en `shutdown` espera sus `dispose`.

**Ganchos en `manager.ts`** (W1-B, solo aditivos):

```ts
liveServers(): Array<{ folder: string; fullAccess: boolean; baseUrl: string; authorization: string; startedAt: number; lastStartCallAt: number }>
setBeforeSpawn(fn: ((folder: string, fullAccess: boolean) => Promise<void>) | null): void   // se await-ea al inicio de spawn()
```

`inlineConfig` pasa a construirse con `deepMerge(base, mcpBlock, rulesBlock, skillsInlineConfig())`:
- `mcpBlock = { mcp: c.mcp, agent: { cowork: { permission: c.permission }, computer: { permission: c.permission } } }`, con `c = coworkMcpContribution({ sandboxed: !fullAccess })`.
- `rulesBlock = { agent: { cowork: { permission: p }, computer: { permission: p } } }`, con `p = rulesPermissionConfig(coworkRules.list(folder))`.
- `c.hosts` se guarda por clave de servidor y se suma a `networkAllowlist`.
- `listFolders()` rellena `fullAccess`.
- `deepMerge` va en el nuevo módulo puro `src/main/cowork/config-merge.ts`.

**Módulos stub con su firma final** (los implementa W2-D o W2-F):

```ts
// src/main/cowork/mcp-cowork.ts (W2-D)
export interface CoworkMcpContribution { mcp: Record<string, unknown>; permission: Record<string, 'ask' | 'allow'>; hosts: string[] }
export function coworkMcpContribution(opts: { sandboxed: boolean }): CoworkMcpContribution
export class CoworkMcpPrefs { list(): CoworkMcpInfo[]; set(name: string, patch: { cowork?: boolean; askEachTool?: boolean }): CoworkMcpInfo[] }
export const coworkMcpPrefs: CoworkMcpPrefs
// src/main/cowork/rules.ts (W2-D)
export class CoworkRulesStore { list(folder?: string): CoworkPermissionRule[]; add(folder: string, permission: string, patterns: string[]): CoworkPermissionRule[]; remove(id: string): CoworkPermissionRule[]; removeFolder(folder: string): void }
export const coworkRules: CoworkRulesStore
export function rulesPermissionConfig(rules: CoworkPermissionRule[]): Record<string, Record<string, 'allow'>>
// src/main/cowork/opencode-config.ts (W2-F)
export function skillsInlineConfig(): Record<string, unknown>   // stub: {}
```

`scheduler/service.ts` (W1-B, solo el tipo): `SchedulerDeps` añade `projects?: CoworkProjectsStore; getSettings?: () => Settings; openTarget?: (t: NotifyTarget) => void`, y `cowork-handlers` se los pasa.

### C.4 Seatbelt (W2-A)

```ts
// SandboxProfileOptions: añadir
extraFolders?: Array<{ path: string; mode: FolderAccessMode }>
/** Subcarpetas donde SÍ se permite unlink/rename (scratch). Por defecto [join(folder, '.cowork')]. */
scratchDirs?: string[]
```

Reglas (en SBPL gana la última que coincide):
1. Las `rw` extra se añaden al `allow file-write*`.
2. Después, `(deny file-write-unlink (subpath X))` para la principal (salvo `allowDelete`) y para **todas** las `rw` extra. El permiso de borrado solo vale para la principal.
3. Después, `(allow file-write-unlink (subpath <folder>/.cowork))`.
4. Al final, `(deny file-write* (subpath RO))` para cada `ro`, por si una carpeta `ro` está dentro de una `rw`.

`sandboxEnv` añade `UV_CACHE_DIR: cache/uv` y `PIP_DISABLE_PIP_VERSION_CHECK: '1'`. `StartCoworkServerOptions.extraFolders` se pasa a `writeSandboxProfile`.

En sandbox, `inlineConfig` añade para cada carpeta vinculada o de confianza:

```
agent.cowork.permission.external_directory = { "*": "ask", "<p>": "allow", "<p>/*": "allow" }
```

Esto cubre sus subcarpetas porque `*` de OpenCode admite `/`. Está por verificar con `/config`.

### C.5 Datos persistidos (JSON)

- **`cowork.json`**: `{ folders, fullAccess, deleteGrants, linked: Record<string, LinkedFolder[]>, trusted: TrustedFolder[] }`.
- **`cowork-rules.json`**: `{ rules: CoworkPermissionRule[] }`. No se guardan reglas para `external_directory`, `doom_loop`, `computer_*` ni patrones de borrado (misma regex que `DELETE_RE`). Con `policy.disableAlwaysAllow`, `add` lanza error.
- **`cowork-mcp.json`**: `{ servers: Record<name, { cowork: boolean; askEachTool: boolean }> }`. **No** se escribe nada en `userData/opencode/opencode.json`: OpenCode valida estrictamente ese archivo.
- **`cowork-tasks.json`**: `{ tasks: CoworkTaskMeta[] }`. Lo fijado se migra desde localStorage `cowork.pinned`.
- **`cowork-prefs.json`**: `CoworkPrefs`, recortando cada valor a su rango.
- **`cowork-projects.json`**: añade `links` y `memoryEnabled`.
- **`routines.json`**: los campos nuevos.
- **`/Library/Application Support/${APP_NAME}/managed.json`**: `ManagedPolicy` sin `source`. Solo el admin puede escribir ahí. En desarrollo se puede forzar con `ONYXCODE_MANAGED_POLICY` si `!app.isPackaged`.

### C.6 Inyección de MCP (W2-D)

Solo entran los servidores activos y marcados en Cowork.

- **Local:** el comando se envuelve así: `['/usr/bin/env','-u','OPENCODE_SERVER_PASSWORD','-u','OPENCODE_SERVER_USERNAME','-u','OPENCODE_AUTH_CONTENT','-u','OPENCODE_CONFIG_CONTENT','-u','ONYXCODE_PLAN_GATE_URL', ...command]`. Hereda Seatbelt y necesita el interruptor npm o PyPI si descarga paquetes.
- **Remoto:** su host va a `hosts`, que se suma a la lista blanca del proxy. Si el MCP usa OAuth: `oauth: true` y aviso "no disponible en sandbox".
- **`askEachTool`:** `permission["<name>_*"] = 'ask'`.

### C.7 Monitor en main (W2-B)

Sustituye al stream por carpeta como fuente de estado de fondo.

- Cada 3 s, en cada servidor de `liveServers()`, consulta `session.status`, `permission.list` y `question.list`, más una caché de `session.get` para `parentID` y título. Ignora los títulos que empiezan por `⏰ ` (rutinas, que ya notifican).
- Emite `activity` cuando algo cambia.
- Notifica por tipo, respetando `prefs.notify` y el global de `extrasPrefs`, **solo** para servidores que el renderer no está mirando (`cowork:viewing`). Al hacer clic: `showMainWindow` y `app:openTarget` con `fullAccess`.
- Mantener despierto: `keepAwake.setActive(anyBusy, 'monitor')`, combinado con OR con la señal del renderer.
- Parada por inactividad: detiene servidores sin tareas en curso ni en espera, que no se estén mirando y que lleven más de `idleStopMinutes`.
- Límite: `setBeforeSpawn` para el servidor ocioso menos usado si hay `>= maxServers`. Nunca mata trabajo en curso.
- Auto-archivo: cada hora por servidor vivo, archiva raíces con `updated` anterior a N días que no estén fijadas ni esperando, y revoca su plan.
- Debe ser **independiente de Electron** (dependencias inyectadas) para poder probarlo con un servidor falso.

---

## D. Oleadas

**Reglas para todos los paquetes:**
- Editar solo los archivos que se poseen.
- No recompilar ni tocar el helper.
- No tocar `pill.ts` ni `CHANNEL_ROLES`.
- Interfaz en español; nombre del producto solo desde `brand.ts`; no renombrar "OnyxCode".
- `npm run typecheck` sin errores atribuibles al paquete.
- **Ningún paquete ejecuta `npx electron-vite build`**: lo hace el orquestador al final de cada oleada.
- Los harness van al scratchpad, no al repo.
- Si necesitas algo de otro paquete, anótalo en el informe; no lo edites.

### Oleada 1 (dos agentes en paralelo, archivos disjuntos; typecheck conjunto al final)

**W1-A · Contratos compartidos**
- **Posee:** `src/shared/ipc-cowork.ts`, `src/shared/types.ts`, `src/main/ipc/schemas.ts` y los nuevos `src/shared/cowork-prompt.ts` y `src/shared/cowork-glossary.ts`.
- **Pasos:**
  1. Añadir exactamente lo de C.1, con JSDoc en español y los canales en las listas.
  2. Esquemas de C.1.
  3. Implementar C.2.
- **Aceptación:** los tipos de invoke y eventos cubiertos.
- **Verificación:** esbuild de `cowork-prompt.ts` al scratchpad y asserts en node: vacío → `undefined`; `memoryEnabled:false` produce la frase de desactivada e ignora `memory`; `ro` produce "solo lectura"; `unattended` añade el texto. `grep -c "cowork:htmlToPdf" src/main/ipc/schemas.ts` da 1.

**W1-B · Cableado de main**
- **Posee:** `src/main/ipc/cowork-handlers.ts`, los nuevos `src/main/ipc/cowork-handle.ts` y los cuatro `cowork-*-handlers.ts` (stubs), los nuevos `src/main/cowork/config-merge.ts`, `mcp-cowork.ts` (stub) y `rules.ts` (stub), `src/main/cowork/manager.ts` (**solo** los ganchos de C.3), `src/main/cowork/opencode-config.ts` (**solo** el stub `skillsInlineConfig`) y `src/main/scheduler/service.ts` (**solo** `SchedulerDeps`).
- **Pasos:** exactamente C.3. `rules.ts` y `mcp-cowork.ts` guardan en memoria y devuelven vacíos.
- **Verificación:** con la app sin cambios funcionales, typecheck; esbuild de `config-merge.ts` con asserts de merge profundo (objetos se fusionan; strings u objetos los sustituye el segundo).

### Oleada 2 (6 paquetes en paralelo)

**W2-A · Carpetas, sandbox y política**
- **Posee:** `manager.ts`, `sandbox-profile.ts`, `sandbox.ts`, los nuevos `src/main/cowork/folder-policy.ts` y `src/main/cowork/policy.ts`, y `ipc/cowork-folders-handlers.ts`.
- **Pasos:**
  1. `folder-policy.ts`, puro:
     - `parseMountOutput(text: string): Array<{ device: string; mountPoint: string; fsType: string }>` (lee la salida de `/sbin/mount`).
     - `forbiddenFolderReason(folder: string, ctx: { home: string; userData: string; mounts: MountInfo[]; allowedRoots?: string[] }): string | null`.
     - Mensajes accionables en español para: raíz o home; carpeta que contiene home; carpetas del sistema (`/System /Library /Applications /usr /bin /sbin /etc /opt /private /tmp /var /dev /cores /Network`); raíz de `/Volumes`; red (`smbfs afpfs nfs webdav cifs ftp macfuse osxfuse`, con "copia los archivos a una carpeta local"); userData de `${APP_NAME}`; `~/Library` ("ubicación protegida… prueba dentro de Documentos"; iCloud Drive con su propio mensaje); `~/.Trash`; rutas de `defaultDeniedReadPaths`; y fuera de `allowedRoots`.
     - `manager.forbiddenFolderReason` delega aquí, con `mount` en caché 30 s.
  2. `policy.ts`: `loadManagedPolicy(): ManagedPolicy | null`, con validación estricta y caché.
  3. Aplicar la política en `manager`:
     - `approveFolder` usa `allowedRoots`.
     - `grantFullAccess` lanza error con `disableFullAccess`.
     - `networkSetHost('allow')` lanza error con `disableCustomHosts`.
     - `extraAllowedHosts` se suma a la lista blanca.
  4. Seatbelt según C.4.
  5. `manager`:
     - `linked` y `trusted` persistidos.
     - `folderSet`, `linkFolder` (con `checkFolder`), `unlinkFolder` y el trío `trusted` (list/set/remove).
     - `restartSandbox(folder)` = `stopOne` + `spawn` si hay handle; `applied` por firma (JSON ordenado de carpetas extra + `allowDelete`).
     - `spawn` pasa `extraFolders` = vinculadas ∪ de confianza, sin duplicados.
     - `inlineConfig` añade las reglas de `external_directory` en sandbox.
     - `assertInsideApproved` acepta vinculadas y de confianza.
     - `deliverables` recorre la principal más las vinculadas `rw` y rellena `root`.
     - `removeFolder` limpia `linked`.
  6. Implementar los handlers; `folders:link` con `restart !== false` reinicia **solo** si el servidor sandbox está vivo y devuelve `restarted`.
  7. **Prueba B** (ver abajo) y aplicar la corrección según el resultado.
- **Verificación:**
  - esbuild de `folder-policy.ts` con asserts de cada mensaje, incluida una línea `//u@h/s on /Volumes/s (smbfs, …)`.
  - Perfil con una `rw` extra y una `ro`: escribir en la `rw` funciona; `rm` en la `rw` falla con EPERM; escribir en la `ro` falla con EPERM; `touch`+`rm` en `.cowork` funciona.
  - typecheck.
- **Prueba B, ejecutable:**
  ```sh
  SP=<scratchpad>; npx esbuild src/main/cowork/sandbox-profile.ts --bundle --platform=node --format=cjs --outfile=$SP/sp.cjs
  T=$(mktemp -d "$HOME/onyxcode-sbtest.XXXX"); mkdir -p $T/f/.cowork $T/f/sub $T/p
  node -e 'const {buildSandboxProfile}=require(process.argv[1]);require("fs").writeFileSync(process.argv[2]+"/prof.sb",buildSandboxProfile({folder:process.argv[2]+"/f",privateDir:process.argv[2]+"/p",allowDelete:false}))' $SP/sp.cjs $T
  cd $T/f && echo a>a.txt && echo c>c.txt && echo d>d.txt
  /usr/bin/sandbox-exec -f $T/prof.sb /bin/sh -c 'mv a.txt b.txt; echo rename=$?; mv c.txt sub/c.txt; echo move=$?; mv d.txt c.txt; echo overwrite=$?; rm d.txt; echo rm=$?; : > d.txt; echo truncate=$?; echo x>.cowork/t && rm .cowork/t; echo scratch=$?; cp -c d.txt clone.txt; echo clone=$?'
  cd / && rm -rf "$T"
  ```
  - **Hipótesis:** rename, move, overwrite y rm dan 1; truncate, clone y (tras la corrección) scratch dan 0.
  - **Si rename y move se bloquean:** se mantiene la protección. Corrección = scratch permitido en `.cowork`; la concesión pasa a llamarse "Permitir borrar, mover y renombrar" (W3-B); guía del agente (W2-F).
  - **Si rename está permitido:** documentar que mover dentro de la carpeta funciona y que "overwrite por rename" es un borrado residual (mitigado por `session.revert`).

**W2-B · Monitor, ciclo de vida y almacenamiento**
- **Posee:** los nuevos `src/main/cowork/monitor.ts`, `tasks-meta.ts`, `prefs.ts` y `storage.ts`; `keep-awake.ts`; `src/main/computer/service.ts` (solo `cleanScreenshots()` y su llamada en `stop()` y `dispose()`); y `ipc/cowork-lifecycle-handlers.ts`.
- **Pasos:**
  1. `CoworkPrefsStore { get(): CoworkPrefs; set(patch): CoworkPrefs }`, recortando valores y respetando `policy.maxAutoArchiveDays` (vía `loadManagedPolicy`, solo lectura).
  2. `CoworkTasksStore { list(); set(req); forget(id) }`.
  3. `CoworkMonitor` según C.7, con dependencias `{ servers: () => LiveServer[]; stop(folder, fullAccess): Promise<void>; prefs; tasks; notify(ev); onArchived(sessionId); now?; pollMs? }` y métodos `start/stop/snapshot/setViewing/anyBusy/isIdle`.
  4. `KeepAwakeService.setActive(active, source: 'renderer'|'monitor' = 'renderer')` combina las dos fuentes con OR.
  5. `storage.ts`:
     - `report(userData, folders, live)` con `/usr/bin/du -sk` (execFile) por `cowork-sandbox/<key>` y su `cache/`, `tmp/`; el mapeo inverso sale de `sandboxKey(folder)`; `screenshotsBytes` de `temp/onyxcode-computer`.
     - `clean(key, scope)`: rechaza si el servidor está vivo; `cache` borra `cache/` y `tmp/`; `all` borra el directorio, **incluido el historial de tareas** (la interfaz lo advierte).
  6. `computer.cleanScreenshots()` hace `rmSync(temp/onyxcode-computer, {recursive, force})`.
  7. Handlers: `activity`, `viewing` (a `monitor.setViewing`), `tasks`, `prefs`, `storage`; `send('cowork:activity')` desde el monitor; limpiar capturas cuando pasan 60 s sin tareas de Control total en curso. `dispose` para el monitor.
- **Verificación:** esbuild de `monitor.ts` al scratchpad y un servidor HTTP falso (`/session/status`, `/permission`, `/question`, `GET /session/:id`, `GET /session`, `PATCH /session/:id`, que registra):
  - Pasar de busy a idle emite `finished` una vez.
  - Un permiso pendiente produce el estado `waiting`.
  - Con `idleStopMinutes` = 0,001 y sin estar mirando se llama a `stop`.
  - Una sesión antigua no fijada recibe PATCH con archived; una fijada no.

**W2-C · Rutinas seguras**
- **Posee:** `src/main/scheduler/service.ts`, el nuevo `src/main/scheduler/approvals.ts`, `src/main/cowork/proxy-policy.ts`, y `features/routines/impl/RoutineEditor.tsx`, `RoutinesView.tsx` y `templates.ts`.
- **Pasos:**
  1. `approvals.ts`, puro: `wildcardMatch(pattern, value)` (`*` = cualquier cosa, `?` = un carácter) y `decideUnattended(p: {permission; patterns}, rules: RoutineAllowRule[]): 'allow' | 'no-match'`. Todos los patrones deben casar con una regla del mismo permiso; `permission` puede acabar en `*` para MCP.
  2. `perform()`:
     - En modo cowork, `system = buildCoworkSystemPrompt({ globalInstructions: getSettings().coworkGlobalInstructions, project: projects.get(f), memory, folders: cowork.folderSet(f), unattended: true })`.
     - Sesión: con `continue`, reutilizar `lastSessionId ?? originSessionId` si `session.get` responde; si no, crear. Guardar `lastSessionId`.
     - Crear la sesión con `permission: allow.map(r => ({...r, action:'allow'}))`.
     - `allowHosts`: `networkAllowOnce` al empezar y `revokeOnce` al terminar (nuevo en `proxy-policy`).
     - Registrar `blockedHosts` escuchando `cowork.on('networkBlocked')` de esa carpeta.
  3. `rejectPending`:
     - Si casa con la lista blanca: `reply 'once'` y a `approved`.
     - Si no y `onAsk === 'reject'`: `reject` y a `rejected`.
     - Si `onAsk === 'wait'`: no responder; notificar una vez por petición ("La rutina «X» necesita tu aprobación", clic → `openTarget({mode:'cowork', id, directory, fullAccess})`) y marcar `waiting`.
     - Las preguntas se rechazan igual que ahora.
  4. Control total:
     - `saveRoutine` exige `fullAccessConsentAt` y `cowork.hasFullAccessGrant(folder)`; en ejecución, `start(folder, true)` y agente `computer`.
     - La aprobación del plan **sigue siendo humana**: la tarjeta y la notificación ya existen; sin aprobación, se agota el tiempo con un error claro.
     - `policy.disableRoutines` hace que `saveRoutine` y la ejecución lancen error.
  5. La notificación final incluye "Se rechazaron N permisos: …" y los hosts bloqueados.
  6. Interfaz del editor, solo en modo cowork:
     - "Cada ejecución: Empezar de cero / Continuar la misma tarea".
     - "Si pide permiso: Rechazar y seguir / Esperar mi aprobación (te avisará)".
     - Lista "Permitir sin preguntar" (permiso + patrón) y "Sitios permitidos".
     - Interruptor "Control total del Mac", visible solo si `folder.fullAccess`; abre un diálogo de consentimiento explícito que guarda `fullAccessConsentAt`.
  7. `RoutinesView` muestra en el historial lo rechazado, aprobado, los hosts bloqueados y "esperando aprobación".
  8. `templates.ts`: plantillas con el patrón "primero revisa y resume, luego propone, luego actúa".
- **Verificación:** asserts de `approvals.ts` con esbuild; harness del scheduler contra un servidor falso con un permiso bash `rm x` (se rechaza y se registra) y `git status` en la lista blanca (se responde `once`).

**W2-D · Proyecto, MCP en Cowork y permisos recordados**
- **Posee:** `src/main/cowork/projects.ts`, `mcp-cowork.ts`, `rules.ts`, `ipc/cowork-project-handlers.ts`, `features/settings/impl/McpSection.tsx` y `features/cowork/impl/ProjectPanel.tsx`.
- **Pasos:**
  1. `projects.ts`: `links` (máx. 50 URL http(s)) y `memoryEnabled` en `save`. Funciones `getAgentsMd(folder)` y `saveAgentsMd(folder, content)` sobre `<folder>/AGENTS.md`; el handler valida con `assertInsideApproved`.
  2. `mcp-cowork.ts` según C.6, leyendo `readAppMcpConfig()` y `cowork-mcp.json`.
  3. `rules.ts` según C.5, con `rulesPermissionConfig` que produce `{ [permission]: { [pattern]: 'allow' } }`.
  4. Handlers de agentsMd, mcp y rules.
  5. `McpSection`: por cada fila, interruptor "Disponible en Cowork" y "Preguntar en cada uso", más la nota "Se aplica al abrir de nuevo la carpeta; en el sandbox los remotos con inicio de sesión (OAuth) no están disponibles; los hosts remotos se añaden a la Red de Cowork".
  6. `ProjectPanel`:
     - Contador `n / 20.000` (`COWORK_INSTRUCTIONS_MAX`).
     - Enlaces (añadir y quitar) e interruptor "Usar memoria".
     - Pestaña "AGENTS.md de la carpeta" con editor y guardar.
     - "Skills disponibles" vía `useCowork.getState().client.app.skills({directory})`.
     - "Permisos recordados" de la carpeta, con Quitar.
     - Los campos nuevos usan `cw('cowork:project:save', …)` directamente y `useCowork.setState({project})`.
- **Verificación:**
  - Fake MCP local (script node que escribe `process.env` en un archivo del scratchpad) lanzado con el comando envuelto: las cinco variables sensibles no aparecen.
  - Asserts de `rulesPermissionConfig`; se rechaza persistir `rm *`.
  - `curl -u cowork:<pw> <baseUrl>/config` (o log de `inlineConfig`) muestra el `mcp` inyectado.

**W2-E · Estado del renderer**
- **Posee:** `features/cowork/impl/store.ts`, `actions.ts`, `util.ts`, `EscalateCard.tsx`, `src/renderer/src/app/App.tsx` (solo `openTarget` con `fullAccess`), y los nuevos `features/cowork/impl/search.ts` y `transcript.ts`.

**API exacta que debe exponer:**

```ts
// store.ts — estado nuevo
activity: CoworkActivitySnapshot | null; taskMeta: Record<string, CoworkTaskMeta>; folderSet: CoworkFolderSet | null
taskModel: ModelRef | null; taskVariant: string | null; prefs: CoworkPrefs | null; policy: ManagedPolicy | null
sideChat: { taskId: string; sessionId: string | null } | null; showArchived: boolean
// (mantener `pinned` derivado de taskMeta para compatibilidad)
export function syncActivity(): void                     // suscripción única + carga inicial; reporta cowork:viewing al cambiar conn/folder
export function loadFolderSet(folder: string): Promise<void>
export function loadTaskMetas(): Promise<void>
export function setTaskMeta(sessionId: string, patch: { pinned?: boolean; group?: string | null; title?: string }): Promise<void>
export function loadCoworkPrefs(): Promise<void>; export function saveCoworkPrefs(p: Partial<CoworkPrefs>): Promise<void>
export function currentCoworkModel(): ModelRef           // taskModel ?? resolveModelForMode('cowork')
export function currentCoworkVariant(): string | undefined
export function setTaskModel(m: ModelRef): void          // + extras modelsByMode.cowork (NUNCA settings.defaultModel)
export function setTaskVariant(v: string | null): void
export function isUsingComputer(taskId: string): boolean // fullAccess && run busy && lastAction < 15 s
export function isPlanPending(taskId: string): boolean   // accessRequest?.plan && accessRequest.sessionId === taskId
// togglePinned(id) conserva su firma y persiste vía cowork:tasks:setMeta (folder = sessions[id].directory, fullAccess = conn.fullAccess)
// notifyTask(sessionID, kind: 'done'|'error'|'approval'|'question', title, body) respeta prefs.notify
// util.ts
export type TaskStatus = 'running' | 'using_computer' | 'plan_ready' | 'waiting' | 'question' | 'done' | 'error' | 'idle' | 'archived'
taskStatus(args: { …actuales; usingComputer?: boolean; planPending?: boolean; archived?: boolean }): TaskStatus
// labels: using_computer 'Usando el Mac', plan_ready 'Plan listo para revisar', archived 'Archivada'
// prioridad: archived > plan_ready > question > waiting > using_computer > running > …
export function folderRequestPaths(p: PermissionRequest): { requested: string; candidates: string[] } // parentDir o directories[0]; hasta 4 ancestros, sin pasar de home
// actions.ts
export async function sendToTask(rawText: string, model?: ModelRef, opts?: { variant?: string }): Promise<void> // session.create con model/metadata{folders}; system = buildCoworkSystemPrompt(...)
export type FolderRequestDecision = { kind: 'deny' } | { kind: 'later' } | { kind: 'allow'; path: string; mode: FolderAccessMode; trust: boolean }
export async function answerFolderRequest(req: PermissionRequest, d: FolderRequestDecision): Promise<void>
export async function linkFolder(path: string, mode: FolderAccessMode, opts?: { trust?: boolean }): Promise<void>
export async function unlinkFolder(path: string): Promise<void>
export async function replyPermissionAlways(req: PermissionRequest): Promise<void> // reply 'always' + cowork:rules:add (salvo excluidos)
export async function editAndRetry(taskId: string, userMessageId: string, text: string): Promise<void>
export async function continueInNewTask(taskId: string): Promise<void>
export async function exportTaskMarkdown(taskId: string): Promise<string | null>
export async function createSkillFromTask(taskId: string): Promise<void>
export function openSideChat(taskId: string): void; export async function sendSideChat(text: string): Promise<void>; export function closeSideChat(): void
export async function restoreTask(sessionId: string): Promise<void>
export async function moveTaskToGroup(sessionId: string, group: string | null): Promise<void>
export async function openTaskAnywhere(t: { sessionId: string; folder: string; fullAccess: boolean }): Promise<void>
// transcript.ts (puro)
export function lastAssistantText(entries: MessageEntry[]): string
export function firstUserPrompt(entries: MessageEntry[]): string
export function transcriptToMarkdown(s: { title: string; directory: string; time: { created: number } }, entries: MessageEntry[], opts?: { includeTools?: boolean }): string
export function buildContinuationPrompt(title: string, entries: MessageEntry[]): string
export function buildSideChatSystem(title: string, entries: MessageEntry[], maxChars?: number): string
export function suggestedExportName(title: string): string
export const CREATE_SKILL_PROMPT: string
// search.ts
export interface TranscriptHit { sessionId: string; title: string; partId: string; snippet: string; at: number }
export function searchEntries(sessionId: string, title: string, entries: MessageEntry[], query: string, max?: number): TranscriptHit[] // NFD, sin tildes, minúsculas
export function useTranscriptSearch(folder: string | null, query: string): { hits: TranscriptHit[]; loading: boolean; scanned: number; total: number }
```

- **Pasos clave:**
  1. `connectFolder` purga `useSessions.status` de las sesiones cuyo origen es **otro** servidor Cowork. Los de Chat y Code no se tocan.
  2. `syncKeepAwake` cuenta solo el origen actual; main hace el OR con el monitor.
  3. `answerFolderRequest`, caso "Permitir" en sandbox:
     - Si hay otras raíces en curso en la carpeta, `confirmDialog` avisando de que se interrumpirán.
     - `reply reject` con el mensaje "Se está concediendo acceso; la tarea se reanudará sola".
     - `cw('cowork:folders:link', {…, restart:true})`.
     - Si `restarted`: `connectFolder(folder,false)`, `openTask(taskId)` y `sendToTask('Ya tienes acceso a <path> (<modo>). Continúa la tarea donde la dejaste.')`.
  4. `answerFolderRequest`, resto de casos:
     - En Control total: `once`, o `always` más `trusted:set` si se marca confianza.
     - "Denegar": `reject` con el mensaje "El usuario denegó… no lo vuelvas a pedir; adapta el plan".
     - "Ahora no": `reject` con "…sigue sin esa carpeta y menciónalo en el resumen".
  5. `editAndRetry`: abortar si está ocupado, `session.revert({sessionID, messageID})`, `loadTask` y `sendToTask`.
  6. Consulta lateral: `session.create({directory, parentID: taskId, title:'Consulta lateral', agent:'chat'})` y `promptAsync` con `agent 'chat'` y `system = buildSideChatSystem`. Al ser hija, no aparece en la lista.
  7. `restoreTask`: `session.update({time:{archived:0}})`; si el servidor lo rechaza o sigue archivada, respaldo `metadata.unarchivedAt` y en el selector "archivada ⇔ archived && !(unarchivedAt > archived)".
  8. `EscalateCard` y `retryAfterNetworkAllow` usan `currentCoworkModel()`.
  9. Migrar `cowork.pinned` a main una sola vez.
- **Verificación:** esbuild de `transcript.ts` y `search.ts` (con react externo) y asserts: acentos (`"informe"` encuentra `"Informé"`), fragmento de ≤ 160 caracteres, la marca de adjuntos se elimina, Markdown con encabezados por turno. typecheck web.

**W2-F · Skills, agentes y puerta del plan**
- **Posee:** `src/main/cowork/opencode-config.ts`, `resources/opencode/agents/cowork.md`, `resources/opencode/agents/computer.md`, los nuevos `resources/opencode/skills/{docx,xlsx,pdf,pptx}/SKILL.md` (más plantillas opcionales en la misma carpeta), `resources/opencode/README.md` y `electron-builder.js`.
- **Pasos:**
  1. **Arreglo A:** en el plugin, eliminar `if (agentBySession.get(...) !== COMPUTER_AGENT) return`. La puerta se aplica a **toda** sesión del servidor con `GATE_URL`, con clave en su propio `sessionID`: las hijas y cualquier otro agente quedan bloqueados sin aprobación (fail-closed). `computer.md` pasa a `task: deny` y se actualiza el punto 10 de su guía.
  2. `prepareOpencodeConfigDir` copia recursivamente `resources/opencode/skills` a `userData/opencode-config/skills` (misma lógica de sello de versión y borrado de sobrantes) y añade `asarUnpack 'resources/opencode/skills/**'`.
  3. Verificar el descubrimiento: arrancar un servidor sandbox real (como en la verificación de Lote A) y llamar a `GET /skill` (`client.app.skills`). Si las skills no aparecen, `skillsInlineConfig()` devuelve `{ skills: { paths: [join(getOpencodeConfigDir(),'skills')] } }`.
  4. Skills en español, cada una con frontmatter `name` (igual a la carpeta, minúsculas y guiones) y `description`. Sus comandos solo usan lo verificado **dentro del perfil Seatbelt real** con `sandbox-exec`:
     - **docx:** HTML limpio en `.cowork/` y luego `textutil -convert docx`; comprobar con `textutil -convert txt -stdout`.
     - **xlsx:** `openpyxl` si `python3 -c "import openpyxl"` funciona. Si no, ruta **sin dependencias**: escribir las partes XML mínimas (`[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/worksheets/sheet1.xml`, `xl/styles.xml`) y `cd dir && zip -X -r ../out.xlsx .`. Verificar con `qlmanage -t` u `openpyxl`.
     - **pptx:** `python-pptx` si existe; si no, pptx XML mínimo con zip o entregar docx con una sección por diapositiva.
     - **pdf:** probar `cupsfilter -m application/pdf x.html > x.pdf` en sandbox. Si funciona, esa es la ruta; si no, entregar `.html` e indicar al usuario el botón «Guardar como PDF» (W3-D). Añadir `pip install --target ./.cowork/pylib` más `PYTHONPATH` solo con PyPI activado; **nunca** `pip --user`.
  5. `cowork.md`:
     - Quitar `textutil -convert pdf` y remitir a las skills.
     - Carpetas adicionales (el prompt las lista, y las de solo lectura no se modifican).
     - Antes de acceder fuera de la carpeta, escribir una frase con el motivo (la tarjeta la mostrará).
     - Mover o renombrar: si falla con "Operation not permitted", explicar que hace falta «Permitir borrar, mover y renombrar», o crear una copia ordenada con `cp -c` sin tocar los originales.
     - Memoria desactivada: respetar el aviso.
     - "Crear skill": guardar en `.opencode/skills/<nombre>/SKILL.md`.
  6. Glosario en ambos agentes.
- **Verificación:**
  - Harness del plugin (como en Lote A): con `ONYXCODE_PLAN_GATE_URL` apuntando a un falso, `chat.params` de la sesión `ses_child` con agente `general` y `tool.execute.before({tool:'bash', sessionID:'ses_child'})` **lanza**; con `/plan-status` true para `ses_child`, pasa; la inyección de `onyxcode_session` se mantiene.
  - `grep -n "task: allow" computer.md` y `grep -rn "convert pdf" resources` dan vacío.
  - Transcripción de las pruebas de cada skill dentro de Seatbelt.

### Oleada 3 (6 paquetes; interfaz sobre las API de la oleada 2)

**W3-A · Barra lateral**
- **Posee:** `TaskList.tsx`, `CoworkSidebar.tsx`, `FolderMenu.tsx` y el nuevo `SidebarSections.tsx`.
- **Pasos:**
  1. Secciones transversales arriba:
     - **Fijadas**: `taskMeta` con `pinned`.
     - **Activas**: `activity.tasks`, de todas las carpetas, con su estado y la carpeta; clic → `openTaskAnywhere`.
     - **Programadas**: `routines:list` en modo cowork, con próxima ejecución; clic abre el editor o la tarea de origen.
     - Cada una con "Mostrar más".
  2. La lista por carpeta:
     - Selector "Agrupar: por fecha / por grupo".
     - Menú con "Mover a grupo…" (`promptDialog` + `moveTaskToGroup`).
     - Conmutador "Archivadas" con "Restaurar".
     - Estados nuevos con `StatusIcon` para `using_computer`, `plan_ready` y `archived`.
  3. Búsqueda: primero coincidencias de título; con 3 o más caracteres, `useTranscriptSearch` con fragmentos; clic → `openTask` y `requestScrollToPart(partId)`.
  4. `FolderMenu`: "Carpetas de Cowork" (glosario), y "Añadir carpeta adicional…" con elección rw/ro: `pickFolder`, `folders:check` y `linkFolder`.
- **Verificación:** typecheck web y banco de pruebas Chromium/Electron (el método de capturas de `UI-REDESIGN.md`) con el store sembrado.

**W3-B · Conversación y aprobaciones**
- **Posee:** `CoworkWorkspace.tsx`, `TaskConversation.tsx`, `PermissionPrompt.tsx`, `DeleteGrant.tsx` y los nuevos `FolderRequestCard.tsx` y `SideChat.tsx`.
- **Pasos:**
  1. `PermissionPrompt`:
     - `external_directory` se muestra con `FolderRequestCard`: título «El agente quiere trabajar en otra carpeta», ruta literal, selector de ancestros (`folderRequestPaths`), modo Lectura y escritura / Solo lectura, «Motivo (según el agente, no verificado)» (`lastAssistantText`, recortado), casilla «No volver a preguntar (carpeta de confianza)», y botones Denegar / Ahora no / Permitir (`answerFolderRequest`).
     - Herramientas MCP: «El agente quiere usar {tool} de {server}» con el JSON literal de metadata y patrones.
     - "Siempre" usa `replyPermissionAlways`, oculto si `policy.disableAlwaysAllow`.
  2. Cabecera de la tarea:
     - Píldora con los estados nuevos.
     - Menú "…": Exportar a Markdown, Continuar en una tarea nueva, Crear skill de esta tarea, Consulta lateral, Programar.
     - Enviar con `currentCoworkModel()`.
  3. `TaskConversation`: en cada mensaje de usuario, «Editar y reintentar» con un `confirmDialog` que explique que se deshacen los mensajes posteriores y los cambios de archivos desde ahí.
  4. `SideChat`: panel lateral con los mensajes de la sesión hija (`useSessions`), compositor y aviso «No modifica la tarea».
  5. `DeleteGrant`: texto «Permitir borrar, mover y renombrar».
  6. Glosario.
- **Verificación:** banco de pruebas con un `PermissionRequest` sembrado de `external_directory` y un `permission` de MCP; typecheck.

**W3-C · Compositor e inicio**
- **Posee:** `CoworkComposer.tsx`, `Home.tsx`, `AccessSegmented.tsx`, y los nuevos `components/EffortPicker.tsx` y `features/cowork/impl/Onboarding.tsx`.
- **Pasos:**
  1. `EffortPicker({ model, variant, onChange })`: menú genérico que replica `EffortChip` y no se muestra si el modelo no tiene variantes.
  2. Compositor: `ModelPicker` con `currentCoworkModel()` y `setTaskModel` (fuera `updateSettings`), `EffortPicker`, `UsageMeter` (con la entrada de la tarea activa) y chips de carpetas adicionales (`folderSet`) con quitar.
  3. `Home`:
     - Plantillas reescritas con «Primero revisa… y muéstrame un resumen; luego propón…; cuando lo apruebe, …».
     - «Ordenar por tipo» avisa de que mover pedirá permiso.
     - «Ocultar sugerencias» / «Mostrar sugerencias» (`localStorage cowork.hideSuggestions`).
  4. `Onboarding`: tarjeta de primer uso con 3 pasos (elige carpeta, qué puede y qué no en Sandbox y Control total, prueba una tarea), enlace «Cómo usar Cowork de forma segura» y `localStorage cowork.onboarded`.
  5. Glosario en `AccessSegmented`.
- **Verificación:** banco de pruebas en claro/oscuro y a 900 px; `grep -n "defaultModel" CoworkComposer.tsx` da vacío.

**W3-D · Panel, entregables y Control del Mac**
- **Posee:** `ProgressPanel.tsx`, `Deliverables.tsx`, `ComputerAccess.tsx`, `src/main/cowork/files.ts`, `ipc/cowork-files-handlers.ts` y `src/main/extras/artifact-window.ts`.
- **Pasos:**
  1. Handlers:
     - `zip`: `dialog.showSaveDialog` y luego `execFile('/usr/bin/zip', ['-j','-X',out,...paths])`, con rutas validadas con `assertInsideApproved`.
     - `quickLook`: `assertInsideApproved`, `assertSafeToOpen` y `spawn('/usr/bin/qlmanage',['-p',path],{detached:true})`, matando el anterior.
     - `exportMarkdown`: diálogo de guardar en Descargas.
     - `htmlToPdf`: solo `.html` o `.htm` dentro de una carpeta aprobada; `renderHtmlToPdf(html)` nuevo en `artifact-window.ts` (ventana oculta con la **misma** partición, CSP y bloqueo de red que los artifacts, y `printToPDF`); escribe `<nombre>.pdf` sin sobrescribir.
  2. `files.ts`: vista previa de `.docx`, `.doc`, `.rtf` y `.odt` con `textutil -convert txt -stdout` (timeout 10 s) como `kind:'text'`.
  3. Entregables: «Descargar todo», «Vista rápida» (QuickLook), en HTML «Abrir como artifact» (`ArtifactButton` con el contenido de `previewFile`) y «Guardar como PDF», y agrupación por `root`.
  4. `ProgressPanel`:
     - Sección «En vivo» mientras `isUsingComputer`: la última imagen de las partes de herramienta (`toolImages`) con la etiqueta de la última acción.
     - Las ejecuciones programadas enlazan a su sesión.
     - «Paso X de Y».
  5. `ComputerAccess`:
     - `FullAccessDialog` añade la retención: «Las capturas se envían al proveedor del modelo y quedan en el historial de la tarea; las copias temporales se borran al terminar y al cerrar la app.»
     - `VisionModelHint` usa `setTaskModel`.
     - Glosario («Control total»).
- **Verificación:** con Electron real, zip de 2 archivos (verificar con `unzip -l`); QuickLook de un `.docx`; PDF desde un HTML de prueba sin red (un `<img src=http…>` no se carga); typecheck.

**W3-E · Ajustes de Cowork**
- **Posee:** `SettingsView.tsx`, `NetworkSection.tsx`, `ComputerSection.tsx` y el nuevo `CoworkSection.tsx`.
- **Pasos:** sección «Cowork» con:
  1. Carpetas de confianza (lista, modo, quitar, añadir).
  2. Carpetas de Cowork (lista con «Control total concedido» y revocar).
  3. Permisos recordados (todas las carpetas, quitar, «se aplica al reabrir la carpeta»).
  4. Notificaciones por tipo.
  5. Auto-archivo (Nunca / 7 / 14 / 30 / 90 días).
  6. Servidores (límite y minutos de inactividad, con los servidores vivos de `activity.servers`).
  7. Almacenamiento (tabla por carpeta, «Limpiar caché», «Borrar todo» con `confirmDialog` que avisa de que se pierde el historial de tareas en sandbox, «Borrar capturas temporales»).
  8. Banner «Gestionado por tu organización» si hay `policy`.
  - `NetworkSection`: hosts de conectores (informativo) y bloqueo si `disableCustomHosts`.
  - Glosario en `ComputerSection`.
- **Verificación:** banco de pruebas; typecheck.

**W3-F · Integración menor y documentación**
- **Posee:** `src/main/ipc/cowork-handlers.ts`, `AUDIT.md`, notas privadas (fuera del repositorio), `docs/SEGURIDAD.md` y el nuevo `docs/COWORK-LOTE-B.md`.
- **Pasos:**
  1. La notificación de `request_access` respeta `prefs.notify.approval`.
  2. `computer:session {active:false}` llama a `computer.cleanScreenshots()` tras 60 s.
  3. Barrido del glosario en los strings de `cowork-handlers`.
  4. Actualizar la tabla de brechas, AUDIT (plan gate A, B, C, stream por carpeta, `textutil pdf`, XDG de Control total) y SEGURIDAD (`env -u` en MCP, carpetas `ro`/`rw`, `managed.json`).
- **Verificación:** greps de E.

---

## E. Comprobaciones finales (orquestador)

1. Tras cada oleada, `npm run typecheck` (node y web) y `npx electron-vite build` (solo el orquestador).
2. Greps que deben dar vacío:
   - `agentBySession.get(input.sessionID) !== COMPUTER_AGENT` en `opencode-config.ts`
   - `task: allow` en `agents/computer.md`
   - `convert pdf` en `resources`
   - `defaultModel` en `features/cowork/impl/CoworkComposer.tsx` y `EscalateCard.tsx`
   - `Acceso total|acceso completo|Carpetas autorizadas` en strings `.tsx` de la interfaz
   - `git diff --stat src/preload/pill.ts resources/computer-use`
   - `git diff src/main/ipc/schemas.ts | grep CHANNEL_ROLES`
3. Presencia: `cowork:activity` en shared, schemas, handlers y renderer.
4. `shasum resources/computer-use/helper.swift` empieza por `d42da8a3`.
5. Revisar los harness de cada paquete en el scratchpad: prompt builder, `folder-policy`, runtime de Seatbelt y prueba B, plugin gate, monitor con servidor falso, approvals, transcript/search, env de MCP, skills en sandbox.
6. Verificaciones en vivo (dependen de OpenCode):
   - `GET /skill`.
   - `/config` con `external_directory` y `mcp`.
   - `session.update({time:{archived:0}})` desarchiva.
   - Las reglas `permission` de `session.create` surten efecto.
   - `session.revert` en sandbox con git de CLT.
   - Si `reply 'always'` sobrevive a un reinicio (`/api/permission/saved`).

**Prueba manual para el usuario** (`npm run dev -- --watch`):

1. Primer uso de Cowork: aparece la tarjeta de onboarding. Descártala y comprueba que no vuelve.
2. Intenta autorizar `~`, `~/Library/Application Support`, un volumen SMB y la Papelera: cada una da su mensaje concreto.
3. En Sandbox, pide «Lee los PDF de ~/Descargas/informes y crea un resumen aquí»:
   - Aparece la tarjeta «quiere trabajar en otra carpeta» con la ruta y el motivo.
   - Permitir en Solo lectura hace que la tarea se reanude sola y lea.
   - Si le pides escribir allí, falla y lo explica.
4. Repite con «No volver a preguntar»: la carpeta queda en Ajustes, en Carpetas de confianza. Quítala desde ahí.
5. «Ordena esta carpeta por tipo»: al mover aparece «Permitir borrar, mover y renombrar». Sin permiso, ofrece una copia ordenada.
6. Crea un xlsx, un docx y un pdf: salen los archivos o una explicación honesta con «Guardar como PDF».
7. En Entregables prueba Vista rápida, Descargar todo y Abrir como artifact en un HTML.
8. Lanza una tarea larga en la carpeta A y cambia a la carpeta B:
   - En «Activas» aparece A trabajando.
   - Al terminar llega la notificación.
   - Mantener despierto se apaga al acabar.
9. Espera el tiempo de inactividad configurado: el servidor de A se detiene (Ajustes, Servidores).
10. Busca una palabra que solo aparezca dentro de una respuesta: la encuentra y salta al punto de la conversación.
11. Fija una tarea, agrúpala, archívala y restáurala.
12. Cambia el modelo y el esfuerzo en una tarea: Chat no cambia; al reabrir la tarea conserva su modelo. El medidor de uso se ve.
13. Editar y reintentar un mensaje (se deshacen los cambios posteriores). «Continuar en una tarea nueva». «Exportar a Markdown».
14. Abre una consulta lateral, pregunta algo y comprueba que la tarea no cambia.
15. En Proyecto:
    - El contador de instrucciones funciona.
    - Añadir un enlace y ver cómo se usa.
    - Con la memoria desactivada, el agente no escribe `.onyxcode/memoria.md`.
    - Editar `AGENTS.md`.
    - Ver la lista de skills.
16. Marca un MCP como «Disponible en Cowork» con «Preguntar en cada uso»: sale una tarjeta por herramienta. En Red aparece su host.
17. «Crear skill de esta tarea»: aparece en `.opencode/skills/…` y luego en la lista de skills.
18. Rutina en sandbox con «Esperar mi aprobación»: al pedir `rm` llega la notificación y puedes aprobar desde la tarea. Con «Rechazar», el historial muestra lo rechazado.
19. Rutina en Control total: pide el consentimiento al crearla y la aprobación del plan en cada ejecución.
20. En Control total, tras aprobar un plan, pide «usa un subagente para listar ~/Desktop»: el subagente queda bloqueado (fail-closed).
21. Cierra la app y comprueba que `temp/onyxcode-computer` ya no existe. Ajustes, Almacenamiento: limpia la caché de una carpeta parada.

---

## F. Riesgos, dependencias de OpenCode y preguntas

**Riesgos**
- **Reiniciar para ampliar carpetas:** reinicia el servidor sandbox e interrumpe las tareas en curso de esa carpeta; se pide confirmación. Las sesiones persisten en el XDG privado.
- **Borrado:** la protección es a nivel de nombres (unlink). Truncar no está protegido; la mitigación es `session.revert`.
- **Rutinas en Control total:** siguen exigiendo aprobar el plan en persona, así que no son 100 % desatendidas.
- **MCP del usuario:** la búsqueda del usuario, los MCP remotos y sus hosts pasan a ser canales de salida permitidos; son visibles y revocables en Ajustes. El envoltorio `env -u` supone que OpenCode lanza los MCP con `process.env`; se verifica en W2-D.
- **Servidor de Control total:** carga la config global del usuario (sus plugins y MCP sin sandbox). Queda documentado, no se cambia.
- **Parada por inactividad:** si el monitor falla, un servidor podría detenerse con trabajo en curso. Se mitiga porque solo se para si no hay sesiones busy, permisos ni preguntas pendientes, tras dos sondeos consecutivos.

**Verificado solo leyendo el binario o el SDK de 1.18.32** (reverificar al subir de versión):
- Rutas de skills y `skills.paths`.
- Patrones `<dir>/*` y metadata de `external_directory`.
- Permiso `skill`.
- `session.create({permission, parentID, model})`, `session.revert`, `app.skills`, `/api/permission/saved`.
- Mutación de `onyxcode_session` (de Lote A).
- Por verificar en ejecución: desarchivar con `archived:0` y el escaneo de `OPENCODE_CONFIG_DIR/skills`.

**Preguntas para el usuario (máx. 5)**
1. **Auto-archivo:** ¿desactivado por defecto (lo propuesto) o 30 días como Claude?
2. **Mover y renombrar en el sandbox:** si la prueba confirma que requiere el mismo permiso que borrar, ¿basta con renombrar la concesión a «Permitir borrar, mover y renombrar», o quieres un «punto de restauración» con copia APFS antes de concederla (más trabajo, ahora aplazado)?
3. **Rutinas en Control total:** ¿permitirlas exigiendo aprobar el plan en cada ejecución, o mantenerlas prohibidas?
4. **Hosts de MCP remotos:** ¿se añaden automáticamente a la lista blanca de red del sandbox al marcar el MCP como «Disponible en Cowork», o prefieres aprobar cada host aparte?
5. **Valores por defecto de servidores:** ¿te sirven 15 minutos de inactividad y un máximo de 4 servidores?

---

### Archivos críticos para la implementación
- /Users/ben/Documents/App OpenCode/src/shared/ipc-cowork.ts
- /Users/ben/Documents/App OpenCode/src/main/cowork/manager.ts
- /Users/ben/Documents/App OpenCode/src/main/cowork/sandbox-profile.ts
- /Users/ben/Documents/App OpenCode/src/renderer/src/features/cowork/impl/store.ts
- /Users/ben/Documents/App OpenCode/src/main/cowork/opencode-config.ts
