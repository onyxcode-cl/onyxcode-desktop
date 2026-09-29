/**
 * Gestor de Cowork: carpetas de Cowork (userData/cowork.json) y un `opencode serve`
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
import { app } from 'electron'
import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import {
  FULL_ACCESS_NOT_GRANTED,
  type ComputerUseInfo,
  type CoworkConnection,
  type CoworkDeliverable,
  type CoworkFolder,
  type CoworkFolderSet,
  type CoworkServerInfo,
  type FolderAccessMode,
  type FolderCheck,
  type LinkedFolder,
  type TrustedFolder
} from '@shared/ipc-cowork'
import { browserService } from '../browser/service'
import { embeddedBrowser } from '../embedded-browser/service'
import { embeddedBrowserMcp } from '../embedded-browser/mcp-server'
import { killTree } from '../opencode/pids'
import { sandboxKey, startCoworkServer, type CoworkServerHandle } from './sandbox'
import { NetworkPolicy, type NetworkPolicyState, type NetworkToggleKey } from './proxy-policy'
import { deepMerge } from './config-merge'
import { coworkMcpContribution } from './mcp-cowork'
import { coworkRules, rulesPermissionConfig } from './rules'
import { skillsInlineConfig } from './opencode-config'
import type { EgressBlockedEvent } from './proxy'
import { forbiddenFolderReason as folderPolicyReason, parseMountOutput, type MountInfo } from './folder-policy'
import { loadManagedPolicy } from './policy'

/** Consentimiento de "Control total" registrado en main (AUDIT.md S7). */
interface FullAccessGrant {
  path: string
  grantedAt: number
}

interface Persisted {
  folders: CoworkFolder[]
  /** Carpetas con Control total concedido explícitamente (`cowork:grantFullAccess`). */
  fullAccess: FullAccessGrant[]
  /** Carpetas con "Permitir borrar, mover y renombrar" concedido (Seatbelt: `file-write-unlink`). */
  deleteGrants: string[]
  /** Carpetas adicionales vinculadas a cada espacio (clave: carpeta principal normalizada). */
  linked: Record<string, LinkedFolder[]>
  /** Carpetas de confianza (todos los espacios). */
  trusted: TrustedFolder[]
}

/** Carpeta adicional efectiva de un servidor sandbox (vinculada ∪ de confianza, sin duplicados). */
interface ExtraFolder {
  path: string
  mode: FolderAccessMode
}

/** Integración con computer use (inyectada para no acoplar el gestor a Electron/IPC). */
export interface CoworkComputerDeps {
  /** Bloque `mcp.computer` para la config de OpenCode, o null si no está disponible. */
  mcpConfig: () => Promise<Record<string, unknown> | null>
  info: () => Promise<ComputerUseInfo>
  /**
   * URL+token del canal lateral de eventos (mismo que usa el MCP), para el plugin
   * `onyxcode-plan-gate` del servidor de acceso total. Null si no está disponible (el servidor arranca
   * igual, pero el agente `computer` no tendría MCP tampoco en ese caso).
   */
  planGateUrl: () => Promise<string | null>
}

const NO_COMPUTER: ComputerUseInfo = {
  available: false,
  accessibility: false,
  screenRecording: false,
  reason: 'Solo disponible con Control total.'
}

function serverKey(folder: string, fullAccess: boolean): string {
  return fullAccess ? `${folder}\u0000full` : folder
}

interface Entry {
  info: CoworkServerInfo
  handle?: CoworkServerHandle
  starting?: Promise<CoworkServerHandle>
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
  server: [CoworkServerInfo]
  networkBlocked: [{ folder: string } & EgressBlockedEvent]
}

// '.lapis' se mantiene junto a '.onyxcode' mientras exista el fallback de lectura de memoria de la
// versión anterior de la app (`src/main/cowork/projects.ts`).
const SKIP_DIRS = new Set(['.git', 'node_modules', '.opencode', '.cowork', '.onyxcode', '.lapis', '.venv', '__pycache__', '.DS_Store'])
const MAX_SCAN_FILES = 5000

function normalizeFolder(p: string): string {
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
    console.error('[cowork] no se pudo leer /sbin/mount:', err)
    if (mountCache) mounts = mountCache.mounts
  }
  mountCache = { at: now, mounts }
  return mounts
}

/**
 * Carpetas que nunca se autorizan ni se vinculan (demasiado amplias, del sistema, de red o
 * fuera de las raíces de la política gestionada). Devuelve un motivo accionable o `null`.
 */
export function forbiddenFolderReason(folder: string): string | null {
  const allowedRoots = loadManagedPolicy()?.allowedFolderRoots
  return folderPolicyReason(normalizeFolder(folder), {
    home: normalizeFolder(homedir()),
    userData: normalizeFolder(app.getPath('userData')),
    mounts: currentMounts(),
    allowedRoots: allowedRoots?.map(normalizeFolder)
  })
}

function isInside(p: string, dir: string): boolean {
  return p === dir || p.startsWith(dir + sep)
}

/** Puerto de un bloque MCP `remote` (`{type:'remote', url:'http://127.0.0.1:<puerto>/mcp', ...}`), o null. */
function portOfMcpConfig(cfg: Record<string, unknown> | null): number | null {
  const url = cfg && typeof cfg.url === 'string' ? cfg.url : ''
  if (!url) return null
  try {
    const p = new URL(url).port
    return p ? Number(p) : null
  } catch {
    return null
  }
}

export class CoworkManager extends EventEmitter<ManagerEvents> {
  private servers = new Map<string, Entry>()
  private data: Persisted | null = null
  readonly network = new NetworkPolicy()

  constructor(private readonly opts: { corsOrigins?: string[]; computer?: CoworkComputerDeps } = {}) {
    super()
  }

  networkState(): NetworkPolicyState {
    return this.network.state()
  }

  /** "Permitir esta vez" (tarjeta de bloqueo): no persiste, efecto inmediato (el proxy relee la lista en cada conexión). */
  networkAllowOnce(folder: string, host: string): void {
    this.assertCustomHostsAllowed()
    this.network.allowOnce(normalizeFolder(folder), host)
  }

  /** Política gestionada: con `disableCustomHosts` no se añaden sitios a la red de Cowork. */
  private assertCustomHostsAllowed(): void {
    if (loadManagedPolicy()?.disableCustomHosts) {
      throw new Error('Tu organización no permite añadir sitios a la red de Cowork.')
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
    return join(app.getPath('userData'), 'cowork.json')
  }

  private load(): Persisted {
    if (this.data) return this.data
    let data: Persisted = { folders: [], fullAccess: [], deleteGrants: [], linked: {}, trusted: [] }
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Persisted>
        if (Array.isArray(raw.folders)) {
          data.folders = raw.folders.filter(
            (f): f is CoworkFolder => !!f && typeof f.path === 'string' && typeof f.approvedAt === 'number'
          )
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
      }
    } catch (err) {
      console.error('[cowork] cowork.json inválido:', err)
      data = { folders: [], fullAccess: [], deleteGrants: [], linked: {}, trusted: [] }
    }
    this.data = data
    return data
  }

  /** true si el usuario concedió "Permitir borrar, mover y renombrar" para esta carpeta. */
  hasDeleteGrant(folder: string): boolean {
    return this.load().deleteGrants.includes(normalizeFolder(folder))
  }

  /** Concede/retira "Permitir borrar, mover y renombrar" y reinicia el servidor sandboxeado si está vivo. */
  async setDeleteGrant(folder: string, allowed: boolean): Promise<void> {
    const f = normalizeFolder(folder)
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
    const f = normalizeFolder(folder)
    const cur = this.servers.get(serverKey(f, false))
    if (!cur?.handle && !cur?.starting) return false
    await this.stopOne(f, false)
    await this.spawn(f, false)
    return true
  }

  private save(): void {
    const file = this.file
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(this.load(), null, 2), 'utf8')
    renameSync(`${file}.tmp`, file)
  }

  listFolders(): CoworkFolder[] {
    return [...this.load().folders]
      .sort((a, b) => (b.lastUsedAt ?? b.approvedAt) - (a.lastUsedAt ?? a.approvedAt))
      .map((f) => ({ ...f, fullAccess: this.hasFullAccessGrant(f.path) }))
  }

  isApproved(folder: string): boolean {
    const f = normalizeFolder(folder)
    return this.load().folders.some((x) => x.path === f)
  }

  approveFolder(folder: string): CoworkFolder {
    const f = normalizeFolder(folder)
    if (!existsSync(f) || !statSync(f).isDirectory()) throw new Error(`No es una carpeta válida: ${f}`)
    const reason = forbiddenFolderReason(f)
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
    const f = normalizeFolder(folder)
    await this.stop(f)
    const data = this.load()
    data.folders = data.folders.filter((x) => x.path !== f)
    data.fullAccess = data.fullAccess.filter((g) => g.path !== f)
    data.deleteGrants = data.deleteGrants.filter((p) => p !== f)
    delete data.linked[f]
    this.save()
    this.network.clearFolder(f)
    coworkRules.removeFolder(f)
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
      const p = normalizeFolder(path)
      if (p === primary || out.has(p)) return
      if (mode === 'rw' && isInside(p, primary)) return
      try {
        if (!statSync(p).isDirectory()) return
      } catch {
        return
      }
      if (forbiddenFolderReason(p)) return
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
    const f = normalizeFolder(folder)
    if (!this.isApproved(f)) throw new Error('La carpeta no está autorizada para Cowork.')
    return f
  }

  /** Conjunto de carpetas de un espacio; `applied` es false si el servidor sandbox en marcha arrancó con otro. */
  folderSet(folder: string): CoworkFolderSet {
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
    const normalized = normalizeFolder(path)
    try {
      if (!existsSync(normalized) || !statSync(normalized).isDirectory()) {
        return { ok: false, normalized, reason: `No es una carpeta válida: ${normalized}` }
      }
    } catch {
      return { ok: false, normalized, reason: `No es una carpeta válida: ${normalized}` }
    }
    const reason = forbiddenFolderReason(normalized)
    return reason ? { ok: false, normalized, reason } : { ok: true, normalized }
  }

  private assertCheck(path: string): string {
    const c = this.checkFolder(path)
    if (!c.ok) throw new Error(c.reason ?? `No es una carpeta válida: ${c.normalized}`)
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
  ): Promise<CoworkFolderSet & { restarted: boolean }> {
    const f = this.requireApproved(folder)
    const p = this.assertCheck(path)
    if (p === f) throw new Error('Esa es la carpeta principal del espacio; ya tiene acceso de escritura.')
    if (mode === 'rw' && isInside(p, f)) throw new Error('Esa carpeta ya está dentro de la carpeta principal.')
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
  async unlinkFolder(
    folder: string,
    path: string,
    opts: { restart?: boolean } = {}
  ): Promise<CoworkFolderSet & { restarted: boolean }> {
    const f = this.requireApproved(folder)
    const p = normalizeFolder(path)
    const data = this.load()
    const before = data.linked[f] ?? []
    data.linked[f] = before.filter((l) => l.path !== p && l.path !== path)
    if (data.linked[f].length === 0) delete data.linked[f]
    if (data.linked[f]?.length !== before.length) this.save()
    return this.applyFolderChange(f, opts.restart)
  }

  private async applyFolderChange(f: string, restart: boolean | undefined): Promise<CoworkFolderSet & { restarted: boolean }> {
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
    const p = normalizeFolder(path)
    const data = this.load()
    const before = data.trusted.length
    data.trusted = data.trusted.filter((t) => t.path !== p && t.path !== path)
    if (data.trusted.length !== before) this.save()
    return this.trustedList()
  }

  hasFullAccessGrant(folder: string): boolean {
    // Política gestionada: con `disableFullAccess` ninguna concesión previa vale.
    if (loadManagedPolicy()?.disableFullAccess) return false
    const f = normalizeFolder(folder)
    return this.load().fullAccess.some((g) => g.path === f)
  }

  /** Registra el consentimiento explícito de Control total (tras el diálogo de confirmación). */
  grantFullAccess(folder: string): void {
    if (loadManagedPolicy()?.disableFullAccess) {
      throw new Error('Tu organización ha desactivado el Control total del Mac.')
    }
    const f = normalizeFolder(folder)
    if (!this.isApproved(f)) throw new Error('La carpeta no está autorizada para Cowork.')
    const data = this.load()
    if (!data.fullAccess.some((g) => g.path === f)) {
      data.fullAccess.push({ path: f, grantedAt: Date.now() })
      this.save()
    }
  }

  /** Retira el Control total y detiene su servidor (sin sandbox) si estaba en marcha. */
  async revokeFullAccess(folder: string): Promise<void> {
    const f = normalizeFolder(folder)
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

  listServers(): CoworkServerInfo[] {
    return [...this.servers.values()].map((e) => e.info)
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

  private setInfo(folder: string, fullAccess: boolean, patch: Partial<CoworkServerInfo>): void {
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
  async start(folder: string, fullAccess = false): Promise<CoworkConnection> {
    const f = normalizeFolder(folder)
    if (!this.isApproved(f)) throw new Error('La carpeta no está autorizada para Cowork.')
    if (fullAccess && !this.hasFullAccessGrant(f)) {
      throw new Error(`${FULL_ACCESS_NOT_GRANTED}: el Control total no está autorizado para esta carpeta.`)
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
    const computerUse = fullAccess && this.opts.computer ? await this.opts.computer.info() : NO_COMPUTER
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
   * Devuelve también el puerto del MCP del navegador integrado si se usó (Lote D, B.7), para que
   * `spawn()` lo añada a `extraOutboundPorts` (Seatbelt) cuando el servidor va sandboxeado.
   */
  private async inlineConfig(
    key: string,
    folder: string,
    fullAccess: boolean,
    extras: ExtraFolder[]
  ): Promise<{ config: Record<string, unknown>; browserMcpPort: number | null }> {
    let base: Record<string, unknown>
    let browserMcpPort: number | null = null
    // Idempotente: nos asegura la implementación real del navegador integrado la primera vez que
    // se arranca cualquier servidor de Cowork (sandbox o Control total).
    embeddedBrowserMcp.setApi(embeddedBrowser)
    if (!fullAccess) {
      // Carpetas adicionales (vinculadas o de confianza): el agente no pregunta por ellas. `*` de
      // OpenCode admite `/`, así que `<p>/*` cubre sus subcarpetas. El resto sigue en `ask`; el
      // orden importa (gana la última regla que coincide).
      const externalDirectory: Record<string, 'ask' | 'allow'> = { '*': 'ask' }
      for (const e of extras) {
        externalDirectory[e.path] = 'allow'
        externalDirectory[`${e.path}/*`] = 'allow'
      }
      // Navegador integrado en Sandbox (Lote D, novedad B.7: antes no había navegador aquí). Sin
      // "Chrome aparte" (solo existe en Control total, B.11). `browser_*` queda con el permiso por
      // defecto ('ask'), como cualquier otra herramienta de acción del sandbox: sin `deny` explícito.
      const browserMcp = await embeddedBrowserMcp.configFor({ product: 'cowork', folder, sandboxed: true }).catch(() => null)
      browserMcpPort = portOfMcpConfig(browserMcp)
      // El agente `computer` vive en el OPENCODE_CONFIG_DIR compartido: ocultarlo en el sandbox.
      base = {
        autoupdate: false,
        ...(browserMcp ? { mcp: { browser: browserMcp } } : {}),
        agent: {
          computer: { disable: true },
          ...(extras.length ? { cowork: { permission: { external_directory: externalDirectory } } } : {})
        }
      }
    } else {
      const mcp = this.opts.computer ? await this.opts.computer.mcpConfig().catch(() => null) : null
      this.fullAccessMcp.set(key, !!mcp)
      // Motor de navegador en Control total (Lote D, B.11): Chrome aparte del Lote C si el usuario
      // lo activó ("Usar Chrome aparte") y está disponible; si no, el navegador integrado. Nunca los
      // dos a la vez: un único `mcp.browser` por servidor, con los mismos nombres de herramienta.
      const browserMcp = browserService.state().enabled
        ? await browserService.mcpConfig(folder).catch(() => null)
        : await embeddedBrowserMcp.configFor({ product: 'cowork', folder, sandboxed: false }).catch(() => null)
      const mcpBlock: Record<string, unknown> = {}
      if (mcp) mcpBlock.computer = mcp
      if (browserMcp) mcpBlock.browser = browserMcp
      base = {
        autoupdate: false,
        ...(Object.keys(mcpBlock).length ? { mcp: mcpBlock } : {}),
        // Las herramientas de cada MCP solo para el agente que corresponde (ver agents/computer.md,
        // agents/cowork.md): al agente `cowork` se le deniegan sus `*_*`, igual que ya pasaba con `computer_*`.
        // La puerta del plan (`onyxcode-plan-gate`) es la que de verdad bloquea `browser_*` hasta aprobarlo.
        agent: {
          cowork: {
            permission: {
              'computer_*': 'deny',
              ...(browserMcp ? { 'browser_*': 'deny' } : {})
            }
          }
        }
      }
    }
    // MCP del usuario disponibles en Cowork (`mcp-cowork.ts`); sus hosts remotos entran a la red.
    const c = coworkMcpContribution({ sandboxed: !fullAccess })
    // Con `disableCustomHosts` los hosts de MCP remotos no se suman a la red (política gestionada).
    this.serverHosts.set(key, loadManagedPolicy()?.disableCustomHosts ? [] : c.hosts)
    const hasPerm = Object.keys(c.permission).length > 0
    const mcpBlock: Record<string, unknown> = {
      ...(Object.keys(c.mcp).length ? { mcp: c.mcp } : {}),
      ...(hasPerm ? { agent: { cowork: { permission: c.permission }, computer: { permission: c.permission } } } : {})
    }
    // Permisos "siempre permitir" recordados para esta carpeta (`rules.ts`).
    const p = rulesPermissionConfig(coworkRules.list(folder))
    const rulesBlock: Record<string, unknown> = Object.keys(p).length
      ? { agent: { cowork: { permission: p }, computer: { permission: p } } }
      : {}
    return { config: deepMerge(base, mcpBlock, rulesBlock, skillsInlineConfig()), browserMcpPort }
  }

  private spawn(folder: string, fullAccess: boolean): Promise<CoworkServerHandle> {
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
    const prepared = before.then(() => Promise.all([this.inlineConfig(key, folder, fullAccess, extras), planGateUrl]))
    const starting = prepared.then(([{ config, browserMcpPort }, gateUrl]) =>
      startCoworkServer(folder, {
        corsOrigins: this.opts.corsOrigins,
        noSandbox: fullAccess,
        // Puerto fijo del MCP del navegador integrado (Lote D, B.7): sin esto, Seatbelt bloquearía
        // la conexión del servidor sandboxeado hacia `http://127.0.0.1:<puerto>/mcp`.
        extraOutboundPorts: browserMcpPort ? [browserMcpPort] : undefined,
        // Estado de OpenCode privado por carpeta (S1): nunca ~/.config|.local/share/opencode.
        isolation: fullAccess
          ? undefined
          : {
              privateDir: join(app.getPath('userData'), 'cowork-sandbox', sandboxKey(folder)),
              userData: app.getPath('userData')
            },
        extraEnv: {
          OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
          ...(fullAccess ? { OPENDESK_FULL_ACCESS: '1' } : {}),
          // Plugin `onyxcode-plan-gate` (bash/edit/write/etc. bloqueados hasta aprobar el plan):
          // SOLO en servidores de acceso total; `onyxcode-env.js` lo oculta a bash (HIDDEN_SHELL_ENV).
          ...(gateUrl ? { ONYXCODE_PLAN_GATE_URL: gateUrl } : {}),
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
        onEgressBlocked: fullAccess
          ? undefined
          : (ev) => this.emit('networkBlocked', { folder, ...ev }),
        onExit: (code) => {
          const e = this.servers.get(key)
          if (!e) return
          e.handle = undefined
          if (e.info.state === 'ready') {
            this.setInfo(folder, fullAccess, { state: 'error', error: `El servidor de Cowork terminó (code=${code})` })
          }
        }
      })
    )
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
        console.log(
          `[cowork] servidor listo ${handle.baseUrl} sandbox=${handle.sandboxed} fullAccess=${fullAccess} (${folder})`
        )
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
    const f = normalizeFolder(folder)
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
    await Promise.all(
      [...this.servers.values()].map((e) => this.stopOne(e.info.folder, !!e.info.fullAccess).catch(() => undefined))
    )
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
  deliverables(folder: string, since: number): CoworkDeliverable[] {
    const root = normalizeFolder(folder)
    if (!this.isApproved(root)) throw new Error('La carpeta no está autorizada para Cowork.')
    const out: CoworkDeliverable[] = []
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
      if (l.mode !== 'rw' || isInside(l.path, root) || isInside(root, l.path) || !existsSync(l.path)) continue
      scan(l.path, l.path)
    }
    return out.sort((a, b) => b.mtime - a.mtime).slice(0, 200)
  }

  /** Verifica que una ruta esté dentro de una carpeta de Cowork, vinculada o de confianza. */
  assertInsideApproved(path: string): string {
    const p = normalizeFolder(path)
    const data = this.load()
    const ok =
      data.folders.some((f) => isInside(p, f.path)) ||
      Object.values(data.linked).some((list) => list.some((l) => isInside(p, l.path))) ||
      data.trusted.some((t) => isInside(p, t.path))
    if (!ok) throw new Error('La ruta no pertenece a una carpeta de Cowork autorizada.')
    return p
  }
}
