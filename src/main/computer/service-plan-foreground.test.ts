/**
 * Una sola aprobación: aprobar el PLAN con «Ver y clic» o «Control total» para alguna app ya da a esa sesión el control del
 * ratón y el teclado (antes hacía falta una segunda tarjeta, «¿Tomar el control de la pantalla?», y el agente perdía varias
 * llamadas rebotando contra el modo segundo plano). Con «Solo ver», con una denegación o sin plan, NO.
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
    systemPreferences: {
      isTrustedAccessibilityClient: () => true,
      getMediaAccessStatus: () => 'granted'
    }
  }
})

import { ComputerService } from './service'

let svc: ComputerService | null = null
beforeEach(() => {
  h.dir = mkdtempSync(join(tmpdir(), 'svc-plan-fg-'))
})
afterEach(() => {
  svc?.dispose()
  svc = null
  rmSync(h.dir, { recursive: true, force: true })
})

function make(): ComputerService {
  svc = new ComputerService({ platform: 'darwin' })
  svc.init()
  return svc
}

const SESSION = 'ses_plan_foreground_01'
const APP = 'com.example.a'

async function approve(
  plan: string[] | undefined,
  decision: 'view' | 'click' | 'full' | 'deny',
  approvePlan = true
): Promise<ComputerService> {
  const s = make()
  const got: Array<{ id: string }> = []
  s.on('requestAccess', (r) => got.push(r))
  const p = s.requestAccess([{ bundleId: APP, name: 'App A' }], undefined, plan, SESSION)
  await vi.waitFor(() => expect(got).toHaveLength(1))
  s.resolveAccessRequest(got[0].id, [{ bundleId: APP, name: 'App A', decision }], { approvePlan })
  await p
  return s
}

describe('el plan aprobado con clic o control total ya concede el control real (una sola tarjeta)', () => {
  it('«Control total» con plan: la sesión queda en primer plano', async () => {
    const s = await approve(['Abrir la app'], 'full')
    expect(s.isForeground(SESSION)).toBe(true)
  })

  it('«Ver y clic» con plan: también', async () => {
    const s = await approve(['Abrir la app'], 'click')
    expect(s.isForeground(SESSION)).toBe(true)
  })

  it('«Solo ver» con plan: NO (no hay clic ni teclado)', async () => {
    const s = await approve(['Abrir la app'], 'view')
    expect(s.isForeground(SESSION)).toBe(false)
  })

  it('app denegada: NO', async () => {
    const s = await approve(['Abrir la app'], 'deny', false)
    expect(s.isForeground(SESSION)).toBe(false)
  })

  it('sin plan (concesión suelta de una app): NO — el control real sigue pidiendo su tarjeta', async () => {
    const s = await approve(undefined, 'full', false)
    expect(s.isForeground(SESSION)).toBe(false)
  })

  it('otra sesión no hereda el control', async () => {
    const s = await approve(['Abrir la app'], 'full')
    expect(s.isForeground('ses_otra')).toBe(false)
  })
})
