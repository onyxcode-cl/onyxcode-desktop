/**
 * C7: los «siempre» de una tarea aislada los guarda main, no el motor (cuya carpeta privada escribe la tarea). Lo que el motor guardó antes
 * se pasa UNA sola vez, saneado; lo que la tarea escriba después en esa carpeta ya no se importa ni se carga.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userData = ''
vi.mock('electron', () => ({ app: { getPath: () => userData } }))
vi.mock('./policy', () => ({ loadManagedPolicy: () => null }))
vi.mock('@shared/i18n', () => ({ t: (k: string) => k }))

import { TasksRulesStore } from './rules'

const FOLDER = '/Users/ana/proyecto'
let engineDir = ''
const write = (name: string, directory: string, rules: unknown[]): void =>
  writeFileSync(join(engineDir, name), JSON.stringify({ directory, rules }))

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'lzx-rules-import-'))
  engineDir = join(userData, 'tasks-sandbox', 'k', 'permisos-siempre')
  mkdirSync(engineDir, { recursive: true })
})
afterEach(() => rmSync(userData, { recursive: true, force: true }))

describe('importEngineAlwaysRulesOnce', () => {
  it('pasa una vez los válidos (saneados) de ESA carpeta y vacía la del motor', () => {
    write('a.json', FOLDER, [
      { permission: 'bash', pattern: 'git status *' },
      { permission: 'bash', pattern: '?*' },
      { permission: 'bash', pattern: '*a*' }, // empieza por comodín: la app no lo recuerda
      { permission: '*', pattern: '*' },
      { permission: 'edit', pattern: '*' },
      { permission: 'equipo_ejecutar', pattern: 'open x' },
      { permission: 'crm_get_contact', pattern: '*' }
    ])
    write('b.json', '/Users/otra/carpeta', [{ permission: 'bash', pattern: 'ls' }])
    const s = new TasksRulesStore()
    expect(s.importEngineAlwaysRulesOnce(FOLDER, engineDir, true)).toBe(2)
    expect(
      s
        .list(FOLDER)
        .map((r) => `${r.permission} ${r.pattern}`)
        .sort()
    ).toEqual(['bash git status *', 'crm_get_contact *'])
    expect(s.list('/Users/otra/carpeta')).toEqual([])
    expect(readdirSync(engineDir)).toEqual([])
    // Lo que la tarea escriba DESPUÉS ya no se importa (ni en otra instancia que relea el archivo).
    write('c.json', FOLDER, [{ permission: 'bash', pattern: 'npm run *' }])
    expect(new TasksRulesStore().importEngineAlwaysRulesOnce(FOLDER, engineDir, true)).toBe(0)
    expect(new TasksRulesStore().list(FOLDER)).toHaveLength(2)
  })

  it('con «Recordar mis siempre» apagado no importa nada, pero queda marcada', () => {
    write('a.json', FOLDER, [{ permission: 'bash', pattern: 'git status *' }])
    const s = new TasksRulesStore()
    expect(s.importEngineAlwaysRulesOnce(FOLDER, engineDir, false)).toBe(0)
    expect(s.importEngineAlwaysRulesOnce(FOLDER, engineDir, true)).toBe(0)
    expect(s.list(FOLDER)).toEqual([])
  })

  it('no sigue enlaces (ni de archivo ni de carpeta)', () => {
    if (process.platform === 'win32') return
    const outside = mkdtempSync(join(tmpdir(), 'lzx-rules-fuera-'))
    try {
      writeFileSync(join(outside, 'x.json'), JSON.stringify({ directory: FOLDER, rules: [{ permission: 'bash', pattern: 'ls' }] }))
      symlinkSync(join(outside, 'x.json'), join(engineDir, 'x.json'))
      const s = new TasksRulesStore()
      expect(s.importEngineAlwaysRulesOnce(FOLDER, engineDir, true)).toBe(0)
      expect(readdirSync(outside)).toEqual(['x.json'])
      rmSync(engineDir, { recursive: true })
      symlinkSync(outside, engineDir)
      expect(new TasksRulesStore().importEngineAlwaysRulesOnce('/otra', engineDir, true)).toBe(0)
      expect(readdirSync(outside)).toEqual(['x.json'])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
