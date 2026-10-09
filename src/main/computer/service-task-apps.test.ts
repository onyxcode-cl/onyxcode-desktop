/**
 * `taskApps`/`GET /task-apps` (F8-B149): a diferencia de la concesión persistente (`grants`, "para
 * siempre"), esto es "qué apps importan para la tarea de ESTA sesión ahora" — lo consulta
 * `nonGrantedBundleIds` (`mcp-platform-darwin.ts`) para decidir qué queda visible en las capturas en
 * segundo plano, en vez de "cualquier app concedida alguna vez" (el bug real de Discord, F8-B140).
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
  h.dir = mkdtempSync(join(tmpdir(), 'svc-task-apps-'))
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

async function url(s: ComputerService): Promise<string> {
  const u = await s.planGateUrl()
  if (!u) throw new Error('sin canal lateral')
  return u
}

async function taskApps(base: string, session: string): Promise<string[]> {
  const j = (await (await fetch(`${base}/task-apps?session=${session}`)).json()) as { apps: string[] }
  return j.apps
}

const SESSION = 'ses_0123456789abcdef'
const APP_A = 'com.example.a'
const APP_B = 'com.example.b'

describe('taskApps: apps relevantes para la tarea actual de una sesión', () => {
  it('sin nada aprobado todavía: lista vacía', async () => {
    const s = make()
    const base = await url(s)
    expect(await taskApps(base, SESSION)).toEqual([])
    expect(s.sessionTaskApps(SESSION)).toEqual([])
  })

  it('al aprobar una app por tarjeta, queda en la lista de la tarea (no antes)', async () => {
    const s = make()
    const base = await url(s)
    const got: Array<{ id: string }> = []
    s.on('requestAccess', (r) => got.push(r))
    const p = s.requestAccess([{ bundleId: APP_A, name: 'App A' }], undefined, undefined, SESSION)
    await vi.waitFor(() => expect(got).toHaveLength(1))
    expect(await taskApps(base, SESSION)).toEqual([]) // todavía sin resolver
    s.resolveAccessRequest(got[0].id, [{ bundleId: APP_A, name: 'App A', decision: 'view' }])
    await p
    expect(await taskApps(base, SESSION)).toEqual([APP_A])
  })

  it('una app DENEGADA no entra en la lista de la tarea', async () => {
    const s = make()
    const base = await url(s)
    const got: Array<{ id: string }> = []
    s.on('requestAccess', (r) => got.push(r))
    const p = s.requestAccess([{ bundleId: APP_A, name: 'App A' }], undefined, undefined, SESSION)
    await vi.waitFor(() => expect(got).toHaveLength(1))
    s.resolveAccessRequest(got[0].id, [{ bundleId: APP_A, name: 'App A', decision: 'deny' }])
    await p
    expect(await taskApps(base, SESSION)).toEqual([])
  })

  it('varias apps aprobadas en la misma tarea se acumulan', async () => {
    const s = make()
    const base = await url(s)
    const got: Array<{ id: string }> = []
    s.on('requestAccess', (r) => got.push(r))
    const p = s.requestAccess(
      [
        { bundleId: APP_A, name: 'App A' },
        { bundleId: APP_B, name: 'App B' }
      ],
      undefined,
      undefined,
      SESSION
    )
    await vi.waitFor(() => expect(got).toHaveLength(1))
    s.resolveAccessRequest(got[0].id, [
      { bundleId: APP_A, name: 'App A', decision: 'view' },
      { bundleId: APP_B, name: 'App B', decision: 'click' }
    ])
    await p
    expect(new Set(await taskApps(base, SESSION))).toEqual(new Set([APP_A, APP_B]))
  })

  it('el Modo auto (autoAccess) también marca la app como relevante para la tarea', async () => {
    const s = make()
    const base = await url(s)
    s.autoAccess = async () => ({ approve: true, recordId: 'rec_1' })
    await s.requestAccess([{ bundleId: APP_A, name: 'App A' }], undefined, undefined, SESSION)
    expect(await taskApps(base, SESSION)).toEqual([APP_A])
  })

  it('revokePlan limpia la lista: tarea nueva empieza de cero', async () => {
    const s = make()
    const base = await url(s)
    const got: Array<{ id: string }> = []
    s.on('requestAccess', (r) => got.push(r))
    const p = s.requestAccess([{ bundleId: APP_A, name: 'App A' }], undefined, ['paso 1'], SESSION)
    await vi.waitFor(() => expect(got).toHaveLength(1))
    s.resolveAccessRequest(got[0].id, [{ bundleId: APP_A, name: 'App A', decision: 'view' }], { approvePlan: true })
    await p
    expect(await taskApps(base, SESSION)).toEqual([APP_A])
    s.revokePlan(SESSION)
    expect(await taskApps(base, SESSION)).toEqual([])
  })

  it('sin sesión: siempre lista vacía (no hay "tarea actual" que consultar)', async () => {
    const s = make()
    await url(s)
    const got: Array<{ id: string }> = []
    s.on('requestAccess', (r) => got.push(r))
    const p = s.requestAccess([{ bundleId: APP_A, name: 'App A' }])
    await vi.waitFor(() => expect(got).toHaveLength(1))
    s.resolveAccessRequest(got[0].id, [{ bundleId: APP_A, name: 'App A', decision: 'view' }])
    await p
    expect(s.sessionTaskApps(undefined)).toEqual([])
  })

  it('las tareas de dos sesiones distintas no se mezclan', async () => {
    const s = make()
    const base = await url(s)
    const sessionB = 'ses_fedcba9876543210'
    const got: Array<{ id: string }> = []
    s.on('requestAccess', (r) => got.push(r))
    const p1 = s.requestAccess([{ bundleId: APP_A, name: 'App A' }], undefined, undefined, SESSION)
    await vi.waitFor(() => expect(got).toHaveLength(1))
    s.resolveAccessRequest(got[0].id, [{ bundleId: APP_A, name: 'App A', decision: 'view' }])
    await p1
    const p2 = s.requestAccess([{ bundleId: APP_B, name: 'App B' }], undefined, undefined, sessionB)
    await vi.waitFor(() => expect(got).toHaveLength(2))
    s.resolveAccessRequest(got[1].id, [{ bundleId: APP_B, name: 'App B', decision: 'view' }])
    await p2
    expect(await taskApps(base, SESSION)).toEqual([APP_A])
    expect(await taskApps(base, sessionB)).toEqual([APP_B])
  })
})
