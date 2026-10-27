/**
 * P4: apps BLOQUEADAS (fija de seguridad, «Bloqueadas por ti», «No» solo en esta sesión): cero tarjetas, evento `blockedApps`
 * con el tipo de bloqueo, y si queda otra app pedible la tarjeta sale solo con ella.
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
    app: { getPath: (n: string) => (n === 'temp' ? join(h.dir, 'tmp') : h.dir), getAppPath: () => join(h.dir, 'app'), isPackaged: false },
    globalShortcut: { register: () => true, unregister: () => undefined },
    powerMonitor: h.power,
    shell: { openExternal: async () => undefined },
    systemPreferences: { isTrustedAccessibilityClient: () => true, getMediaAccessStatus: () => 'granted' }
  }
})

import { ComputerService, type BlockedApp } from './service'

let svc: ComputerService | null = null
beforeEach(() => {
  h.dir = mkdtempSync(join(tmpdir(), 'svc-blocked-'))
})
afterEach(() => {
  svc?.dispose()
  svc = null
  rmSync(h.dir, { recursive: true, force: true })
})

const SESSION = 'ses_0123456789abcdef'
const FIXED = { bundleId: 'com.1password.1password', name: '1Password' }
const USER = { bundleId: 'com.example.user', name: 'App Usuario' }
const OTHER = { bundleId: 'com.example.other', name: 'Otra' }

function make(): { s: ComputerService; cards: Array<{ id: string; apps: Array<{ bundleId: string }> }>; blocked: BlockedApp[][] } {
  const s = new ComputerService({ platform: 'darwin' })
  svc = s
  s.init()
  const cards: Array<{ id: string; apps: Array<{ bundleId: string }> }> = []
  const blocked: BlockedApp[][] = []
  s.on('requestAccess', (r) => cards.push(r))
  s.on('blockedApps', (e) => blocked.push(e.apps))
  return { s, cards, blocked }
}

describe('apps bloqueadas: sin tarjeta y con tipo de bloqueo', () => {
  it('fija de seguridad: cero tarjetas, tipo «fixed»', async () => {
    const { s, cards, blocked } = make()
    const r = await s.requestAccess([FIXED], undefined, undefined, SESSION)
    expect(cards).toHaveLength(0)
    expect(r.decisions[FIXED.bundleId]).toBe('deny')
    expect(blocked).toEqual([[{ ...FIXED, kind: 'fixed' }]])
    expect(r.blocked?.[0].kind).toBe('fixed')
  })

  it('«Bloqueadas por ti» (guardada): cero tarjetas, tipo «user»', async () => {
    const { s, cards, blocked } = make()
    s.grants.deny(USER.bundleId)
    const r = await s.requestAccess([USER], undefined, undefined, SESSION)
    expect(cards).toHaveLength(0)
    expect(r.decisions[USER.bundleId]).toBe('deny')
    expect(blocked[0][0].kind).toBe('user')
  })

  it('«No» solo en esta tarea: cero tarjetas la segunda vez, tipo «session»', async () => {
    const { s, cards, blocked } = make()
    const p = s.requestAccess([USER], undefined, undefined, SESSION)
    await vi.waitFor(() => expect(cards).toHaveLength(1))
    s.resolveAccessRequest(cards[0].id, [{ bundleId: USER.bundleId, name: USER.name, decision: 'deny' }])
    await p
    expect(blocked).toHaveLength(0)
    const r = await s.requestAccess([USER], undefined, undefined, SESSION)
    expect(cards).toHaveLength(1)
    expect(r.decisions[USER.bundleId]).toBe('deny')
    expect(blocked[0][0].kind).toBe('session')
  })

  it('bloqueada + otra app: la tarjeta sale solo con la otra', async () => {
    const { s, cards, blocked } = make()
    const p = s.requestAccess([FIXED, OTHER], undefined, undefined, SESSION)
    await vi.waitFor(() => expect(cards).toHaveLength(1))
    expect(cards[0].apps.map((a) => a.bundleId)).toEqual([OTHER.bundleId])
    s.resolveAccessRequest(cards[0].id, [{ bundleId: OTHER.bundleId, name: OTHER.name, decision: 'view' }])
    const r = await p
    expect(r.decisions).toEqual({ [OTHER.bundleId]: 'view', [FIXED.bundleId]: 'deny' })
    expect(blocked[0][0].bundleId).toBe(FIXED.bundleId)
  })
})
