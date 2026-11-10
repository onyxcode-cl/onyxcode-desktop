/** El backend Seatbelt decide el aislamiento de chats (el constructor del perfil es puro): sigue el modo unificado. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { macOnly } from '../../../test/platform'
import { seatbeltProfileText } from './seatbelt'

const prev = process.env.LAZUNOX_UNIFIED_APPS
let dir = ''
afterEach(() => {
  if (prev === undefined) delete process.env.LAZUNOX_UNIFIED_APPS
  else process.env.LAZUNOX_UNIFIED_APPS = prev
  if (dir) rmSync(dir, { recursive: true, force: true })
})

// El perfil es SBPL de macOS (rutas POSIX del sistema).
describe.skipIf(!macOnly)('backend Seatbelt: aislamiento de ~/Lazunox/Chats', () => {
  const profile = (flag: string | undefined): string => {
    if (flag === undefined) delete process.env.LAZUNOX_UNIFIED_APPS
    else process.env.LAZUNOX_UNIFIED_APPS = flag
    dir = mkdtempSync(join(tmpdir(), 'lzx-sb-'))
    return seatbeltProfileText('/tmp/proyecto', { privateDir: join(dir, 'p'), userData: join(dir, 'u') }, join(dir, 'cfg'))
  }
  it('encendido por defecto (y con =1): deniega Lazunox/Chats', () => {
    expect(profile(undefined)).toContain('Lazunox/Chats')
    expect(profile('1')).toContain('Lazunox/Chats')
  })
  it('con =0: el perfil de siempre', () => {
    expect(profile('0')).not.toContain('Lazunox/Chats')
  })
})
