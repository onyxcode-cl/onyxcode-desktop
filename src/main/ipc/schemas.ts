/**
 * Esquema del payload de CADA canal IPC invoke (renderer → main) y qué ventanas pueden usarlo.
 *
 * - Las tablas están tipadas contra los contratos de `shared/ipc*.ts`: si un canal cambia de
 *   forma o se añade uno nuevo sin esquema, `tsc` falla.
 * - `CHANNEL_ROLES`: por defecto solo la ventana principal puede invocar; Quick Entry y la píldora
 *   del overlay tienen su lista mínima (el overlay a pantalla completa no invoca nada).
 */
import { IPC_INVOKE_CHANNELS, type IpcInvokeChannel, type IpcRequest } from '@shared/ipc'
import { CODE_INVOKE_CHANNELS, type CodeInvokeChannel, type CodeRequest } from '@shared/ipc-code'
import { COWORK_INVOKE_CHANNELS, type CoworkInvokeChannel, type CoworkRequest } from '@shared/ipc-cowork'
import {
  IPC_EXTRAS_INVOKE_CHANNELS,
  type IpcExtrasInvokeChannel,
  type IpcExtrasInvokeContract
} from '@shared/ipc-extras'
import {
  absPath,
  arr,
  bool,
  literal,
  none,
  num,
  obj,
  optional,
  nullable,
  partial,
  record,
  str,
  tagged,
  type Validator
} from './validate'

/** Rol de la ventana que envía (lo asigna main al crearla). */
export type WindowRole = 'main' | 'quick' | 'overlay' | 'pill'

const id = str({ max: 200, min: 1 })
const shortText = str({ max: 500 })
const modelRef = obj({ providerID: str({ max: 200, min: 1 }), modelID: str({ max: 200, min: 1 }) })
const cwdReq = obj({ cwd: absPath })
const folderReq = obj({ folder: absPath })
const pathReq = obj({ path: absPath })
const openFolderOpts = optional(obj({ title: optional(shortText), defaultPath: optional(absPath) }))
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
      v === false ? (false as const) : record((x: unknown, p?: string) => (typeof x === 'number' ? num()(x, p) : str({ max: 4096 })(x, p)), 50)(v, path)
    )
  })
})

const APP_SCHEMAS: { [C in IpcInvokeChannel]: Validator<IpcRequest<C>> } = {
  'app:info': none,
  'app:openExternal': obj({ url: str({ max: 8192, pattern: /^https?:\/\//i }) }),
  'opencode:connection': none,
  'opencode:status': none,
  'opencode:restart': none,
  'settings:get': none,
  'settings:set': partial({
    defaultModel: modelRef,
    theme: literal('system', 'light', 'dark'),
    recentFolders: arr(absPath, 50),
    coworkGlobalInstructions: str({ max: 20_000 })
  }),
  'settings:addRecentFolder': pathReq,
  'dialog:openFolder': (v, p) => openFolderOpts(v, p) ?? {},
  'pty:create': ptyCreate,
  'pty:write': obj({ id, data: str({ max: 1024 * 1024 }) }),
  'pty:resize': obj({ id, cols: num({ int: true, min: 1, max: 1000 }), rows: num({ int: true, min: 1, max: 500 }) }),
  'pty:kill': obj({ id }),
  'git:status': cwdReq,
  'git:diff': obj({ cwd: absPath, path: optional(str({ max: 4096 })), staged: optional(bool) }),
  'git:worktrees': cwdReq,
  // Canales antiguos sin implementación (responden NOT_IMPLEMENTED): no aceptan nada.
  'scheduler:list': none,
  'scheduler:save': () => {
    throw new Error('scheduler:save no está disponible')
  },
  'scheduler:delete': obj({ id }),
  'scheduler:runNow': obj({ id })
}

const CODE_SCHEMAS: { [C in CodeInvokeChannel]: Validator<CodeRequest<C>> } = {
  'pty:create': ptyCreate,
  'pty:write': APP_SCHEMAS['pty:write'],
  'pty:resize': APP_SCHEMAS['pty:resize'],
  'pty:kill': APP_SCHEMAS['pty:kill'],
  'pty:list': none,
  'pty:available': none,
  'git:isRepo': cwdReq,
  'git:status': cwdReq,
  'git:diff': APP_SCHEMAS['git:diff'],
  'git:branches': cwdReq,
  'git:currentBranch': cwdReq,
  'git:worktrees': cwdReq,
  'git:createWorktree': obj({ cwd: absPath, branch: str({ max: 250, min: 1 }), base: optional(str({ max: 250 })) }),
  'git:removeWorktree': obj({ cwd: absPath, path: absPath, force: optional(bool) }),
  'git:commit': obj({ cwd: absPath, message: str({ max: 100_000, min: 1 }), stageAll: optional(bool) }),
  'git:log': obj({ cwd: absPath, n: optional(num({ int: true, min: 1, max: 1000 })) }),
  'dialog:openFolder': openFolderOpts,
  'dialog:revealInFinder': pathReq,
  'dialog:openInEditor': pathReq
}

const COWORK_SCHEMAS: { [C in CoworkInvokeChannel]: Validator<CoworkRequest<C>> } = {
  'cowork:pickFolder': none,
  'cowork:listFolders': none,
  'cowork:approveFolder': folderReq,
  'cowork:removeFolder': folderReq,
  'cowork:start': obj({ folder: absPath, fullAccess: optional(bool) }),
  'cowork:grantFullAccess': folderReq,
  'cowork:revokeFullAccess': folderReq,
  'cowork:stop': obj({ folder: absPath, fullAccess: optional(bool) }),
  'cowork:servers': none,
  'cowork:deliverables': obj({ folder: absPath, since: num({ min: 0 }) }),
  'cowork:reveal': pathReq,
  'cowork:openPath': pathReq,
  'cowork:importFiles': folderReq,
  'cowork:previewFile': obj({ path: absPath, maxBytes: optional(num({ int: true, min: 1, max: 20 * 1024 * 1024 })) }),
  'cowork:project:get': folderReq,
  'cowork:project:save': obj({ folder: absPath, name: optional(str({ max: 200 })), instructions: optional(str({ max: 20_000 })) }),
  'cowork:memory:get': folderReq,
  'cowork:memory:save': obj({ folder: absPath, content: str({ max: 2 * 1024 * 1024 }) }),
  'cowork:memory:delete': folderReq,
  'cowork:network:state': none,
  'cowork:network:setToggle': obj({ key: literal('npmEnabled', 'pypiEnabled'), value: bool }),
  'cowork:network:setHost': obj({ host: str({ max: 255, min: 1 }), decision: literal('allow', 'block', 'unset') }),
  'cowork:network:allowOnce': obj({ folder: absPath, host: str({ max: 255, min: 1 }) }),
  'cowork:deleteGrant:get': folderReq,
  'cowork:deleteGrant:set': obj({ folder: absPath, allowed: bool }),
  'routines:list': none,
  'routines:save': obj({
    id: optional(id),
    name: str({ max: 200, min: 1 }),
    prompt: str({ max: 100_000, min: 1 }),
    mode: literal('chat', 'cowork', 'code'),
    folder: optional(nullable(absPath)),
    model: modelRef,
    schedule,
    enabled: bool,
    originSessionId: optional(nullable(id))
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
  'computer:session': obj({ active: bool, label: optional(str({ max: 500 })) }),
  'computer:grants': none,
  'computer:setGrant': obj({ bundleId: str({ max: 255, min: 1 }), name: str({ max: 255, min: 1 }), tier: literal('view', 'click', 'full') }),
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
    feedback: optional(str({ max: 1000 }))
  }),
  'computer:showMainWindow': none,
  'cowork:keepAwakeState': none,
  'cowork:keepAwakeSetting': obj({ enabled: bool }),
  'cowork:keepAwakeActive': obj({ active: bool })
}

type ExtrasReq<C extends IpcExtrasInvokeChannel> = IpcExtrasInvokeContract[C]['req']
const EXTRAS_SCHEMAS: { [C in IpcExtrasInvokeChannel]: Validator<ExtrasReq<C>> } = {
  'extras:getPrefs': none,
  'extras:setPrefs': partial({
    quickEntryShortcut: str({ max: 100 }),
    modelsByMode: partial({ chat: modelRef, code: modelRef, cowork: modelRef }),
    showTray: bool
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
  'mcp:revealConfig': none
}

/**
 * Validador por canal. Los canales repetidos entre contratos (`pty:*`, `git:*`,
 * `dialog:openFolder`) los atiende el handler de Code (registrado después), así que gana su esquema.
 */
export const IPC_SCHEMAS: Record<string, Validator<unknown>> = {
  ...APP_SCHEMAS,
  ...COWORK_SCHEMAS,
  ...EXTRAS_SCHEMAS,
  ...CODE_SCHEMAS
}

/** Canales que puede invocar cada ventana secundaria (la principal: todos). */
export const CHANNEL_ROLES: Record<Exclude<WindowRole, 'main'>, ReadonlySet<string>> = {
  quick: new Set(['extras:quickSubmit', 'extras:quickHide']),
  // La píldora puede resolver una tarjeta pendiente sin activar la ventana principal
  // (`showInactive`; ver `computer/overlay.ts`).
  pill: new Set(['computer:stop', 'computer:respondAccess', 'computer:showMainWindow']),
  overlay: new Set()
}

/**
 * Comprobación en tiempo de ejecución (desarrollo): todo canal invoke de los contratos tiene
 * esquema. Las tablas ya están tipadas contra los contratos (tsc falla si falta uno); esto cubre
 * además un canal añadido a una lista sin pasar por el tipo. Devuelve los que faltan.
 */
export function missingSchemas(): string[] {
  const all = [...IPC_INVOKE_CHANNELS, ...CODE_INVOKE_CHANNELS, ...COWORK_INVOKE_CHANNELS, ...IPC_EXTRAS_INVOKE_CHANNELS]
  return [...new Set<string>(all)].filter((c) => !IPC_SCHEMAS[c])
}
