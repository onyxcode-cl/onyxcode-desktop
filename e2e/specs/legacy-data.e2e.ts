// Datos viejos: arranca la app REAL con un userData sembrado desde `e2e/fixtures/legacy-userdata/` (nombres anteriores del
// modo Tareas) y comprueba que la migración m001 los pasa a los nombres nuevos sin perder nada.
//
// SALTADO: se activa en el paso 3 del plan de renombrado («se activa en el paso 3»), cuando `runMigrations` se conecte al
// arranque de main. Hasta entonces la app no migra y estas aserciones fallarían. Para activarlo: quitar `.skip`.
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ROOT, startApp, type E2EApp } from '../lib/launch'

const FIXTURE = join(ROOT, 'e2e', 'fixtures', 'legacy-userdata')
const json = <T>(userData: string, rel: string): T => JSON.parse(readFileSync(join(userData, rel), 'utf8')) as T
const backupsOf = (userData: string): string[] =>
  existsSync(join(userData, 'backups')) ? readdirSync(join(userData, 'backups')).filter((n) => n.startsWith('pre-m001-')) : []

describe.skip('datos viejos de userData (se activa en el paso 3)', () => {
  let userData = ''
  let app: E2EApp | null = null
  let registryAt = ''

  beforeAll(() => {
    userData = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-legacy-')))
    cpSync(FIXTURE, userData, { recursive: true })
  })

  afterAll(async () => {
    await app?.stop()
    app = null
    if (userData) rmSync(userData, { recursive: true, force: true })
  })

  it('migra los nombres viejos a los nuevos en el primer arranque', async () => {
    app = await startApp({ userData, keepUserData: true })
    for (const n of [
      'tasks-folders.json',
      'tasks-meta.json',
      'tasks-prefs.json',
      'tasks-projects.json',
      'tasks-rules.json',
      'tasks-network.json',
      'tasks-mcp.json',
      'tasks-auto.json',
      'tasks-keep-awake.json'
    ])
      expect(existsSync(join(userData, n)), n).toBe(true)
    expect(existsSync(join(userData, 'tasks-sandbox/0123456789abcdef/data/opencode/opencode.db'))).toBe(true)
    expect(existsSync(join(userData, 'Partitions/onyxcode-web-tasks/Cookies'))).toBe(true)
    for (const old of [
      'cowork.json',
      'cowork-tasks.json',
      'cowork-rules.json',
      'cowork-mcp.json',
      'cowork-sandbox',
      'Partitions/onyxcode-web-cowork'
    ])
      expect(existsSync(join(userData, old)), old).toBe(false)
    expect(json<Record<string, unknown>>(userData, 'settings.json').tasksGlobalInstructions).toBe('Preferir respuestas breves.')
  })

  it('las rutinas quedan con mode:"tasks"', () => {
    const { routines } = json<{ routines: Array<{ id: string; mode: string }> }>(userData, 'routines.json')
    expect(routines.map((r) => [r.id, r.mode])).toEqual([
      ['rt_1', 'tasks'],
      ['rt_2', 'chat'],
      ['rt_3', 'code']
    ])
  })

  it('las tareas fijadas y las carpetas aprobadas se conservan', () => {
    const meta = json<{ tasks: Array<{ sessionId: string; pinned?: boolean }> }>(userData, 'tasks-meta.json')
    expect(meta.tasks.filter((t) => t.pinned).map((t) => t.sessionId)).toEqual(['ses_pinned_1', 'ses_pinned_2'])
    const folders = json<{ folders: Array<{ path: string }>; fullAccess: unknown[] }>(userData, 'tasks-folders.json')
    expect(folders.folders.map((f) => f.path)).toEqual(['/Users/tester/Proyectos/alfa', '/Users/tester/Proyectos/beta'])
    expect(folders.fullAccess).toHaveLength(1)
    expect(json<{ rules: unknown[] }>(userData, 'tasks-rules.json').rules).toHaveLength(2)
  })

  it('existe la copia de seguridad backups/pre-m001-* con su manifiesto y el registro migrations.json', () => {
    const backups = backupsOf(userData)
    expect(backups).toHaveLength(1)
    expect(existsSync(join(userData, 'backups', backups[0], 'manifest.json'))).toBe(true)
    const reg = json<{ schema: number; applied: Array<{ id: string; at: string }> }>(userData, 'migrations.json')
    expect(reg.applied.map((a) => a.id)).toEqual(['m001-tasks-rename'])
    registryAt = reg.applied[0].at
  })

  it('un segundo arranque no hace nada (sin copias nuevas ni cambios en el registro)', async () => {
    await app?.stop()
    app = await startApp({ userData, keepUserData: true })
    expect(backupsOf(userData)).toHaveLength(1)
    expect(json<{ applied: Array<{ at: string }> }>(userData, 'migrations.json').applied).toEqual([
      expect.objectContaining({ at: registryAt })
    ])
    expect(existsSync(join(userData, 'cowork.json'))).toBe(false)
    expect(existsSync(join(userData, 'cowork-sandbox'))).toBe(false)
  })
})
