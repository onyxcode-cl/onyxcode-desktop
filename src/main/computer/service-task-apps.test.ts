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

// ───────────── Permiso solo para esta sesión (P3) ─────────────
describe('tarjeta de acceso: permiso y denegación solo de la sesión', () => {
  async function tierOf(base: string, session: string, bundle: string): Promise<string | null> {
    const j = (await (await fetch(`${base}/tier?bundleId=${bundle}&name=X&session=${session}`)).json()) as { tier: string | null }
    return j.tier
  }
  async function card(s: ComputerService, app: string, session = SESSION): Promise<{ id: string; p: Promise<unknown> }> {
    const got: Array<{ id: string }> = []
    const off = (r: { id: string }): void => void got.push(r)
    s.on('requestAccess', off)
    const p = s.requestAccess([{ bundleId: app, name: 'X' }], undefined, undefined, session)
    await vi.waitFor(() => expect(got).toHaveLength(1))
    s.off('requestAccess', off)
    return { id: got[0].id, p }
  }

  it('por defecto concede solo a la sesión: no toca el disco ni otras sesiones', async () => {
    const s = make()
    const base = await url(s)
    const { id, p } = await card(s, APP_A)
    s.resolveAccessRequest(id, [{ bundleId: APP_A, name: 'X', decision: 'click' }])
    await p
    expect(await tierOf(base, SESSION, APP_A)).toBe('click')
    expect(await tierOf(base, 'ses_otra_sesion_1', APP_A)).toBeNull()
    expect(s.grants.snapshot().grants).toEqual([])
    expect(s.grants.tierFor(APP_A)).toBeNull()
  })

  it("scope 'always' conserva el permiso permanente", async () => {
    const s = make()
    const { id, p } = await card(s, APP_A)
    s.resolveAccessRequest(id, [{ bundleId: APP_A, name: 'X', decision: 'view' }], { scope: 'always' })
    await p
    expect(s.grants.tierFor(APP_A)).toBe('view')
  })

  it('caduca al revocar el plan y al detener', async () => {
    const s = make()
    const base = await url(s)
    const a = await card(s, APP_A)
    s.resolveAccessRequest(a.id, [{ bundleId: APP_A, name: 'X', decision: 'full' }])
    await a.p
    s.revokePlan(SESSION)
    expect(await tierOf(base, SESSION, APP_A)).toBeNull()
    const b = await card(s, APP_B)
    s.resolveAccessRequest(b.id, [{ bundleId: APP_B, name: 'X', decision: 'view' }])
    await b.p
    expect(await tierOf(base, SESSION, APP_B)).toBe('view')
    s.stop()
    expect(await tierOf(base, SESSION, APP_B)).toBeNull()
  })

  it('no baja un nivel: sesión «view» sobre persistido «full» sigue en full, y al revés', async () => {
    const s = make()
    const base = await url(s)
    s.grants.grant(APP_A, 'X', 'full')
    const a = await card(s, APP_A)
    s.resolveAccessRequest(a.id, [{ bundleId: APP_A, name: 'X', decision: 'view' }])
    await a.p
    expect(await tierOf(base, SESSION, APP_A)).toBe('full')
    expect(s.grants.tierFor(APP_A)).toBe('full')
    const b = await card(s, APP_B)
    s.resolveAccessRequest(b.id, [{ bundleId: APP_B, name: 'X', decision: 'full' }])
    await b.p
    const b2 = await card(s, APP_B)
    s.resolveAccessRequest(b2.id, [{ bundleId: APP_B, name: 'X', decision: 'view' }])
    await b2.p
    expect(await tierOf(base, SESSION, APP_B)).toBe('full')
  })

  it('Denegar sin alsoBlock: no escribe `denied` y no vuelve a abrir tarjeta en esa sesión', async () => {
    const s = make()
    const base = await url(s)
    const { id, p } = await card(s, APP_A)
    s.resolveAccessRequest(id, [{ bundleId: APP_A, name: 'X', decision: 'deny' }])
    await p
    expect(s.grants.snapshot().denied).toEqual([])
    const cards: unknown[] = []
    s.on('requestAccess', (r) => cards.push(r))
    const r = (await s.requestAccess([{ bundleId: APP_A, name: 'X' }], undefined, undefined, SESSION)) as {
      decisions: Record<string, string>
    }
    expect(r.decisions[APP_A]).toBe('deny')
    expect(cards).toHaveLength(0)
    expect(await tierOf(base, SESSION, APP_A)).toBeNull()
    // Otra sesión sí vuelve a preguntar.
    const o = await card(s, APP_A, 'ses_otra_sesion_1')
    s.resolveAccessRequest(o.id, [], { cancel: true })
    await o.p
  })

  it('una denegada en la sesión nunca se concede aunque el renderer diga que sí', async () => {
    const s = make()
    const base = await url(s)
    const a = await card(s, APP_A)
    s.resolveAccessRequest(a.id, [{ bundleId: APP_A, name: 'X', decision: 'deny' }])
    await a.p
    // Tarjeta con otra app pendiente en la misma sesión, intentando colar APP_A.
    const b = await card(s, APP_B)
    s.resolveAccessRequest(b.id, [
      { bundleId: APP_A, name: 'X', decision: 'full' },
      { bundleId: APP_B, name: 'X', decision: 'view' }
    ])
    await b.p
    expect(await tierOf(base, SESSION, APP_A)).toBeNull()
  })

  it('Denegar con alsoBlock sí bloquea para siempre; una denegada guardada nunca se concede', async () => {
    const s = make()
    const a = await card(s, APP_A)
    s.resolveAccessRequest(a.id, [{ bundleId: APP_A, name: 'X', decision: 'deny' }], { alsoBlock: true })
    await a.p
    expect(s.grants.snapshot().denied).toEqual([APP_A])
    const a2 = await card(s, APP_A, 'ses_otra_sesion_1')
    const res = new Promise<Record<string, string>>((ok) => void a2.p.then((r) => ok((r as { decisions: Record<string, string> }).decisions)))
    s.resolveAccessRequest(a2.id, [{ bundleId: APP_A, name: 'X', decision: 'full' }], { scope: 'always' })
    expect((await res)[APP_A]).toBe('deny')
    expect(s.grants.tierFor(APP_A)).toBeNull()
  })

  it('una app bloqueada fija nunca se concede, ni con scope always', async () => {
    const s = make()
    const blocked = 'com.apple.Passwords'
    expect(s.grants.isBlocked(blocked)).toBe(true)
    const { id, p } = await card(s, blocked)
    const res = new Promise<Record<string, string>>((ok) => void p.then((r) => ok((r as { decisions: Record<string, string> }).decisions)))
    s.resolveAccessRequest(id, [{ bundleId: blocked, name: 'X', decision: 'full' }], { scope: 'always' })
    expect((await res)[blocked]).toBe('deny')
  })
})
