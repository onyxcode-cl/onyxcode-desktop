/** Iconos en la tarjeta de permiso: tope de 8 apps con icono, límite de 1,5 s por icono, fallos y iconos idénticos ⇒ sin icono. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ dir: '', power: null as unknown as import('node:events').EventEmitter }))

vi.mock('electron', async () => {
  const { EventEmitter: EE } = await import('node:events')
  h.power = new EE()
  return {
    app: {
      getPath: (n: string) => (n === 'temp' ? join(h.dir, 'tmp') : h.dir),
      getAppPath: () => join(h.dir, 'app'),
      isPackaged: false
    },
    globalShortcut: { register: () => true, unregister: () => undefined },
    powerMonitor: h.power,
    shell: { openExternal: async () => undefined },
    systemPreferences: { isTrustedAccessibilityClient: () => true, getMediaAccessStatus: () => 'granted' }
  }
})

import { ComputerService } from './service'

let svc: ComputerService | null = null
beforeEach(() => {
  h.dir = mkdtempSync(join(tmpdir(), 'svc-icons-'))
})
afterEach(() => {
  svc?.dispose()
  svc = null
  rmSync(h.dir, { recursive: true, force: true })
})

const make = (): ComputerService => {
  svc = new ComputerService({ platform: 'darwin' })
  svc.init()
  return svc
}
const PNG_A = 'data:image/png;base64,AAAAAAAAAAA='
const PNG_B = 'data:image/png;base64,BBBBBBBBBBB='
const apps = (n: number) => Array.from({ length: n }, (_, i) => ({ bundleId: `com.example.a${i}`, name: `App ${i}` }))

async function card(s: ComputerService, list: Array<{ bundleId: string; name: string }>) {
  const cards: Array<{ id: string; apps: Array<{ bundleId: string; icon?: string }> }> = []
  s.on('requestAccess', (r) => cards.push(r))
  void s.requestAccess(list, undefined, undefined, 'ses_1')
  await vi.waitFor(() => expect(cards).toHaveLength(1), { timeout: 4_000 })
  return cards[0]
}

describe('iconos de la tarjeta (requestAccess)', () => {
  it('solo las primeras 8 apps piden icono; las demás caen al nombre', async () => {
    const s = make()
    const asked: string[] = []
    s.appIcon = async (b) => (asked.push(b), `data:image/png;base64,${Buffer.from(b).toString('base64')}`)
    const c = await card(s, apps(10))
    expect(asked).toHaveLength(8)
    expect(c.apps.filter((a) => a.icon)).toHaveLength(8)
    expect(c.apps[8].icon).toBeUndefined()
    expect(c.apps[9].icon).toBeUndefined()
  })

  it('un icono que tarda más de 1,5 s se descarta sin retrasar la tarjeta más de eso', async () => {
    const s = make()
    s.appIcon = (b) => (b.endsWith('a0') ? new Promise(() => undefined) : Promise.resolve(PNG_B))
    const t0 = Date.now()
    const c = await card(s, apps(2))
    const dt = Date.now() - t0
    expect(dt).toBeGreaterThanOrEqual(1_400)
    expect(dt).toBeLessThan(3_500)
    expect(c.apps[0].icon).toBeUndefined()
    expect(c.apps[1].icon).toBe(PNG_B)
  }, 10_000)

  it('si el resolvedor falla ⇒ sin icono y la tarjeta sale igual', async () => {
    const s = make()
    s.appIcon = async () => {
      throw new Error('boom')
    }
    const c = await card(s, apps(2))
    expect(c.apps.every((a) => a.icon === undefined)).toBe(true)
  })

  it('apps distintas con EXACTAMENTE el mismo icono ⇒ ninguna lo lleva (es el genérico)', async () => {
    const s = make()
    s.appIcon = async (b) => (b.endsWith('a2') ? PNG_B : PNG_A)
    const c = await card(s, apps(3))
    expect(c.apps.map((a) => a.icon)).toEqual([undefined, undefined, PNG_B])
  })
})
