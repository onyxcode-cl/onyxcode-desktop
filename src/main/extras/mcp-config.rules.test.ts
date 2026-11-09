/**
 * Reglas de permiso que `project:scan` entrega a Code (global del usuario + archivo de la app, en ese orden, en CADA llamada): con todas las acciones,
 * `permission: "deny"` normalizado a `*: deny` y lo de `agent.build|plan.permission`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userData = ''
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

import { appOpencodeConfigPath, readGlobalConfigRules } from './mcp-config'

let xdg: string
let saved: string | undefined
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'lzx-ud-'))
  xdg = mkdtempSync(join(tmpdir(), 'lzx-xdg-'))
  saved = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = xdg
  mkdirSync(join(xdg, 'opencode'), { recursive: true })
})
afterEach(() => {
  if (saved === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = saved
  rmSync(userData, { recursive: true, force: true })
  rmSync(xdg, { recursive: true, force: true })
})

const R = (permission: string, pattern: string, action: string, agent?: string) =>
  agent ? { permission, pattern, action, agent } : { permission, pattern, action }

describe('readGlobalConfigRules', () => {
  it('mezcla la config global y la de la app (en ese orden), con `*`, `permission: "deny"`, mapas y agent.build/plan', () => {
    writeFileSync(
      join(xdg, 'opencode', 'opencode.json'),
      JSON.stringify({ permission: { '*start*': 'deny', 'x_*': 'ask' }, agent: { build: { permission: { g_b: 'deny' } } } })
    )
    const file = appOpencodeConfigPath()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(
      file,
      JSON.stringify({ mcp: {}, permission: 'deny', agent: { plan: { permission: { p_x: { '*': 'deny', 'a/*': 'allow' } } } } })
    )
    expect(readGlobalConfigRules()).toEqual([
      R('*start*', '*', 'deny'),
      R('x_*', '*', 'ask'),
      R('g_b', '*', 'deny', 'build'),
      R('*', '*', 'deny'),
      R('p_x', '*', 'deny', 'plan'),
      R('p_x', 'a/*', 'allow', 'plan')
    ])
  })
  it('sin archivos: lista vacía y nunca lanza (archivo roto incluido)', () => {
    expect(readGlobalConfigRules()).toEqual([])
    writeFileSync(join(xdg, 'opencode', 'opencode.json'), '{roto')
    expect(readGlobalConfigRules()).toEqual([])
  })
  it('lee el archivo en cada llamada (Ajustes puede cambiarlo con la app abierta)', () => {
    const f = join(xdg, 'opencode', 'opencode.json')
    writeFileSync(f, JSON.stringify({ permission: { a_b: 'deny' } }))
    expect(readGlobalConfigRules()).toHaveLength(1)
    writeFileSync(f, JSON.stringify({ permission: { a_b: 'deny', c_d: 'deny' } }))
    expect(readGlobalConfigRules()).toHaveLength(2)
  })
  it('B1: un archivo global enorme (más de 1 MB) se ignora, y con los archivos sin cambios se devuelve la caché', () => {
    const f = join(xdg, 'opencode', 'opencode.json')
    writeFileSync(f, JSON.stringify({ permission: { a_b: 'deny' }, relleno: 'x'.repeat(1024 * 1024 + 10) }))
    expect(readGlobalConfigRules()).toEqual([])
    writeFileSync(f, JSON.stringify({ permission: { a_b: 'deny' } }))
    const a = readGlobalConfigRules()
    expect(readGlobalConfigRules()).toBe(a) // misma referencia: no volvió a leer ni a parsear
  })
})
