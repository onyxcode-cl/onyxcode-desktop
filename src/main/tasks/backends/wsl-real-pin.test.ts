import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseWslPin, wslRootfsUrl } from './wsl-pin'
import { parseSetupPin } from './wsl-setup'

/** El `pin.json` REAL del repo (raíz de confianza del paquete incluido de Tareas en Windows). */
const raw = JSON.parse(readFileSync(join(process.cwd(), 'resources', 'opencode-bin', 'pin.json'), 'utf8')) as {
  version: string
  assets: Record<string, unknown>
  'wsl-rootfs': { url: string }
}

describe('resources/opencode-bin/pin.json (beta de Tareas en Windows, 2026-10-07)', () => {
  it('pasa parseSetupPin (imagen estricta + opencode linux-x64 de la misma versión)', () => {
    const pin = parseSetupPin(raw)
    expect(pin).not.toBeNull()
    expect(pin!.rootfs.version).toBe('2026.10.1')
    expect(pin!.rootfs.minVersion).toBe('2026.10.1')
    expect(pin!.rootfs.sha256).toBe('5cf9da9d8941d43461dca47e19193b0e3b1bcbb8b25d978623b665974f79ddc6')
    expect(pin!.rootfs.size).toBe(77545052)
    expect(pin!.rootfs.unpackedMax).toBeGreaterThanOrEqual(225052160)
    expect(pin!.opencode.sha256).toBe('e546123213ae47909a4268692aa4b94950d011afe9cac9938753a2194f1c16d5')
    expect(pin!.opencode.size).toBe(60628669)
    expect(pin!.opencode.url).toBe('https://github.com/anomalyco/opencode/releases/download/v1.18.33/opencode-linux-x64.tar.gz')
  })
  it('la url de la imagen es EXACTAMENTE la de wslRootfsUrl (no publicada: el parser no se relajó)', () => {
    expect(raw['wsl-rootfs'].url).toBe(wslRootfsUrl('2026.10.1'))
    expect(wslRootfsUrl('2026.10.1')).toContain('/lazunox-wsl/releases/download/rootfs-2026.10.1/')
    expect(parseWslPin({ ...raw['wsl-rootfs'], url: 'https://example.com/x.tar.gz' })).toBeNull()
  })
  it('conserva los assets de darwin-arm64 y win32-x64', () => {
    expect(Object.keys(raw.assets).sort()).toEqual(['darwin-arm64', 'linux-x64', 'win32-x64'])
    expect(raw.version).toBe('1.18.33')
  })
})
