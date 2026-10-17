/**
 * Validación de la carpeta de instrucciones del proyecto de Code (`AGENTS.md`): existente y ni la raíz, ni el home, ni
 * dentro de la carpeta de datos de la app. Con carpetas de prueba en tmpdir (nunca las reales).
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/nunca-usado' } }))

import { assertInstructionsFolder } from './tasks-memory-handlers'

let base: string
let home: string
let userData: string
let project: string

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-instr-')))
  home = join(base, 'home')
  userData = join(home, 'userData')
  project = join(home, 'proyecto')
  mkdirSync(userData, { recursive: true })
  mkdirSync(project, { recursive: true })
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('assertInstructionsFolder', () => {
  it('acepta una carpeta de proyecto existente', () => {
    expect(assertInstructionsFolder(project, home, userData)).toBe(project)
  })

  it('rechaza el home, la raíz y la carpeta de datos de la app (y lo que cuelga de ella)', () => {
    expect(() => assertInstructionsFolder(home, home, userData)).toThrow()
    expect(() => assertInstructionsFolder(parse(project).root, home, userData)).toThrow()
    expect(() => assertInstructionsFolder(userData, home, userData)).toThrow()
    const inner = join(userData, 'memoria')
    mkdirSync(inner)
    expect(() => assertInstructionsFolder(inner, home, userData)).toThrow()
  })

  it('rechaza rutas inexistentes, relativas y con byte nulo', () => {
    expect(() => assertInstructionsFolder(join(base, 'no-existe'), home, userData)).toThrow()
    expect(() => assertInstructionsFolder('relativa/x', home, userData)).toThrow()
    expect(() => assertInstructionsFolder(`${project}\0x`, home, userData)).toThrow()
  })
})
