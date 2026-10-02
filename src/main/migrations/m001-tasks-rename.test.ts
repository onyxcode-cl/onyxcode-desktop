import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LEGACY_USERDATA_RENAMES } from './legacy-names'
import { M001_ID, listBackups, readManifest } from './m001-tasks-rename'
import { readRegistry, rollbackM001, runMigrations } from './index'
import { cleanTmp, readJson, seededUserData, snapshot, tmpDir } from './test-helpers'
import { posixOnly } from '../../test/platform'

const quiet = { log: () => undefined }
const VERSION = '0.2.2'
const opts = { ...quiet, appVersion: VERSION }

afterEach(() => cleanTmp((p) => rmSync(p, { recursive: true, force: true })))

describe('m001: userData viejo sembrado -> nombres nuevos', () => {
  it('migra ficheros, carpetas, partición y claves JSON a los nombres nuevos', () => {
    const ud = seededUserData()
    const out = runMigrations(ud, opts)
    expect(out).toHaveLength(1)
    expect(out[0].status).toBe('applied')

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
      expect(existsSync(join(ud, n)), n).toBe(true)
    for (const [old] of LEGACY_USERDATA_RENAMES) expect(existsSync(join(ud, old)), `${old} sigue`).toBe(false)

    // Carpetas grandes: renombradas con su contenido intacto.
    expect(readFileSync(join(ud, 'tasks-sandbox/0123456789abcdef/data/opencode/opencode.db'), 'utf8')).toContain('SENTINEL')
    expect(readFileSync(join(ud, 'Partitions/onyxcode-web-tasks/Cookies'), 'utf8')).toContain('SENTINEL')
    expect(existsSync(join(ud, 'Partitions/onyxcode-web-tasks/Local Storage/leveldb/000003.log'))).toBe(true)

    // Claves dentro de JSON.
    const settings = readJson(ud, 'settings.json')
    expect(settings.tasksGlobalInstructions).toBe('Preferir respuestas breves.')
    expect('coworkGlobalInstructions' in settings).toBe(false)
    expect(settings.onboarded).toBe(true)
    const modelsByMode = readJson(ud, 'extras.json').modelsByMode as Record<string, unknown>
    expect(modelsByMode.tasks).toEqual({ providerID: 'fake', modelID: 'fake-tareas' })
    expect('cowork' in modelsByMode).toBe(false)
    expect(modelsByMode.chat).toBeDefined()
    const eb = readJson(ud, 'embedded-browser.json') as {
      sites: Record<string, unknown>
      denied: Record<string, unknown>
      prefs: { agentEnabled: Record<string, unknown> }
    }
    expect(eb.sites.tasks).toEqual([{ site: 'example.com', addedAt: 1758800000000 }])
    expect(eb.denied.tasks).toEqual(['malo.example'])
    expect(eb.prefs.agentEnabled).toEqual({ code: false, tasks: true })
    expect('cowork' in eb.sites || 'cowork' in eb.denied).toBe(false)
    const routines = readJson(ud, 'routines.json') as { routines: Array<{ id: string; mode: string }>; history: Array<{ mode: string }> }
    expect(routines.routines.map((r) => [r.id, r.mode])).toEqual([
      ['rt_1', 'tasks'],
      ['rt_2', 'chat'],
      ['rt_3', 'code']
    ])
    expect(routines.history[0].mode).toBe('tasks')
    const mcp = readJson(ud, 'tasks-mcp.json') as { servers: Record<string, Record<string, unknown>> }
    expect(mcp.servers.docs).toEqual({ tasks: true, askEachTool: false })
    expect(mcp.servers.crm).toEqual({ tasks: false, askEachTool: true })

    // Datos del usuario conservados.
    const meta = readJson(ud, 'tasks-meta.json') as { tasks: Array<{ sessionId: string; pinned?: boolean }> }
    expect(meta.tasks.filter((t) => t.pinned).map((t) => t.sessionId)).toEqual(['ses_pinned_1', 'ses_pinned_2'])
    const folders = readJson(ud, 'tasks-folders.json') as { folders: unknown[]; fullAccess: unknown[]; deleteGrants: string[] }
    expect(folders.folders).toHaveLength(2)
    expect(folders.fullAccess).toHaveLength(1)
    expect(folders.deleteGrants).toEqual(['/Users/tester/Proyectos/beta'])
    expect((readJson(ud, 'tasks-rules.json') as { rules: unknown[] }).rules).toHaveLength(2)
  })

  it('crea copia previa en backups/pre-m001-<ts>/ con manifest y registro migrations.json', () => {
    const ud = seededUserData()
    const original = snapshot(ud)
    runMigrations(ud, opts)
    const backups = listBackups(ud)
    expect(backups).toHaveLength(1)
    expect(backups[0]).toMatch(/pre-m001-\d{8}T\d+Z$/)
    const manifest = readManifest(backups[0])
    expect(manifest?.completed).toBe(true)
    expect(manifest?.appVersion).toBe(VERSION)
    // Los JSON afectados están copiados byte a byte; las carpetas grandes NO se copian.
    for (const rel of manifest?.files ?? []) expect(readFileSync(join(backups[0], 'files', rel)).toString('hex')).toBe(original[rel])
    expect(manifest?.files).toEqual(
      expect.arrayContaining(['settings.json', 'extras.json', 'routines.json', 'embedded-browser.json', 'cowork.json', 'cowork-mcp.json'])
    )
    expect(existsSync(join(backups[0], 'files', 'cowork-sandbox'))).toBe(false)
    expect(existsSync(join(backups[0], 'files', 'Partitions'))).toBe(false)
    expect(manifest?.renames).toHaveLength(LEGACY_USERDATA_RENAMES.length)
    const reg = readRegistry(ud)
    expect(reg.schema).toBe(1)
    expect(reg.applied).toHaveLength(1)
    expect(reg.applied[0]).toMatchObject({ id: M001_ID, appVersion: VERSION })
    expect(typeof reg.applied[0].at).toBe('string')
  })

  it('la segunda ejecución es un no-op (nada cambia, ninguna copia nueva)', () => {
    const ud = seededUserData()
    runMigrations(ud, opts)
    const after = snapshot(ud)
    const second = runMigrations(ud, opts)
    expect(second).toEqual([{ id: M001_ID, status: 'skipped' }])
    expect(snapshot(ud)).toEqual(after)
  })

  it('sin registro pero ya migrado (p. ej. registro perdido) tampoco cambia nada ni crea copias', () => {
    const ud = seededUserData()
    runMigrations(ud, opts)
    rmSync(join(ud, 'migrations.json'))
    const before = snapshot(ud, ['migrations.json'])
    const out = runMigrations(ud, opts)
    expect(out[0].status).toBe('applied')
    expect(out[0].report?.changed).toBe(false)
    expect(out[0].report?.backupDir).toBeNull()
    expect(snapshot(ud, ['migrations.json'])).toEqual(before)
  })

  it('userData nuevo (sin rastro viejo): no crea copias y deja el registro', () => {
    const ud = tmpDir()
    const out = runMigrations(ud, opts)
    expect(out[0].status).toBe('applied')
    expect(existsSync(join(ud, 'backups'))).toBe(false)
    expect(readRegistry(ud).applied.map((a) => a.id)).toEqual([M001_ID])
  })

  it('conflicto viejo+nuevo: gana el nuevo y el viejo va a conflicts/ (nunca se borra)', () => {
    const ud = seededUserData()
    const oldRules = readFileSync(join(ud, 'cowork-rules.json'))
    writeFileSync(join(ud, 'tasks-rules.json'), '{"rules":[]}')
    mkdirSync(join(ud, 'tasks-sandbox/nuevohash'), { recursive: true })
    writeFileSync(join(ud, 'tasks-sandbox/nuevohash/NUEVO'), 'nuevo')
    mkdirSync(join(ud, 'Partitions/onyxcode-web-tasks'), { recursive: true })
    writeFileSync(join(ud, 'Partitions/onyxcode-web-tasks/Cookies'), 'nuevas')

    const out = runMigrations(ud, opts)
    expect(out[0].status).toBe('applied')
    // Gana el nuevo.
    expect(readFileSync(join(ud, 'tasks-rules.json'), 'utf8')).toBe('{"rules":[]}')
    expect(readdirSync(join(ud, 'tasks-sandbox'))).toEqual(['nuevohash'])
    expect(readFileSync(join(ud, 'Partitions/onyxcode-web-tasks/Cookies'), 'utf8')).toBe('nuevas')
    // El viejo desaparece de su sitio pero está entero en conflicts/.
    const bdir = listBackups(ud)[0]
    expect(existsSync(join(ud, 'cowork-rules.json'))).toBe(false)
    expect(readFileSync(join(bdir, 'conflicts/cowork-rules.json')).equals(oldRules)).toBe(true)
    expect(readFileSync(join(bdir, 'conflicts/cowork-sandbox/0123456789abcdef/data/opencode/opencode.db'), 'utf8')).toContain('SENTINEL')
    expect(readFileSync(join(bdir, 'conflicts/Partitions/onyxcode-web-cowork/Cookies'), 'utf8')).toContain('SENTINEL')
    expect(readManifest(bdir)?.conflicts.sort()).toEqual(['Partitions/onyxcode-web-cowork', 'cowork-rules.json', 'cowork-sandbox'])
  })

  it('en claves JSON con viejo y nuevo a la vez gana el nuevo', () => {
    const ud = seededUserData()
    const s = readJson(ud, 'settings.json')
    s.tasksGlobalInstructions = 'la nueva'
    writeFileSync(join(ud, 'settings.json'), JSON.stringify(s))
    runMigrations(ud, opts)
    const after = readJson(ud, 'settings.json')
    expect(after.tasksGlobalInstructions).toBe('la nueva')
    expect('coworkGlobalInstructions' in after).toBe(false)
    // El valor viejo sigue en la copia de seguridad.
    const bdir = listBackups(ud)[0]
    expect(JSON.parse(readFileSync(join(bdir, 'files/settings.json'), 'utf8')).coworkGlobalInstructions).toBe('Preferir respuestas breves.')
  })

  it('un paso que falla (JSON corrupto) no impide los demás y no escribe el registro; el reintento termina', () => {
    const ud = seededUserData()
    const corrupt = '{ "defaultModel": esto no es json'
    writeFileSync(join(ud, 'settings.json'), corrupt)
    const out = runMigrations(ud, opts)
    expect(out[0].status).toBe('partial')
    expect(out[0].report?.failed).toBe(1)
    expect(out[0].report?.steps.find((s) => s.status === 'failed')?.step).toContain('settings.json')
    // El resto sí se migró.
    expect(existsSync(join(ud, 'tasks-folders.json'))).toBe(true)
    expect(existsSync(join(ud, 'tasks-sandbox'))).toBe(true)
    expect((readJson(ud, 'routines.json').routines as Array<{ mode: string }>)[0].mode).toBe('tasks')
    expect(readFileSync(join(ud, 'settings.json'), 'utf8')).toBe(corrupt)
    expect(existsSync(join(ud, 'migrations.json'))).toBe(false)
    const [bdir] = listBackups(ud)
    expect(readManifest(bdir)?.completed).toBe(false)

    // Se arregla el fichero y el siguiente arranque reintenta, reutilizando la misma copia (el diario cubre todo).
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ coworkGlobalInstructions: 'x' }))
    const retry = runMigrations(ud, opts)
    expect(retry[0].status).toBe('applied')
    expect(readJson(ud, 'settings.json').tasksGlobalInstructions).toBe('x')
    expect(readRegistry(ud).applied).toHaveLength(1)
    expect(listBackups(ud)).toEqual([bdir])
    expect(readManifest(bdir)?.completed).toBe(true)
  })

  // chmod 0o500 no impide escribir en NTFS: el fallo no se puede provocar así en Windows.
  it.skipIf(!posixOnly)('un paso de renombre que falla (carpeta sin permiso de escritura) tampoco impide los demás', () => {
    const ud = seededUserData()
    chmodSync(join(ud, 'Partitions'), 0o555)
    try {
      const out = runMigrations(ud, opts)
      expect(out[0].status).toBe('partial')
      expect(out[0].report?.steps.filter((s) => s.status === 'failed').map((s) => s.step)).toEqual([expect.stringContaining('Partitions')])
      expect(existsSync(join(ud, 'Partitions/onyxcode-web-cowork/Cookies'))).toBe(true)
      expect(existsSync(join(ud, 'tasks-meta.json'))).toBe(true)
      expect(existsSync(join(ud, 'tasks-sandbox'))).toBe(true)
      expect(existsSync(join(ud, 'migrations.json'))).toBe(false)
    } finally {
      chmodSync(join(ud, 'Partitions'), 0o755)
    }
  })

  it('conserva solo las 3 últimas copias de seguridad', () => {
    const ud = tmpDir()
    let t = Date.UTC(2026, 0, 1)
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(ud, 'cowork-prefs.json'), `{"i":${i}}`)
      writeFileSync(join(ud, 'settings.json'), '{}')
      rmSync(join(ud, 'migrations.json'), { force: true })
      const now = new Date((t += 60_000))
      runMigrations(ud, { ...opts, now: () => now })
      rmSync(join(ud, 'tasks-prefs.json'))
    }
    const names = listBackups(ud).map((d) => d.split('/').pop())
    expect(names).toHaveLength(3)
    expect(names).toEqual([...names].sort())
    expect(names[0]).toContain('20260101T000300')
  })

  it('los tests usan un directorio temporal, nunca el userData real', () => {
    const ud = seededUserData()
    expect(ud.startsWith(realpathSync(tmpdir()))).toBe(true)
    expect(ud).not.toContain('Application Support')
  })
})

describe('rollbackM001', () => {
  it('restaura el estado original byte a byte', () => {
    const ud = seededUserData()
    const original = snapshot(ud)
    runMigrations(ud, opts)
    expect(snapshot(ud, ['backups', 'migrations.json'])).not.toEqual(original)
    const r = rollbackM001(ud)
    expect(r.undoneRenames).toBe(LEGACY_USERDATA_RENAMES.length)
    expect(snapshot(ud, ['backups'])).toEqual(original)
    // Y m001 vuelve a poder aplicarse igual.
    const again = runMigrations(ud, opts)
    expect(again[0].status).toBe('applied')
    expect(existsSync(join(ud, 'tasks-sandbox/0123456789abcdef/data/opencode/opencode.db'))).toBe(true)
  })

  it('restaura también un caso con conflictos y con registro previo de otra migración', () => {
    const ud = seededUserData()
    writeFileSync(join(ud, 'tasks-rules.json'), '{"rules":[]}')
    mkdirSync(join(ud, 'tasks-sandbox/n'), { recursive: true })
    writeFileSync(join(ud, 'tasks-sandbox/n/f'), 'n')
    writeFileSync(
      join(ud, 'migrations.json'),
      JSON.stringify({ schema: 1, applied: [{ id: 'm000-otra', at: 'x', appVersion: '0' }] }, null, 2)
    )
    const original = snapshot(ud)
    runMigrations(ud, opts)
    rollbackM001(ud)
    expect(snapshot(ud, ['backups'])).toEqual(original)
    expect(readRegistry(ud).applied.map((a) => a.id)).toEqual(['m000-otra'])
  })

  it('restaura tras una ejecución parcial (fallo + diario incompleto)', () => {
    const ud = seededUserData()
    writeFileSync(join(ud, 'settings.json'), 'roto{')
    const original = snapshot(ud)
    runMigrations(ud, opts)
    rollbackM001(ud)
    expect(snapshot(ud, ['backups'])).toEqual(original)
  })

  it('sin copia previa lanza un error claro', () => {
    expect(() => rollbackM001(tmpDir())).toThrow(/pre-m001/)
  })
})
