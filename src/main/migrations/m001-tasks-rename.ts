/**
 * m001: nombres neutros del modo Tareas en userData (ficheros, carpetas, partición y claves dentro de JSON).
 *
 * Garantías:
 *  - Idempotente: cada paso solo actúa si hay rastro viejo.
 *  - Atómico por paso: `renameSync` o tmp+rename; nunca deja un fichero a medias.
 *  - Nunca borra datos: si existen el nombre viejo y el nuevo gana el nuevo y el viejo va a `backups/…/conflicts/`.
 *  - Copia de seguridad previa en `userData/backups/pre-m001-<ts>/` (JSON afectados + `manifest.json` con el diario de
 *    operaciones). Las carpetas grandes se renombran, no se copian. Se conservan las 3 últimas.
 *  - Un paso que falla se registra y se sigue con los demás; el llamador no escribe el registro si hubo fallos.
 */
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  LEGACY_MCP_FLAG_KEY,
  LEGACY_MODE,
  LEGACY_SETTINGS_GLOBAL_INSTRUCTIONS_KEY,
  LEGACY_USERDATA_RENAMES,
  NEW_MODE
} from './legacy-names'
import { exists, isPlainObject, renameKey, writeFileAtomic } from './json-util'

export const M001_ID = 'm001-tasks-rename'
export const BACKUP_PREFIX = 'pre-m001-'
export const KEEP_BACKUPS = 3

export interface M001Manifest {
  id: string
  createdAt: string
  appVersion: string
  /** true cuando todos los pasos terminaron bien. */
  completed: boolean
  /** Rutas relativas a userData copiadas a `<backup>/files/<ruta>` (contenido original). */
  files: string[]
  /** Renombres hechos (diario; se deshacen en orden inverso). */
  renames: Array<{ from: string; to: string }>
  /** Entradas viejas movidas a `<backup>/conflicts/<ruta>` porque ya existía la nueva. */
  conflicts: string[]
}

export type StepStatus = 'ok' | 'noop' | 'failed'
export interface StepResult {
  step: string
  status: StepStatus
  detail?: string
}
export interface M001Report {
  steps: StepResult[]
  failed: number
  changed: boolean
  backupDir: string | null
}
export interface M001Options {
  appVersion?: string
  now?: () => Date
  log?: (msg: string, err?: unknown) => void
}

const defaultLog = (msg: string, err?: unknown): void => {
  if (err) console.error(`[migrations] ${msg}`, err)
  else console.log(`[migrations] ${msg}`)
}

const stamp = (d: Date): string => d.toISOString().replace(/[-:.]/g, '')

export function backupsRoot(userData: string): string {
  return join(userData, 'backups')
}

/** Copias `pre-m001-*` existentes, de la más antigua a la más reciente. */
export function listBackups(userData: string): string[] {
  try {
    return readdirSync(backupsRoot(userData))
      .filter((n) => n.startsWith(BACKUP_PREFIX))
      .sort()
      .map((n) => join(backupsRoot(userData), n))
  } catch {
    return []
  }
}

export function readManifest(dir: string): M001Manifest | null {
  try {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as M001Manifest
    return m && m.id === M001_ID && Array.isArray(m.files) && Array.isArray(m.renames) && Array.isArray(m.conflicts) ? m : null
  } catch {
    return null
  }
}

/** Contexto de una ejecución: crea la copia de seguridad la primera vez que hay algo que tocar. */
class Ctx {
  manifest: M001Manifest | null = null
  backupDir: string | null = null
  changed = false

  constructor(
    readonly userData: string,
    private readonly opts: Required<M001Options>
  ) {}

  private ensure(): M001Manifest {
    if (this.manifest && this.backupDir) return this.manifest
    // Una ejecución anterior incompleta (algún paso falló): se reutiliza su copia para que el diario cubra todo.
    const last = listBackups(this.userData).at(-1)
    const prev = last ? readManifest(last) : null
    if (last && prev && !prev.completed) {
      this.backupDir = last
      this.manifest = prev
    } else {
      const now = this.opts.now()
      this.backupDir = join(backupsRoot(this.userData), `${BACKUP_PREFIX}${stamp(now)}`)
      this.manifest = {
        id: M001_ID,
        createdAt: now.toISOString(),
        appVersion: this.opts.appVersion,
        completed: false,
        files: [],
        renames: [],
        conflicts: []
      }
      mkdirSync(this.backupDir, { recursive: true })
      this.saveManifest()
    }
    return this.manifest
  }

  saveManifest(): void {
    if (this.manifest && this.backupDir) writeFileAtomic(join(this.backupDir, 'manifest.json'), JSON.stringify(this.manifest, null, 2))
  }

  /** Copia el original de un fichero antes de tocarlo (una sola vez; los renombrados ya se copiaron con el nombre viejo). */
  backupFile(rel: string): void {
    const m = this.ensure()
    if (m.files.includes(rel) || m.renames.some((r) => r.to === rel)) return
    const dest = join(this.backupDir as string, 'files', rel)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(join(this.userData, rel), dest)
    m.files.push(rel)
    this.saveManifest()
  }

  rename(from: string, to: string): void {
    const m = this.ensure()
    // Se anota antes de ejecutar: el rollback comprueba existencia, así que una operación no hecha se ignora.
    m.renames.push({ from, to })
    this.saveManifest()
    mkdirSync(dirname(join(this.userData, to)), { recursive: true })
    renameSync(join(this.userData, from), join(this.userData, to))
    this.changed = true
  }

  moveToConflicts(rel: string): void {
    const m = this.ensure()
    m.conflicts.push(rel)
    this.saveManifest()
    const dest = join(this.backupDir as string, 'conflicts', rel)
    mkdirSync(dirname(dest), { recursive: true })
    if (exists(dest)) throw new Error(`ya existe ${dest} en conflicts/`)
    renameSync(join(this.userData, rel), dest)
    this.changed = true
  }

  finish(ok: boolean): void {
    if (!this.manifest) return
    this.manifest.completed = ok
    this.saveManifest()
    if (ok) pruneBackups(this.userData)
  }
}

/** Deja solo las `KEEP_BACKUPS` copias más recientes (únicos datos que este módulo borra: sus propias copias antiguas). */
function pruneBackups(userData: string): void {
  const all = listBackups(userData)
  for (const dir of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) rmSync(dir, { recursive: true, force: true })
}

function renameStep(ctx: Ctx, from: string, to: string): StepResult {
  const step = `rename ${from} -> ${to}`
  const src = join(ctx.userData, from)
  if (!exists(src)) return { step, status: 'noop' }
  if (exists(join(ctx.userData, to))) {
    ctx.moveToConflicts(from)
    return { step, status: 'ok', detail: 'conflicto: gana el nuevo, el viejo va a conflicts/' }
  }
  if (lstatSync(src).isFile()) ctx.backupFile(from)
  ctx.rename(from, to)
  return { step, status: 'ok' }
}

type Transform = (data: Record<string, unknown>) => boolean

const migrateRoutines: Transform = (data) => {
  let changed = false
  for (const list of [data.routines, data.history]) {
    if (!Array.isArray(list)) continue
    for (const r of list) {
      if (isPlainObject(r) && r.mode === LEGACY_MODE) {
        r.mode = NEW_MODE
        changed = true
      }
    }
  }
  return changed
}

const migrateMcpFlags: Transform = (data) => {
  if (!isPlainObject(data.servers)) return false
  let changed = false
  for (const v of Object.values(data.servers)) if (isPlainObject(v) && renameKey(v, LEGACY_MCP_FLAG_KEY, NEW_MODE)) changed = true
  return changed
}

const migrateKeyIn =
  (...path: string[]): Transform =>
  (data) => {
    let cur: unknown = data
    for (const k of path) cur = isPlainObject(cur) ? cur[k] : undefined
    return isPlainObject(cur) && renameKey(cur, LEGACY_MODE, NEW_MODE)
  }

const migrateEmbeddedBrowser: Transform = (data) => {
  // `prefs.agentEnabled.<modo>` también se persiste con la clave del modo.
  const a = migrateKeyIn('sites')(data)
  const b = migrateKeyIn('denied')(data)
  const c = migrateKeyIn('prefs', 'agentEnabled')(data)
  return a || b || c
}

const TRANSFORMS: ReadonlyArray<{ file: string; label: string; fn: Transform }> = [
  {
    file: 'settings.json',
    label: 'settings.json: instrucciones globales',
    fn: (d) => renameKey(d, LEGACY_SETTINGS_GLOBAL_INSTRUCTIONS_KEY, 'tasksGlobalInstructions')
  },
  { file: 'extras.json', label: 'extras.json: modelsByMode', fn: migrateKeyIn('modelsByMode') },
  { file: 'embedded-browser.json', label: 'embedded-browser.json: sites/denied/agentEnabled', fn: migrateEmbeddedBrowser },
  { file: 'routines.json', label: 'routines.json: mode de rutinas', fn: migrateRoutines },
  { file: 'tasks-mcp.json', label: 'tasks-mcp.json: servers[*]', fn: migrateMcpFlags }
]

function transformStep(ctx: Ctx, file: string, label: string, fn: Transform): StepResult {
  const abs = join(ctx.userData, file)
  if (!exists(abs)) return { step: label, status: 'noop' }
  const parsed: unknown = JSON.parse(readFileSync(abs, 'utf8'))
  if (!isPlainObject(parsed)) return { step: label, status: 'noop' }
  if (!fn(parsed)) return { step: label, status: 'noop' }
  ctx.backupFile(file)
  writeFileAtomic(abs, JSON.stringify(parsed, null, 2))
  ctx.changed = true
  return { step: label, status: 'ok' }
}

export function runM001(userData: string, options: M001Options = {}): M001Report {
  const opts: Required<M001Options> = {
    appVersion: options.appVersion ?? '',
    now: options.now ?? (() => new Date()),
    log: options.log ?? defaultLog
  }
  const ctx = new Ctx(userData, opts)
  const steps: StepResult[] = []
  const run = (name: string, fn: () => StepResult): void => {
    try {
      steps.push(fn())
    } catch (err) {
      opts.log(`paso fallido (${name}); se continúa con los demás`, err)
      steps.push({ step: name, status: 'failed', detail: err instanceof Error ? err.message : String(err) })
    }
  }
  for (const [from, to] of LEGACY_USERDATA_RENAMES) run(`rename ${from} -> ${to}`, () => renameStep(ctx, from, to))
  for (const t of TRANSFORMS) run(t.label, () => transformStep(ctx, t.file, t.label, t.fn))
  const failed = steps.filter((s) => s.status === 'failed').length
  try {
    ctx.finish(failed === 0)
  } catch (err) {
    opts.log('no se pudo cerrar la copia de seguridad', err)
  }
  return { steps, failed, changed: ctx.changed, backupDir: ctx.backupDir }
}

export interface RollbackReport {
  backupDir: string
  restoredFiles: number
  undoneRenames: number
  restoredConflicts: number
}

/**
 * Inversa exacta de m001 (solo para tests y soporte: el downgrade no está soportado). Usa el diario de la copia más
 * reciente: deshace renombres en orden inverso, devuelve los conflictos a su sitio, restaura los JSON originales byte a
 * byte y quita m001 del registro `migrations.json`.
 */
export function rollbackM001(userData: string): RollbackReport {
  const dir = listBackups(userData).at(-1)
  const manifest = dir ? readManifest(dir) : null
  if (!dir || !manifest) throw new Error('No hay copia de seguridad pre-m001 con manifiesto')
  let undoneRenames = 0
  for (const { from, to } of [...manifest.renames].reverse()) {
    if (exists(join(userData, to)) && !exists(join(userData, from))) {
      mkdirSync(dirname(join(userData, from)), { recursive: true })
      renameSync(join(userData, to), join(userData, from))
      undoneRenames++
    }
  }
  let restoredConflicts = 0
  for (const rel of [...manifest.conflicts].reverse()) {
    const stored = join(dir, 'conflicts', rel)
    if (exists(stored) && !exists(join(userData, rel))) {
      mkdirSync(dirname(join(userData, rel)), { recursive: true })
      renameSync(stored, join(userData, rel))
      restoredConflicts++
    }
  }
  for (const rel of manifest.files) {
    const dest = join(userData, rel)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(join(dir, 'files', rel), dest)
  }
  removeFromRegistry(userData, M001_ID)
  return { backupDir: dir, restoredFiles: manifest.files.length, undoneRenames, restoredConflicts }
}

function removeFromRegistry(userData: string, id: string): void {
  const file = join(userData, 'migrations.json')
  if (!exists(file)) return
  const reg = JSON.parse(readFileSync(file, 'utf8')) as { schema: number; applied: Array<{ id: string }> }
  const applied = reg.applied.filter((a) => a.id !== id)
  if (applied.length === 0) rmSync(file)
  else writeFileSync(file, JSON.stringify({ ...reg, applied }, null, 2))
}
