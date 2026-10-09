/**
 * Espera acotada de las tarjetas (`request_access`): el cliente de OpenCode corta una llamada MCP a los ~5 min, así que el MCP vuelve
 * antes con «sigo esperando» y el agente repite la MISMA petición. Aquí se comprueba la mitad de `main`: una petición repetida se
 * REENGANCHA a la tarjeta abierta (no crea otra) y una sola respuesta del usuario resuelve a todas las llamadas que esperan.
 */
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
  h.dir = mkdtempSync(join(tmpdir(), 'svc-reattach-'))
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
const APP = [{ bundleId: 'com.example.a', name: 'App A' }]

describe('la petición repetida se reengancha a la tarjeta abierta', () => {
  it('misma sesión, plan y apps: una sola tarjeta y una respuesta resuelve a las dos llamadas', async () => {
    const s = make()
    const cards: Array<{ id: string }> = []
    s.on('requestAccess', (r) => cards.push(r))
    const first = s.requestAccess(APP, undefined, ['Abrir la app'], 'ses_1')
    await vi.waitFor(() => expect(cards).toHaveLength(1))
    const again = s.requestAccess(APP, undefined, ['Abrir la app'], 'ses_1')
    await new Promise((r) => setTimeout(r, 20))
    expect(cards).toHaveLength(1)
    s.resolveAccessRequest(cards[0].id, [{ bundleId: 'com.example.a', name: 'App A', decision: 'click' }], { approvePlan: true })
    const [a, b] = await Promise.all([first, again])
    expect(a.planApproved).toBe(true)
    expect(b.planApproved).toBe(true)
  })

  it('otro plan, otra sesión u otro tipo: tarjeta NUEVA (no se mezcla con la anterior)', async () => {
    const s = make()
    const cards: Array<{ id: string }> = []
    s.on('requestAccess', (r) => cards.push(r))
    void s.requestAccess(APP, undefined, ['Paso A'], 'ses_1')
    await vi.waitFor(() => expect(cards).toHaveLength(1))
    void s.requestAccess(APP, undefined, ['Paso B'], 'ses_1')
    void s.requestAccess(APP, undefined, ['Paso A'], 'ses_2')
    void s.requestAccess(APP, undefined, undefined, 'ses_1', undefined, 'takeover')
    await vi.waitFor(() => expect(cards).toHaveLength(4))
  })

  it('tras responder, una petición igual abre una tarjeta nueva (la anterior ya no está pendiente)', async () => {
    const s = make()
    const cards: Array<{ id: string }> = []
    s.on('requestAccess', (r) => cards.push(r))
    const first = s.requestAccess(APP, undefined, ['Paso A'], 'ses_1')
    await vi.waitFor(() => expect(cards).toHaveLength(1))
    s.resolveAccessRequest(cards[0].id, [{ bundleId: 'com.example.a', name: 'App A', decision: 'click' }], { approvePlan: true })
    await first
    void s.requestAccess(APP, undefined, ['Paso A'], 'ses_1')
    await vi.waitFor(() => expect(cards).toHaveLength(2))
  })
})
