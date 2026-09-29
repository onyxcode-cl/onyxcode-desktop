/**
 * Permisos recordados por carpeta ("Siempre permitir"), persistidos en `userData/tasks-rules.json`.
 *
 * Se inyectan en la config inline de los servidores Cowork (`agent.<cowork|computer>.permission`),
 * así que se aplican al (re)abrir la carpeta. NUNCA se recuerdan:
 * - `external_directory` (el acceso a otras carpetas se concede por la vía de carpetas de confianza),
 * - `doom_loop` (el aviso de bucle debe seguir preguntando),
 * - `computer_*` (control del Mac: cada acción pasa por la puerta del plan),
 * - patrones de borrado (`rm`, `rmdir`, `unlink`, `trash`, `srm`, `-delete`).
 * Con `policy.disableAlwaysAllow` (managed.json) `add` lanza error y las reglas no se inyectan.
 */
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CoworkPermissionRule } from '@shared/ipc-cowork'
import { loadManagedPolicy } from './policy'

interface Persisted {
  rules: CoworkPermissionRule[]
}

/** Misma expresión que `DELETE_RE` de `PermissionPrompt.tsx` (renderer): comandos de borrado. */
const DELETE_RE = /(^|[;&|]\s*)(rm|rmdir|unlink|trash|srm)\b|\s-delete\b/

const PERMISSION_RE = /^[A-Za-z0-9_*.:-]{1,200}$/
const MAX_PATTERN = 2000
const MAX_RULES = 1000

/** Permisos que nunca se recuerdan. */
function isNeverRemembered(permission: string): boolean {
  return permission === 'external_directory' || permission === 'doom_loop' || permission.startsWith('computer_')
}

/** Motivo por el que un par permiso/patrón no puede recordarse, o null si es admisible. */
export function ruleRejectionReason(permission: string, pattern: string): string | null {
  if (!PERMISSION_RE.test(permission)) return `Permiso inválido: "${permission}".`
  if (isNeverRemembered(permission)) {
    return `El permiso "${permission}" no se puede recordar: siempre pregunta.`
  }
  if (!pattern || pattern.length > MAX_PATTERN) return 'Patrón inválido.'
  if (DELETE_RE.test(pattern)) return `No se recuerdan permisos de borrado ("${pattern}"): siempre preguntan.`
  // Un patrón de bash que empieza por comodín (o es solo comodines) cubriría también `rm`.
  if (permission === 'bash' && (/^[\s*?]*$/.test(pattern) || /^[*?]/.test(pattern.trim()))) {
    return 'No se puede recordar un patrón de bash tan amplio: cubriría también comandos de borrado.'
  }
  return null
}

export class CoworkRulesStore {
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
        if (Array.isArray(raw.rules)) {
          data.rules = raw.rules.filter(
            (r): r is CoworkPermissionRule =>
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
      console.error('[cowork] tasks-rules.json inválido:', err)
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
  list(folder?: string): CoworkPermissionRule[] {
    return this.load()
      .rules.filter((r) => folder === undefined || r.folder === folder)
      .map((r) => ({ ...r }))
  }

  /** Recuerda `permission` + cada patrón para la carpeta. Lanza si alguno no es admisible. */
  add(folder: string, permission: string, patterns: string[]): CoworkPermissionRule[] {
    if (loadManagedPolicy()?.disableAlwaysAllow) {
      throw new Error('Tu organización desactivó "Siempre permitir".')
    }
    if (!folder) throw new Error('Falta la carpeta.')
    if (!patterns.length) throw new Error('No hay patrones que recordar.')
    // Todo o nada: si uno no es admisible no se guarda ninguno.
    for (const pattern of patterns) {
      const why = ruleRejectionReason(permission, pattern)
      if (why) throw new Error(why)
    }
    const data = this.load()
    const now = Date.now()
    let changed = false
    for (const pattern of patterns) {
      if (data.rules.some((r) => r.folder === folder && r.permission === permission && r.pattern === pattern)) continue
      if (data.rules.length >= MAX_RULES) throw new Error('Demasiados permisos recordados; quita alguno antes.')
      data.rules.push({ id: randomUUID(), folder, permission, pattern, createdAt: now })
      changed = true
    }
    if (changed) this.persist()
    return this.list(folder)
  }

  /** Quita una regla por id. Devuelve todas las que quedan. */
  remove(id: string): CoworkPermissionRule[] {
    const data = this.load()
    const before = data.rules.length
    data.rules = data.rules.filter((r) => r.id !== id)
    if (data.rules.length !== before) this.persist()
    return this.list()
  }

  /** Olvida todas las reglas de una carpeta (al quitarla de Cowork). */
  removeFolder(folder: string): void {
    const data = this.load()
    const before = data.rules.length
    data.rules = data.rules.filter((r) => r.folder !== folder)
    if (data.rules.length !== before) this.persist()
  }
}

export const coworkRules = new CoworkRulesStore()

/**
 * Reglas → bloque `permission` de OpenCode: `{ [permission]: { [pattern]: 'allow' } }`.
 * Con `policy.disableAlwaysAllow` devuelve `{}` (las reglas guardadas dejan de aplicarse).
 */
export function rulesPermissionConfig(rules: CoworkPermissionRule[]): Record<string, Record<string, 'allow'>> {
  const out: Record<string, Record<string, 'allow'>> = {}
  if (loadManagedPolicy()?.disableAlwaysAllow) return out
  for (const r of rules) {
    if (ruleRejectionReason(r.permission, r.pattern)) continue
    ;(out[r.permission] ??= {})[r.pattern] = 'allow'
  }
  return out
}
