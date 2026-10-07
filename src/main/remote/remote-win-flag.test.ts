import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { capsFor } from '@shared/platform-caps'
import { capsFlagsFromArgv, capsFlagsToArgs } from '@shared/caps-argv'
import { REMOTE_WIN_BUILD, resolveRemoteWin } from './remote-win-flag'

describe('remoteWin: puerta de compilación', () => {
  it('el literal del repositorio es true (decisión expresa del dueño, 2026-10-07; solo él lo cambia, en un commit aparte)', () => {
    const src = readFileSync(join(__dirname, 'remote-win-flag.ts'), 'utf8')
    expect(src).toMatch(/export const REMOTE_WIN_BUILD = true\b/)
    expect(REMOTE_WIN_BUILD).toBe(true)
  })
  it('no vive en feature-flags.ts (zona intocable)', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'shared', 'feature-flags.ts'), 'utf8')
    expect(src).not.toMatch(/REMOTE_WIN/)
  })
  it('con la puerta apagada (inyectada) solo la variable de desarrollo la enciende, y nunca empaquetada', () => {
    for (const isPackaged of [true, false, undefined]) {
      expect(resolveRemoteWin({ platform: 'win32', build: false, env: {}, isPackaged })).toBe(false)
    }
    expect(resolveRemoteWin({ platform: 'win32', build: false, env: { LAZUNOX_REMOTE_WIN: '1' }, isPackaged: true })).toBe(false)
  })
  it('con la puerta real encendida: Windows sí (empaquetada o no), el resto no, y la política de la organización la cierra', () => {
    expect(resolveRemoteWin({ platform: 'win32', env: {}, isPackaged: true })).toBe(true)
    expect(resolveRemoteWin({ platform: 'win32', env: {}, isPackaged: true, policyBlocked: true })).toBe(false)
    for (const platform of ['darwin', 'linux', 'remote']) expect(resolveRemoteWin({ platform, env: {}, isPackaged: true })).toBe(false)
  })
})

describe('resolveRemoteWin (plataforma inyectada)', () => {
  const base = { env: {}, isPackaged: true }
  it('solo win32 la enciende', () => {
    for (const platform of ['darwin', 'linux', 'remote']) {
      expect(resolveRemoteWin({ ...base, platform, build: true })).toBe(false)
    }
    expect(resolveRemoteWin({ ...base, platform: 'win32', build: true })).toBe(true)
  })
  it('la variable solo vale sin empaquetar y exactamente con «1»', () => {
    const env = { LAZUNOX_REMOTE_WIN: '1' }
    expect(resolveRemoteWin({ platform: 'win32', env, isPackaged: false, build: false })).toBe(true)
    expect(resolveRemoteWin({ platform: 'win32', env, isPackaged: true, build: false })).toBe(false)
    expect(resolveRemoteWin({ platform: 'win32', env, build: false })).toBe(false)
    expect(resolveRemoteWin({ platform: 'win32', env: { LAZUNOX_REMOTE_WIN: 'true' }, isPackaged: false, build: false })).toBe(false)
  })
  it('la política que bloquea el remoto cierra la bandera aunque la compilación esté abierta', () => {
    expect(resolveRemoteWin({ ...base, platform: 'win32', build: true, policyBlocked: true })).toBe(false)
    expect(resolveRemoteWin({ platform: 'win32', env: { LAZUNOX_REMOTE_WIN: '1' }, isPackaged: false, policyBlocked: true })).toBe(false)
  })
  it('un valor no booleano de la compilación no abre (fail closed)', () => {
    expect(resolveRemoteWin({ ...base, platform: 'win32', build: 'si' as unknown as boolean })).toBe(false)
  })
})

describe('remoteWin en capacidades y en el argumento del preload', () => {
  it('matriz plataforma x bandera: solo win32 con la bandera enciende remote; macOS no cambia', () => {
    const rows: Array<[string, boolean | undefined, boolean]> = [
      ['darwin', undefined, true],
      ['darwin', false, true],
      ['darwin', true, true],
      ['win32', undefined, false],
      ['win32', false, false],
      ['win32', true, true],
      ['linux', true, false]
    ]
    for (const [platform, remoteWin, remote] of rows) {
      expect([platform, remoteWin, capsFor(platform, { remoteWin }).remote]).toEqual([platform, remoteWin, remote])
    }
  })
  it('la bandera solo afecta a `remote`: lo demás de win32 no cambia (Tareas y Control del PC siguen apagados)', () => {
    const { remote: _a, ...off } = capsFor('win32')
    const { remote: _b, ...on } = capsFor('win32', { remoteWin: true })
    expect(on).toEqual(off)
  })
  it('un valor no booleano no enciende el remoto', () => {
    expect(capsFor('win32', { remoteWin: 'si' as unknown as boolean }).remote).toBe(false)
  })
  it('la PWA del celular nunca anuncia `remote` (ni con la bandera)', () => {
    expect(capsFor('remote', { remoteWin: true }).remote).toBe(false)
  })
  it('viaja al preload y vuelve igual; sin ella no se añade argumento', () => {
    expect(capsFlagsToArgs({ remoteWin: false })).toEqual([])
    expect(capsFlagsFromArgv(capsFlagsToArgs({ remoteWin: true }))).toEqual({ remoteWin: true })
    expect(capsFlagsFromArgv(['--lazunox-caps=remoteWin,otra'])).toEqual({ remoteWin: true })
  })
})
