// Uso de Overdrive (F8-B198): lectura de solo lectura de los registros aislados de cada carpeta aprobada. Bases SQLite reales y temporales.
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { posixOnly } from '../../test/platform'
import { TASKS_USAGE_MAX, TASKS_USAGE_PER_FOLDER, tasksUsageSummary, type TasksUsageEnv } from './usage-summary'

type Db = { exec(sql: string): void; prepare(sql: string): { run(...p: unknown[]): unknown }; close(): void }
const { DatabaseSync } = createRequire(process.execPath)('node:sqlite') as { DatabaseSync: new (p: string) => Db }

const SCHEMA = `CREATE TABLE session (
  id text PRIMARY KEY, project_id text NOT NULL, parent_id text, directory text NOT NULL, title text NOT NULL,
  cost real DEFAULT 0 NOT NULL, tokens_input integer DEFAULT 0 NOT NULL, tokens_output integer DEFAULT 0 NOT NULL,
  tokens_reasoning integer DEFAULT 0 NOT NULL, tokens_cache_read integer DEFAULT 0 NOT NULL, tokens_cache_write integer DEFAULT 0 NOT NULL,
  model text, time_updated integer NOT NULL, time_archived integer)`

let root: string
let env: TasksUsageEnv
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lzx-usage-'))
  env = { userData: root, sandboxKey: (f) => `k-${basename(f)}`, platform: 'darwin' }
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const dbPath = (folder: string): string => join(root, 'tasks-sandbox', `k-${basename(folder)}`, 'data', 'opencode', 'opencode.db')
function makeDb(folder: string, build: (db: Db) => void, schema = SCHEMA): string {
  const file = dbPath(folder)
  mkdirSync(join(file, '..'), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(schema)
  build(db)
  db.close()
  return file
}
const add = (
  db: Db,
  id: string,
  o: Partial<{
    parent: string | null
    model: string | null
    cost: number
    inp: number
    out: number
    updated: number
    archived: number | null
  }> = {}
): void => {
  db.prepare(
    'INSERT INTO session (id, project_id, parent_id, directory, title, cost, tokens_input, tokens_output, model, time_updated, time_archived) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).run(
    id,
    'p',
    o.parent ?? null,
    '/Users/secreto/proyecto',
    'Título privado de la tarea',
    o.cost ?? 0,
    o.inp ?? 0,
    o.out ?? 0,
    o.model === undefined ? JSON.stringify({ id: 'm1', providerID: 'prov' }) : o.model,
    o.updated ?? 1000,
    o.archived ?? null
  )
}

describe('uso de Overdrive: lectura de los registros aislados', () => {
  it('suma las sesiones de varias carpetas aprobadas, con modelo, tokens y costo', () => {
    makeDb('/a/uno', (db) => {
      add(db, 's1', { inp: 100, out: 40, cost: 0.5, updated: 3000 })
      add(db, 's2', { parent: 's1', inp: 10, out: 5, updated: 2000 })
    })
    makeDb('/b/dos', (db) => add(db, 's3', { inp: 7, out: 3, model: JSON.stringify({ id: 'm2', providerID: 'otro' }), updated: 4000 }))
    const r = tasksUsageSummary(env, ['/a/uno', '/b/dos'])
    expect(r).toMatchObject({ supported: true, folders: 2, unreadable: 0, capped: false })
    expect(r.sessions.map((s) => s.id)).toEqual(['s3', 's1', 's2'])
    expect(r.sessions[1]).toEqual({
      id: 's1',
      model: { id: 'm1', providerID: 'prov' },
      cost: 0.5,
      tokens: { input: 100, output: 40, reasoning: 0, cache: { read: 0, write: 0 } },
      updated: 3000
    })
    expect(r.sessions[2]?.parentID).toBe('s1')
  })

  it('no entrega títulos, rutas ni carpetas: solo cifras', () => {
    makeDb('/a/uno', (db) => add(db, 's1', { inp: 1 }))
    const json = JSON.stringify(tasksUsageSummary(env, ['/a/uno']))
    expect(json).not.toContain('Título privado')
    expect(json).not.toContain('/Users/secreto')
    expect(json).not.toContain('proyecto')
  })

  it('las tareas archivadas no cuentan (igual que en Chat y Code)', () => {
    makeDb('/a/uno', (db) => {
      add(db, 'vivo')
      add(db, 'archivado', { archived: 5 })
    })
    expect(tasksUsageSummary(env, ['/a/uno']).sessions.map((s) => s.id)).toEqual(['vivo'])
  })

  it('una carpeta sin registro todavía (sin tareas) no cuenta ni como leída ni como ilegible', () => {
    makeDb('/a/uno', (db) => add(db, 's1'))
    expect(tasksUsageSummary(env, ['/a/uno', '/c/sin-nada'])).toMatchObject({ folders: 1, unreadable: 0 })
  })

  it('sin carpetas aprobadas: vacío, soportado', () => {
    expect(tasksUsageSummary(env, [])).toEqual({ supported: true, folders: 0, unreadable: 0, sessions: [], capped: false })
  })

  it('Windows (WSL): no soportado, y ni siquiera mira el disco', () => {
    makeDb('/a/uno', (db) => add(db, 's1'))
    expect(tasksUsageSummary({ ...env, platform: 'win32' }, ['/a/uno'])).toEqual({
      supported: false,
      folders: 0,
      unreadable: 0,
      sessions: [],
      capped: false
    })
  })

  it('una sesión repetida en dos carpetas se cuenta una vez', () => {
    makeDb('/a/uno', (db) => add(db, 'igual', { inp: 5 }))
    makeDb('/b/dos', (db) => add(db, 'igual', { inp: 5 }))
    expect(tasksUsageSummary(env, ['/a/uno', '/b/dos']).sessions).toHaveLength(1)
  })

  it('el tope por carpeta avisa de que hay más sin contar', () => {
    makeDb('/a/uno', (db) => {
      db.exec('BEGIN')
      for (let i = 0; i < TASKS_USAGE_PER_FOLDER + 20; i++) add(db, `s${i}`, { updated: i })
      db.exec('COMMIT')
    })
    const r = tasksUsageSummary(env, ['/a/uno'])
    expect(r.sessions).toHaveLength(TASKS_USAGE_PER_FOLDER)
    expect(r.capped).toBe(true)
    expect(r.sessions[0]?.id).toBe(`s${TASKS_USAGE_PER_FOLDER + 19}`)
    expect(TASKS_USAGE_MAX).toBeGreaterThanOrEqual(TASKS_USAGE_PER_FOLDER)
  })

  it('NO modifica el registro (solo lectura): el archivo queda idéntico y el motor puede seguir escribiendo', () => {
    const file = makeDb('/a/uno', (db) => {
      db.exec('PRAGMA journal_mode = WAL')
      add(db, 's1')
    })
    const snap = (): string => `${createHash('sha256').update(readFileSync(file)).digest('hex')}|${statSync(file).mtimeMs}`
    const before = snap()
    expect(tasksUsageSummary(env, ['/a/uno']).sessions).toHaveLength(1)
    expect(snap()).toBe(before)
    // Quien escribe (el servidor del motor) sigue pudiendo hacerlo después de nuestra lectura.
    const db = new DatabaseSync(file)
    add(db, 's2', { updated: 5000 })
    db.close()
    expect(tasksUsageSummary(env, ['/a/uno']).sessions.map((x) => x.id)).toEqual(['s2', 's1'])
  })
})

describe('uso de Overdrive: el archivo no es de fiar', () => {
  it('valores raros (negativos, textos enormes, modelo que no es JSON) se limpian', () => {
    makeDb('/a/uno', (db) => {
      add(db, 'x'.repeat(500), { inp: 1 })
      add(db, 'ok', { inp: -50, out: 2, cost: -1, model: 'esto no es json' })
      add(db, 'ok2', { model: JSON.stringify({ id: 'y'.repeat(500), providerID: 'p' }) })
    })
    const r = tasksUsageSummary(env, ['/a/uno'])
    expect(r.sessions.map((s) => s.id).sort()).toEqual(['ok', 'ok2'])
    const ok = r.sessions.find((s) => s.id === 'ok')!
    expect(ok.tokens.input).toBe(0)
    expect(ok.tokens.output).toBe(2)
    expect(ok.cost).toBe(0)
    expect(ok.model).toBeUndefined()
    expect(r.sessions.find((s) => s.id === 'ok2')!.model).toBeUndefined()
  })

  it('un archivo que no es SQLite se cuenta como no leído', () => {
    const file = dbPath('/a/uno')
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, 'basura que no es una base de datos '.repeat(50))
    expect(tasksUsageSummary(env, ['/a/uno'])).toMatchObject({ folders: 0, unreadable: 1, sessions: [] })
  })

  it('otra versión del motor (faltan columnas) o `session` convertida en vista: no leída, sin cifras inventadas', () => {
    makeDb('/a/uno', () => undefined, 'CREATE TABLE session (id text, title text)')
    makeDb(
      '/b/dos',
      () => undefined,
      `CREATE TABLE real_s (id text, parent_id text, model text, cost real, tokens_input int, tokens_output int, tokens_reasoning int,
        tokens_cache_read int, tokens_cache_write int, time_updated int, time_archived int);
       INSERT INTO real_s VALUES ('v', NULL, NULL, 9, 9, 9, 9, 9, 9, 1, NULL);
       CREATE VIEW session AS SELECT * FROM real_s`
    )
    expect(tasksUsageSummary(env, ['/a/uno', '/b/dos'])).toMatchObject({ folders: 0, unreadable: 2, sessions: [] })
  })

  it.skipIf(!posixOnly)('un enlace simbólico en lugar del archivo se ignora (no se sigue)', () => {
    const real = join(root, 'ajena.db')
    const db = new DatabaseSync(real)
    db.exec(SCHEMA)
    add(db, 'ajena')
    db.close()
    const file = dbPath('/a/uno')
    mkdirSync(join(file, '..'), { recursive: true })
    symlinkSync(real, file)
    expect(tasksUsageSummary(env, ['/a/uno'])).toMatchObject({ folders: 0, unreadable: 0, sessions: [] })
  })

  it('un fallo al abrir una carpeta no impide leer las demás', () => {
    makeDb('/a/uno', (db) => add(db, 's1'))
    makeDb('/b/dos', (db) => add(db, 's2'))
    let n = 0
    const open: TasksUsageEnv['open'] = (path) => {
      if (n++ === 0) throw new Error('database is locked')
      return new DatabaseSync(path) as never
    }
    const r = tasksUsageSummary({ ...env, open }, ['/a/uno', '/b/dos'])
    expect(r).toMatchObject({ folders: 1, unreadable: 1 })
    expect(r.sessions.map((s) => s.id)).toEqual(['s2'])
  })
})
