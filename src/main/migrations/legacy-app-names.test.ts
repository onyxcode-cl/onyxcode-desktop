import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateLegacyUserData } from './legacy-app-names'
import { cleanTmp, tmpDir } from './test-helpers'

afterEach(() => cleanTmp((p) => rmSync(p, { recursive: true, force: true })))

function seedApp(appData: string, name: string, files: Record<string, string>): string {
  const dir = join(appData, name)
  mkdirSync(dir, { recursive: true })
  for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, f), c)
  return dir
}

describe('migrateLegacyUserData', () => {
  it('trae las entradas de Lapis sin pisar las que ya existen', () => {
    const appData = tmpDir()
    const userData = join(appData, 'OnyxCode')
    mkdirSync(userData)
    writeFileSync(join(userData, 'other.json'), 'nuevo')
    seedApp(appData, 'Lapis', { 'settings.json': '{"a":1}', 'other.json': 'viejo', 'routines.json': '[]' })
    migrateLegacyUserData(userData, appData, () => undefined)
    expect(readFileSync(join(userData, 'settings.json'), 'utf8')).toBe('{"a":1}')
    expect(readFileSync(join(userData, 'routines.json'), 'utf8')).toBe('[]')
    expect(readFileSync(join(userData, 'other.json'), 'utf8')).toBe('nuevo')
  })

  it('prefiere Lapis sobre OpenDesk y no hace nada si ya hay settings.json', () => {
    const appData = tmpDir()
    const userData = join(appData, 'OnyxCode')
    seedApp(appData, 'OpenDesk', { 'settings.json': 'od' })
    seedApp(appData, 'Lapis', { 'settings.json': 'lapis' })
    migrateLegacyUserData(userData, appData, () => undefined)
    expect(readFileSync(join(userData, 'settings.json'), 'utf8')).toBe('lapis')

    const appData2 = tmpDir()
    const userData2 = join(appData2, 'OnyxCode')
    seedApp(appData2, 'OnyxCode', { 'settings.json': 'actual' })
    seedApp(appData2, 'Lapis', { 'settings.json': 'lapis', 'x.json': '1' })
    migrateLegacyUserData(userData2, appData2, () => undefined)
    expect(existsSync(join(userData2, 'x.json'))).toBe(false)
  })
})
