/**
 * Preferencias de Cowork (`userData/tasks-prefs.json`): auto-archivo, parada por inactividad,
 * máximo de servidores y notificaciones por tipo. Todo valor persistido o recibido se valida y se
 * recorta a su rango; la política gestionada (`maxAutoArchiveDays`) se inyecta como función para
 * que este módulo no dependa de Electron.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_COWORK_PREFS, type CoworkNotifyPrefs, type CoworkPrefs } from '@shared/ipc-tasks'

export const AUTO_ARCHIVE_MAX_DAYS = 365
export const IDLE_STOP_MAX_MINUTES = 1440
export const MAX_SERVERS_MIN = 1
export const MAX_SERVERS_MAX = 12

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, Math.round(v)))
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/** Normaliza un objeto cualquiera a `CoworkPrefs` válidos (sin política). */
export function normalizeCoworkPrefs(input: unknown, base: CoworkPrefs = DEFAULT_COWORK_PREFS): CoworkPrefs {
  const o = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const n = o.notify && typeof o.notify === 'object' ? (o.notify as Record<string, unknown>) : {}
  const notify: CoworkNotifyPrefs = {
    done: bool(n.done, base.notify.done),
    approval: bool(n.approval, base.notify.approval),
    question: bool(n.question, base.notify.question),
    error: bool(n.error, base.notify.error)
  }
  return {
    autoArchiveDays: clampInt(o.autoArchiveDays, 0, AUTO_ARCHIVE_MAX_DAYS, base.autoArchiveDays),
    idleStopMinutes: clampInt(o.idleStopMinutes, 0, IDLE_STOP_MAX_MINUTES, base.idleStopMinutes),
    maxServers: clampInt(o.maxServers, MAX_SERVERS_MIN, MAX_SERVERS_MAX, base.maxServers),
    notify
  }
}

/**
 * Aplica el tope de la política: con `maxAutoArchiveDays = m > 0`, "nunca" (0) y cualquier valor
 * mayor que `m` quedan en `m`.
 */
export function applyPolicyToPrefs(p: CoworkPrefs, maxAutoArchiveDays: number | undefined | null): CoworkPrefs {
  const m = typeof maxAutoArchiveDays === 'number' && Number.isFinite(maxAutoArchiveDays) ? Math.floor(maxAutoArchiveDays) : 0
  if (m <= 0) return p
  const days = p.autoArchiveDays === 0 || p.autoArchiveDays > m ? m : p.autoArchiveDays
  return days === p.autoArchiveDays ? p : { ...p, autoArchiveDays: days }
}

export interface CoworkPrefsStoreOptions {
  /** `maxAutoArchiveDays` de la política gestionada (o undefined si no hay). */
  policyMaxAutoArchiveDays?: () => number | undefined | null
}

export class CoworkPrefsStore {
  private cache: CoworkPrefs | null = null

  constructor(
    private readonly file: string,
    private readonly opts: CoworkPrefsStoreOptions = {}
  ) {}

  private load(): CoworkPrefs {
    if (this.cache) return this.cache
    let raw: unknown = null
    try {
      if (existsSync(this.file)) raw = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch (err) {
      console.error('[tasks] tasks-prefs.json inválido, usando valores por defecto:', err)
    }
    this.cache = normalizeCoworkPrefs(raw)
    return this.cache
  }

  /** Preferencias efectivas (recortadas y con el tope de la política aplicado). */
  get(): CoworkPrefs {
    const p = applyPolicyToPrefs(this.load(), this.opts.policyMaxAutoArchiveDays?.())
    return { ...p, notify: { ...p.notify } }
  }

  set(patch: {
    autoArchiveDays?: number
    idleStopMinutes?: number
    maxServers?: number
    notify?: Partial<CoworkNotifyPrefs>
  }): CoworkPrefs {
    const cur = this.load()
    const next = normalizeCoworkPrefs(
      {
        autoArchiveDays: patch.autoArchiveDays ?? cur.autoArchiveDays,
        idleStopMinutes: patch.idleStopMinutes ?? cur.idleStopMinutes,
        maxServers: patch.maxServers ?? cur.maxServers,
        notify: { ...cur.notify, ...(patch.notify ?? {}) }
      },
      cur
    )
    this.cache = next
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
    renameSync(tmp, this.file)
    return this.get()
  }
}
