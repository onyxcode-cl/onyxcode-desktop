import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanLegacyBrowserData } from './legacy-cleanup'

let root: string
let userData: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'legacy-cleanup-'))
  userData = join(root, 'userData')
  mkdirSync(userData)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('cleanLegacyBrowserData', () => {
  it('borra el perfil y el json, y conserva el resto de userData', () => {
    mkdirSync(join(userData, 'cowork-browser', 'profile', 'Default'), { recursive: true })
    writeFileSync(join(userData, 'cowork-browser', 'profile', 'Default', 'Cookies'), 'x')
    writeFileSync(join(userData, 'cowork-browser.json'), '{}')
    writeFileSync(join(userData, 'settings.json'), '{}')
    mkdirSync(join(userData, 'cowork-browser-other'))

    const removed = cleanLegacyBrowserData(userData)

    expect(removed.map((p) => p.slice(userData.length + 1)).sort()).toEqual(['cowork-browser', 'cowork-browser.json'])
    expect(existsSync(join(userData, 'cowork-browser'))).toBe(false)
    expect(existsSync(join(userData, 'cowork-browser.json'))).toBe(false)
    expect(existsSync(join(userData, 'settings.json'))).toBe(true)
    expect(existsSync(join(userData, 'cowork-browser-other'))).toBe(true)
  })

  it('no hace nada (y no lanza) si no hay datos, y es idempotente', () => {
    expect(cleanLegacyBrowserData(userData)).toEqual([])
    writeFileSync(join(userData, 'cowork-browser.json'), '{}')
    expect(cleanLegacyBrowserData(userData)).toHaveLength(1)
    expect(cleanLegacyBrowserData(userData)).toEqual([])
  })

  it('no toca nada fuera de userData (hermano con el mismo nombre)', () => {
    mkdirSync(join(root, 'cowork-browser'))
    writeFileSync(join(root, 'cowork-browser.json'), '{}')
    cleanLegacyBrowserData(userData)
    expect(existsSync(join(root, 'cowork-browser'))).toBe(true)
    expect(existsSync(join(root, 'cowork-browser.json'))).toBe(true)
  })

  it('no lanza si userData no existe', () => {
    expect(cleanLegacyBrowserData(join(root, 'no-existe'))).toEqual([])
  })
})
