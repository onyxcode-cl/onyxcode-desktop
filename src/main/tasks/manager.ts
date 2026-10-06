/**
 * Gestor de Tareas: carpetas de Tareas (userData/tasks-folders.json) y un `opencode serve`
 * por carpeta y modo (arranque perezoso, reutilizado, detenido al salir):
 *  - normal: sandboxeado (Seatbelt), sin el agente `computer`;
 *  - Control total (`fullAccess`): SIN sandbox, con el MCP `computer` (control del Mac)
 *    y el agente `computer` (resources/opencode/agents/computer.md).
 *
 * Carpetas adicionales (Lote B): cada espacio puede vincular otras carpetas (`linked`, solo de
 * ese espacio) y el usuario puede marcar carpetas de confianza (`trusted`, todos los espacios).
 * Ambas se pasan al perfil Seatbelt como `extraFolders` (`rw` escribible sin borrado, `ro` sin
 * escritura); el perfil se fija al lanzar el proceso, así que ampliarlas exige reiniciar el
 * servidor sandbox (`restartSandbox`). `applied` compara la firma con la que arrancó.
 */
import { t } from '@shared/i18n'
import { app } from 'electron'
import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, win32 } from 'node:path'
import { isInside, normalizeDrive, samePath } from '../util/paths'
import { LEGACY_FOLDER_SCRATCH, LEGACY_PROJECT_DIR } from '../migrations/legacy-names'
import { migrateFolderScratch } from '../migrations/migrate-folder-scratch'
import {
  FULL_ACCESS_NOT_GRANTED,
  type ComputerUseInfo,
  type TasksConnection,
  type TasksDeliverable,
  type TasksFolder,
  type TasksFolderSet,
  type TasksFullAccessState,
  type TasksServerInfo,
  type FolderAccessMode,
  type FolderCheck,
  type LinkedFolder,
  type TrustedFolder
} from '@shared/ipc-tasks'
import { embeddedBrowser } from '../embedded-browser/service'
import { embeddedBrowserMcp } from '../embedded-browser/mcp-server'
import { killTree } from '../opencode/pids'
import { sandboxKey, startTasksServer, type TasksServerHandle } from './sandbox'
import { NetworkPolicy, type NetworkPolicyState, type NetworkToggleKey } from './proxy-policy'
import { buildInlineConfig } from './inline-config'
import { tasksMcpContribution } from './mcp-tasks'
import { McpProxy } from './mcp-proxy'
import { tasksRules, rulesPermissionConfig } from './rules'
import { skillsInlineConfig } from './opencode-config'
import type { EgressBlockedEvent } from './proxy'
import { forbiddenFolderReason as folderPolicyReason, parseMountOutput, type MountInfo } from './folder-policy'
import { loadManagedPolicy } from './policy'
import { defaultDeniedReadPaths } from './sandbox-profile'
import type { WinBackendProvider } from './backends'
import { isApprovedPath, resolveUiPath } from './ui-path'
import { createRealWinHost, type WinHost } from './win-context'

/** Consentimiento de "Control total" registrado en main (AUDIT.md S7). */
interface FullAccessGrant {
  path: string
  grantedAt: number
}

interface Persisted {
  folders: TasksFolder[]
  /** Carpetas con Control total concedido explícitamente (`tasks:grantFullAccess`). */
  fullAccess: FullAccessGrant[]
  /** Carpetas con "Permitir borrar, mover y renombrar" concedido (Seatbelt: `file-write-unlink`). */
  deleteGrants: string[]
  /** Carpetas adicionales vinculadas a cada espacio (clave: carpeta principal normalizada). */
  linked: Record<string, LinkedFolder[]>
  /** Carpetas de confianza (todos los espacios). */
  trusted: TrustedFolder[]
  /**
   * Consentimiento explícito de Control total, UNA vez por equipo (no por carpeta): fecha (epoch ms) en que el
   * usuario aceptó el diálogo, o ausente si no lo hay. Se retira en Ajustes › Tareas.
   */
  fullAccessConsentAt?: number
  /** Última carpeta de trabajo usada en Control total (por defecto, la carpeta personal). */
  fullAccessDir?: string
}

/** Carpeta adicional efectiva de un servidor sandbox (vinculada ∪ de confianza, sin duplicados). */
interface ExtraFolder {
  path: string
  mode: FolderAccessMode
}

/** Integración con computer use (inyectada para no acoplar el gestor a Electron/IPC). */
export interface TasksComputerDeps {
  /** Bloque `mcp.computer` para la config de OpenCode, o null si no está disponible. */
  mcpConfig: () => Promise<Record<string, unknown> | null>
  info: () => Promise<ComputerUseInfo>
  /**
   * URL+token del canal lateral de eventos (mismo que usa el MCP), para el plugin
   * `lazunox-plan-gate` del servidor de acceso total. Null si no está disponible (el servidor arranca
   * igual, pero el agente `computer` no tendría MCP tampoco en ese caso).
   */
  planGateUrl: () => Promise<string | null>
}

const noComputer = (): ComputerUseInfo => ({
  available: false,
  accessibility: false,
  screenRecording: false,
  reason: t('merr.task.onlyFull')
})

function serverKey(folder: string, fullAccess: boolean): string {
  return fullAccess ? `${folder}\u0000full` : folder
}

interface Entry {
  info: TasksServerInfo
  handle?: TasksServerHandle
  starting?: Promise<TasksServerHandle>
  /** Instante (ms) en que el servidor quedó listo. */
  startedAt?: number
  /** Última vez que el renderer pidió `start()` para este servidor (uso reciente). */
  lastStartCallAt?: number
  /** Firma (carpetas extra + borrado) con la que arrancó el servidor sandbox. */
  signature?: string
}

/** Servidor vivo con sus credenciales y marcas de tiempo (monitor de ciclo de vida). */
export interface LiveServer {
  folder: string
  fullAccess: boolean
  baseUrl: string
  authorization: string
  startedAt: number
  lastStartCallAt: number
}

interface ManagerEvents {
  server: [TasksServerInfo]
  networkBlocked: [{ folder: string } & EgressBlockedEvent]
}

// '.lapis' se mantiene junto a '.lazunox' mientras exista el fallback de lectura de memoria de la
// versión anterior de la app (`src/main/tasks/projects.ts`).
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.opencode',
  LEGACY_FOLDER_SCRATCH,
  '.lazunox',
  LEGACY_PROJECT_DIR,
  '.venv',
  '__pycache__',
  '.DS_Store'
])
const MAX_SCAN_FILES = 5000

function normalizeFolder(p: string, win?: WinHost | null): string {
  if (win) {
    // Windows: `/win/c/x` (ruta de la distro) → `C:\x`; `realpath.native` expande 8.3 y `subst` y quita `\\?\`. Si la ruta es hostil
    // (UNC, ADS, `..`…) se devuelve tal cual: NINGUNA autorización se apoya en esta función, `forbiddenFolderReason` y
    // `assertInsideApproved` vuelven a validarla con `resolveUiPath` y la rechazan.
    const r = resolveUiPath(p, 'win32')
    // Hostil (UNC, `\\.\`, ADS…): solo léxico y SIN tocar disco, para no abrir una conexión SMB ni un dispositivo.
    if (!r.ok) return normalizeDrive(win32.resolve(p), 'win32')
    try {
      return normalizeDrive(win.realpath(r.path), 'win32')
    } catch {
      return normalizeDrive(win32.resolve(r.path), 'win32')
    }
  }
  const abs = resolve(p)
  try {
    return realpathSync(abs)
  } catch {
    return abs
  }
}

/** Tabla de montajes (`/sbin/mount`) en caché 30 s: detecta volúmenes de red sin lanzar el proceso cada vez. */
let mountCache: { at: number; mounts: MountInfo[] } | null = null
const MOUNT_TTL_MS = 30_000

function currentMounts(): MountInfo[] {
  const now = Date.now()
  if (mountCache && now - mountCache.at < MOUNT_TTL_MS) return mountCache.mounts
  let mounts: MountInfo[] = []
  try {
    mounts = parseMountOutput(execFileSync('/sbin/mount', [], { encoding: 'utf8', timeout: 3000 }))
  } catch (err) {
    console.error('[tasks] no se pudo leer /sbin/mount:', err)
    if (mountCache) mounts = mountCache.mounts
  }
  mountCache = { at: now, mounts }
  return mounts
}

/** Token Bearer de un bloque MCP remoto (`headers.Authorization`), o null. */
function bearerOfMcpConfig(cfg: Record<string, unknown> | null): string | null {
  const h = cfg?.headers
  const a = h && typeof h === 'object' ? (h as Record<string, unknown>).Authorization : undefined
  return typeof a === 'string' && a.startsWith('Bearer ') ? a.slice(7) : null
}

export class TasksManager extends EventEmitter<ManagerEvents> {
  private servers = new Map<string, Entry>()
  private data: Persisted | null = null
  readonly network = new NetworkPolicy()

  /** Plataforma efectiva (inyectable en pruebas). En `win32` la política de carpetas es la propia de Windows y Control total no existe. */
  private readonly platform: NodeJS.Platform
  /** Solo en win32: contexto de la política (unidades, perfil, enlaces) y `realpath` nativo. */
  private readonly win: WinHost | null

  constructor(
    private readonly opts: {
      corsOrigins?: string[]
      computer?: TasksComputerDeps
      platform?: NodeJS.Platform
      /** Contexto de Windows (pruebas); por defecto el real. */
      win?: WinHost
      /** Bandera efectiva `tasksWin` y proveedor del backend de Windows (los trae `main`). Ausentes: en Windows no se lanza nada. */
      tasksWin?: boolean
      winBackend?: WinBackendProvider
    } = {}
  ) {
    super()
    this.platform = opts.platform ?? process.platform
    this.win = this.platform === 'win32' ? (opts.win ?? createRealWinHost({ userData: app.getPath('userData') })) : null
  }

  /** `normalizeFolder` con la plataforma del gestor. */
  private nf(p: string): string {
    return normalizeFolder(p, this.win)
  }

  private inside(p: string, dir: string): boolean {
    return isInside(p, dir, this.platform)
  }

  /** ¿Existe y es una carpeta? (en Windows, con el disco del contexto). */
  private isDir(p: string): boolean {
    if (this.win) return this.win.isDirectory(p)
    try {
      return existsSync(p) && statSync(p).isDirectory()
    } catch {
      return false
    }
  }

  /** Control total no existe en Windows (sin sandbox ni control del PC en esta versión): jamás se concede ni arranca. */
  private get noFullAccess(): boolean {
    return this.platform === 'win32'
  }

  /**
   * Relee lo asíncrono de la política de carpetas (unidades de Windows). Se espera en los puntos de entrada asíncronos antes
   * de aprobar, comprobar, vincular o arrancar; en macOS no hace nada.
   */
  async refreshPolicy(): Promise<void> {
    await this.win?.refresh()
  }

  /**
   * Carpetas que nunca se autorizan ni se vinculan (demasiado amplias, del sistema, de red o fuera de las raíces de la
   * política gestionada). Devuelve un motivo accionable o `null`. En Windows: `folder-policy-win` con contexto REAL; sin
   * contexto (unidades sin leer o caducadas) rechaza todo.
   */
  private forbidden(folder: string): string | null {
    const allowedRoots = loadManagedPolicy()?.allowedFolderRoots?.map((r) => this.nf(r))
    const normalized = this.nf(folder)
    if (this.win) {
      return folderPolicyReason(
        normalized,
        {
          home: this.win.home(),
          userData: this.nf(app.getPath('userData')),
          mounts: [],
          allowedRoots,
          win: this.win.context(allowedRoots)
        },
        'win32'
      )
    }
    return folderPolicyReason(normalized, {
      home: this.nf(homedir()),
      userData: this.nf(app.getPath('userData')),
      mounts: currentMounts(),
      allowedRoots
    })
  }

  networkState(): NetworkPolicyState {
    return this.network.state()
  }

  /** "Permitir esta vez" (tarjeta de bloqueo): no persiste, efecto inmediato (el proxy relee la lista en cada conexión). */
  networkAllowOnce(folder: string, host: string): void {
    this.assertCustomHostsAllowed()
    this.network.allowOnce(this.nf(folder), host)
  }

  /** Política gestionada: con `disableCustomHosts` no se añaden sitios a la red del sandbox. */
  private assertCustomHostsAllowed(): void {
    if (loadManagedPolicy()?.disableCustomHosts) {
      throw new Error(t('merr.task.orgNoHosts'))
    }
  }

  /** "Permitir siempre" / "Mantener bloqueado" para un host (persistido, efecto inmediato). */
  networkSetHost(host: string, decision: 'allow' | 'block' | 'unset'): NetworkPolicyState {
    if (decision === 'allow') this.assertCustomHostsAllowed()
    return this.network.setHostAlways(host, decision)
  }

  networkSetToggle(key: NetworkToggleKey, value: boolean): NetworkPolicyState {
    return this.network.setToggle(key, value)
  }

  private get file(): string {
    return join(app.getPath('userData'), 'tasks-folders.json')
  }

  private load(): Persisted {
    if (this.data) return this.data
    let data: Persisted = { folders: [], fullAccess: [], deleteGrants: [], linked: {}, trusted: [] }
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Persisted>
        if (Array.isArray(raw.folders)) {
          data.folders = raw.folders.filter((f): f is TasksFolder => !!f && typeof f.path === 'string' && typeof f.approvedAt === 'number')
        }
        if (Array.isArray(raw.fullAccess)) {
          data.fullAccess = raw.fullAccess.filter(
            (g): g is FullAccessGrant => !!g && typeof g.path === 'string' && typeof g.grantedAt === 'number'
          )
        }
        if (Array.isArray(raw.deleteGrants)) {
          data.deleteGrants = raw.deleteGrants.filter((p): p is string => typeof p === 'string')
        }
        const validFolder = (f: unknown): f is LinkedFolder =>
          !!f &&
          typeof (f as LinkedFolder).path === 'string' &&
          typeof (f as LinkedFolder).name === 'string' &&
          ((f as LinkedFolder).mode === 'rw' || (f as LinkedFolder).mode === 'ro') &&
          typeof (f as LinkedFolder).addedAt === 'number'
        if (raw.linked && typeof raw.linked === 'object' && !Array.isArray(raw.linked)) {
          for (const [primary, list] of Object.entries(raw.linked)) {
            if (Array.isArray(list)) data.linked[primary] = list.filter(validFolder)
          }
        }
        if (Array.isArray(raw.trusted)) data.trusted = raw.trusted.filter(validFolder)
        if (typeof raw.fullAccessConsentAt === 'number' && Number.isFinite(raw.fullAccessConsentAt) && raw.fullAccessConsentAt > 0) {
          data.fullAccessConsentAt = raw.fullAccessConsentAt
        }
        if (typeof raw.fullAccessDir === 'string' && raw.fullAccessDir) data.fullAccessDir = raw.fullAccessDir
      }
    } catch (err) {
      console.error('[tasks] tasks-folders.json inválido:', err)
      data = { folders: [], fullAccess: [], deleteGrants: [], linked: {}, trusted: [] }
    }
    this.data = data
    return data
  }

  /** true si el usuario concedió "Permitir borrar, mover y renombrar" para esta carpeta. */
  hasDeleteGrant(folder: string): boolean {
    return this.load().deleteGrants.includes(this.nf(folder))
  }

  /** Concede/retira "Permitir borrar, mover y renombrar" y reinicia el servidor sandboxeado si está vivo. */
  async setDeleteGrant(folder: string, allowed: boolean): Promise<void> {
    const f = this.nf(folder)
    const data = this.load()
    const before = data.deleteGrants.includes(f)
    if (allowed && !before) data.deleteGrants.push(f)
    else if (!allowed && before) data.deleteGrants = data.deleteGrants.filter((p) => p !== f)
    else return
    this.save()
    // Reconfigurar: el permiso de borrado vive en el perfil Seatbelt (proceso ya lanzado), así
    // que hace falta relanzar el servidor sandboxeado para que tome efecto.
    await this.restartSandbox(f)
  }

  /** Reinicia el servidor sandbox de la carpeta si hay uno en marcha. Devuelve true si lo reinició. */
  async restartSandbox(folder: string): Promise<boolean> {
    const f = this.nf(folder)
    const cur = this.servers.get(serverKey(f, false))
    if (!cur?.handle && !cur?.starting) return false
    await this.stopOne(f, false)
    await this.refreshPolicy()
    await this.spawn(f, false)
    return true
  }

  private save(): void {
    const file = this.file
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(this.load(), null, 2), 'utf8')
    renameSync(`${file}.tmp`, file)
  }

  listFolders(): TasksFolder[] {
    return [...this.load().folders]
      .sort((a, b) => (b.lastUsedAt ?? b.approvedAt) - (a.lastUsedAt ?? a.approvedAt))
      .map((f) => ({ ...f, fullAccess: this.hasFullAccessGrant(f.path) }))
  }

  isApproved(folder: string): boolean {
    const f = this.nf(folder)
    return this.load().folders.some((x) => samePath(x.path, f, this.platform))
  }

  approveFolder(folder: string): TasksFolder {
    const f = this.nf(folder)
    // Windows: la política decide ANTES de tocar el disco (una ruta de red o de dispositivo no debe abrirse para comprobarla).
    const early = this.win ? this.forbidden(f) : null
    if (early) throw new Error(early)
    if (!this.isDir(f)) throw new Error(t('merr.task.notValidFolder', { folder: f }))
    const reason = this.win ? null : this.forbidden(f)
    if (reason) throw new Error(reason)
    const data = this.load()
    let entry = data.folders.find((x) => x.path === f)
    if (!entry) {
      entry = { path: f, name: basename(f), approvedAt: Date.now() }
      data.folders.push(entry)
      this.save()
    }
    return entry
  }

  async removeFolder(folder: string): Promise<void> {
    const f = this.nf(folder)
    await this.stop(f)
    const data = this.load()
    data.folders = data.folders.filter((x) => x.path !== f)
    data.fullAccess = data.fullAccess.filter((g) => g.path !== f)
    data.deleteGrants = data.deleteGrants.filter((p) => p !== f)
    delete data.linked[f]
    this.save()
    this.network.clearFolder(f)
    tasksRules.removeFolder(f)
  }

  // ───────────────────────── Carpetas adicionales y de confianza ─────────────────────────

  /**
   * Carpetas extra efectivas del servidor sandbox de `primary`: vinculadas (mandan) ∪ de confianza,
   * sin duplicados. Se descartan las que ya no existen, las que hoy serían rechazadas (política,
   * volumen de red montado después…) y las `rw` contenidas en la principal (ya son escribibles).
   */
  private extraFolders(primary: string): ExtraFolder[] {
    const data = this.load()
    const out = new Map<string, ExtraFolder>()
    const consider = (path: string, mode: FolderAccessMode): void => {
      const p = this.nf(path)
      if (samePath(p, primary, this.platform) || out.has(p)) return
      if (mode === 'rw' && this.inside(p, primary)) return
      if (this.win && this.forbidden(p)) return
      if (!this.isDir(p)) return
      if (this.forbidden(p)) return
      out.set(p, { path: p, mode })
    }
    for (const l of data.linked[primary] ?? []) consider(l.path, l.mode)
    for (const t of data.trusted) consider(t.path, t.mode)
    return [...out.values()].sort((a, b) => a.path.localeCompare(b.path))
  }

  /** Firma del perfil del servidor sandbox: JSON ordenado de las carpetas extra + permiso de borrado. */
  private signatureOf(extras: ExtraFolder[], allowDelete: boolean): string {
    const sorted = [...extras].sort((a, b) => a.path.localeCompare(b.path)).map((e) => ({ path: e.path, mode: e.mode }))
    return JSON.stringify({ extra: sorted, allowDelete })
  }

  private requireApproved(folder: string): string {
    const f = this.nf(folder)
    if (!this.isApproved(f)) throw new Error(t('merr.task.notAuthorized'))
    return f
  }

  /** Conjunto de carpetas de un espacio; `applied` es false si el servidor sandbox en marcha arrancó con otro. */
  folderSet(folder: string): TasksFolderSet {
    const fp = this.nf(folder)
    // Carpeta de trabajo de Control total sin autorizar para Sandbox: sin carpetas adicionales.
    if (!this.isApproved(fp) && this.fullAccessRoots().includes(fp)) return { primary: fp, linked: [], trusted: [], applied: true }
    const f = this.requireApproved(folder)
    const data = this.load()
    const entry = this.servers.get(serverKey(f, false))
    const live = !!entry?.handle || !!entry?.starting
    const applied = !live || entry?.signature === this.signatureOf(this.extraFolders(f), this.hasDeleteGrant(f))
    return {
      primary: f,
      linked: [...(data.linked[f] ?? [])],
      trusted: [...data.trusted],
      applied
    }
  }

  /** Comprueba si `path` se puede autorizar o vincular (existe, es una carpeta y pasa la política). */
  checkFolder(path: string): FolderCheck {
    const normalized = this.nf(path)
    if (this.win) {
      const early = this.forbidden(normalized)
      if (early) return { ok: false, normalized, reason: early }
    }
    if (!this.isDir(normalized)) return { ok: false, normalized, reason: t('merr.task.notValidFolder', { folder: normalized }) }
    const reason = this.win ? null : this.forbidden(normalized)
    return reason ? { ok: false, normalized, reason } : { ok: true, normalized }
  }

  private assertCheck(path: string): string {
    const c = this.checkFolder(path)
    if (!c.ok) throw new Error(c.reason ?? t('merr.task.notValidFolder', { folder: c.normalized }))
    return c.normalized
  }

  /**
   * Vincula `path` al espacio `folder` (y opcionalmente la marca de confianza). Si `restart` no es
   * false y el servidor sandbox está vivo con otra configuración, lo reinicia (interrumpe sus tareas).
   */
  async linkFolder(
    folder: string,
    path: string,
    mode: FolderAccessMode,
    opts: { trust?: boolean; restart?: boolean } = {}
  ): Promise<TasksFolderSet & { restarted: boolean }> {
    const f = this.requireApproved(folder)
    const p = this.assertCheck(path)
    if (p === f) throw new Error(t('merr.task.mainFolder'))
    if (mode === 'rw' && this.inside(p, f)) throw new Error(t('merr.task.insideMain'))
    const data = this.load()
    const list = (data.linked[f] ??= [])
    const prev = list.find((l) => l.path === p)
    if (prev) {
      prev.mode = mode
    } else {
      list.push({ path: p, name: basename(p), mode, addedAt: Date.now() })
    }
    if (opts.trust) this.upsertTrusted(p, mode)
    this.save()
    return this.applyFolderChange(f, opts.restart)
  }

  /** Quita una carpeta vinculada del espacio. `restart` igual que en `linkFolder`. */
  async unlinkFolder(folder: string, path: string, opts: { restart?: boolean } = {}): Promise<TasksFolderSet & { restarted: boolean }> {
    const f = this.requireApproved(folder)
    const p = this.nf(path)
    const data = this.load()
    const before = data.linked[f] ?? []
    data.linked[f] = before.filter((l) => l.path !== p && l.path !== path)
    if (data.linked[f].length === 0) delete data.linked[f]
    if (data.linked[f]?.length !== before.length) this.save()
    return this.applyFolderChange(f, opts.restart)
  }

  private async applyFolderChange(f: string, restart: boolean | undefined): Promise<TasksFolderSet & { restarted: boolean }> {
    let restarted = false
    if (restart !== false && !this.folderSet(f).applied) restarted = await this.restartSandbox(f)
    return { ...this.folderSet(f), restarted }
  }

  private upsertTrusted(p: string, mode: FolderAccessMode): void {
    const data = this.load()
    const prev = data.trusted.find((t) => t.path === p)
    if (prev) prev.mode = mode
    else data.trusted.push({ path: p, name: basename(p), mode, addedAt: Date.now() })
  }

  trustedList(): TrustedFolder[] {
    return [...this.load().trusted].sort((a, b) => a.addedAt - b.addedAt)
  }

  /** Marca (o cambia el modo de) una carpeta de confianza. Aplica a los servidores al reiniciarlos. */
  setTrusted(path: string, mode: FolderAccessMode): TrustedFolder[] {
    this.upsertTrusted(this.assertCheck(path), mode)
    this.save()
    return this.trustedList()
  }

  removeTrusted(path: string): TrustedFolder[] {
    const p = this.nf(path)
    const data = this.load()
    const before = data.trusted.length
    data.trusted = data.trusted.filter((t) => t.path !== p && t.path !== path)
    if (data.trusted.length !== before) this.save()
    return this.trustedList()
  }

  /** Concesión PREVIA de Control total de esa carpeta (modelo antiguo, por carpeta; sigue valiendo). */
  hasFullAccessGrant(folder: string): boolean {
    if (this.noFullAccess) return false
    // Política gestionada: con `disableFullAccess` ninguna concesión previa vale.
    if (loadManagedPolicy()?.disableFullAccess) return false
    const f = this.nf(folder)
    return this.load().fullAccess.some((g) => g.path === f)
  }

  /** Fecha (epoch ms) del consentimiento de Control total de este equipo, o null. Con `disableFullAccess` no hay. */
  fullAccessConsentAt(): number | null {
    if (this.noFullAccess) return null
    if (loadManagedPolicy()?.disableFullAccess) return null
    return this.load().fullAccessConsentAt ?? null
  }

  /**
   * Carpeta de trabajo por defecto de Control total: la última usada en ese modo si sigue existiendo; si no, la
   * carpeta personal del usuario. El usuario puede cambiarla, pero no hace falta elegir ninguna.
   */
  fullAccessWorkspace(): string {
    const last = this.load().fullAccessDir
    if (last) {
      try {
        if (statSync(last).isDirectory()) return this.nf(last)
      } catch {
        // ya no existe: vuelve al home
      }
    }
    return this.nf(homedir())
  }

  /** Estado de Control total para la UI (diálogo único, carpeta por defecto, bloqueo por política). */
  fullAccessState(): TasksFullAccessState {
    const disabled = this.noFullAccess || loadManagedPolicy()?.disableFullAccess === true
    return {
      consentAt: disabled ? null : (this.load().fullAccessConsentAt ?? null),
      workspace: this.fullAccessWorkspace(),
      home: this.nf(homedir()),
      disabled
    }
  }

  /**
   * Registra el consentimiento explícito de Control total de ESTE EQUIPO (tras el diálogo). Conserva la fecha
   * original si ya existía. Sin carpeta: el agente podrá actuar sobre todo el equipo del usuario.
   */
  grantFullAccessConsent(): number {
    if (this.noFullAccess) throw new Error(t('merr.task.fullAccessUnavailable'))
    if (loadManagedPolicy()?.disableFullAccess) throw new Error(t('merr.task.orgNoFullControl'))
    const data = this.load()
    if (!data.fullAccessConsentAt) {
      data.fullAccessConsentAt = Date.now()
      this.save()
    }
    return data.fullAccessConsentAt
  }

  /**
   * Retira TODO el Control total: el consentimiento del equipo y las concesiones antiguas por carpeta, y detiene
   * todos los servidores sin sandbox. Con esto vuelve a pedirse el diálogo.
   */
  async revokeFullAccessConsent(): Promise<void> {
    const data = this.load()
    delete data.fullAccessConsentAt
    delete data.fullAccessDir
    data.fullAccess = []
    this.save()
    await Promise.all(
      [...this.servers.values()].filter((e) => e.info.fullAccess).map((e) => this.stopOne(e.info.folder, true).catch(() => undefined))
    )
  }

  /**
   * ¿Puede arrancar Control total en `f` (ya normalizada)? Devuelve el motivo si no.
   *  - concesión antigua de esa carpeta (debe seguir autorizada), o
   *  - consentimiento del equipo + una carpeta que existe (la carpeta NO tiene que estar autorizada para Sandbox).
   * Con `allowedFolderRoots` (política) se exige además que la carpeta esté autorizada (que ya pasó esa política).
   */
  fullAccessBlock(f: string): 'notGranted' | 'notDir' | null {
    if (this.noFullAccess) return 'notGranted'
    if (loadManagedPolicy()?.disableFullAccess) return 'notGranted'
    if (this.isApproved(f) && this.hasFullAccessGrant(f)) return null
    if (!this.load().fullAccessConsentAt) return 'notGranted'
    try {
      if (!statSync(f).isDirectory()) return 'notDir'
    } catch {
      return 'notDir'
    }
    if (loadManagedPolicy()?.allowedFolderRoots && !this.isApproved(f)) return 'notGranted'
    return null
  }

  /** ¿Puede arrancar Control total en esa carpeta? (rutinas y UI.) */
  canStartFullAccess(folder: string): boolean {
    return this.fullAccessBlock(this.nf(folder)) === null
  }

  /** Carpetas de trabajo de Control total que la UI puede leer (vista previa, ZIP…): la actual y las de servidores vivos. */
  private fullAccessRoots(): string[] {
    if (!this.fullAccessConsentAt()) return []
    const roots = new Set<string>([this.fullAccessWorkspace()])
    for (const e of this.servers.values()) if (e.info.fullAccess && (e.handle || e.starting)) roots.add(e.info.folder)
    return [...roots]
  }

  /** ¿`real` es la carpeta personal o una que la contiene? (demasiado grande para puntos de restauración o entregables.) */
  coversHome(real: string): boolean {
    return this.inside(this.nf(homedir()), this.nf(real))
  }

  /** Registra la última carpeta de trabajo de Control total (solo si cambió). */
  private rememberFullDir(f: string): void {
    const data = this.load()
    if (data.fullAccessDir === f) return
    data.fullAccessDir = f
    this.save()
  }

  /** Concesión antigua por carpeta (compatibilidad): sigue registrándose si la carpeta está autorizada. */
  grantFullAccess(folder: string): void {
    if (this.noFullAccess) throw new Error(t('merr.task.fullAccessUnavailable'))
    if (loadManagedPolicy()?.disableFullAccess) {
      throw new Error(t('merr.task.orgNoFullControl'))
    }
    const f = this.nf(folder)
    if (!this.isApproved(f)) throw new Error(t('merr.task.notAuthorized'))
    const data = this.load()
    if (!data.fullAccess.some((g) => g.path === f)) {
      data.fullAccess.push({ path: f, grantedAt: Date.now() })
      this.save()
    }
  }

  /** Retira la concesión antigua de esa carpeta y detiene su servidor sin sandbox (el consentimiento del equipo no cambia). */
  async revokeFullAccess(folder: string): Promise<void> {
    const f = this.nf(folder)
    const data = this.load()
    const before = data.fullAccess.length
    data.fullAccess = data.fullAccess.filter((g) => g.path !== f)
    if (data.fullAccess.length !== before) this.save()
    await this.stop(f, true)
  }

  private touch(folder: string): void {
    const entry = this.load().folders.find((x) => x.path === folder)
    if (entry) {
      entry.lastUsedAt = Date.now()
      this.save()
    }
  }

  /** Servidores de acceso total vivos, con sus credenciales (kill-switch del control del Mac). */
  fullAccessConnections(): Array<{ folder: string; baseUrl: string; authorization: string }> {
    const out: Array<{ folder: string; baseUrl: string; authorization: string }> = []
    for (const e of this.servers.values()) {
      if (e.info.fullAccess && e.handle) {
        out.push({ folder: e.info.folder, baseUrl: e.handle.baseUrl, authorization: e.handle.authorization })
      }
    }
    return out
  }

  /** Servidores con proceso vivo (sandbox y Control total), con credenciales y marcas de tiempo. */
  liveServers(): LiveServer[] {
    const out: LiveServer[] = []
    for (const e of this.servers.values()) {
      if (!e.handle) continue
      const startedAt = e.startedAt ?? 0
      out.push({
        folder: e.info.folder,
        fullAccess: !!e.info.fullAccess,
        baseUrl: e.handle.baseUrl,
        authorization: e.handle.authorization,
        startedAt,
        lastStartCallAt: e.lastStartCallAt ?? startedAt
      })
    }
    return out
  }

  /**
   * Gancho que se await-ea al inicio de `spawn()` (p.ej. el monitor detiene un servidor ocioso si
   * se alcanzó el máximo). Si lanza, el arranque falla con ese error.
   */
  setBeforeSpawn(fn: ((folder: string, fullAccess: boolean) => Promise<void>) | null): void {
    this.beforeSpawn = fn
  }

  private beforeSpawn: ((folder: string, fullAccess: boolean) => Promise<void>) | null = null

  /** Hosts extra (MCP remotos) por clave de servidor; se suman a la lista blanca del proxy. */
  private serverHosts = new Map<string, string[]>()

  private setInfo(folder: string, fullAccess: boolean, patch: Partial<TasksServerInfo>): void {
    const key = serverKey(folder, fullAccess)
    const entry = this.servers.get(key) ?? { info: { folder, state: 'stopped', sandboxed: false, fullAccess } }
    entry.info = { ...entry.info, ...patch, folder, fullAccess }
    this.servers.set(key, entry)
    this.emit('server', entry.info)
  }

  /**
   * Arranca o reutiliza el servidor de una carpeta ya autorizada.
   * `fullAccess` ⇒ servidor aparte sin sandbox con el MCP de control del computador.
   */
  async start(folder: string, fullAccess = false): Promise<TasksConnection> {
    // Windows: sin Control total (decisión de `main`, no solo de la interfaz: A18) y con la política releída al arrancar.
    if (this.noFullAccess && fullAccess) throw new Error(t('merr.task.fullAccessUnavailable'))
    await this.refreshPolicy()
    const f = this.nf(folder)
    if (fullAccess) {
      // Control total: consentimiento del equipo (o concesión antigua de la carpeta); la carpeta no tiene que estar autorizada.
      const block = this.fullAccessBlock(f)
      if (block === 'notDir') throw new Error(t('merr.task.notValidFolder', { folder: f }))
      if (block) throw new Error(`${FULL_ACCESS_NOT_GRANTED}: ${t('merr.task.fullNotGranted')}`)
      this.rememberFullDir(f)
    } else if (!this.isApproved(f)) {
      throw new Error(t('merr.task.notAuthorized'))
    } else if (this.win) {
      // Reescaneo al arrancar (D3): una junction creada DESPUÉS de aprobar la carpeta, o una unidad que dejó de ser local,
      // impide el arranque. Falla cerrado si no se puede comprobar.
      const why = this.forbidden(f)
      if (why) throw new Error(why)
    }
    const key = serverKey(f, fullAccess)
    const existing = this.servers.get(key)
    let handle = existing?.handle
    if (!handle || existing?.info.state !== 'ready') {
      handle = await (existing?.starting ?? this.spawn(f, fullAccess))
    }
    const used = this.servers.get(key)
    if (used) used.lastStartCallAt = Date.now()
    this.touch(f)
    const computerUse = fullAccess && this.opts.computer ? await this.opts.computer.info() : noComputer()
    return {
      folder: f,
      baseUrl: handle.baseUrl,
      authorization: handle.authorization,
      sandboxed: handle.sandboxed,
      version: handle.version,
      fullAccess,
      computerUse: fullAccess && !this.fullAccessMcp.get(key) ? { ...computerUse, available: false } : computerUse
    }
  }

  /** true si el servidor de acceso completo de esa clave arrancó con el MCP `computer`. */
  private fullAccessMcp = new Map<string, boolean>()

  /**
   * Config inline de OpenCode para cada modo (base + MCP del usuario + reglas recordadas + skills).
   * En sandbox devuelve además el proxy MCP (F8-B79): `spawn()` abre solo su puerto en Seatbelt y lo apaga
   * (con la revocación de los tokens) cuando el proceso termina o no llega a arrancar.
   */
  private async inlineConfig(
    key: string,
    folder: string,
    fullAccess: boolean,
    extras: ExtraFolder[]
  ): Promise<{ config: Record<string, unknown>; mcpProxy: McpProxy | null; browserToken: string | null }> {
    // Proxy MCP FUERA del sandbox (F8-B79): el servidor sandboxeado solo recibe URL loopback + token de sesión; los
    // secretos reales (token del navegador, cabeceras de los MCP del usuario) se quedan en main. Solo en sandbox.
    let mcpProxy: McpProxy | null = null
    try {
      if (!fullAccess) {
        mcpProxy = new McpProxy()
        await mcpProxy.start()
      }
      return await this.buildInlineConfig(key, folder, fullAccess, extras, mcpProxy)
    } catch (err) {
      await mcpProxy?.stop().catch(() => undefined)
      throw err
    }
  }

  private async buildInlineConfig(
    key: string,
    folder: string,
    fullAccess: boolean,
    extras: ExtraFolder[],
    mcpProxy: McpProxy | null
  ): Promise<{ config: Record<string, unknown>; mcpProxy: McpProxy | null; browserToken: string | null }> {
    let browserMcp: Record<string, unknown> | null = null
    let computerMcp: Record<string, unknown> | null = null
    // Idempotente: nos asegura la implementación real del navegador integrado la primera vez que
    // se arranca cualquier servidor de Tareas (sandbox o Control total).
    embeddedBrowserMcp.setApi(embeddedBrowser)
    if (!fullAccess) {
      // Navegador integrado en Sandbox (Lote D, novedad B.7: antes no había navegador aquí).
      // `browser_*` queda con el permiso por defecto ('ask'), como cualquier otra herramienta de acción del sandbox: sin `deny` explícito.
      browserMcp = await embeddedBrowserMcp.configFor({ product: 'tasks', folder, sandboxed: true }).catch(() => null)
      // El agente `computer` vive en el OPENCODE_CONFIG_DIR compartido: ocultarlo en el sandbox (ver buildInlineConfig).
    } else {
      computerMcp = this.opts.computer ? await this.opts.computer.mcpConfig().catch(() => null) : null
      this.fullAccessMcp.set(key, !!computerMcp)
      // Navegador en Control total (Lote D, B.11): el navegador integrado.
      browserMcp = await embeddedBrowserMcp.configFor({ product: 'tasks', folder, sandboxed: false }).catch(() => null)
    }
    // El token REAL del navegador solo lo conoce main (revocación al terminar): el sandbox ve la ruta del proxy.
    const realBrowserToken = bearerOfMcpConfig(browserMcp)
    if (mcpProxy && browserMcp && typeof browserMcp.url === 'string') {
      try {
        const route = mcpProxy.addRoute({
          name: 'browser',
          url: browserMcp.url,
          headers: realBrowserToken ? { Authorization: `Bearer ${realBrowserToken}` } : undefined
        })
        browserMcp = { ...browserMcp, url: route.url, headers: route.headers }
      } catch (err) {
        console.error('[tasks] el navegador integrado no entra en el sandbox:', err instanceof Error ? err.message : 'error')
        browserMcp = null
      }
    }
    // MCP del usuario disponibles en Tareas (`mcp-tasks.ts`); sus hosts remotos (sin secretos) entran a la red.
    const c = tasksMcpContribution({ sandboxed: !fullAccess, registerRoute: mcpProxy ? (spec) => mcpProxy.addRoute(spec) : undefined })
    if (c.blocked.length) {
      console.warn(`[tasks] MCP no disponibles en el sandbox (secretos en el entorno): ${c.blocked.join(', ')}`)
    }
    // Con `disableCustomHosts` los hosts de MCP remotos no se suman a la red (política gestionada).
    this.serverHosts.set(key, loadManagedPolicy()?.disableCustomHosts ? [] : c.hosts)
    // Permisos "siempre permitir" recordados para esta carpeta (`rules.ts`).
    const config = buildInlineConfig({
      fullAccess,
      extras,
      browserMcp,
      computerMcp,
      mcpContribution: c,
      rulesPermission: rulesPermissionConfig(tasksRules.list(folder)),
      skills: skillsInlineConfig()
    })
    return { config, mcpProxy, browserToken: realBrowserToken }
  }

  private spawn(folder: string, fullAccess: boolean): Promise<TasksServerHandle> {
    const key = serverKey(folder, fullAccess)
    // Carpetas extra y borrado se fijan AHORA (el perfil Seatbelt no se puede cambiar en caliente);
    // la firma registrada es la de lo realmente usado, para que `applied` sea fiable.
    const extras = fullAccess ? [] : this.extraFolders(folder)
    const allowDelete = fullAccess ? undefined : this.hasDeleteGrant(folder)
    const signature = fullAccess ? '' : this.signatureOf(extras, allowDelete === true)
    this.setInfo(folder, fullAccess, { state: 'starting', error: undefined })
    const starting0 = this.servers.get(key)
    if (starting0) starting0.signature = signature
    const planGateUrl =
      fullAccess && this.opts.computer ? this.opts.computer.planGateUrl().catch(() => null) : Promise.resolve<string | null>(null)
    const before = Promise.resolve(this.beforeSpawn ? this.beforeSpawn(folder, fullAccess) : undefined)
    const prepared = before.then(() => {
      // scratch antiguo → `.lazunox/trabajo/` en main y ANTES de lanzar el servidor (Seatbelt no permite renombrar fuera del scratch).
      // Nunca en la carpeta personal (Control total sin carpeta): no se toca nada del home del usuario.
      if (folder !== this.nf(homedir())) migrateFolderScratch(folder, (m, e) => console.warn('[tasks]', m, e ?? ''))
      return Promise.all([this.inlineConfig(key, folder, fullAccess, extras), planGateUrl])
    })
    const starting = prepared.then(([{ config, mcpProxy, browserToken }, gateUrl]) => {
      // El token del MCP del navegador vive en el entorno de `opencode serve` (OPENCODE_CONFIG_CONTENT): se
      // revoca en cuanto ese proceso termina o no llega a arrancar (F8-B69, hallazgos 6 y 10).
      const revokeBrowserToken = (): void => {
        if (browserToken) embeddedBrowserMcp.revokeToken(browserToken)
        // El proxy MCP muere con el servidor: los tokens de sesión dejan de valer y no queda puerto abierto.
        void mcpProxy?.stop().catch(() => undefined)
      }
      return startTasksServer(folder, {
        corsOrigins: this.opts.corsOrigins,
        noSandbox: fullAccess,
        platform: this.platform,
        tasksWin: this.opts.tasksWin,
        winBackend: this.opts.winBackend,
        // Puerto del proxy MCP (F8-B79): único destino MCP local que Seatbelt deja al servidor sandboxeado. El puerto
        // del MCP del navegador integrado YA NO se abre: solo el proxy (con el token real) puede hablarle.
        extraOutboundPorts: mcpProxy ? [mcpProxy.port] : undefined,
        // Estado de OpenCode privado por carpeta (S1): nunca ~/.config|.local/share/opencode.
        isolation: fullAccess
          ? undefined
          : {
              privateDir: join(app.getPath('userData'), 'tasks-sandbox', sandboxKey(folder)),
              userData: app.getPath('userData')
            },
        extraEnv: {
          OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
          ...(fullAccess ? { LAZUNOX_FULL_ACCESS: '1' } : {}),
          // Plugin `lazunox-plan-gate` (bash/edit/write/etc. bloqueados hasta aprobar el plan):
          // SOLO en servidores de acceso total; `lazunox-env.js` lo oculta a bash (HIDDEN_SHELL_ENV).
          ...(gateUrl ? { LAZUNOX_PLAN_GATE_URL: gateUrl } : {}),
          // Solo sandbox: sin esto la búsqueda web de OpenCode alterna entre mcp.exa.ai y
          // search.parallel.ai según el hash de la sesión. Fijar el proveedor deja UN único host
          // (`WEB_SEARCH_HOSTS`) que la lista blanca del proxy de egress puede permitir.
          ...(!fullAccess ? { OPENCODE_WEBSEARCH_PROVIDER: 'exa' } : {}),
          // Solo sandbox: el servidor también descubre `~/.claude/skills` del usuario y, si allí hay
          // skills con el mismo nombre (docx, pdf, pptx, xlsx), gana una u otra al azar. Con esto ganan
          // siempre las de la app; las skills del proyecto (`.opencode/skills`) se siguen viendo.
          ...(!fullAccess ? { OPENCODE_DISABLE_EXTERNAL_SKILLS: '1' } : {})
        },
        networkAllowlist: fullAccess
          ? undefined
          : () => [
              ...this.network.effectiveAllowlist(folder),
              ...(this.serverHosts.get(key) ?? []),
              // Política gestionada: hosts que la organización permite siempre.
              ...(loadManagedPolicy()?.extraAllowedHosts ?? [])
            ],
        allowDelete,
        extraFolders: fullAccess ? undefined : extras,
        onEgressBlocked: fullAccess ? undefined : (ev) => this.emit('networkBlocked', { folder, ...ev }),
        onExit: (code) => {
          revokeBrowserToken()
          const e = this.servers.get(key)
          if (!e) return
          e.handle = undefined
          if (e.info.state === 'ready') {
            this.setInfo(folder, fullAccess, { state: 'error', error: t('merr.task.serverEnded', { code: String(code) }) })
          }
        }
      }).catch((err: unknown) => {
        revokeBrowserToken()
        throw err
      })
    })
    const entry = this.servers.get(key)
    if (entry) entry.starting = starting
    return starting.then(
      (handle) => {
        const e = this.servers.get(key)
        if (e) {
          e.handle = handle
          e.starting = undefined
          e.startedAt = Date.now()
        }
        this.setInfo(folder, fullAccess, {
          state: 'ready',
          sandboxed: handle.sandboxed,
          version: handle.version,
          error: undefined
        })
        console.log(`[tasks] servidor listo ${handle.baseUrl} sandbox=${handle.sandboxed} fullAccess=${fullAccess} (${folder})`)
        return handle
      },
      (err: unknown) => {
        const e = this.servers.get(key)
        if (e) e.starting = undefined
        const error = err instanceof Error ? err.message : String(err)
        this.setInfo(folder, fullAccess, { state: 'error', error })
        throw err
      }
    )
  }

  /** Detiene el servidor de la carpeta en el modo indicado (ambos si se omite). */
  async stop(folder: string, fullAccess?: boolean): Promise<void> {
    const f = this.nf(folder)
    const modes = fullAccess === undefined ? [false, true] : [fullAccess]
    await Promise.all(modes.map((m) => this.stopOne(f, m)))
  }

  private async stopOne(f: string, fullAccess: boolean): Promise<void> {
    const key = serverKey(f, fullAccess)
    const e = this.servers.get(key)
    if (!e) return
    e.info = { ...e.info, state: 'stopped' }
    const handle = e.handle ?? (await e.starting?.catch(() => undefined))
    e.handle = undefined
    await handle?.stop()
    this.setInfo(f, fullAccess, { state: 'stopped' })
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.servers.values()].map((e) => this.stopOne(e.info.folder, !!e.info.fullAccess).catch(() => undefined)))
  }

  /** Mata todo de forma síncrona (process.on('exit')). */
  killAllSync(): void {
    for (const e of this.servers.values()) {
      // Grupo entero (MCP, bash…): los servidores se lanzan detached.
      if (e.handle?.pid) killTree(e.handle.pid, 'SIGKILL')
    }
  }

  /**
   * Archivos modificados desde `since` en la carpeta principal y en sus carpetas vinculadas `rw`
   * (las de solo lectura no producen entregables). Los de una vinculada llevan `root`.
   */
  deliverables(folder: string, since: number): TasksDeliverable[] {
    const root = this.nf(folder)
    if (!this.isApproved(root)) {
      if (!this.fullAccessRoots().includes(root)) throw new Error(t('merr.task.notAuthorized'))
      // La carpeta personal entera no se recorre (miles de archivos, ~/Library…): sin entregables detectados.
      if (root === this.nf(homedir())) return []
    }
    const out: TasksDeliverable[] = []
    let seen = 0
    const scan = (base: string, linkedRoot?: string): void => {
      const walk = (dir: string, depth: number): void => {
        if (depth > 6 || seen > MAX_SCAN_FILES) return
        let names: string[]
        try {
          names = readdirSync(dir)
        } catch {
          return
        }
        for (const name of names) {
          if (SKIP_DIRS.has(name)) continue
          const full = join(dir, name)
          let st
          try {
            st = statSync(full)
          } catch {
            continue
          }
          seen++
          if (st.isDirectory()) walk(full, depth + 1)
          else if (st.isFile() && st.mtimeMs >= since) {
            out.push({
              path: full,
              relPath: relative(base, full),
              size: st.size,
              mtime: st.mtimeMs,
              ...(linkedRoot ? { root: linkedRoot } : {})
            })
          }
        }
      }
      walk(base, 0)
    }
    scan(root)
    for (const l of this.load().linked[root] ?? []) {
      // La principal ya recorre lo que hay dentro de ella; una vinculada ancestra no se recorre entera.
      if (l.mode !== 'rw' || this.inside(l.path, root) || this.inside(root, l.path) || !existsSync(l.path)) continue
      scan(l.path, l.path)
    }
    return out.sort((a, b) => b.mtime - a.mtime).slice(0, 200)
  }

  /**
   * ¿La ruta está en la carpeta de trabajo de Control total (con consentimiento del equipo)? Aun así se niegan los
   * mismos secretos que el sandbox (`~/.ssh`, claves de nube, config de OpenCode…) a las funciones de la interfaz.
   */
  private insideFullWorkspace(p: string): boolean {
    if (!this.fullAccessRoots().some((r) => this.inside(p, r))) return false
    const home = this.nf(homedir())
    return !defaultDeniedReadPaths(home).some((d) => this.inside(p, d) || this.inside(p, this.nf(d)))
  }

  /** Verifica que una ruta esté dentro de una carpeta de Tareas, vinculada o de confianza (o del espacio de Control total). */
  assertInsideApproved(path: string): string {
    // Windows: UNA puerta de entrada (`resolveUiPath`: rechaza UNC, dispositivos, ADS, `..`, 8.3, reservados) y `/win/c/x`
    // se traduce a `C:\x`. Traducir no autoriza: después se exige pertenecer a una carpeta aprobada.
    let input = path
    if (this.win) {
      const r = resolveUiPath(path, 'win32')
      if (!r.ok) throw new Error(t('merr.task.pathNotAuthorized'))
      input = r.path
    }
    const p = this.nf(input)
    const ok = isApprovedPath(p, this.load(), (a, b) => this.inside(a, b))
    if (!ok && !this.insideFullWorkspace(p)) throw new Error(t('merr.task.pathNotAuthorized'))
    return p
  }
}
