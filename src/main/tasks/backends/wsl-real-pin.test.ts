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
    expect(pin!.rootfs.version).toBe('2026.10.10')
    expect(pin!.rootfs.minVersion).toBe('2026.10.10')
    expect(pin!.rootfs.sha256).toBe('8f855de87d073755ff8024eb4fe8f639538dbde7067bc74586e96028263cf39e')
    expect(pin!.rootfs.size).toBe(98919533)
    expect(pin!.rootfs.unpackedMax).toBeGreaterThanOrEqual(274501120)
    expect(pin!.opencode.sha256).toBe('f00e8b9f698cc663c6ee1d25ca161197ee0242345de357cf644fc8538eb8b774')
    expect(pin!.opencode.size).toBe(50344153)
    expect(pin!.opencode.url).toBe('https://github.com/onyxcode-cl/lazunox-motor/releases/download/v1.19.0-lazunox.1/opencode-linux-x64.tar.gz')
  })
  it('la url de la imagen es EXACTAMENTE la de wslRootfsUrl (no publicada: el parser no se relajó)', () => {
    expect(raw['wsl-rootfs'].url).toBe(wslRootfsUrl('2026.10.10'))
    expect(wslRootfsUrl('2026.10.10')).toContain('/lazunox-wsl/releases/download/rootfs-2026.10.10/')
    expect(parseWslPin({ ...raw['wsl-rootfs'], url: 'https://example.com/x.tar.gz' })).toBeNull()
  })
  it('conserva los assets de darwin-arm64 y win32-x64', () => {
    expect(Object.keys(raw.assets).sort()).toEqual(['darwin-arm64', 'linux-x64', 'win32-x64'])
    expect(raw.version).toBe('1.19.0')
  })
})
