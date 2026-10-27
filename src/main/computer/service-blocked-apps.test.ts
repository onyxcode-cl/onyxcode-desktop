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
    const first = await p
    // Aviso INMEDIATO al responder «Denegar» (kind session) y la respuesta al agente lleva `blocked`.
    expect(blocked).toEqual([[{ ...USER, kind: 'session' }]])
    expect(first.blocked).toEqual([{ ...USER, kind: 'session' }])
    const r = await s.requestAccess([USER], undefined, undefined, SESSION)
    expect(cards).toHaveLength(1)
    expect(r.decisions[USER.bundleId]).toBe('deny')
    expect(blocked[1][0].kind).toBe('session')
  })

  it('«Bloquear siempre»: aviso inmediato kind «user» y la respuesta lleva `blocked`', async () => {
    const { s, cards, blocked } = make()
    const p = s.requestAccess([USER], undefined, undefined, SESSION)
    await vi.waitFor(() => expect(cards).toHaveLength(1))
    s.resolveAccessRequest(cards[0].id, [{ bundleId: USER.bundleId, name: USER.name, decision: 'deny' }], { alsoBlock: true })
    const r = await p
    expect(blocked).toEqual([[{ ...USER, kind: 'user' }]])
    expect(r.blocked).toEqual([{ ...USER, kind: 'user' }])
    expect(r.decisions[USER.bundleId]).toBe('deny')
  })

  it('carrera: la app quedó bloqueada mientras la tarjeta estaba abierta ⇒ el agente recibe igual el texto firme y la persona el aviso', async () => {
    const { s, cards, blocked } = make()
    const p = s.requestAccess([USER], undefined, undefined, SESSION)
    await vi.waitFor(() => expect(cards).toHaveLength(1))
    s.grants.deny(USER.bundleId, USER.name) // otra tarea o Ajustes la bloquea con la tarjeta abierta
    s.resolveAccessRequest(cards[0].id, [{ bundleId: USER.bundleId, name: USER.name, decision: 'view' }])
    const r = await p
    expect(r.decisions[USER.bundleId]).toBe('deny')
    expect(r.blocked).toEqual([{ ...USER, kind: 'user' }])
    expect(blocked).toEqual([[{ ...USER, kind: 'user' }]])
  })

  it('«Denegar» sin sessionId válido: no queda guardado, sin aviso y sin `blocked`', async () => {
    const { s, cards, blocked } = make()
    const p = s.requestAccess([USER], undefined, undefined, undefined)
    await vi.waitFor(() => expect(cards).toHaveLength(1))
    s.resolveAccessRequest(cards[0].id, [{ bundleId: USER.bundleId, name: USER.name, decision: 'deny' }])
    const r = await p
    expect(r.decisions[USER.bundleId]).toBe('deny')
    expect(blocked).toHaveLength(0)
    expect(r.blocked).toBeUndefined()
  })

  it('un deny para un bundleId que NO estaba en la tarjeta: se ignora, nada se emite ni se bloquea', async () => {
    const { s, cards, blocked } = make()
    const p = s.requestAccess([USER], undefined, undefined, SESSION)
    await vi.waitFor(() => expect(cards).toHaveLength(1))
    s.resolveAccessRequest(
      cards[0].id,
      [
        { bundleId: USER.bundleId, name: USER.name, decision: 'view' },
        { bundleId: 'com.otra.cualquiera', name: 'Inventada', decision: 'deny' }
      ],
      { alsoBlock: true }
    )
    const r = await p
    expect(blocked).toHaveLength(0)
    expect(r.blocked).toBeUndefined()
    expect(s.grants.isDenied('com.otra.cualquiera')).toBe(false)
  })

  it('el nombre del aviso sale de la tarjeta (main); si falta, el bundleId, nunca el que manda el renderer', async () => {
    const { s, cards, blocked } = make()
    const p = s.requestAccess([{ bundleId: USER.bundleId, name: '' }], undefined, undefined, SESSION)
    await vi.waitFor(() => expect(cards).toHaveLength(1))
    s.resolveAccessRequest(cards[0].id, [{ bundleId: USER.bundleId, name: 'NOMBRE-FALSO-DEL-RENDERER', decision: 'deny' }], {
      alsoBlock: true
    })
    await p
    expect(blocked[0][0].name).toBe(USER.bundleId)
  })

  it('Cancelar / Esc / Editar: no emite aviso ni `blocked`', async () => {
    const { s, cards, blocked } = make()
    const p = s.requestAccess([USER], undefined, undefined, SESSION)
    await vi.waitFor(() => expect(cards).toHaveLength(1))
    s.resolveAccessRequest(cards[0].id, [{ bundleId: USER.bundleId, name: USER.name, decision: 'deny' }], { cancel: true, alsoBlock: true })
    const r = await p
    expect(blocked).toHaveLength(0)
    expect(r.blocked).toBeUndefined()
    expect(s.grants.isDenied(USER.bundleId)).toBe(false)
  })

  it('mezcla en la respuesta: una bloqueada y otra permitida; solo la bloqueada se anuncia', async () => {
    const { s, cards, blocked } = make()
    const p = s.requestAccess([USER, OTHER], undefined, undefined, SESSION)
    await vi.waitFor(() => expect(cards).toHaveLength(1))
    s.resolveAccessRequest(
      cards[0].id,
      [
        { bundleId: USER.bundleId, name: USER.name, decision: 'deny' },
        { bundleId: OTHER.bundleId, name: OTHER.name, decision: 'view' }
      ],
      { alsoBlock: true }
    )
    const r = await p
    expect(blocked).toEqual([[{ ...USER, kind: 'user' }]])
    expect(r.blocked).toEqual([{ ...USER, kind: 'user' }])
    expect(r.decisions).toEqual({ [USER.bundleId]: 'deny', [OTHER.bundleId]: 'view' })
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

describe('apps bloqueadas: plan, reenganche, Modo auto y sesión', () => {
  it('plan con TODAS las apps bloqueadas: la tarjeta sale con apps [] y la respuesta trae `blocked`', async () => {
    const { s, cards } = make()
    const p = s.requestAccess([FIXED], undefined, ['abrir el gestor'], SESSION)
    await vi.waitFor(() => expect(cards).toHaveLength(1))
    expect(cards[0].apps).toEqual([])
    s.resolveAccessRequest(cards[0].id, [], { approvePlan: true })
    const r = await p
    expect(r.decisions[FIXED.bundleId]).toBe('deny')
    expect(r.blocked?.map((b) => b.bundleId)).toEqual([FIXED.bundleId])
  })

  it('petición repetida con una bloqueada y otra pedible: se reengancha a UNA sola tarjeta', async () => {
    const { s, cards } = make()
    const p1 = s.requestAccess([FIXED, OTHER], undefined, undefined, SESSION)
    await vi.waitFor(() => expect(cards).toHaveLength(1))
    const p2 = s.requestAccess([FIXED, OTHER], undefined, undefined, SESSION)
    await new Promise((r) => setTimeout(r, 30))
    expect(cards).toHaveLength(1)
    s.resolveAccessRequest(cards[0].id, [{ bundleId: OTHER.bundleId, name: OTHER.name, decision: 'view' }])
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.decisions[OTHER.bundleId]).toBe('view')
    expect(r2.decisions[OTHER.bundleId]).toBe('view')
  })

  it('Modo auto con mezcla: autoAccess nunca recibe la app bloqueada', async () => {
    const { s } = make()
    const seen: string[][] = []
    s.autoAccess = async (q) => {
      seen.push(q.apps.map((a) => a.bundleId))
      return { approve: true, recordId: 'rec_1' }
    }
    const r = await s.requestAccess([FIXED, OTHER], undefined, undefined, SESSION)
    expect(seen).toEqual([[OTHER.bundleId]])
    expect(r.decisions[FIXED.bundleId]).toBe('deny')
    expect(r.decisions[OTHER.bundleId]).toBe('view')
  })

  it('sessionId inválido: el «No» de sesión no aplica (se vuelve a preguntar)', async () => {
    const { s, cards, blocked } = make()
    const bad = 'sesión inválida/../x'
    const p = s.requestAccess([USER], undefined, undefined, bad)
    await vi.waitFor(() => expect(cards).toHaveLength(1))
    s.resolveAccessRequest(cards[0].id, [{ bundleId: USER.bundleId, name: USER.name, decision: 'deny' }])
    await p
    const p2 = s.requestAccess([USER], undefined, undefined, bad)
    await vi.waitFor(() => expect(cards).toHaveLength(2))
    expect(blocked).toHaveLength(0)
    s.resolveAccessRequest(cards[1].id, [{ bundleId: USER.bundleId, name: USER.name, decision: 'deny' }])
    await p2
  })

  it('el texto de «session» coincide con el comportamiento: dura toda la tarea, otra tarea pregunta, y al terminar se retira', async () => {
    const { s, cards, blocked } = make()
    const planStates: Array<{ sessionId: string; approved: boolean }> = []
    s.on('planState', (e) => planStates.push(e))
    const p = s.requestAccess([USER], undefined, undefined, SESSION)
    await vi.waitFor(() => expect(cards).toHaveLength(1))
    s.resolveAccessRequest(cards[0].id, [{ bundleId: USER.bundleId, name: USER.name, decision: 'deny' }])
    await p
    // Misma tarea: sigue bloqueada, sin tarjeta (no «te volveré a preguntar»).
    for (let i = 0; i < 2; i++) {
      const r = await s.requestAccess([USER], undefined, undefined, SESSION)
      expect(r.blocked?.[0].kind).toBe('session')
    }
    expect(cards).toHaveLength(1)
    expect(blocked).toHaveLength(3)
    // Tarea nueva: se vuelve a preguntar.
    const other = 'ses_fedcba9876543210'
    const p2 = s.requestAccess([USER], undefined, undefined, other)
    await vi.waitFor(() => expect(cards).toHaveLength(2))
    s.resolveAccessRequest(cards[1].id, [{ bundleId: USER.bundleId, name: USER.name, decision: 'view' }])
    await p2
    // Fin de la tarea: se retira el «No» y se avisa al renderer.
    s.revokePlan(SESSION)
    expect(planStates).toContainEqual({ sessionId: SESSION, approved: false })
    const p3 = s.requestAccess([USER], undefined, undefined, SESSION)
    await vi.waitFor(() => expect(cards).toHaveLength(3))
    s.resolveAccessRequest(cards[2].id, [{ bundleId: USER.bundleId, name: USER.name, decision: 'view' }])
    await p3
  })

  it('los textos del aviso «session» dicen lo mismo que el comportamiento (es y en)', async () => {
    const { es } = await import('@shared/i18n/es')
    const { en } = await import('@shared/i18n/en')
    const e = es['tasksComputer.blocked.session']
    const n = en['tasksComputer.blocked.session']
    expect(e).toContain('hasta que esta tarea termine')
    expect(e).toContain('tarea nueva')
    expect(e).not.toContain('pídeselo de nuevo')
    expect(n).toContain('until this task ends')
    expect(n).toContain('new task')
    expect(n).not.toMatch(/ask the agent again/)
  })
})
