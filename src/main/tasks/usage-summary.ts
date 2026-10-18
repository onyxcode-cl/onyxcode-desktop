/**
 * Uso de Overdrive para «Ajustes › Uso» (F8-B198). Cada carpeta aprobada de Tareas tiene su propio servidor aislado y, dentro de su
 * directorio privado (`userData/tasks-sandbox/<clave>/data/opencode/opencode.db`), su propia base de datos de sesiones. El motor ya
 * guarda ahí, por sesión, los tokens y el costo; aquí solo se LEEN esos totales, sin arrancar ningún servidor y sin tocar mensajes.
 *
 * Qué sale de aquí (y qué no): por sesión, un id opaco, el id del padre, el modelo (id y servicio), el costo, los tokens y la fecha de
 * la última actividad. NUNCA títulos, mensajes, rutas, carpetas ni nombres de proyecto. Es lo mínimo que necesita la agregación.
 *
 * Seguridad de la lectura (el servidor aislado puede escribir en su propio directorio, así que el archivo NO es de fiar):
 *  - Solo se abren los archivos de las carpetas aprobadas, en la ruta fija de arriba, que existan, sean archivos normales y no
 *    enlaces (`lstat`); la clave la calcula `sandboxKey`, nunca viene del renderer.
 *  - Se abren en modo solo lectura (`readOnly` + `query_only`), sin extensiones, y `session` debe ser una TABLA (no una vista).
 *  - Cada valor se valida (texto corto, números finitos y no negativos) y todo tiene tope: lo peor que logra un archivo manipulado
 *    es falsear sus propias cifras, igual que el motor las informa.
 *  - Si el archivo no se puede leer o no tiene las columnas esperadas (otra versión del motor), esa carpeta se cuenta como «no leída»
 *    y la pantalla lo dice; nunca se inventan cifras.
 * En Windows el servidor vive dentro de WSL (su base de datos está en el disco virtual de la distro): ahí `supported` es `false`.
 */
import { createRequire } from 'node:module'
import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import type { TasksUsageSession, TasksUsageSummary } from '@shared/ipc-tasks'

/** Sesiones más recientes que se leen de cada carpeta y en total. */
export const TASKS_USAGE_PER_FOLDER = 300
export const TASKS_USAGE_MAX = 1000

/** Lo mínimo de `node:sqlite` que se usa (así las pruebas pueden pasar una base falsa). */
export interface UsageDb {
  prepare(sql: string): { all(...params: Array<string | number>): unknown[] }
  close(): void
}
export type OpenUsageDb = (path: string) => UsageDb

/** Abre un archivo SQLite en solo lectura con `node:sqlite` (incluido en Electron/Node 22.5+). */
export const openReadOnly: OpenUsageDb = (path) => {
  const req = createRequire(process.execPath)
  const { DatabaseSync } = req('node:sqlite') as { DatabaseSync: new (p: string, o?: { readOnly?: boolean }) => UsageDb }
  const db = new DatabaseSync(path, { readOnly: true })
  db.prepare('PRAGMA query_only = 1').all()
  return db
}

export interface TasksUsageEnv {
  /** `app.getPath('userData')`. */
  userData: string
  /** `sandboxKey` de sandbox-profile (clave del directorio privado de una carpeta). */
  sandboxKey: (folder: string) => string
  platform?: NodeJS.Platform
  open?: OpenUsageDb
}

const COLUMNS = [
  'id',
  'parent_id',
  'model',
  'cost',
  'tokens_input',
  'tokens_output',
  'tokens_reasoning',
  'tokens_cache_read',
  'tokens_cache_write',
  'time_updated',
  'time_archived'
] as const

const text = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

/** `model` se guarda como JSON `{id, providerID}`; cualquier otra cosa se ignora. */
function modelOf(v: unknown): TasksUsageSession['model'] | undefined {
  if (typeof v !== 'string' || v.length > 1000) return undefined
  try {
    const o = JSON.parse(v) as { id?: unknown; providerID?: unknown }
    const id = text(o?.id)
    const providerID = text(o?.providerID)
    return id && providerID ? { id, providerID } : undefined
  } catch {
    return undefined
  }
}

function dbFile(env: TasksUsageEnv, folder: string): string | null {
  const file = join(env.userData, 'tasks-sandbox', env.sandboxKey(folder), 'data', 'opencode', 'opencode.db')
  try {
    const st = lstatSync(file)
    return st.isFile() && !st.isSymbolicLink() ? file : null
  } catch {
    return null
  }
}

/** Sesiones de UNA carpeta, o `null` si su archivo no se puede leer con el esquema esperado. `undefined`: no hay archivo (aún sin tareas). */
function readFolder(env: TasksUsageEnv, folder: string, perFolder: number): TasksUsageSession[] | null | undefined {
  const file = dbFile(env, folder)
  if (!file) return undefined
  let db: UsageDb | null = null
  try {
    db = (env.open ?? openReadOnly)(file)
    const kind = db.prepare("SELECT type FROM sqlite_master WHERE name = 'session'").all() as Array<{ type?: unknown }>
    if (kind.length !== 1 || kind[0]?.type !== 'table') return null
    const cols = new Set((db.prepare('PRAGMA table_info(session)').all() as Array<{ name?: unknown }>).map((c) => String(c.name)))
    if (!COLUMNS.every((c) => cols.has(c))) return null
    const rows = db
      .prepare(`SELECT ${COLUMNS.join(', ')} FROM session WHERE time_archived IS NULL ORDER BY time_updated DESC LIMIT ?`)
      .all(perFolder) as Array<Record<string, unknown>>
    const out: TasksUsageSession[] = []
    for (const r of rows) {
      const id = text(r.id)
      if (!id) continue
      const parentID = text(r.parent_id)
      const model = modelOf(r.model)
      out.push({
        id,
        ...(parentID ? { parentID } : {}),
        ...(model ? { model } : {}),
        cost: num(r.cost),
        tokens: {
          input: num(r.tokens_input),
          output: num(r.tokens_output),
          reasoning: num(r.tokens_reasoning),
          cache: { read: num(r.tokens_cache_read), write: num(r.tokens_cache_write) }
        },
        updated: num(r.time_updated)
      })
    }
    return out
  } catch {
    return null
  } finally {
    try {
      db?.close()
    } catch {
      // nada que cerrar
    }
  }
}

/**
 * Resumen de uso de las carpetas aprobadas. Barato (una consulta de solo lectura por carpeta) y sin efectos: no arranca servidores.
 * `folders` son las rutas aprobadas que ya conoce el gestor de Tareas.
 */
export function tasksUsageSummary(env: TasksUsageEnv, folders: readonly string[]): TasksUsageSummary {
  if ((env.platform ?? process.platform) === 'win32') return { supported: false, folders: 0, unreadable: 0, sessions: [], capped: false }
  const seen = new Set<string>()
  const sessions: TasksUsageSession[] = []
  let read = 0
  let unreadable = 0
  let hitLimit = false
  for (const folder of folders) {
    const rows = readFolder(env, folder, TASKS_USAGE_PER_FOLDER)
    if (rows === undefined) continue
    if (rows === null) {
      unreadable++
      continue
    }
    read++
    if (rows.length >= TASKS_USAGE_PER_FOLDER) hitLimit = true
    for (const s of rows) {
      if (seen.has(s.id)) continue
      seen.add(s.id)
      sessions.push(s)
    }
  }
  sessions.sort((a, b) => b.updated - a.updated)
  const capped = hitLimit || sessions.length > TASKS_USAGE_MAX
  return { supported: true, folders: read, unreadable, sessions: sessions.slice(0, TASKS_USAGE_MAX), capped }
}
