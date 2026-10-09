/**
 * Política «celular» (F0-T3): qué puede pedir el celular al Mac, por canal IPC y por ruta HTTP del motor.
 *
 * - DENEGAR POR DEFECTO: todo canal o ruta sin entrada explícita se rechaza (`unknown-channel` / `unknown-route`).
 *   Los tests exigen una entrada para CADA canal invoke de `shared/ipc*.ts` (`missingSchemas()`), CADA evento y CADA ruta
 *   de `resources/opencode-bin/api-routes.json`; añadir uno nuevo sin clasificar rompe el test.
 * - Clases: R = lectura, M = mutación acotada al ámbito, D = peligrosa (se pide confirmación en el Mac, ver
 *   `confirm-queue.ts`), X = prohibida. Reducir privilegios (detener, revocar) es M; ampliarlos es D.
 * - Ámbito: toda ruta absoluta y todo `directory` deben estar dentro del conjunto permitido (`PolicyContext`).
 * - Los setters genéricos se validan campo a campo; lo que no se reconoce se rechaza.
 * - Cuando hay duda, la clase es la más estricta (D o X). Tabla final y casos límite: `docs/SEGURIDAD.md`.
 *
 * `decide` es PURA: no toca disco, red ni Electron (solo `node:path` y `node:os` para normalizar rutas). Los datos que
 * hacen falta (carpetas permitidas, directorio de una sesión, modelos de `provider.list`, tipo de un permiso) los aporta
 * quien llama en `PolicyContext`. La política NO resuelve enlaces simbólicos: el despachador (T4/T2) debe comprobar
 * `realpath` antes de ejecutar.
 */
import { homedir } from 'node:os'
import { isAbsolute, resolve, sep } from 'node:path'
import type { RemoteText } from '@shared/ipc-remote'
import { approvalVerdict } from './command-denylist'
import { cleanDetail, previewText } from './confirm-detail'

export type PolicyClass = 'R' | 'M' | 'D' | 'X'

export type PolicyRequest =
  | { kind: 'ipc'; channel: string; payload?: unknown }
  | {
      kind: 'http'
      /** GET, POST… */
      method: string
      /** Ruta concreta del motor sin query (`/session/ses_1/message`). */
      path: string
      query?: Record<string, string | undefined>
      body?: unknown
    }

export interface PolicyContext {
  /** Carpetas permitidas: recientes de Code y carpetas de Tareas ya aprobadas. */
  allowedDirs: readonly string[]
  /** Directorios de Chat (ámbito de las sesiones de Chat). */
  chatDirs?: readonly string[]
  /** Carpetas con Control total ya confirmado en el Mac (único sitio donde se admite el agente `computer`). */
  fullAccessDirs?: readonly string[]
  /** Directorio de una sesión conocida (`undefined` = desconocida → se rechaza). Si falta la función no se comprueba. */
  sessionDir?: (sessionId: string) => string | undefined
  /** `providerID/modelID` presentes en `provider.list`. Sin conjunto, ningún `model` se puede verificar y se rechaza. */
  knownModels?: ReadonlySet<string>
  /** Tipo (`edit`, `bash`, `external_directory`…) del permiso pendiente; desconocido = se trata como peligroso. */
  permissionKind?: (requestId: string) => string | undefined
  /** Qué pide el permiso pendiente (comando, rutas o patrones), ya recortado, para mostrarlo en la confirmación. */
  permissionDetail?: (requestId: string) => string[] | undefined
  /** Este celular tiene encendido «Aprobar comandos desde este celular» (por dispositivo, apagado por defecto). */
  canApproveCommands?: boolean
  /** Texto íntegro que pide el permiso pendiente (aprendido del motor, no del celular), para la lista de denegación. */
  permissionText?: (requestId: string) => string[] | undefined
  /** `realpath` de una ruta (puede no existir) para la lista de denegación; sin él solo se compara lo léxico. */
  realpath?: (p: string) => string | null
  /** Carpeta de una rutina por id (`null` = sin carpeta, p. ej. Chat; `undefined` = desconocida → se rechaza). */
  routineFolder?: (routineId: string) => string | null | undefined
  /** Carpeta de una tarea de Tareas por id de sesión (`undefined` = desconocida → se rechaza). */
  taskFolder?: (sessionId: string) => string | undefined
  /** ¿Es carpeta? `undefined` = no se sabe → se trata como carpeta (D). */
  isDirectory?: (absPath: string) => boolean | undefined
  /** Para mostrar rutas con `~` (por defecto `os.homedir()`). */
  home?: string
}

export type PolicyDecision =
  /** `key` = canal IPC o `MÉTODO /ruta/{plantilla}` (sin ids): lo que se anota en la auditoría de las acciones M. */
  | {
      allow: true
      class: 'R' | 'M'
      key: string
      /** «Una vez» de `bash`/`edit` aprobado desde el celular sin confirmar (cuenta para el tope por hora y se audita). */ approve?: true
    }
  | { allow: false; reason: string }
  | { confirm: true; summary: RemoteText; detail: string[]; channel: string }

type Outcome = PolicyClass | { deny: string } | { approve: true }
const deny = (reason: string): Outcome => ({ deny: reason })

// ─────────────────────────────── utilidades ───────────────────────────────

const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const isStr = (v: unknown): v is string => typeof v === 'string'

function cleanDirs(dirs: readonly string[] | undefined): string[] {
  const out: string[] = []
  for (const d of dirs ?? []) {
    if (!isStr(d) || d.includes('\0') || !isAbsolute(d)) continue
    const r = resolve(d)
    // Una raíz o el home entero como «carpeta permitida» abriría todo el disco: se ignora.
    if (r === resolve(sep) || r === resolve(homedir())) continue
    out.push(r)
  }
  return out
}

/** ¿`p` está dentro de `base` (o es `base`)? Léxico: sin enlaces simbólicos ni mayúsculas/minúsculas. */
function isInside(base: string, p: string): boolean {
  const b = resolve(base)
  const r = resolve(p)
  return r === b || r.startsWith(b.endsWith(sep) ? b : b + sep)
}

/** Ruta absoluta (sin NUL) dentro de alguna carpeta de `dirs`. */
function inDirs(p: unknown, dirs: readonly string[]): p is string {
  if (!isStr(p) || p.includes('\0') || !isAbsolute(p)) return false
  return cleanDirs(dirs).some((d) => isInside(d, p))
}

const scopeIpc = (ctx: PolicyContext): readonly string[] => ctx.allowedDirs
const scopeHttp = (ctx: PolicyContext): readonly string[] => [...ctx.allowedDirs, ...(ctx.chatDirs ?? [])]

/** Ruta relativa (o absoluta) que debe quedar dentro de `cwd`: sin `..` que escape. */
function childOk(cwd: string, p: unknown): boolean {
  if (!isStr(p) || p.includes('\0')) return false
  return isInside(cwd, isAbsolute(p) ? p : resolve(cwd, p))
}

function sameDir(a: string, b: string): boolean {
  return resolve(a) === resolve(b)
}

function tilde(p: string, home: string): string {
  const h = resolve(home)
  const r = resolve(p)
  return r === h ? '~' : r.startsWith(h + sep) ? '~' + r.slice(h.length) : p
}

const MODEL_RE = /^[A-Za-z0-9._:/-]{1,200}$/

/** `{providerID, modelID}` o `"prov/model"` → `prov/model` (o undefined si no tiene forma). */
function modelKey(v: unknown): string | undefined {
  if (isStr(v)) return MODEL_RE.test(v) && v.includes('/') ? v : undefined
  const o = rec(v)
  return isStr(o.providerID) && isStr(o.modelID) && o.providerID && o.modelID ? `${o.providerID}/${o.modelID}` : undefined
}

function modelOutcome(v: unknown, ctx: PolicyContext): Outcome | undefined {
  const key = modelKey(v)
  if (!key) return deny('model-invalid')
  if (!ctx.knownModels?.has(key)) return deny('model-unknown')
  return undefined
}

// ─────────────────────────────── IPC ───────────────────────────────

type IpcFn = (payload: Record<string, unknown>, ctx: PolicyContext) => Outcome
type IpcSpec = PolicyClass | IpcFn

/** `cls` si todos los campos indicados son rutas absolutas dentro del ámbito; si no, `out-of-scope`. */
const scoped =
  (cls: PolicyClass, ...keys: string[]): IpcSpec =>
  (p, ctx) =>
    keys.every((k) => inDirs(p[k], scopeIpc(ctx))) ? cls : deny('out-of-scope')

/** Como `scoped` pero el campo puede ser `null`/ausente (`tasks:viewing`). */
const scopedOpt =
  (cls: PolicyClass, key: string): IpcSpec =>
  (p, ctx) =>
    p[key] === null || p[key] === undefined || inDirs(p[key], scopeIpc(ctx)) ? cls : deny('out-of-scope')

function mergeFields(fields: Record<string, PolicyClass>, p: Record<string, unknown>): Outcome {
  let worst: PolicyClass = 'M'
  const keys = Object.keys(p).filter((k) => p[k] !== undefined)
  if (keys.length === 0) return deny('empty-payload')
  for (const k of keys) {
    const c = fields[k]
    if (!c || c === 'X') return deny(`field-forbidden:${k}`)
    if (c === 'D') worst = 'D'
  }
  return worst
}

/** Setter genérico: cada campo tiene su clase; un campo desconocido o X rechaza TODA la llamada. */
const fieldwise =
  (fields: Record<string, PolicyClass>): IpcSpec =>
  (p) =>
    mergeFields(fields, p)

const SETTINGS_FIELDS: Record<string, PolicyClass> = {
  defaultModel: 'M',
  theme: 'M',
  language: 'M',
  tasksGlobalInstructions: 'D',
  // «Aprender de las tareas» (memoria aprendida, 2026-10-07): X, como el resto de lo que no se toca desde el celular.
  learningEnabled: 'X',
  // El resto no se toca desde el celular: ruta del binario, actualizaciones, carpetas recientes, onboarding, términos.
  opencodeBin: 'X',
  checkUpdates: 'X',
  recentFolders: 'X',
  onboarded: 'X',
  routinesTermsAcknowledged: 'X'
}

const EXTRAS_PREF_FIELDS: Record<string, PolicyClass> = {
  modelsByMode: 'M',
  showTray: 'M',
  notificationsEnabled: 'M',
  soundEnabled: 'M',
  quickEntryShortcut: 'X',
  keybindings: 'X',
  lastEditor: 'X'
}

const TASKS_PREF_FIELDS: Record<string, PolicyClass> = {
  notify: 'M',
  stallWarnMinutes: 'M',
  autoArchiveDays: 'D',
  idleStopMinutes: 'D',
  maxServers: 'D'
}

const COMPUTER_PREF_FIELDS: Record<string, PolicyClass> = { hideOtherApps: 'M', unhideOnFinish: 'M', mode: 'M' }

/** Navegador: el dueño de la pestaña (Code → `directory`, Tareas → `folder`) debe estar en el ámbito. */
function browserOwnerOk(p: Record<string, unknown>, ctx: PolicyContext): boolean {
  const o = rec(p.owner)
  return o.kind === 'code' ? inDirs(o.directory, scopeIpc(ctx)) : o.kind === 'tasks' ? inDirs(o.folder, scopeIpc(ctx)) : false
}
const browserOwned =
  (cls: PolicyClass): IpcSpec =>
  (p, ctx) =>
    browserOwnerOk(p, ctx) ? cls : deny('out-of-scope')

/**
 * Acciones sobre algo identificado solo por un id (rutina, tarea): la carpeta a la que pertenece debe estar en el ámbito.
 * Sin saber a qué carpeta pertenece, se rechaza (`scope-unknown`).
 */
const ownedBy =
  (cls: PolicyClass, key: string, pick: (ctx: PolicyContext) => ((id: string) => string | null | undefined) | undefined): IpcFn =>
  (p, ctx) => {
    const lookup = pick(ctx)
    const id = p[key]
    if (!isStr(id) || id === '' || !lookup) return deny('scope-unknown')
    const folder = lookup(id)
    if (folder === undefined) return deny('scope-unknown')
    if (folder === null) return cls // sin carpeta (Chat): el ámbito de Chat ya está acotado por el motor
    return inDirs(folder, scopeHttp(ctx)) ? cls : deny('out-of-scope')
  }
const routineScoped = (cls: PolicyClass): IpcFn => ownedBy(cls, 'id', (c) => c.routineFolder)
const taskScoped = (cls: PolicyClass): IpcFn => ownedBy(cls, 'sessionId', (c) => c.taskFolder)

const MAX_DISCARD_FILES = 20

/**
 * Tabla IPC. UNA entrada por canal invoke (ver la prueba de cobertura). Comentario `// X:` = motivo de la prohibición.
 */
export const CELULAR_POLICY: Record<string, IpcSpec> = {
  // ── app ──
  'app:info': 'R', // el resultado se limpia con `sanitizeResult` (sin `userDataPath`)
  'app:openExternal': 'X', // abre el navegador del Mac
  'app:notify': 'X',
  'app:setAttention': 'X',
  'app:opencodeInfo': 'X', // revela la ruta del binario
  'app:opencodeAction': 'X',
  'app:pickOpencodeBin': 'X',
  'app:updateState': 'R',
  'app:checkUpdates': 'M',
  'app:dismissUpdate': 'M',
  'app:updateDownload': 'D',
  'app:updateCancel': 'M',
  'app:updateInstall': 'D',
  'app:bootConfirm': 'X',
  'app:testProviderKey': 'X',
  // ── motor ──
  'opencode:connection': 'R', // el puente reescribe `baseUrl`/`authorization`
  'opencode:status': 'R',
  'opencode:restart': 'D',
  // ── diagnóstico ──
  'diag:logs': 'X',
  'diag:copy': 'X',
  'diag:export': 'X',
  // ── ajustes ──
  'settings:get': 'R',
  'settings:set': fieldwise(SETTINGS_FIELDS),
  'settings:addRecentFolder': 'D',

  // ── Tareas: carpetas, acceso total, archivos ──
  'tasks:pickFolder': 'X', // diálogo nativo
  'tasks:listFolders': 'R',
  'tasks:approveFolder': 'D',
  'tasks:removeFolder': scoped('M', 'folder'),
  'tasks:start': (p, ctx) => (!inDirs(p.folder, scopeIpc(ctx)) ? deny('out-of-scope') : p.fullAccess === true ? 'D' : 'M'),
  'tasks:grantFullAccess': scoped('D', 'folder'),
  'tasks:revokeFullAccess': scoped('M', 'folder'),
  'tasks:fullAccess:state': 'R',
  'tasks:fullAccess:consent': 'D',
  'tasks:fullAccess:revokeAll': 'M',
  'tasks:deliverables': scoped('R', 'folder'),
  'tasks:reveal': 'X',
  'tasks:openPath': 'X',
  'tasks:importFiles': 'X',
  'tasks:previewFile': (p, ctx) =>
    !inDirs(p.path, scopeIpc(ctx))
      ? deny('out-of-scope')
      : typeof p.maxBytes === 'number' && p.maxBytes > 8 * 1024 * 1024
        ? deny('too-large')
        : 'R',
  'tasks:project:get': scoped('R', 'folder'),
  // `instructions`/`links` condicionan al agente de forma persistente → D; solo nombre/memoria → M.
  'tasks:project:save': (p, ctx) =>
    !inDirs(p.folder, scopeIpc(ctx)) ? deny('out-of-scope') : p.instructions !== undefined || p.links !== undefined ? 'D' : 'M',
  'tasks:memory:get': scoped('R', 'folder'),
  'tasks:memory:save': scoped('D', 'folder'),
  'tasks:memory:delete': scoped('D', 'folder'),
  // Memoria aprendida (decisión 2026-10-07): todo X por ahora. Es contenido que el agente propuso sobre el
  // usuario/sus proyectos; verlo, aprobarlo o borrarlo se queda solo en el Mac/PC, nunca desde el celular.
  'tasks:learn:get': 'X',
  'tasks:learn:accept': 'X',
  'tasks:learn:remove': 'X',
  'tasks:learn:clear': 'X',
  'tasks:skill:accept': 'X',
  'tasks:skill:approved': 'X',
  'tasks:skill:trust': 'X',
  'tasks:skill:remove': 'X',
  'tasks:learn:pending:list': 'X',
  'tasks:learn:pending:acceptMemory': 'X',
  'tasks:learn:pending:acceptSkill': 'X',
  'tasks:learn:pending:discard': 'X',
  'tasks:learn:pending:discardAll': 'X',
  'tasks:learn:pending:ackDropped': 'X',
  'tasks:viewer:open': 'X', // lee bytes de cualquier archivo aprobado de Tareas: la vista es nativa de la ventana del Mac/PC
  'tasks:viewer:attach': 'X',
  'tasks:viewer:close': 'X',
  'tasks:network:state': 'R',
  'tasks:network:setToggle': 'D',
  'tasks:network:setHost': 'D',
  'tasks:network:allowOnce': scoped('D', 'folder'),
  'tasks:deleteGrant:get': scoped('R', 'folder'),
  'tasks:deleteGrant:set': scoped('D', 'folder'),

  // ── Rutinas ──
  'routines:list': 'R',
  'routines:save': (p, ctx) =>
    p.folder === undefined || p.folder === null || inDirs(p.folder, scopeIpc(ctx)) ? 'D' : deny('out-of-scope'),
  'routines:delete': routineScoped('M'),
  'routines:toggle': (p, ctx) => (p.enabled === true ? 'D' : routineScoped('M')(p, ctx)), // activar una rutina la deja ejecutándose sola
  'routines:runNow': 'D',
  'routines:history': 'R',
  'routines:preview': 'R',

  // ── Control del PC ──
  'computer:status': 'R',
  'computer:requestPermissions': 'X', // permisos TCC del sistema
  'computer:winConsent': 'X', // el consentimiento de Windows solo se da en el propio PC (nunca desde el celular)
  'computer:auditLog': 'X', // el registro auditable se ve en el PC
  'computer:stop': 'M',
  'computer:resume': 'D',
  'computer:state': 'R',
  'computer:session': 'M',
  'computer:grants': 'R',
  'computer:setGrant': 'D',
  'computer:revokeGrant': 'M',
  'computer:denyApp': 'M',
  'computer:undenyApp': 'D',
  // Solo rechazar/cancelar es M; cualquier concesión de apps o aprobar el plan se confirma en el Mac.
  'computer:respondAccess': (p) => {
    const decisions = Array.isArray(p.decisions) ? p.decisions : []
    const grants = decisions.some((d) => rec(d).decision !== 'deny')
    return grants || p.approvePlan === true ? 'D' : 'M'
  },
  'computer:revokePlan': 'M',
  'computer:approvedPlans': 'R',
  'computer:showMainWindow': 'X',
  'tasks:keepAwakeState': 'R',
  'tasks:keepAwakeSetting': 'M',
  'tasks:keepAwakeActive': 'M',

  // ── Tareas: carpetas vinculadas y de confianza ──
  'tasks:folders:get': scoped('R', 'folder'),
  'tasks:folders:check': scoped('R', 'path'),
  'tasks:folders:link': scoped('D', 'folder'),
  'tasks:folders:unlink': scoped('D', 'folder'),
  'tasks:trusted:list': 'R',
  'tasks:trusted:set': 'D',
  'tasks:trusted:remove': 'D',
  'tasks:policy': 'R',
  // Estado del entorno aislado: lectura. Instalarlo o cancelarlo (descarga, importa una distro) NO es cosa del celular.
  'tasks:sandbox:status': 'R',
  'tasks:sandbox:setup': 'X',
  'tasks:sandbox:cancel': 'X',
  'tasks:activity': 'R',
  'tasks:viewing': scopedOpt('M', 'folder'),
  'tasks:tasks:list': 'R',
  'tasks:tasks:setMeta': scoped('M', 'folder'),
  'tasks:tasks:forget': taskScoped('M'),
  'tasks:prefs:get': 'R',
  'tasks:prefs:set': fieldwise(TASKS_PREF_FIELDS),
  'tasks:storage:report': 'R',
  'tasks:storage:clean': 'D',
  'tasks:storage:cleanScreenshots': 'D',
  'tasks:storage:cleanRestorePoints': 'D',
  'tasks:restore:create': scoped('M', 'folder'),
  'tasks:restore:list': scoped('R', 'folder'),
  'tasks:restore:changes': scoped('R', 'folder'),
  'tasks:restore:apply': scoped('D', 'folder'),
  'tasks:restore:forget': taskScoped('M'),
  'tasks:agentsMd:get': scoped('R', 'folder'),
  'tasks:agentsMd:save': scoped('D', 'folder'),
  'tasks:mcp:list': 'R',
  'tasks:mcp:set': 'X', // D6: nada de MCP desde el celular
  'tasks:rules:list': (p, ctx) => (p.folder === undefined || inDirs(p.folder, scopeIpc(ctx)) ? 'R' : deny('out-of-scope')),
  'tasks:rules:add': scoped('D', 'folder'), // recordar un permiso lo amplía
  'tasks:rules:remove': 'M',
  'tasks:zip': 'X', // guarda en el Mac
  'tasks:quickLook': 'X',
  'tasks:exportMarkdown': 'X',
  'tasks:htmlToPdf': 'X',
  'computer:prefs:get': 'R',
  'computer:prefs:set': (p) => (p.mode === 'full' ? 'D' : mergeFields(COMPUTER_PREF_FIELDS, p)),
  'computer:teachRespond': 'X',
  'computer:record:start': 'X',
  'computer:record:stop': 'X',
  'computer:record:prepare': 'X',
  'tasks:auto:state': 'R',
  'tasks:auto:set': 'D',
  'tasks:auto:revoke': 'M',
  'tasks:auto:clearLog': 'D', // borra el registro de auditoría
  'tasks:auto:consider': 'D',

  // ── extras ──
  'extras:getPrefs': 'R',
  'extras:setPrefs': fieldwise(EXTRAS_PREF_FIELDS),
  'extras:versions': 'R',
  'extras:openArtifact': 'X',
  'extras:downloadHtmlAsPdf': 'X',
  'extras:downloadSlidesAsPptx': 'X',
  'extras:presentSlides': 'X',
  'extras:transcribeAudio': 'X',
  'extras:chatDoc:open': 'X',
  'extras:chatDoc:attach': 'X',
  'extras:chatDoc:close': 'X',
  'extras:downloadChatDoc': 'X',
  'extras:quickSubmit': 'X',
  'extras:quickHide': 'X',
  'extras:quickToggle': 'X',
  'extras:suspendShortcut': 'X',
  'extras:takePendingPrompt': 'X',
  'mcp:getConfig': 'X', // puede traer variables y cabeceras con secretos
  'mcp:save': 'X',
  'mcp:remove': 'X',
  'mcp:setEnabled': 'X',
  'mcp:revealConfig': 'X',
  'mcp:catalog': 'R',
  'mcp:installCatalog': 'X',

  // ── terminal (F1–F3: ninguna) ──
  'pty:create': 'X',
  'pty:write': 'X',
  'pty:resize': 'X',
  'pty:kill': 'X',
  'pty:list': 'X',
  'pty:available': 'X',

  // ── git ──
  'git:isRepo': scoped('R', 'cwd'),
  'git:status': scoped('R', 'cwd'),
  'git:diff': (p, ctx) =>
    !inDirs(p.cwd, scopeIpc(ctx))
      ? deny('out-of-scope')
      : p.path !== undefined && !childOk(p.cwd as string, p.path)
        ? deny('path-escape')
        : 'R',
  'git:branches': scoped('R', 'cwd'),
  'git:currentBranch': scoped('R', 'cwd'),
  'git:worktrees': scoped('R', 'cwd'),
  'git:createWorktree': 'X', // crea una carpeta FUERA del proyecto (`<repo>/../.<repo>-worktrees/<rama>`); el celular no la usa
  'git:removeWorktree': (p, ctx) => (inDirs(p.cwd, scopeIpc(ctx)) && inDirs(p.path, scopeIpc(ctx)) ? 'D' : deny('out-of-scope')),
  'git:commit': scoped('M', 'cwd'),
  'git:log': scoped('R', 'cwd'),
  'git:discard': (p, ctx) => {
    if (!inDirs(p.cwd, scopeIpc(ctx))) return deny('out-of-scope')
    const paths = Array.isArray(p.paths) ? p.paths : []
    if (!paths.every((x) => childOk(p.cwd as string, x))) return deny('path-escape')
    return p.scope === 'all' || paths.length > MAX_DISCARD_FILES ? 'D' : 'M'
  },
  'git:discardHunk': (p, ctx) =>
    !inDirs(p.cwd, scopeIpc(ctx)) ? deny('out-of-scope') : childOk(p.cwd as string, p.path) ? 'M' : deny('path-escape'),
  'git:discardUndo': scoped('M', 'cwd'),

  // ── comparar modelos: ninguno desde el celular (crean carpetas fuera del proyecto y aplican parches al árbol) ──
  'compare:list': 'X',
  'compare:preflight': 'X',
  'compare:start': 'X',
  'compare:cancel': 'X',
  'compare:retry': 'X',
  'compare:diff': 'X',
  'compare:adopt': 'X',
  'compare:discard': 'X',
  'compare:close': 'X',
  'compare:exportBench': 'X',

  // ── diálogos nativos y editores ──
  'dialog:openFolder': 'X',
  'dialog:revealInFinder': 'X',
  'dialog:openInEditor': 'X',
  'editors:list': scoped('R', 'cwd'),
  'editors:open': 'X',

  // ── archivos ──
  'files:watch': scoped('R', 'folder'),
  'files:setDirs': (p, ctx) => {
    const dirs = Array.isArray(p.dirs) ? p.dirs : []
    const ok = dirs.every((d) =>
      isStr(d) && isAbsolute(d) ? inDirs(d, scopeIpc(ctx)) : isStr(d) && !d.includes('\0') && !d.split(/[\\/]/).includes('..')
    )
    return ok ? 'R' : deny('out-of-scope')
  },
  'files:unwatch': 'R',
  'files:create': (p, ctx) => {
    if (!inDirs(p.cwd, scopeIpc(ctx))) return deny('out-of-scope')
    if (!childOk(p.cwd, p.parent === '' ? '.' : p.parent)) return deny('path-escape')
    return isStr(p.name) && !/[\\/\0]/.test(p.name) && p.name !== '..' && p.name !== '.' ? 'M' : deny('name-invalid')
  },
  'files:rename': (p, ctx) => {
    if (!inDirs(p.cwd, scopeIpc(ctx))) return deny('out-of-scope')
    if (!childOk(p.cwd, p.path)) return deny('path-escape')
    if (!isStr(p.name) || /[\\/\0]/.test(p.name) || p.name === '..' || p.name === '.') return deny('name-invalid')
    return ctx.isDirectory?.(isAbsolute(p.path as string) ? (p.path as string) : resolve(p.cwd, p.path as string)) === false ? 'M' : 'D'
  },
  'files:trash': (p, ctx) => {
    if (!inDirs(p.cwd, scopeIpc(ctx))) return deny('out-of-scope')
    if (!childOk(p.cwd, p.path)) return deny('path-escape')
    return ctx.isDirectory?.(isAbsolute(p.path as string) ? (p.path as string) : resolve(p.cwd, p.path as string)) === false ? 'M' : 'D'
  },

  // ── navegador integrado ──
  'browser:state': browserOwned('R'),
  'browser:attach': 'X', // vista nativa del Mac
  'browser:detach': 'X',
  'browser:newTab': browserOwned('M'),
  'browser:closeTab': browserOwned('M'),
  'browser:selectTab': browserOwned('M'),
  'browser:navigate': browserOwned('M'),
  'browser:history': browserOwned('M'),
  // Pausar/detener reduce; reanudar el agente amplía.
  'browser:agent': (p, ctx) => (!browserOwnerOk(p, ctx) ? deny('out-of-scope') : p.action === 'resume' ? 'D' : 'M'),
  'browser:pick': 'X',
  'browser:capture': browserOwned('R'),
  'browser:toChat': browserOwned('M'),
  // Solo denegar es M; cualquier permiso a un sitio se confirma en el Mac.
  'browser:respond': (p) => (p.decision === 'deny' ? 'M' : 'D'),
  'browser:popOut': 'X',
  'browser:setViewMode': 'X',
  'browser:openExternal': 'X',
  'browser:devServers': 'X',
  'browser:sites:get': 'X',
  'browser:sites:setPrefs': 'X',
  'browser:sites:remove': 'X',
  'browser:sites:undeny': 'X',
  'browser:sites:removeLocal': 'X',
  'browser:clearData': 'X',

  // ── control remoto: el celular jamás se administra a sí mismo (ni desde el onboarding) ──
  'remote:getState': 'X',
  'remote:start': 'X',
  'remote:newPairing': 'X',
  'remote:stop': 'X',
  'remote:confirmPair': 'X',
  'remote:revoke': 'X',
  'remote:confirmAction': 'X', // solo la ventana principal del Mac confirma
  'remote:setRemember': 'X',
  'remote:setConfirmEach': 'X',
  'remote:resetPin': 'X',
  'remote:revokeAll': 'X',
  'remote:setDeviceTtl': 'X',
  'remote:setConnection': 'X', // salir de casa solo se enciende en el Mac
  'remote:setAway': 'X',
  'remote:travelInstall': 'X', // descargar un binario solo se decide en el Mac, con diálogo de consentimiento
  'remote:setTravelKeep': 'X', // cuánto dura el túnel solo se decide en el Mac
  'remote:auditList': 'X',
  'remote:setApproveCommands': 'X' // aprobar comandos desde un celular solo se enciende en el Mac, con confirmación propia
}

// ─────────────────────────────── eventos ───────────────────────────────

/** `allow` = tal cual; `sanitize` = tras recortar (rutas fuera del ámbito, credenciales, texto largo); `deny` = no se reenvía. */
export type EventPolicy = 'allow' | 'sanitize' | 'deny'

export const CELULAR_EVENTS: Record<string, EventPolicy> = {
  'opencode:status': 'allow',
  'opencode:connection': 'sanitize', // `baseUrl`/`authorization` reescritos por el puente
  'settings:changed': 'sanitize', // sin `opencodeBin` ni carpetas fuera del ámbito
  'app:openTarget': 'deny',
  'app:updateState': 'allow',
  'app:updateProgress': 'allow',
  'pty:data': 'deny',
  'pty:exit': 'deny',
  'files:changed': 'sanitize', // solo rutas del ámbito
  'compare:changed': 'deny', // trae rutas de worktrees y ramas
  'tasks:server': 'sanitize', // trae credenciales del motor de la tarea
  'routines:changed': 'allow',
  'routines:run': 'allow',
  'computer:action': 'deny', // capturas de pantalla
  'computer:stopped': 'allow',
  'computer:killState': 'allow',
  'computer:overlay': 'deny',
  'computer:accessRequest': 'sanitize',
  'computer:accessResolved': 'allow',
  'computer:planState': 'allow',
  'tasks:networkBlocked': 'allow',
  'tasks:activity': 'allow',
  'tasks:sandbox:progress': 'deny',
  'computer:assist': 'deny',
  'computer:recordDone': 'deny',
  'tasks:auto:approved': 'allow',
  'tasks:learn:pending:changed': 'deny', // propuestas de memoria/skill, aunque ya sin el bloque crudo: revisión solo en el Mac
  'tasks:viewer:event': 'deny', // avisos de una vista nativa de la ventana: no existe en el celular
  'extras:quick-prompt': 'deny',
  'extras:new-conversation': 'deny',
  'extras:open-settings': 'deny',
  'extras:prefs-changed': 'deny',
  'extras:quick-shown': 'deny',
  'mcp:changed': 'deny',
  'extras:chatDoc:event': 'deny', // avisos de una vista nativa de la ventana: no existe en el celular
  'extras:voiceModelProgress': 'deny', // dictado por voz: el celular no graba del micrófono del Mac
  'browser:state': 'sanitize',
  'browser:approval': 'sanitize',
  'browser:approvalDone': 'allow',
  'browser:picked': 'deny',
  'browser:reveal': 'deny',
  'browser:shortcut': 'deny',
  'browser:toChat': 'deny',
  'browser:sites': 'deny',
  'remote:changed': 'deny',
  'remote:pairRequest': 'deny',
  'remote:confirmRequest': 'deny', // solo la ventana principal del Mac
  'remote:confirmDismiss': 'deny'
}

/** Política de un evento IPC para el celular (denegar por defecto). */
export function eventPolicy(channel: string): EventPolicy {
  if (channel.startsWith('remote:')) return 'deny'
  return Object.hasOwn(CELULAR_EVENTS, channel) ? (CELULAR_EVENTS[channel] ?? 'deny') : 'deny'
}

// ─────────────────────────────── HTTP (motor OpenCode) ───────────────────────────────

interface HttpArg {
  req: Extract<PolicyRequest, { kind: 'http' }>
  params: Record<string, string>
}
type HttpSpec = PolicyClass | ((h: HttpArg, ctx: PolicyContext) => Outcome)

const directoryOf = (h: HttpArg): string | undefined => (isStr(h.req.query?.directory) ? h.req.query.directory : undefined)

/** `directory` obligatorio y dentro del ámbito; si la sesión es conocida, su directorio debe coincidir. */
function httpScope(h: HttpArg, ctx: PolicyContext, required = true): Outcome | undefined {
  const d = directoryOf(h)
  if (d === undefined) return required ? deny('directory-required') : undefined
  if (!inDirs(d, scopeHttp(ctx))) return deny('out-of-scope')
  const sid = h.params.sessionID
  if (sid && ctx.sessionDir) {
    const sd = ctx.sessionDir(sid)
    if (sd === undefined) return deny('session-unknown')
    if (!sameDir(sd, d)) return deny('out-of-scope')
  }
  return undefined
}

/** Lectura/mutación simple acotada a `directory`. */
const httpScoped =
  (cls: PolicyClass): HttpSpec =>
  (h, ctx) =>
    httpScope(h, ctx) ?? cls

/** Lectura sin `directory` obligatorio (si viene, debe estar en el ámbito). */
const httpGlobal =
  (cls: PolicyClass): HttpSpec =>
  (h, ctx) =>
    httpScope(h, ctx, false) ?? cls

/** Lectura de archivos del proyecto: el `path` (relativo) no puede escapar del `directory`. */
const httpFileRead: HttpSpec = (h, ctx) => {
  const s = httpScope(h, ctx)
  if (s) return s
  const p = h.req.query?.path
  if (p !== undefined && !childOk(directoryOf(h) as string, p === '' ? '.' : p)) return deny('path-escape')
  return 'R'
}

const ALLOWED_AGENTS: ReadonlySet<string> = new Set(['chat', 'plan', 'build', 'tasks', 'computer'])

function agentOutcome(agent: unknown, dir: string, ctx: PolicyContext): Outcome | undefined {
  if (!isStr(agent) || !ALLOWED_AGENTS.has(agent)) return deny('agent-forbidden')
  const isChatDir = (ctx.chatDirs ?? []).some((c) => isInside(c, dir))
  if (isChatDir && agent !== 'chat') return deny('agent-not-chat')
  if (agent === 'computer' && !(ctx.fullAccessDirs ?? []).some((f) => sameDir(f, dir))) return deny('computer-agent-unconfirmed')
  return undefined
}

const MAX_PARTS = 100
const DATA_URL_RE = /^data:[A-Za-z0-9.+/-]+(;[A-Za-z0-9=._-]+)*;base64,/
const hasOnly = (o: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k))

/**
 * Ruta del `pathname` de un `file:` URL. En Windows `pathToFileURL('C:\\x')` da `file:///C:/x` (pathname `/C:/x`): se quita la
 * barra inicial para que `resolve` no lo trate como `C:\\C:\\x` y rechace TODO adjunto legítimo. La plataforma se inyecta
 * para probarlo en el Mac; en macOS/Linux la ruta es la decodificada tal cual.
 */
export function fileUrlPath(pathname: string, platform: NodeJS.Platform = process.platform): string {
  const d = decodeURIComponent(pathname)
  return platform === 'win32' && /^\/[A-Za-z]:(\/|\\|$)/.test(d) ? d.slice(1) : d
}

/** Partes de un prompt: texto y archivos `data:`; `file://` solo bajo el directorio de la sesión y nunca en Chat. */
function partsOutcome(parts: unknown, dir: string, isChat: boolean): Outcome | undefined {
  if (!Array.isArray(parts) || parts.length === 0 || parts.length > MAX_PARTS) return deny('parts-invalid')
  for (const raw of parts) {
    const part = rec(raw)
    if (part.type === 'text') {
      if (!hasOnly(part, ['type', 'text']) || !isStr(part.text)) return deny('parts-invalid')
    } else if (part.type === 'file') {
      if (!hasOnly(part, ['type', 'mime', 'filename', 'url', 'source']) || !isStr(part.url)) return deny('parts-invalid')
      if (part.url.startsWith('data:')) {
        if (!DATA_URL_RE.test(part.url)) return deny('part-url-invalid')
      } else if (part.url.startsWith('file:')) {
        if (isChat) return deny('file-url-chat')
        let target: string
        try {
          const u = new URL(part.url)
          if (u.protocol !== 'file:' || u.host !== '') return deny('part-url-invalid')
          target = fileUrlPath(u.pathname)
        } catch {
          return deny('part-url-invalid')
        }
        if (target.includes('\0') || !isInside(dir, target)) return deny('file-url-out-of-scope')
      } else {
        return deny('part-url-scheme')
      }
      if (part.source !== undefined) {
        const src = rec(part.source)
        if (isStr(src.path) && (isChat || !isInside(dir, src.path))) return deny('file-url-out-of-scope')
      }
    } else {
      return deny('part-type')
    }
  }
  return undefined
}

const PROMPT_KEYS = ['messageID', 'model', 'agent', 'variant', 'parts'] as const

const promptAsync: HttpSpec = (h, ctx) => {
  const s = httpScope(h, ctx)
  if (s) return s
  const dir = directoryOf(h) as string
  const body = rec(h.req.body)
  if (!hasOnly(body, PROMPT_KEYS)) return deny('body-field-forbidden')
  const a = agentOutcome(body.agent, dir, ctx)
  if (a) return a
  if (body.model !== undefined) {
    const m = modelOutcome(body.model, ctx)
    if (m) return m
  }
  const isChat = body.agent === 'chat' || (ctx.chatDirs ?? []).some((c) => isInside(c, dir))
  return partsOutcome(body.parts, dir, isChat) ?? 'M'
}

const sessionCreate: HttpSpec = (h, ctx) => {
  const s = httpScope(h, ctx)
  if (s) return s
  const dir = directoryOf(h) as string
  const body = rec(h.req.body)
  if (!hasOnly(body, ['title', 'parentID', 'agent', 'metadata', 'permission'])) return deny('body-field-forbidden')
  if (body.agent !== undefined) {
    const a = agentOutcome(body.agent, dir, ctx)
    if (a) return a
  } else if ((ctx.chatDirs ?? []).some((c) => isInside(c, dir))) {
    return deny('agent-not-chat')
  }
  // Un conjunto de permisos propio puede ampliarlos (aceptar todo): se confirma en el Mac.
  return body.permission !== undefined ? 'D' : 'M'
}

const sessionUpdate: HttpSpec = (h, ctx) => {
  const s = httpScope(h, ctx)
  if (s) return s
  const body = rec(h.req.body)
  if (!hasOnly(body, ['title', 'time', 'metadata', 'permission'])) return deny('body-field-forbidden')
  if (body.time !== undefined && !hasOnly(rec(body.time), ['archived'])) return deny('body-field-forbidden')
  if (body.metadata !== undefined && !hasOnly(rec(body.metadata), ['unarchivedAt'])) return deny('body-field-forbidden')
  return body.permission !== undefined ? 'D' : 'M'
}

const sessionCommand: HttpSpec = (h, ctx) => {
  const s = httpScope(h, ctx)
  if (s) return s
  const body = rec(h.req.body)
  if (!hasOnly(body, ['command', 'arguments', 'agent', 'model', 'variant', 'messageID'])) return deny('body-field-forbidden')
  if (!isStr(body.command)) return deny('body-invalid')
  const a = agentOutcome(body.agent, directoryOf(h) as string, ctx)
  if (a) return a
  if (body.model !== undefined) {
    const m = modelOutcome(body.model, ctx)
    if (m) return m
  }
  return 'M'
}

const sessionSummarize: HttpSpec = (h, ctx) => {
  const s = httpScope(h, ctx)
  if (s) return s
  const body = rec(h.req.body)
  if (!hasOnly(body, ['providerID', 'modelID', 'auto'])) return deny('body-field-forbidden')
  if (body.providerID !== undefined || body.modelID !== undefined) {
    const m = modelOutcome({ providerID: body.providerID, modelID: body.modelID }, ctx)
    if (m) return m
  }
  return 'M'
}

const sessionRevert: HttpSpec = (h, ctx) => {
  const s = httpScope(h, ctx)
  if (s) return s
  return hasOnly(rec(h.req.body), ['messageID', 'partID']) ? 'M' : deny('body-field-forbidden')
}

const sessionFork: HttpSpec = (h, ctx) => {
  const s = httpScope(h, ctx)
  if (s) return s
  return hasOnly(rec(h.req.body), ['messageID']) ? 'M' : deny('body-field-forbidden')
}

const questionAnswer: HttpSpec = (h, ctx) => {
  const s = httpScope(h, ctx)
  if (s) return s
  return hasOnly(rec(h.req.body), ['answers']) ? 'M' : deny('body-field-forbidden')
}

/**
 * Permisos de OpenCode cuyo `once` es una mutación normal; cualquier otro (o desconocido) se confirma en el Mac. `bash`, `edit`,
 * `webfetch`, `task` y `external_directory` NO están: ejecutan código, escriben o salen de la carpeta (hallazgo 2), así que su
 * `once` es D salvo `bash`/`edit` con «Aprobar comandos desde este celular» encendido y pasando la lista de denegación.
 */
export const ONCE_SAFE_PERMISSIONS: ReadonlySet<string> = new Set([
  'read',
  'glob',
  'grep',
  'list',
  'websearch',
  'codesearch',
  'skill',
  'todowrite',
  'todoread',
  'lsp'
])

const permissionReply: HttpSpec = (h, ctx) => {
  const s = httpScope(h, ctx)
  if (s) return s
  const body = rec(h.req.body)
  if (!hasOnly(body, ['reply', 'response', 'message'])) return deny('body-field-forbidden')
  const reply = body.reply ?? body.response
  if (reply === 'reject') return 'M'
  if (reply !== 'once') return deny('permission-always') // `always` (y cualquier otro valor) nunca desde el celular
  const id = h.params.requestID ?? h.params.permissionID
  const kind = id ? ctx.permissionKind?.(id) : undefined
  if (id && (kind === 'bash' || kind === 'edit') && ctx.canApproveCommands === true) {
    // Con el ajuste encendido solo pasa lo que la lista de denegación deja, evaluada sobre el texto que pidió el motor; ante duda, D.
    const dir = directoryOf(h)
    if (dir !== undefined) {
      const env = { sessionDir: dir, ...(ctx.home ? { home: ctx.home } : {}), ...(ctx.realpath ? { realpath: ctx.realpath } : {}) }
      if (approvalVerdict(kind, ctx.permissionText?.(id), env) === null) return { approve: true }
    }
    return 'D'
  }
  return kind !== undefined && ONCE_SAFE_PERMISSIONS.has(kind) ? 'M' : 'D'
}

/** Rutas del motor que NO usa el renderer del celular (X explícito: ver la prueba de cobertura contra `api-routes.json`). */
const HTTP_X_ROUTES = [
  // API nueva (`/api/*`): el renderer no la usa
  'DELETE /api/credential/{credentialID}',
  'DELETE /api/integration/attempt/{attemptID}',
  'DELETE /api/permission/saved/{id}',
  'DELETE /api/pty/{ptyID}',
  'GET /api/agent',
  'GET /api/command',
  'GET /api/event',
  'GET /api/fs/find',
  'GET /api/fs/list',
  'GET /api/fs/read/*',
  'GET /api/health',
  'GET /api/integration',
  'GET /api/integration/attempt/{attemptID}',
  'GET /api/integration/{integrationID}',
  'GET /api/location',
  'GET /api/model',
  'GET /api/permission/request',
  'GET /api/permission/saved',
  'GET /api/provider',
  'GET /api/provider/{providerID}',
  'GET /api/pty',
  'GET /api/pty/{ptyID}',
  'GET /api/pty/{ptyID}/connect',
  'GET /api/question/request',
  'GET /api/reference',
  'GET /api/session',
  'GET /api/session/active',
  'GET /api/session/{sessionID}',
  'GET /api/session/{sessionID}/context',
  'GET /api/session/{sessionID}/event',
  'GET /api/session/{sessionID}/history',
  'GET /api/session/{sessionID}/message',
  'GET /api/session/{sessionID}/message/{messageID}',
  'GET /api/session/{sessionID}/permission',
  'GET /api/session/{sessionID}/permission/{requestID}',
  'GET /api/session/{sessionID}/question',
  'GET /api/skill',
  'PATCH /api/credential/{credentialID}',
  'POST /api/integration/attempt/{attemptID}/complete',
  'POST /api/integration/{integrationID}/connect/key',
  'POST /api/integration/{integrationID}/connect/oauth',
  'POST /api/pty',
  'POST /api/pty/{ptyID}/connect-token',
  'POST /api/session',
  'POST /api/session/{sessionID}/agent',
  'POST /api/session/{sessionID}/compact',
  'POST /api/session/{sessionID}/interrupt',
  'POST /api/session/{sessionID}/model',
  'POST /api/session/{sessionID}/permission',
  'POST /api/session/{sessionID}/permission/{requestID}/reply',
  'POST /api/session/{sessionID}/prompt',
  'POST /api/session/{sessionID}/question/{requestID}/reject',
  'POST /api/session/{sessionID}/question/{requestID}/reply',
  'POST /api/session/{sessionID}/revert/clear',
  'POST /api/session/{sessionID}/revert/commit',
  'POST /api/session/{sessionID}/revert/stage',
  'POST /api/session/{sessionID}/wait',
  'PUT /api/pty/{ptyID}',
  // credenciales y proveedores (`auth.set/remove`, `provider.auth`)
  'DELETE /auth/{providerID}',
  'PUT /auth/{providerID}',
  'GET /provider/auth',
  'POST /provider/{providerID}/oauth/authorize',
  'POST /provider/{providerID}/oauth/callback',
  // configuración y ciclo de vida del motor
  'GET /config',
  'PATCH /config',
  'GET /global/config',
  'PATCH /global/config',
  'POST /global/dispose',
  'POST /global/upgrade',
  'POST /instance/dispose',
  'POST /log',
  // terminal y TUI
  'DELETE /pty/{ptyID}',
  'GET /pty',
  'GET /pty/shells',
  'GET /pty/{ptyID}',
  'GET /pty/{ptyID}/connect',
  'POST /pty',
  'POST /pty/{ptyID}/connect-token',
  'PUT /pty/{ptyID}',
  'GET /tui/control/next',
  'POST /tui/append-prompt',
  'POST /tui/clear-prompt',
  'POST /tui/control/response',
  'POST /tui/execute-command',
  'POST /tui/open-help',
  'POST /tui/open-models',
  'POST /tui/open-sessions',
  'POST /tui/open-themes',
  'POST /tui/publish',
  'POST /tui/select-session',
  'POST /tui/show-toast',
  'POST /tui/submit-prompt',
  // MCP (D6)
  'DELETE /mcp/{name}/auth',
  'GET /mcp',
  'POST /mcp',
  'POST /mcp/{name}/auth',
  'POST /mcp/{name}/auth/authenticate',
  'POST /mcp/{name}/auth/callback',
  'POST /mcp/{name}/connect',
  'POST /mcp/{name}/disconnect',
  // experimentales (espacios de trabajo, worktrees, consola, herramientas)
  'DELETE /experimental/project/{projectID}/copy',
  'DELETE /experimental/workspace/{id}',
  'DELETE /experimental/worktree',
  'GET /experimental/capabilities',
  'GET /experimental/console',
  'GET /experimental/console/orgs',
  'GET /experimental/resource',
  'GET /experimental/tool',
  'GET /experimental/tool/ids',
  'GET /experimental/workspace',
  'GET /experimental/workspace/adapter',
  'GET /experimental/workspace/status',
  'GET /experimental/worktree',
  'POST /experimental/console/switch',
  'POST /experimental/control-plane/move-session',
  'POST /experimental/project/{projectID}/copy',
  'POST /experimental/project/{projectID}/copy/generate-name',
  'POST /experimental/project/{projectID}/copy/refresh',
  'POST /experimental/session/{sessionID}/background',
  'POST /experimental/workspace',
  'POST /experimental/workspace/sync-list',
  'POST /experimental/workspace/warp',
  'POST /experimental/worktree',
  'POST /experimental/worktree/reset',
  // proyectos, rutas del sistema, sincronización, herramientas del editor
  'GET /path',
  'GET /project',
  'GET /project/current',
  'GET /project/{projectID}/directories',
  'PATCH /project/{projectID}',
  'POST /project/git/init',
  'GET /formatter',
  'GET /lsp',
  'POST /sync/history',
  'POST /sync/replay',
  'POST /sync/start',
  'POST /sync/steal',
  'POST /vcs/apply',
  // sesión: lo que el celular no necesita o es más amplio que `prompt_async`
  'DELETE /session/{sessionID}/message/{messageID}',
  'DELETE /session/{sessionID}/message/{messageID}/part/{partID}',
  'DELETE /session/{sessionID}/share',
  'PATCH /session/{sessionID}/message/{messageID}/part/{partID}',
  'POST /session/{sessionID}/init',
  'POST /session/{sessionID}/message',
  'POST /session/{sessionID}/share',
  'POST /session/{sessionID}/shell'
] as const

/**
 * Tabla HTTP: `MÉTODO /ruta/{param}` del motor (versión fijada en `resources/opencode-bin/api-routes.json`) → clase.
 * En comentarios, el método del SDK v2 que la usa el renderer.
 */
export const CELULAR_HTTP_POLICY: Record<string, HttpSpec> = {
  ...Object.fromEntries(HTTP_X_ROUTES.map((r) => [r, 'X' as HttpSpec])),
  // lecturas (Chat y Code)
  'GET /session': httpScoped('R'), // session.list
  'GET /session/status': httpScoped('R'), // session.status
  'GET /session/{sessionID}': httpScoped('R'), // session.get
  'GET /session/{sessionID}/children': httpScoped('R'), // session.children
  'GET /session/{sessionID}/diff': httpScoped('R'), // session.diff
  'GET /session/{sessionID}/message': httpScoped('R'), // session.messages
  'GET /session/{sessionID}/message/{messageID}': httpScoped('R'), // session.message
  'GET /session/{sessionID}/todo': httpScoped('R'), // session.todo
  'GET /experimental/session': httpGlobal('R'), // experimental.session.list (el motor lista de todos los proyectos: T4 filtra la respuesta por ámbito)
  'GET /provider': httpGlobal('R'), // provider.list
  'GET /config/providers': httpGlobal('R'), // config.providers
  'GET /permission': httpScoped('R'), // permission.list
  'GET /question': httpScoped('R'), // question.list
  'GET /agent': httpGlobal('R'),
  'GET /command': httpGlobal('R'),
  'GET /skill': httpGlobal('R'),
  'GET /file': httpFileRead, // file.list
  'GET /file/content': httpFileRead, // file.read
  'GET /file/status': httpScoped('R'), // file.status
  'GET /find': httpScoped('R'), // find.text
  'GET /find/file': httpScoped('R'), // find.files
  'GET /find/symbol': httpScoped('R'), // find.symbols
  'GET /vcs': httpScoped('R'),
  'GET /vcs/diff': httpScoped('R'),
  'GET /vcs/diff/raw': httpScoped('R'),
  'GET /vcs/status': httpScoped('R'),
  'GET /event': httpGlobal('R'), // SSE (T4 filtra por ámbito)
  'GET /global/event': httpGlobal('R'), // global.event (SSE)
  'GET /global/health': 'R',
  // mutaciones acotadas
  'POST /session': sessionCreate, // session.create
  'PATCH /session/{sessionID}': sessionUpdate, // session.update (título/archivar; `permission` = D)
  'DELETE /session/{sessionID}': httpScoped('M'), // session.delete (una)
  'POST /session/{sessionID}/prompt_async': promptAsync, // session.promptAsync
  'POST /session/{sessionID}/command': sessionCommand, // session.command (Code)
  'POST /session/{sessionID}/abort': httpScoped('M'), // session.abort
  'POST /session/{sessionID}/revert': sessionRevert, // session.revert
  'POST /session/{sessionID}/unrevert': httpScoped('M'), // session.unrevert
  'POST /session/{sessionID}/summarize': sessionSummarize, // session.summarize
  'POST /session/{sessionID}/fork': sessionFork, // session.fork
  'POST /question/{requestID}/reply': questionAnswer, // question.reply
  'POST /question/{requestID}/reject': httpScoped('M'), // question.reject
  'POST /permission/{requestID}/reply': permissionReply, // permission.reply
  'POST /session/{sessionID}/permissions/{permissionID}': permissionReply // versión antigua de permission.reply
}

interface RouteEntry {
  key: string
  method: string
  segs: string[]
  wildcard: boolean
  params: number
  spec: HttpSpec
}

const ROUTES: RouteEntry[] = Object.entries(CELULAR_HTTP_POLICY)
  .map(([key, spec]) => {
    const [method = '', tpl = ''] = key.split(' ')
    const segs = tpl.split('/').filter(Boolean)
    return { key, method, segs, wildcard: segs[segs.length - 1] === '*', params: segs.filter((s) => s.startsWith('{')).length, spec }
  })
  // Lo más específico primero (`/session/status` antes que `/session/{sessionID}`).
  .sort((a, b) => a.params - b.params)

const SEG_RE = /^[A-Za-z0-9_.:-]{1,200}$/

/** Busca la entrada de una ruta concreta; `undefined` = ruta desconocida. */
function matchRoute(method: string, path: string): { entry: RouteEntry; params: Record<string, string> } | undefined {
  if (!path.startsWith('/') || /[\0?#\\]|%2e|%2f|%5c|\/\//i.test(path)) return undefined
  const segs = path.split('/').filter(Boolean)
  if (segs.some((s) => s === '.' || s === '..')) return undefined
  for (const entry of ROUTES) {
    if (entry.method !== method) continue
    const fixed = entry.wildcard ? entry.segs.length - 1 : entry.segs.length
    if (entry.wildcard ? segs.length < fixed : segs.length !== fixed) continue
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < fixed && ok; i++) {
      const t = entry.segs[i] as string
      const s = segs[i] as string
      if (t.startsWith('{')) {
        if (!SEG_RE.test(s)) ok = false
        else params[t.slice(1, -1)] = s
      } else if (t !== s) ok = false
    }
    if (ok) return { entry, params }
  }
  return undefined
}

// ─────────────────────────────── resúmenes para la confirmación ───────────────────────────────

interface SummaryExtra {
  ctx: PolicyContext
  params: Record<string, string>
}
type Summary = (p: Record<string, unknown>, home: string, x: SummaryExtra) => { text: RemoteText; detail: string[] }

/** `{permission, pattern, action}[]` (o cualquier forma) → una línea por regla, para ver qué se concede. */
function ruleLines(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((r) => {
      const o = rec(r)
      return isStr(o.action) || isStr(o.permission) || isStr(o.pattern)
        ? `${String(o.action ?? '?')} ${String(o.permission ?? '?')} ${String(o.pattern ?? '*')}`
        : JSON.stringify(r)
    })
  }
  return v === undefined ? [] : [JSON.stringify(v)]
}

function scheduleLine(s: unknown): string {
  const o = rec(s)
  switch (o.kind) {
    case 'daily':
      return `cada día ${String(o.time)}`
    case 'weekly':
      return `cada semana (día ${String(o.day)}) ${String(o.time)}`
    case 'interval':
      return `cada ${String(o.hours)} h`
    case 'cron':
      return `cron ${String(o.expr)}`
    default:
      return JSON.stringify(s) ?? ''
  }
}

const folderLine = (p: Record<string, unknown>, key: string, home: string): string[] => (isStr(p[key]) ? [tilde(p[key], home)] : [])
const t = (es: string, en: string): RemoteText => ({ es, en })

/** Resumen legible (es/en) de cada acción D. Las claves son canales IPC o `MÉTODO /ruta`. */
export const CELULAR_SUMMARIES: Record<string, Summary> = {
  'app:updateDownload': () => ({ text: t('Descargar la actualización de Lazunox', 'Download the Lazunox update'), detail: [] }),
  'app:updateInstall': () => ({
    text: t('Reiniciar el Mac para instalar la actualización de Lazunox', 'Restart Lazunox to install the update'),
    detail: []
  }),
  'opencode:restart': () => ({
    text: t('Reiniciar el motor de Lazunox (corta lo que se esté ejecutando)', 'Restart the Lazunox engine (stops whatever is running)'),
    detail: []
  }),
  'settings:set': (p) => ({
    text: t('Cambiar las instrucciones globales de las tareas', 'Change the global task instructions'),
    detail: previewText(p.tasksGlobalInstructions)
  }),
  'settings:addRecentFolder': (p, h) => ({
    text: t('Añadir una carpeta a las recientes', 'Add a folder to the recent list'),
    detail: folderLine(p, 'path', h)
  }),
  'tasks:approveFolder': (p, h) => ({
    text: t('Aprobar una carpeta para Tareas', 'Approve a folder for Tasks'),
    detail: folderLine(p, 'folder', h)
  }),
  'tasks:start': (p, h) => ({
    text: t('Iniciar una tarea con control total del Mac', 'Start a task with full control of the Mac'),
    detail: folderLine(p, 'folder', h)
  }),
  'tasks:grantFullAccess': (p, h) => ({
    text: t('Dar control total a una carpeta', 'Grant full control to a folder'),
    detail: folderLine(p, 'folder', h)
  }),
  'tasks:fullAccess:consent': () => ({ text: t('Aceptar el aviso de control total', 'Accept the full-control notice'), detail: [] }),
  'tasks:project:save': (p, h) => ({
    text: t('Cambiar las instrucciones o enlaces de un proyecto', "Change a project's instructions or links"),
    detail: [
      ...folderLine(p, 'folder', h),
      ...previewText(p.instructions),
      ...(Array.isArray(p.links) ? p.links.map((l) => `enlace: ${isStr(l) ? l : JSON.stringify(l)}`) : [])
    ]
  }),
  'tasks:memory:save': (p, h) => ({
    text: t('Reescribir la memoria de un proyecto', "Rewrite a project's memory"),
    detail: [...folderLine(p, 'folder', h), ...previewText(p.content)]
  }),
  'tasks:memory:delete': (p, h) => ({
    text: t('Borrar la memoria de un proyecto', "Delete a project's memory"),
    detail: folderLine(p, 'folder', h)
  }),
  'tasks:network:setToggle': (p) => ({
    text: t('Cambiar el acceso a la red de las tareas', 'Change the network access of tasks'),
    detail: [`${String(p.key)} = ${String(p.value)}`]
  }),
  'tasks:network:setHost': (p) => ({
    text: t('Cambiar un sitio permitido en la red de las tareas', 'Change an allowed site on the task network'),
    detail: [`${String(p.host)}: ${String(p.decision)}`]
  }),
  'tasks:network:allowOnce': (p, h) => ({
    text: t('Permitir un sitio una vez a una tarea', 'Allow a site once for a task'),
    detail: [String(p.host), ...folderLine(p, 'folder', h)]
  }),
  'tasks:deleteGrant:set': (p, h) => ({
    text:
      p.allowed === true
        ? t('Permitir que las tareas borren archivos', 'Allow tasks to delete files')
        : t('Quitar el permiso de borrar archivos', 'Remove the permission to delete files'),
    detail: folderLine(p, 'folder', h)
  }),
  'routines:save': (p, h) => ({
    text: t('Crear o cambiar una rutina que se ejecuta sola', 'Create or change a routine that runs on its own'),
    detail: [
      String(p.name ?? ''),
      ...folderLine(p, 'folder', h),
      `${scheduleLine(p.schedule)}${p.enabled === false ? ' (apagada)' : ''}`,
      ...(p.fullAccess === true ? [t('Con control total', 'With full control').es] : []),
      ...previewText(p.prompt, 6, 200),
      ...(Array.isArray(p.allowHosts) && p.allowHosts.length > 0 ? [`sitios permitidos: ${p.allowHosts.map(String).join(', ')}`] : []),
      ...(Array.isArray(p.allow) && p.allow.length > 0 ? [`permisos fijos: ${p.allow.map((r) => ruleLines([r])[0]).join('; ')}`] : [])
    ]
  }),
  'routines:toggle': () => ({ text: t('Activar una rutina', 'Turn a routine on'), detail: [] }),
  'routines:runNow': () => ({ text: t('Ejecutar una rutina ahora', 'Run a routine now'), detail: [] }),
  'computer:resume': () => ({ text: t('Reanudar el control del Mac', 'Resume control of the Mac'), detail: [] }),
  'computer:setGrant': (p) => ({
    text: t('Dar acceso a una app del Mac', 'Grant access to a Mac app'),
    detail: [`${String(p.name)} (${String(p.tier)})`]
  }),
  'computer:undenyApp': (p) => ({ text: t('Dejar de bloquear una app', 'Stop blocking an app'), detail: [String(p.bundleId)] }),
  'computer:respondAccess': (p) => ({
    text: t('Conceder acceso a apps o aprobar un plan en el Mac', 'Grant app access or approve a plan on the Mac'),
    detail: (Array.isArray(p.decisions) ? p.decisions : [])
      .filter((d) => rec(d).decision !== 'deny')
      .map((d) => `${String(rec(d).name)} (${String(rec(d).decision)})`)
  }),
  'tasks:folders:link': (p, h) => ({
    text: t('Vincular otra carpeta a un proyecto', 'Link another folder to a project'),
    detail: [...folderLine(p, 'folder', h), ...folderLine(p, 'path', h), String(p.mode)]
  }),
  'tasks:folders:unlink': (p, h) => ({
    text: t('Desvincular una carpeta de un proyecto', 'Unlink a folder from a project'),
    detail: [...folderLine(p, 'folder', h), ...folderLine(p, 'path', h)]
  }),
  'tasks:trusted:set': (p, h) => ({
    text: t('Marcar una carpeta como de confianza', 'Mark a folder as trusted'),
    detail: [...folderLine(p, 'path', h), String(p.mode)]
  }),
  'tasks:trusted:remove': (p, h) => ({
    text: t('Quitar una carpeta de confianza', 'Remove a trusted folder'),
    detail: folderLine(p, 'path', h)
  }),
  'tasks:prefs:set': (p) => ({
    text: t(
      'Cambiar la política de las tareas (archivado, servidores o inactividad)',
      'Change the task policy (archiving, servers or idle time)'
    ),
    detail: Object.keys(p)
  }),
  'tasks:storage:clean': () => ({ text: t('Borrar el almacenamiento de un proyecto', "Delete a project's storage"), detail: [] }),
  'tasks:storage:cleanScreenshots': () => ({ text: t('Borrar las capturas de las tareas', 'Delete task screenshots'), detail: [] }),
  'tasks:storage:cleanRestorePoints': () => ({ text: t('Borrar los puntos de restauración', 'Delete restore points'), detail: [] }),
  'tasks:restore:apply': (p, h) => ({
    text: t('Restaurar archivos a un punto anterior', 'Restore files to an earlier point'),
    detail: [...folderLine(p, 'folder', h), Array.isArray(p.paths) ? `${p.paths.length}` : '*']
  }),
  'tasks:agentsMd:save': (p, h) => ({
    text: t('Reescribir el archivo AGENTS.md de un proyecto', "Rewrite a project's AGENTS.md file"),
    detail: [...folderLine(p, 'folder', h), ...previewText(p.content)]
  }),
  'tasks:rules:add': (p, h) => ({
    text: t('Recordar un permiso para un proyecto', 'Remember a permission for a project'),
    detail: [
      String(p.permission),
      ...(Array.isArray(p.patterns) ? p.patterns.map((x) => `patrón: ${String(x)}`) : ['patrón: ?']),
      ...folderLine(p, 'folder', h)
    ]
  }),
  'computer:prefs:set': () => ({ text: t('Pasar el control del Mac a modo completo', 'Switch Mac control to full mode'), detail: [] }),
  'tasks:auto:set': () => ({ text: t('Cambiar el modo automático', 'Change auto mode'), detail: [] }),
  'tasks:auto:clearLog': () => ({ text: t('Borrar el registro del modo automático', 'Clear the auto mode log'), detail: [] }),
  'tasks:auto:consider': (p, h) => ({
    text: t('Valorar una petición con el modo automático', 'Evaluate a request with auto mode'),
    detail: folderLine(p, 'folder', h)
  }),
  'git:removeWorktree': (p, h) => ({
    text: t('Eliminar un worktree de git', 'Remove a git worktree'),
    detail: [...folderLine(p, 'path', h), ...(p.force === true ? [t('A la fuerza', 'Forced').es] : [])]
  }),
  'git:discard': (p, h) => ({
    text: t('Descartar los cambios sin guardar de varios archivos', 'Discard unsaved changes in several files'),
    detail: [
      ...folderLine(p, 'cwd', h),
      p.scope === 'all' ? t('Todo el proyecto', 'The whole project').es : `${Array.isArray(p.paths) ? p.paths.length : 0}`
    ]
  }),
  'files:rename': (p, h) => ({
    text: t('Renombrar una carpeta', 'Rename a folder'),
    detail: [...folderLine(p, 'cwd', h), `${String(p.path)} -> ${String(p.name)}`]
  }),
  'files:trash': (p, h) => ({
    text: t('Mover una carpeta a la papelera', 'Move a folder to the Trash'),
    detail: [...folderLine(p, 'cwd', h), String(p.path)]
  }),
  'browser:agent': () => ({ text: t('Reanudar el agente del navegador', 'Resume the browser agent'), detail: [] }),
  'browser:respond': (p) => ({
    text: t('Permitir a un sitio o acción del navegador', 'Allow a browser site or action'),
    detail: [String(p.decision)]
  }),
  'POST /permission/{requestID}/reply': (p, _h, x) => permissionReplySummary(p, x),
  'POST /session/{sessionID}/permissions/{permissionID}': (p, _h, x) => permissionReplySummary(p, x),
  'PATCH /session/{sessionID}': (p) => ({
    text: t('Cambiar los permisos de una sesión', "Change a session's permissions"),
    detail: ruleLines(p.permission)
  }),
  'POST /session': (p) => ({
    text: t('Crear una sesión con permisos propios', 'Create a session with its own permissions'),
    detail: ruleLines(p.permission)
  })
}

/** Línea larga con el principio Y el final (un comando largo no puede esconder lo último tras un recorte): `inicio … final`. */
function headTail(line: string, max = 236): string {
  const flat = line.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const tail = Math.floor(max * 0.35)
  return `${flat.slice(0, max - tail - 3)} … ${flat.slice(flat.length - tail)}`
}

/** Qué se aprueba al responder un permiso pendiente: tipo y comando/rutas/patrones que el motor pide. */
function permissionReplySummary(p: Record<string, unknown>, x: SummaryExtra): { text: RemoteText; detail: string[] } {
  const id = x.params.requestID ?? x.params.permissionID
  const kind = id ? x.ctx.permissionKind?.(id) : undefined
  const what = id ? x.ctx.permissionDetail?.(id) : undefined
  const text =
    kind === 'bash'
      ? t('Permitir una vez que el agente ejecute este comando en el Mac', 'Allow once the agent to run this command on the Mac')
      : kind === 'edit'
        ? t('Permitir una vez que el agente edite este archivo', 'Allow once the agent to edit this file')
        : t(
            'Permitir una vez una acción del agente fuera de la carpeta del proyecto, de red, de subagentes o de Control del Mac',
            'Allow once an agent action outside the project folder, on the network, by a subagent or Mac control'
          )
  return {
    text,
    detail: [
      String(p.reply ?? p.response ?? ''),
      kind !== undefined ? `tipo: ${kind}` : 'tipo: desconocido',
      ...(what && what.length > 0 ? what.map((l) => headTail(l)) : ['(no se pudo saber qué pide; compruébalo en el Mac)'])
    ]
  }
}

function summaryFor(
  key: string,
  req: PolicyRequest,
  ctx: PolicyContext,
  params: Record<string, string>
): { summary: RemoteText; detail: string[] } {
  const home = ctx.home ?? homedir()
  const payload = req.kind === 'ipc' ? rec(req.payload) : { ...rec(req.body), directory: req.query?.directory }
  const s = CELULAR_SUMMARIES[key]
  if (!s) return { summary: t(`Acción sensible: ${key}`, `Sensitive action: ${key}`), detail: [] }
  const r = s(payload, home, { ctx, params })
  const dir = req.kind === 'http' && isStr(req.query?.directory) ? [tilde(req.query.directory, home)] : []
  // Texto del celular: sin saltos ni secretos, con tope de longitud y de líneas (el dueño decide leyéndolo).
  return { summary: r.text, detail: cleanDetail([...dir, ...r.detail]) }
}

// ─────────────────────────────── decide ───────────────────────────────

function finish(o: Outcome, key: string, req: PolicyRequest, ctx: PolicyContext, params: Record<string, string> = {}): PolicyDecision {
  if (typeof o === 'object' && 'approve' in o) return { allow: true, class: 'M', key, approve: true }
  if (typeof o === 'object') return { allow: false, reason: o.deny }
  if (o === 'X') return { allow: false, reason: 'forbidden' }
  if (o === 'D') {
    const { summary, detail } = summaryFor(key, req, ctx, params)
    return { confirm: true, summary, detail, channel: key }
  }
  return { allow: true, class: o, key }
}

/**
 * Decide qué hacer con una petición del celular. Pura y sin excepciones: ante cualquier forma inesperada rechaza.
 * `allow` = ejecutar; `confirm` = pedir confirmación en el Mac (`confirm-queue.ts`) y ejecutar solo si la aprueba;
 * `reason` = rechazo (código corto, sin datos del usuario).
 */
export function decide(request: PolicyRequest, ctx: PolicyContext): PolicyDecision {
  try {
    if (request.kind === 'ipc') {
      const ch = request.channel
      if (!isStr(ch) || ch.startsWith('remote:')) return { allow: false, reason: 'forbidden' }
      if (!Object.hasOwn(CELULAR_POLICY, ch)) return { allow: false, reason: 'unknown-channel' }
      const spec = CELULAR_POLICY[ch] as IpcSpec
      const o = typeof spec === 'function' ? spec(rec(request.payload), ctx) : spec
      return finish(o, ch, request, ctx)
    }
    if (request.kind === 'http') {
      const method = isStr(request.method) ? request.method.toUpperCase() : ''
      const q = request.query ?? {}
      if (
        Object.keys(q).some((k) => k === 'workspace' || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(k)) ||
        Object.values(q).some((v) => v !== undefined && !isStr(v))
      ) {
        return { allow: false, reason: 'query-forbidden' }
      }
      const m = isStr(request.path) ? matchRoute(method, request.path) : undefined
      if (!m) return { allow: false, reason: 'unknown-route' }
      const spec = m.entry.spec
      const o = typeof spec === 'function' ? spec({ req: { ...request, method }, params: m.params }, ctx) : spec
      return finish(o, m.entry.key, request, ctx, m.params)
    }
  } catch {
    return { allow: false, reason: 'policy-error' }
  }
  return { allow: false, reason: 'unknown-request' }
}

/**
 * Limpia el resultado de un canal antes de enviarlo al celular (mismo recorte que los eventos de `event-trim.ts`):
 *  - `app:info`: sin `userDataPath`.
 *  - `settings:get`: sin `opencodeBin` y con `recentFolders` solo del ámbito.
 *  - `tasks:trusted:list`: solo carpetas del ámbito.
 *  - `tasks:policy`: sin `source` (ruta del archivo) ni `allowedFolderRoots` (rutas de la organización).
 * `inScope` decide si una ruta absoluta está en el ámbito; sin él, ninguna ruta se considera del ámbito (cierra por defecto).
 * Devuelve una copia; no modifica el original.
 */
export function sanitizeResult(channel: string, data: unknown, inScope: (path: string) => boolean = () => false): unknown {
  const keep = (p: unknown): boolean => isStr(p) && isAbsolute(p) && inScope(p)
  if (channel === 'tasks:trusted:list') return Array.isArray(data) ? data.filter((e) => keep(rec(e).path)) : []
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return data
  const o = data as Record<string, unknown>
  if (channel === 'app:info') {
    const { userDataPath: _omit, ...rest } = o
    void _omit
    return rest
  }
  if (channel === 'settings:get') {
    const { opencodeBin: _bin, recentFolders, ...rest } = o
    void _bin
    return { ...rest, ...(Array.isArray(recentFolders) ? { recentFolders: recentFolders.filter(keep) } : {}) }
  }
  if (channel === 'tasks:policy') {
    const { source: _src, allowedFolderRoots: _roots, ...rest } = o
    void _src
    void _roots
    return rest
  }
  return data
}
