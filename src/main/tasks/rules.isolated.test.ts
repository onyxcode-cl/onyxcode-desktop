/**
 * H3 (revisión final 1.8.19): los «siempre» que el motor aislado guardó en su carpeta privada (al alcance de la tarea) NO se importan;
 * y lo que la persona da desde una Tarea aislada no vale cuando la carpeta se abre en Control total.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userData = ''
vi.mock('electron', () => ({ app: { getPath: () => userData } }))
vi.mock('./policy', () => ({ loadManagedPolicy: () => null }))
vi.mock('@shared/i18n', () => ({ t: (k: string) => k }))

import { TasksRulesStore, rulesPermissionConfig } from './rules'

const FOLDER = '/Users/ana/proyecto'
let engineDir = ''
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'lzx-rules-iso-'))
  engineDir = join(userData, 'tasks-sandbox', 'k', 'permisos-siempre')
  mkdirSync(engineDir, { recursive: true })
})
afterEach(() => rmSync(userData, { recursive: true, force: true }))

describe('discardEngineAlwaysRulesOnce', () => {
  it('no importa nada (ni siquiera reglas que pasarían los filtros): vacía la carpeta del motor y marca la carpeta', () => {
    writeFileSync(
      join(engineDir, 'a.json'),
      JSON.stringify({
        directory: FOLDER,
        rules: [
          { permission: 'bash', pattern: 'python3 *' },
          { permission: 'bash', pattern: 'git status *' }
        ]
      })
    )
    const s = new TasksRulesStore()
    expect(s.discardEngineAlwaysRulesOnce(FOLDER, engineDir)).toBe(1)
    expect(s.list(FOLDER)).toEqual([])
    expect(readdirSync(engineDir)).toEqual([])
    // Ya marcada: lo que se escriba después no se toca ni se importa.
    writeFileSync(join(engineDir, 'b.json'), '{}')
    expect(new TasksRulesStore().discardEngineAlwaysRulesOnce(FOLDER, engineDir)).toBe(0)
    expect(new TasksRulesStore().list(FOLDER)).toEqual([])
  })

  it('no sigue enlaces', () => {
    if (process.platform === 'win32') return
    const outside = mkdtempSync(join(tmpdir(), 'lzx-rules-fuera-'))
    try {
      writeFileSync(join(outside, 'x.json'), '{}')
      rmSync(engineDir, { recursive: true })
      symlinkSync(outside, engineDir)
      new TasksRulesStore().discardEngineAlwaysRulesOnce(FOLDER, engineDir)
      expect(readdirSync(outside)).toEqual(['x.json'])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('reglas dadas en una Tarea aislada', () => {
  it('valen en el modo aislado y NO en Control total; las de Control total valen en los dos', () => {
    const s = new TasksRulesStore()
    s.add(FOLDER, 'bash', ['python3 *'], { isolatedOnly: true })
    s.add(FOLDER, 'bash', ['npm test'])
    const rules = s.list(FOLDER)
    expect(rulesPermissionConfig(rules, { fullAccess: false })).toEqual({ bash: { 'python3 *': 'allow', 'npm test': 'allow' } })
    expect(rulesPermissionConfig(rules, { fullAccess: true })).toEqual({ bash: { 'npm test': 'allow' } })
  })

  it('si la persona da la misma regla en Control total, pasa a valer en los dos modos; al revés no se reduce', () => {
    const s = new TasksRulesStore()
    s.add(FOLDER, 'bash', ['make *'], { isolatedOnly: true })
    s.add(FOLDER, 'bash', ['make *'])
    s.add(FOLDER, 'bash', ['ls'])
    s.add(FOLDER, 'bash', ['ls'], { isolatedOnly: true })
    expect(rulesPermissionConfig(new TasksRulesStore().list(FOLDER), { fullAccess: true })).toEqual({
      bash: { 'make *': 'allow', ls: 'allow' }
    })
  })
})
