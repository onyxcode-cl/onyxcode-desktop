/**
 * Esquema del payload de CADA canal IPC invoke (renderer → main) y qué ventanas pueden usarlo.
 *
 * - Las tablas están tipadas contra los contratos de `shared/ipc*.ts`: si un canal cambia de
 *   forma o se añade uno nuevo sin esquema, `tsc` falla.
 * - `CHANNEL_ROLES`: por defecto solo la ventana principal puede invocar; Quick Entry y la píldora
 *   del overlay tienen su lista mínima (el overlay a pantalla completa no invoca nada).
 */
import { IPC_INVOKE_CHANNELS, type IpcInvokeChannel, type IpcRequest } from '@shared/ipc'
import { DIAG_SOURCES } from '@shared/diagnostics'
import { OPENCODE_ACTIONS } from '@shared/opencode-links'
import { CODE_INVOKE_CHANNELS, EDITOR_IDS, FILES_SUB_ID_RE, type CodeInvokeChannel, type CodeRequest } from '@shared/ipc-code'
import { TASKS_INVOKE_CHANNELS, type TasksInvokeChannel, type TasksRequest } from '@shared/ipc-tasks'
import { IPC_EXTRAS_INVOKE_CHANNELS, type IpcExtrasInvokeChannel, type IpcExtrasInvokeContract } from '@shared/ipc-extras'
import {
  BROWSER_HOST_EXCLUDED_CHANNELS,
  BROWSER_INVOKE_CHANNELS,
  type BrowserInvokeChannel,
  type BrowserInvokeContract
} from '@shared/ipc-browser'
import { REMOTE_INVOKE_CHANNELS, type RemoteInvokeChannel, type RemoteInvokeContract } from '@shared/ipc-remote'
import { absPath, arr, bool, literal, none, num, obj, optional, nullable, partial, record, str, tagged, type Validator } from './validate'

/** Rol de la ventana que envía (lo asigna main al crearla). */
export type WindowRole = 'main' | 'quick' | 'overlay' | 'pill' | 'assist' | 'browserHost'

const id = str({ max: 200, min: 1 })
const shortText = str({ max: 500 })
/** Id de sesión de OpenCode (`ses_…`). */
const sessionId = str({ max: 200, min: 1, pattern: /^[A-Za-z0-9_-]+$/ })
const modelRef = obj({ providerID: str({ max: 200, min: 1 }), modelID: str({ max: 200, min: 1 }) })
const cwdReq = obj({ cwd: absPath })
const folderReq = obj({ folder: absPath })
const pathReq = obj({ path: absPath })
const openFolderOpts = optional(obj({ title: optional(shortText), defaultPath: optional(absPath) }))
const notifyTarget = obj({ mode: literal('code', 'tasks'), id, directory: optional(absPath), fullAccess: optional(bool) })
/**
 * Como `optional(nullable(x))` pero CONSERVANDO `null` (`optional` lo colapsa a `undefined`):
 * necesario cuando `null` significa "quitar" (p.ej. `group: null`).
 */
function optNull<T>(inner: Validator<T>): Validator<T | null | undefined> {
  return (v, path) => (v === undefined ? undefined : v === null ? null : inner(v, path))
}
/** Host (dominio) permitido en la red de una rutina. */
const host = str({ max: 255, min: 1, pattern: /^[a-z0-9.-]+$/i })
/** Nombre de permiso de OpenCode (`bash`, `edit`, `mcp_*`…). */
const permName = str({ max: 200, min: 1, pattern: /^[A-Za-z0-9_*.:-]+$/ })
/** Id hexadecimal corto (tarjeta `request_access`/Teach, grabación de skill). */
const hexId = str({ max: 64, min: 1, pattern: /^[a-f0-9]+$/ })
/** Sitio (eTLD+1) del navegador propio de Tareas. */
const site = str({ max: 253, min: 1, pattern: /^[a-z0-9.-]+$/i })
const pattern = str({ max: 2000, min: 1 })
/** Nombre de archivo simple: sin separadores de ruta, dos puntos ni bytes nulos. */
const fileName = str({ max: 200, min: 1, pattern: /^[^/\\:\0]+$/ })
/** Id de suscripción del vigilante de archivos. */
const filesSubId = str({ max: 64, min: 8, pattern: FILES_SUB_ID_RE })
/** Nombre de una entrada nueva/renombrada (la validación completa, con nombres reservados, la hace main). */
const entryName = str({ max: 400, min: 1 })
const folderMode = literal('rw', 'ro')
/** Grupo de tareas: `null` = sin grupo. */
const group = nullable(str({ max: 80 }))
/** Correo de la cuenta: forma mínima aquí (el servicio hace la validación completa). */
const accountEmail = str({ max: 254, min: 3, pattern: /^[^\s@]+@[^\s@]+$/ })
const links = arr(str({ max: 2048, pattern: /^https?:\/\//i }), 50)
/** Clave del directorio `tasks-sandbox/<key>` (hash hexadecimal). */
const storageKey = str({ max: 64, min: 1, pattern: /^[A-Za-z0-9_-]+$/ })
const hhmm = str({ pattern: /^\d{1,2}:\d{2}$/ })
const schedule = tagged('kind', {
  daily: obj({ kind: literal('daily'), time: hhmm }),
  weekly: obj({ kind: literal('weekly'), day: num({ int: true, min: 0, max: 6 }), time: hhmm }),
  interval: obj({ kind: literal('interval'), hours: num({ min: 0.01, max: 24 * 365 }) }),
  cron: obj({ kind: literal('cron'), expr: str({ max: 200, min: 1 }) })
})
const ptyCreate = obj({
  cwd: str({ max: 4096 }),
  cols: num({ int: true, min: 1, max: 1000 }),
  rows: num({ int: true, min: 1, max: 500 }),
  shell: optional(absPath)
})
const mcpName = str({ max: 64, min: 1, pattern: /^[A-Za-z0-9_-]+$/ })
const mcpEntry = tagged('type', {
  local: obj({
    type: literal('local'),
    command: arr(str({ max: 4096 }), 200),
    environment: optional(record(str({ max: 16_384 }))),
    cwd: optional(str({ max: 4096 })),
    enabled: optional(bool),
    timeout: optional(num({ min: 0, max: 3_600_000 }))
  }),
  remote: obj({
    type: literal('remote'),
    url: str({ max: 4096, pattern: /^https?:\/\//i }),
    headers: optional(record(str({ max: 16_384 }))),
    enabled: optional(bool),
    timeout: optional(num({ min: 0, max: 3_600_000 })),
    oauth: optional((v: unknown, path?: string) =>
      v === false
        ? (false as const)
        : record((x: unknown, p?: string) => (typeof x === 'number' ? num()(x, p) : str({ max: 4096 })(x, p)), 50)(v, path)
    )
  })
})

// ───────────────────────────── Lote D: navegador integrado ─────────────────────────────
const tabId = str({ max: 34, min: 9, pattern: /^t[a-f0-9]{8,32}$/ })
const browserInput = str({ max: 2048 })
const browserOwner = tagged('kind', {
  code: obj({ kind: literal('code'), directory: absPath }),
  tasks: obj({ kind: literal('tasks'), folder: absPath })
})
const browserRectCoord = num({ min: -20_000, max: 20_000 })
const browserRect = obj({ x: browserRectCoord, y: browserRectCoord, width: browserRectCoord, height: browserRectCoord })
const browserDecision = literal('task', 'always', 'deny', 'allow')
const browserProduct = literal('code', 'tasks')
const localOrigin = str({ max: 261, min: 1, pattern: /^(localhost|127\.0\.0\.1|\[::1\]):\d{1,5}$/ })
const browserToChat = obj({
  owner: browserOwner,
  text: str({ max: 20_000 }),
  image: optional(
    obj({
      name: fileName,
      mime: literal('image/jpeg'),
      dataUrl: str({ max: 8 * 1024 * 1024, pattern: /^data:image\/jpeg;base64,/ })
    })
  )
})

const BROWSER_SCHEMAS: { [C in BrowserInvokeChannel]: Validator<BrowserInvokeContract[C]['req']> } = {
  'browser:state': obj({ owner: browserOwner }),
  'browser:attach': obj({ owner: browserOwner, rect: browserRect, visible: bool }),
  'browser:detach': obj({ owner: browserOwner }),
  'browser:newTab': obj({ owner: browserOwner, input: optional(browserInput) }),
  'browser:closeTab': obj({ owner: browserOwner, tabId }),
  'browser:selectTab': obj({ owner: browserOwner, tabId }),
  'browser:navigate': obj({ owner: browserOwner, tabId, input: browserInput }),
  'browser:history': obj({ owner: browserOwner, tabId, action: literal('back', 'forward', 'reload', 'stop') }),
  'browser:agent': obj({ owner: browserOwner, action: literal('pause', 'resume', 'stop') }),
  'browser:pick': obj({ owner: browserOwner, tabId, on: bool }),
  'browser:capture': obj({ owner: browserOwner, tabId }),
  'browser:toChat': browserToChat,
  'browser:respond': obj({ id: hexId, decision: browserDecision }),
  'browser:popOut': obj({ owner: browserOwner, on: bool }),
  'browser:setViewMode': obj({ mode: literal('desktop', 'mobile') }),
  'browser:openExternal': obj({ owner: browserOwner, tabId }),
  'browser:devServers': obj({ directory: absPath }),
  'browser:sites:get': none,
  'browser:sites:setPrefs': obj({ agentEnabled: optional(partial({ code: bool, tasks: bool })) }),
  'browser:sites:remove': obj({ product: browserProduct, site }),
  'browser:sites:undeny': obj({ product: browserProduct, site }),
  'browser:sites:removeLocal': obj({ origin: localOrigin }),
  'browser:clearData': obj({ product: browserProduct })
}

const APP_SCHEMAS: { [C in IpcInvokeChannel]: Validator<IpcRequest<C>> } = {
  'app:info': none,
  'app:openExternal': obj({ url: str({ max: 8192, pattern: /^https?:\/\//i }) }),
  'app:notify': obj({ title: str({ max: 300, min: 1 }), body: str({ max: 2000, min: 1 }), target: optional(notifyTarget) }),
  'app:setAttention': obj({ count: num({ int: true, min: 0, max: 999_999 }) }),
  'app:opencodeInfo': none,
  'app:opencodeAction': obj({ action: literal(...OPENCODE_ACTIONS) }),
  'app:pickOpencodeBin': none,
  'app:updateState': none,
  'app:checkUpdates': none,
  'app:dismissUpdate': obj({ version: str({ max: 64, min: 1, pattern: /^v?\d+\.\d+\.\d+[0-9A-Za-z.+-]*$/ }) }),
  'app:updateDownload': none,
  'app:updateCancel': none,
  'app:updateInstall': none,
  'app:bootConfirm': none,
  'app:testProviderKey': obj({ providerID: str({ min: 1, max: 200, pattern: /^[A-Za-z0-9._-]+$/ }) }),
  'account:state': none,
  'account:google': none,
  'account:cancel': none,
  'account:retry': none,
  'account:emailStart': obj({ email: accountEmail }),
  'account:emailVerify': obj({ email: accountEmail, code: str({ min: 6, max: 6, pattern: /^\d{6}$/ }) }),
  'account:signOut': none,
  'account:delete': none,
  'account:export': none,
  'opencode:connection': none,
  'opencode:status': none,
  'opencode:restart': none,
  'diag:logs': obj({ source: literal(...DIAG_SOURCES), maxLines: optional(num({ int: true, min: 1, max: 5000 })) }),
  'diag:copy': obj({ source: literal(...DIAG_SOURCES) }),
  'diag:export': none,
  'settings:get': none,
  'settings:set': partial({
    defaultModel: modelRef,
    theme: literal('system', 'light', 'dark'),
    recentFolders: arr(absPath, 50),
    tasksGlobalInstructions: str({ max: 20_000 }),
    onboarded: bool,
    routinesTermsAcknowledged: bool,
    checkUpdates: bool,
    language: literal('system', 'es', 'en')
    // `opencodeBin` NO se acepta desde el renderer: solo main la escribe, tras validar el binario (`app:pickOpencodeBin`).
  }),
  'settings:addRecentFolder': pathReq
}

const CODE_SCHEMAS: { [C in CodeInvokeChannel]: Validator<CodeRequest<C>> } = {
  'pty:create': ptyCreate,
  'pty:write': obj({ id, data: str({ max: 1024 * 1024 }) }),
  'pty:resize': obj({ id, cols: num({ int: true, min: 1, max: 1000 }), rows: num({ int: true, min: 1, max: 500 }) }),
  'pty:kill': obj({ id }),
  'pty:list': none,
  'pty:available': none,
  'git:isRepo': cwdReq,
  'git:status': cwdReq,
  'git:diff': obj({ cwd: absPath, path: optional(str({ max: 4096 })), staged: optional(bool) }),
  'git:branches': cwdReq,
  'git:currentBranch': cwdReq,
  'git:worktrees': cwdReq,
  'git:createWorktree': obj({ cwd: absPath, branch: str({ max: 250, min: 1 }), base: optional(str({ max: 250 })) }),
  'git:removeWorktree': obj({ cwd: absPath, path: absPath, force: optional(bool) }),
  'git:commit': obj({ cwd: absPath, message: str({ max: 100_000, min: 1 }), stageAll: optional(bool) }),
  'git:log': obj({ cwd: absPath, n: optional(num({ int: true, min: 1, max: 1000 })) }),
  'git:discard': obj({ cwd: absPath, paths: arr(str({ max: 4096, min: 1 }), 200), scope: optional(literal('all', 'unstaged')) }),
  'git:discardHunk': obj({
    cwd: absPath,
    path: str({ max: 4096, min: 1 }),
    index: num({ int: true, min: 0, max: 100_000 }),
    hunk: str({ max: 1_000_000, min: 1 })
  }),
  'git:discardUndo': obj({ cwd: absPath, undoId: str({ max: 64, min: 1, pattern: /^[0-9a-f-]{36}$/ }) }),
  'dialog:openFolder': openFolderOpts,
  'dialog:revealInFinder': pathReq,
  'dialog:openInEditor': pathReq,
  'files:watch': obj({ folder: absPath, subId: filesSubId }),
  'files:setDirs': obj({ subId: filesSubId, dirs: arr(str({ max: 4096 }), 100) }),
  'files:unwatch': obj({ subId: filesSubId }),
  'files:create': obj({ cwd: absPath, parent: str({ max: 4096 }), name: entryName, kind: literal('file', 'dir') }),
  'files:rename': obj({ cwd: absPath, path: str({ max: 4096, min: 1 }), name: entryName }),
  'files:trash': obj({ cwd: absPath, path: str({ max: 4096, min: 1 }) }),
  'editors:list': cwdReq,
  'editors:open': obj({ cwd: absPath, id: literal(...EDITOR_IDS) })
}

const TASKS_SCHEMAS: { [C in TasksInvokeChannel]: Validator<TasksRequest<C>> } = {
  'tasks:pickFolder': none,
  'tasks:listFolders': none,
  'tasks:approveFolder': folderReq,
  'tasks:removeFolder': folderReq,
  'tasks:start': obj({ folder: absPath, fullAccess: optional(bool) }),
  'tasks:grantFullAccess': folderReq,
  'tasks:revokeFullAccess': folderReq,
  'tasks:fullAccess:state': none,
  'tasks:fullAccess:consent': none,
  'tasks:fullAccess:revokeAll': none,
  'tasks:deliverables': obj({ folder: absPath, since: num({ min: 0 }) }),
  'tasks:reveal': pathReq,
  'tasks:openPath': pathReq,
  'tasks:importFiles': folderReq,
  'tasks:previewFile': obj({ path: absPath, maxBytes: optional(num({ int: true, min: 1, max: 20 * 1024 * 1024 })) }),
  'tasks:project:get': folderReq,
  'tasks:project:save': obj({
    folder: absPath,
    name: optional(str({ max: 200 })),
    instructions: optional(str({ max: 20_000 })),
    links: optional(links),
    memoryEnabled: optional(bool)
  }),
  'tasks:memory:get': folderReq,
  'tasks:memory:save': obj({ folder: absPath, content: str({ max: 2 * 1024 * 1024 }) }),
  'tasks:memory:delete': folderReq,
  'tasks:network:state': none,
  'tasks:network:setToggle': obj({ key: literal('npmEnabled', 'pypiEnabled', 'webSearchEnabled'), value: bool }),
  'tasks:network:setHost': obj({ host: str({ max: 255, min: 1 }), decision: literal('allow', 'block', 'unset') }),
  'tasks:network:allowOnce': obj({ folder: absPath, host: str({ max: 255, min: 1 }) }),
  'tasks:deleteGrant:get': folderReq,
  'tasks:deleteGrant:set': obj({ folder: absPath, allowed: bool }),
  'routines:list': none,
  'routines:save': obj({
    id: optional(id),
    name: str({ max: 200, min: 1 }),
    prompt: str({ max: 100_000, min: 1 }),
    mode: literal('chat', 'tasks', 'code'),
    folder: optional(nullable(absPath)),
    model: modelRef,
    schedule,
    enabled: bool,
    originSessionId: optional(nullable(id)),
    sessionMode: optional(literal('fresh', 'continue')),
    onAsk: optional(literal('reject', 'wait')),
    allow: optional(arr(obj({ permission: permName, pattern }), 50)),
    allowHosts: optional(arr(host, 50)),
    fullAccess: optional(bool),
    fullAccessConsentAt: optNull(num({ min: 0 }))
  }),
  'routines:delete': obj({ id }),
  'routines:toggle': obj({ id, enabled: bool }),
  'routines:runNow': obj({ id }),
  'routines:history': (v, p) => optional(obj({ id: optional(id), limit: optional(num({ int: true, min: 1, max: 1000 })) }))(v, p) ?? {},
  'routines:preview': obj({ schedule }),
  'computer:status': none,
  'computer:requestPermissions': none,
  'computer:stop': none,
  'computer:resume': none,
  'computer:state': none,
  'computer:session': obj({ active: bool, label: optional(str({ max: 500 })), sessionId: optional(sessionId) }),
  'computer:grants': none,
  'computer:setGrant': obj({
    bundleId: str({ max: 255, min: 1 }),
    name: str({ max: 255, min: 1 }),
    tier: literal('view', 'click', 'full')
  }),
  'computer:revokeGrant': obj({ bundleId: str({ max: 255, min: 1 }) }),
  'computer:denyApp': obj({ bundleId: str({ max: 255, min: 1 }), name: str({ max: 255, min: 1 }) }),
  'computer:undenyApp': obj({ bundleId: str({ max: 255, min: 1 }) }),
  'computer:respondAccess': obj({
    id: str({ max: 100, min: 1 }),
    decisions: arr(
      obj({
        bundleId: str({ max: 255, min: 1 }),
        name: str({ max: 255, min: 1 }),
        decision: literal('view', 'click', 'full', 'deny')
      }),
      20
    ),
    feedback: optional(str({ max: 1000 })),
    approvePlan: optional(bool),
    cancel: optional(bool)
  }),
  'computer:revokePlan': obj({ sessionId }),
  'computer:approvedPlans': none,
  'computer:showMainWindow': none,
  'tasks:keepAwakeState': none,
  'tasks:keepAwakeSetting': obj({ enabled: bool }),
  'tasks:keepAwakeActive': obj({ active: bool }),

  // Lote B: carpetas
  'tasks:folders:get': folderReq,
  'tasks:folders:check': pathReq,
  'tasks:folders:link': obj({ folder: absPath, path: absPath, mode: folderMode, trust: optional(bool), restart: optional(bool) }),
  'tasks:folders:unlink': obj({ folder: absPath, path: absPath, restart: optional(bool) }),
  'tasks:trusted:list': none,
  'tasks:trusted:set': obj({ path: absPath, mode: folderMode }),
  'tasks:trusted:remove': pathReq,
  'tasks:policy': none,
  // Lote B: actividad, tareas, preferencias y almacenamiento
  'tasks:activity': none,
  'tasks:viewing': obj({ folder: nullable(absPath), fullAccess: optional(bool) }),
  'tasks:tasks:list': none,
  'tasks:tasks:setMeta': obj({
    sessionId,
    folder: absPath,
    fullAccess: bool,
    title: optional(str({ max: 500 })),
    pinned: optional(bool),
    group: optNull(group)
  }),
  'tasks:tasks:forget': obj({ sessionId }),
  'tasks:prefs:get': none,
  'tasks:prefs:set': partial({
    autoArchiveDays: num({ int: true, min: 0, max: 365 }),
    idleStopMinutes: num({ int: true, min: 0, max: 1440 }),
    stallWarnMinutes: num({ int: true, min: 0, max: 240 }),
    maxServers: num({ int: true, min: 1, max: 12 }),
    notify: partial({ done: bool, approval: bool, question: bool, error: bool })
  }),
  'tasks:storage:report': none,
  'tasks:storage:clean': obj({ key: storageKey, scope: literal('cache', 'all') }),
  'tasks:storage:cleanScreenshots': none,
  'tasks:storage:cleanRestorePoints': none,
  // Puntos de restauración
  'tasks:restore:create': obj({ folder: absPath, sessionId, label: shortText }),
  'tasks:restore:list': obj({ folder: absPath, sessionId }),
  'tasks:restore:changes': obj({ folder: absPath, pointId: hexId }),
  'tasks:restore:apply': obj({ folder: absPath, pointId: hexId, paths: optional(arr(str({ max: 4096, min: 1 }), 5000)) }),
  'tasks:restore:forget': obj({ sessionId }),
  // Lote B: proyecto, MCP y permisos recordados
  'tasks:agentsMd:get': folderReq,
  'tasks:agentsMd:save': obj({ folder: absPath, content: str({ max: 200_000 }) }),
  'tasks:mcp:list': none,
  'tasks:mcp:set': obj({ name: mcpName, tasks: optional(bool), askEachTool: optional(bool) }),
  'tasks:rules:list': (v, p) => optional(obj({ folder: optional(absPath) }))(v, p) ?? {},
  'tasks:rules:add': obj({ folder: absPath, permission: permName, patterns: arr(pattern, 50) }),
  'tasks:rules:remove': obj({ id }),
  // Lote B: archivos
  'tasks:zip': obj({ paths: arr(absPath, 500), suggestedName: optional(fileName) }),
  'tasks:quickLook': pathReq,
  'tasks:exportMarkdown': obj({ suggestedName: fileName, content: str({ max: 20 * 1024 * 1024 }) }),
  'tasks:htmlToPdf': pathReq,

  // Lote C: preferencias de computer use
  'computer:prefs:get': none,
  'computer:prefs:set': partial({
    mode: literal('background', 'full'),
    hideOtherApps: bool,
    unhideOnFinish: bool
  }),
  'computer:teachRespond': obj({ id: hexId, action: literal('next', 'exit') }),
  'computer:record:start': obj({ mic: bool }),
  'computer:record:stop': (v, p) => optional(obj({ discard: optional(bool) }))(v, p) ?? {},
  'computer:record:prepare': obj({ id: hexId, folder: absPath, includeTyped: bool }),

  // Lote C: Modo auto (handlers de C3)
  'tasks:auto:state': none,
  'tasks:auto:set': partial({
    enabled: bool,
    folder: obj({ path: absPath, on: bool }),
    task: obj({ sessionId, on: bool }),
    viewApps: arr(str({ max: 255, min: 1, pattern: /^[A-Za-z0-9._-]+$/ }), 100)
  }),
  'tasks:auto:revoke': obj({ id }),
  'tasks:auto:clearLog': none,
  'tasks:auto:consider': obj({
    folder: absPath,
    fullAccess: bool,
    requestId: str({ max: 200, min: 1, pattern: /^[A-Za-z0-9_-]+$/ })
  })
}

type ExtrasReq<C extends IpcExtrasInvokeChannel> = IpcExtrasInvokeContract[C]['req']
const EXTRAS_SCHEMAS: { [C in IpcExtrasInvokeChannel]: Validator<ExtrasReq<C>> } = {
  'extras:getPrefs': none,
  'extras:setPrefs': partial({
    quickEntryShortcut: str({ max: 100 }),
    modelsByMode: partial({ chat: modelRef, code: modelRef, tasks: modelRef }),
    showTray: bool,
    notificationsEnabled: bool,
    soundEnabled: bool,
    keybindings: record(nullable(str({ max: 60 })), 100)
  }),
  'extras:versions': none,
  'extras:openArtifact': obj({ title: str({ max: 500 }), html: str({ max: 5 * 1024 * 1024 }) }),
  'extras:quickSubmit': obj({ text: str({ max: 100_000 }) }),
  'extras:quickHide': none,
  'extras:quickToggle': none,
  'extras:suspendShortcut': obj({ suspended: bool }),
  'extras:takePendingPrompt': none,
  'mcp:getConfig': none,
  'mcp:save': obj({ name: mcpName, entry: mcpEntry, previousName: optional(mcpName) }),
  'mcp:remove': obj({ name: mcpName }),
  'mcp:setEnabled': obj({ name: mcpName, enabled: bool }),
  'mcp:revealConfig': none,
  'mcp:catalog': none,
  'mcp:installCatalog': obj({
    id: str({ max: 64, min: 1, pattern: /^[a-z0-9-]+$/ }),
    name: mcpName,
    inputs: record(str({ max: 4096 }), 10),
    enable: bool,
    askEachUse: bool
  })
}

type RemoteReq<C extends RemoteInvokeChannel> = RemoteInvokeContract[C]['req']
const REMOTE_SCHEMAS: { [C in RemoteInvokeChannel]: Validator<RemoteReq<C>> } = {
  'remote:getState': none,
  'remote:start': none,
  'remote:newPairing': none,
  'remote:stop': none,
  'remote:confirmPair': obj({ requestId: str({ max: 64, min: 1, pattern: /^[A-Za-z0-9_-]+$/ }), accept: bool }),
  'remote:revoke': obj({ deviceId: str({ max: 32, min: 32, pattern: /^[0-9a-f]+$/ }) }),
  'remote:confirmAction': obj({ requestId: str({ max: 64, min: 1, pattern: /^[A-Za-z0-9_-]+$/ }), accept: bool })
}

/**
 * Validador por canal.
 */
export const IPC_SCHEMAS: Record<string, Validator<unknown>> = {
  ...APP_SCHEMAS,
  ...TASKS_SCHEMAS,
  ...EXTRAS_SCHEMAS,
  ...CODE_SCHEMAS,
  ...BROWSER_SCHEMAS,
  ...REMOTE_SCHEMAS
}

/** Canales que puede invocar cada ventana secundaria (la principal: todos). */
export const CHANNEL_ROLES: Record<Exclude<WindowRole, 'main'>, ReadonlySet<string>> = {
  quick: new Set(['extras:quickSubmit', 'extras:quickHide']),
  // La píldora puede resolver una tarjeta pendiente sin activar la ventana principal
  // (`showInactive`; ver `computer/overlay.ts`).
  pill: new Set(['computer:stop', 'computer:respondAccess', 'computer:showMainWindow']),
  overlay: new Set(),
  // Ventana `assist` (Teach mode y píldora de grabación): responder un paso o terminar/descartar
  // la grabación, sin activar la ventana principal (ver `computer/assist-window.ts`).
  assist: new Set(['computer:teachRespond', 'computer:record:stop']),
  // Ventana «Navegador» aparte (Lote D, B.4): todo `browser:*` salvo Ajustes/`devServers`, que solo
  // tiene sentido desde la ventana principal.
  browserHost: new Set(BROWSER_INVOKE_CHANNELS.filter((c) => !BROWSER_HOST_EXCLUDED_CHANNELS.has(c)))
}

/**
 * Comprobación en tiempo de ejecución (desarrollo): todo canal invoke de los contratos tiene
 * esquema. Las tablas ya están tipadas contra los contratos (tsc falla si falta uno); esto cubre
 * además un canal añadido a una lista sin pasar por el tipo. Devuelve los que faltan.
 */
export function missingSchemas(): string[] {
  const all = [
    ...IPC_INVOKE_CHANNELS,
    ...CODE_INVOKE_CHANNELS,
    ...TASKS_INVOKE_CHANNELS,
    ...IPC_EXTRAS_INVOKE_CHANNELS,
    ...BROWSER_INVOKE_CHANNELS,
    ...REMOTE_INVOKE_CHANNELS
  ]
  return [...new Set<string>(all)].filter((c) => !IPC_SCHEMAS[c])
}
