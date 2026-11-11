/**
 * Permisos recordados por carpeta ("Siempre permitir"), persistidos en `userData/tasks-rules.json`.
 *
 * Se inyectan en la config inline de los servidores Tareas (`agent.<tasks|computer>.permission`),
 * así que se aplican al (re)abrir la carpeta. NUNCA se recuerdan:
 * - `external_directory` (el acceso a otras carpetas se concede por la vía de carpetas de confianza),
 * - `doom_loop` (el aviso de bucle debe seguir preguntando),
 * - `computer_*` (control del Mac: cada acción pasa por la puerta del plan),
 * - patrones de borrado (`rm`, `rmdir`, `unlink`, `trash`, `srm`, `-delete`).
 * Con `policy.disableAlwaysAllow` (managed.json) `add` lanza error y las reglas no se inyectan.
 */
import { t } from '@shared/i18n'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { TasksPermissionRule } from '@shared/ipc-tasks'
import { loadManagedPolicy } from './policy'
import { emptySavedPermissionDir } from '../opencode/permission-store'

interface Persisted {
  rules: TasksPermissionRule[]
  /**
   * Carpetas cuyos «siempre» guardados por el MOTOR (en su carpeta privada, al alcance de la tarea) ya se descartaron UNA vez. Desde la
   * 1.8.19 el motor aislado no guarda ni carga nada (ver `discardEngineAlwaysRulesOnce`); esto evita volver a tocar lo que una tarea
   * escriba después en esa carpeta.
   */
  engineImported?: string[]
}

/** Misma expresión que `DELETE_RE` de `PermissionPrompt.tsx` (renderer): comandos de borrado. */
const DELETE_RE = /(^|[;&|]\s*)(rm|rmdir|unlink|trash|srm)\b|\s-delete\b/

const PERMISSION_RE = /^[A-Za-z0-9_*.:-]{1,200}$/
const MAX_PATTERN = 2000
const MAX_RULES = 1000

/** Permisos que nunca se recuerdan. */
function isNeverRemembered(permission: string): boolean {
  return (
    permission === 'external_directory' ||
    permission === 'doom_loop' ||
    permission.startsWith('computer_') ||
    permission.startsWith('equipo_')
  )
}

/** Motivo por el que un par permiso/patrón no puede recordarse, o null si es admisible. */
export function ruleRejectionReason(permission: string, pattern: string): string | null {
  if (!PERMISSION_RE.test(permission)) return t('merr.rules.permInvalid', { permission })
  if (isNeverRemembered(permission)) {
    return t('merr.rules.neverRemembered', { permission })
  }
  if (!pattern || pattern.length > MAX_PATTERN) return t('merr.rules.patternInvalid')
  if (DELETE_RE.test(pattern)) return t('merr.rules.deleteNotRemembered', { pattern })
  // Un patrón de bash que empieza por comodín (o es solo comodines) cubriría también `rm`.
  if (permission === 'bash' && (/^[\s*?]*$/.test(pattern) || /^[*?]/.test(pattern.trim()))) {
    return t('merr.rules.patternTooBroad')
  }
  return null
}

export class TasksRulesStore {
  private data: Persisted | null = null

  private get file(): string {
    return join(app.getPath('userData'), 'tasks-rules.json')
  }

  private load(): Persisted {
    if (this.data) return this.data
    let data: Persisted = { rules: [] }
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Persisted>
        if (Array.isArray(raw.engineImported)) data.engineImported = raw.engineImported.filter((f): f is string => typeof f === 'string')
        if (Array.isArray(raw.rules)) {
          data.rules = raw.rules.filter(
            (r): r is TasksPermissionRule =>
              !!r &&
              typeof r.id === 'string' &&
              typeof r.folder === 'string' &&
              typeof r.permission === 'string' &&
              typeof r.pattern === 'string' &&
              typeof r.createdAt === 'number' &&
              // Higiene: descarta reglas que hoy no se aceptarían (archivo editado a mano).
              ruleRejectionReason(r.permission, r.pattern) === null
          )
        }
      }
    } catch (err) {
      console.error('[tasks] tasks-rules.json inválido:', err)
      data = { rules: [] }
    }
    this.data = data
    return data
  }

  private persist(): void {
    const file = this.file
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(this.load(), null, 2), 'utf8')
    renameSync(`${file}.tmp`, file)
  }

  /** Reglas recordadas (de una carpeta, o todas si se omite). */
  list(folder?: string): TasksPermissionRule[] {
    return this.load()
      .rules.filter((r) => folder === undefined || r.folder === folder)
      .map((r) => ({ ...r }))
  }

  /** Recuerda `permission` + cada patrón para la carpeta. Lanza si alguno no es admisible. */
  /**
   * `isolatedOnly`: la persona la dio desde una Tarea AISLADA; no se aplicará en Control total (`rulesPermissionConfig`). Si la misma regla
   * ya existía solo para el modo aislado y ahora se da en Control total, pasa a valer en los dos.
   */
  add(folder: string, permission: string, patterns: string[], opts: { isolatedOnly?: boolean } = {}): TasksPermissionRule[] {
    if (loadManagedPolicy()?.disableAlwaysAllow) {
      throw new Error(t('merr.rules.orgNoAlways'))
    }
    if (!folder) throw new Error(t('merr.rules.noFolder'))
    if (!patterns.length) throw new Error(t('merr.rules.noPatterns'))
    // Todo o nada: si uno no es admisible no se guarda ninguno.
    for (const pattern of patterns) {
      const why = ruleRejectionReason(permission, pattern)
      if (why) throw new Error(why)
    }
    const data = this.load()
    const now = Date.now()
    let changed = false
    for (const pattern of patterns) {
      const existing = data.rules.find((r) => r.folder === folder && r.permission === permission && r.pattern === pattern)
      if (existing) {
        if (existing.isolatedOnly && !opts.isolatedOnly) {
          delete existing.isolatedOnly
          changed = true
        }
        continue
      }
      if (data.rules.length >= MAX_RULES) throw new Error(t('merr.rules.tooMany'))
      data.rules.push({
        id: randomUUID(),
        folder,
        permission,
        pattern,
        createdAt: now,
        ...(opts.isolatedOnly ? { isolatedOnly: true } : {})
      })
      changed = true
    }
    if (changed) this.persist()
    return this.list(folder)
  }

  /** Quita una regla por id. Devuelve todas las que quedan. */
  remove(id: string): TasksPermissionRule[] {
    const data = this.load()
    const before = data.rules.length
    data.rules = data.rules.filter((r) => r.id !== id)
    if (data.rules.length !== before) this.persist()
    return this.list()
  }

  /**
   * Una sola vez por carpeta (1.8.19, H3): los «siempre» que el motor aislado guardó en su carpeta privada antes de esta versión NO se
   * importan (la tarea los pudo escribir, y aquí valdrían también en Control total). Se vacía esa carpeta sin seguir enlaces y la carpeta
   * queda marcada. La persona vuelve a pulsar «Siempre» una vez. Devuelve cuántas entradas quitó.
   */
  discardEngineAlwaysRulesOnce(folder: string, engineDir: string): number {
    const data = this.load()
    if ((data.engineImported ?? []).includes(folder)) return 0
    data.engineImported = [...(data.engineImported ?? []), folder]
    try {
      this.persist()
    } catch (err) {
      console.error('[tasks] no se pudo guardar la migración de permisos «siempre»:', err instanceof Error ? err.message : 'error')
      return 0
    }
    const removed = emptySavedPermissionDir(engineDir)
    if (removed) console.log(`[tasks] se descartaron ${removed} archivos de permisos «siempre» que guardó el motor aislado`)
    return removed
  }

  /** Olvida todas las reglas de una carpeta (al quitarla de Tareas). */
  removeFolder(folder: string): void {
    const data = this.load()
    const before = data.rules.length
    data.rules = data.rules.filter((r) => r.folder !== folder)
    if (data.rules.length !== before) this.persist()
  }
}

export const tasksRules = new TasksRulesStore()

/**
 * Reglas → bloque `permission` de OpenCode: `{ [permission]: { [pattern]: 'allow' } }`.
 * Con `policy.disableAlwaysAllow` devuelve `{}` (las reglas guardadas dejan de aplicarse). Con `fullAccess`, sin las `isolatedOnly`.
 */
export function rulesPermissionConfig(
  rules: TasksPermissionRule[],
  opts: { fullAccess?: boolean } = {}
): Record<string, Record<string, 'allow'>> {
  const out: Record<string, Record<string, 'allow'>> = {}
  if (loadManagedPolicy()?.disableAlwaysAllow) return out
  for (const r of rules) {
    if (ruleRejectionReason(r.permission, r.pattern)) continue
    // Dada en una Tarea aislada: en Control total no vale (ahí el mismo `bash` correría fuera de la jaula).
    if (opts.fullAccess && r.isolatedOnly) continue
    ;(out[r.permission] ??= {})[r.pattern] = 'allow'
  }
  return out
}
