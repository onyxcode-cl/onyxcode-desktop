import { describe, expect, it } from 'vitest'
import type { RemoteConfirmRequest } from '@shared/ipc-remote'
import {
  callDigest,
  canonicalJson,
  CONFIRM_LIMITS,
  ConfirmQueue,
  deviceFingerprint,
  type ConfirmOutcome,
  type ConfirmResult
} from './confirm-queue'

function setup() {
  let t = 1_000_000
  const timers: Array<{ at: number; fn: () => void; id: number; live: boolean }> = []
  const shown: RemoteConfirmRequest[] = []
  const dismissed: Array<[string, ConfirmOutcome]> = []
  const q = new ConfirmQueue({
    ui: { present: (i) => shown.push(i), dismiss: (id, o) => dismissed.push([id, o]) },
    now: () => t,
    setTimer: (fn, ms) => {
      const e = { at: t + ms, fn, id: timers.length, live: true }
      timers.push(e)
      return e
    },
    clearTimer: (h) => {
      ;(h as { live: boolean }).live = false
    }
  })
  const advance = (ms: number): void => {
    t += ms
    for (const e of timers.filter((x) => x.live && x.at <= t).sort((a, b) => a.at - b.at)) {
      e.live = false
      e.fn()
    }
  }
  const input = (channel = 'git:removeWorktree', payload: unknown = { cwd: '/p', path: '/p/wt' }, deviceId = 'dev1') => ({
    deviceId,
    deviceName: 'iPhone de Ana',
    channel,
    payload,
    summary: { es: 'Eliminar', en: 'Remove' },
    detail: ['~/p']
  })
  return { q, shown, dismissed, advance, input, now: () => t }
}

const settle = async (p: Promise<ConfirmResult>): Promise<ConfirmResult | 'pending'> =>
  Promise.race([p, new Promise<'pending'>((r) => setTimeout(() => r('pending'), 5))])

describe('canonicalJson / callDigest', () => {
  it('el orden de claves no importa; el contenido sí', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe('{"a":[2,{"d":1}],"b":1}')
    expect(callDigest('x', { a: 1, b: 2 })).toBe(callDigest('x', { b: 2, a: 1 }))
    expect(callDigest('x', { a: 1 })).not.toBe(callDigest('x', { a: 2 }))
    expect(callDigest('x', { a: 1 })).not.toBe(callDigest('y', { a: 1 }))
    expect(callDigest('ab', 'c')).not.toBe(callDigest('a', 'bc'))
    expect(callDigest('x', undefined)).toMatch(/^[0-9a-f]{64}$/)
  })
  it('huella de dispositivo: 8 hex', () => expect(deviceFingerprint('dev1')).toMatch(/^[0-9a-f]{8}$/))
})

describe('ConfirmQueue', () => {
  it('muestra la primera con nombre, huella, resumen y plazo de 90 s', async () => {
    const { q, shown, input, now } = setup()
    const p = q.request(input())
    expect(shown).toHaveLength(1)
    const s = shown[0] as RemoteConfirmRequest
    expect(s.deviceName).toBe('iPhone de Ana')
    expect(s.deviceFingerprint).toBe(deviceFingerprint('dev1'))
    expect(s.summary.es).toBe('Eliminar')
    expect(s.detail).toEqual(['~/p'])
    expect(s.expiresAt - now()).toBe(CONFIRM_LIMITS.timeoutMs)
    expect(q.resolve(s.requestId, true)).toBe(true)
    expect(await p).toEqual({ outcome: 'approved', digest: callDigest('git:removeWorktree', { cwd: '/p', path: '/p/wt' }) })
    expect(q.pendingCount).toBe(0)
  })

  it('rechazar resuelve rejected; resolver dos veces o un id inventado no vale', async () => {
    const { q, shown, input } = setup()
    const p = q.request(input())
    const id = (shown[0] as RemoteConfirmRequest).requestId
    expect(q.resolve('inventado', true)).toBe(false)
    expect(q.resolve(id, false)).toBe(true)
    expect((await p).outcome).toBe('rejected')
    expect(q.resolve(id, true)).toBe(false)
  })

  it('aprobar una llamada distinta no vale', async () => {
    const { q, shown, input } = setup()
    const a = q.request(input('git:removeWorktree', { cwd: '/p', path: '/p/wt1' }))
    const b = q.request(input('git:removeWorktree', { cwd: '/p', path: '/p/wt2' }))
    expect(shown).toHaveLength(1) // solo se muestra la primera
    expect(q.pendingCount).toBe(2) // b espera sin mostrarse: su id aún no existe para la interfaz
    const first = shown[0] as RemoteConfirmRequest
    q.resolve(first.requestId, true)
    const ra = await a
    expect(ra.outcome).toBe('approved')
    expect(ra.digest).toBe(callDigest('git:removeWorktree', { cwd: '/p', path: '/p/wt1' }))
    expect(ra.digest).not.toBe(callDigest('git:removeWorktree', { cwd: '/p', path: '/p/wt2' }))
    expect(await settle(b)).toBe('pending') // la aprobación de a no arrastra a b
    expect(shown).toHaveLength(2)
    q.resolve((shown[1] as RemoteConfirmRequest).requestId, false)
    expect((await b).outcome).toBe('rejected')
  })

  it('una aprobación se consume: repetir la llamada pide otra confirmación', async () => {
    const { q, shown, input } = setup()
    const p1 = q.request(input())
    q.resolve((shown[0] as RemoteConfirmRequest).requestId, true)
    await p1
    const p2 = q.request(input())
    expect(shown).toHaveLength(2)
    expect(await settle(p2)).toBe('pending')
    expect((shown[1] as RemoteConfirmRequest).requestId).not.toBe((shown[0] as RemoteConfirmRequest).requestId)
  })

  it('deduplica la misma llamada pendiente: un solo diálogo y las dos reciben el resultado', async () => {
    const { q, shown, input } = setup()
    const a = q.request(input('x:y', { a: 1, b: 2 }))
    const b = q.request(input('x:y', { b: 2, a: 1 }))
    expect(q.pendingCount).toBe(1)
    expect(shown).toHaveLength(1)
    q.resolve((shown[0] as RemoteConfirmRequest).requestId, true)
    expect((await a).outcome).toBe('approved')
    expect((await b).outcome).toBe('approved')
  })

  it('la misma llamada desde otro dispositivo NO se une', () => {
    const { q, input } = setup()
    void q.request(input('x:y', {}, 'dev1'))
    void q.request(input('x:y', {}, 'dev2'))
    expect(q.pendingCount).toBe(2)
  })

  it('máx. 2 pendientes: la tercera es busy', async () => {
    const { q, input } = setup()
    void q.request(input('a:a'))
    void q.request(input('b:b'))
    const c = await q.request(input('c:c'))
    expect(c.outcome).toBe('busy')
    expect(q.pendingCount).toBe(2)
  })

  it('FIFO: la segunda se muestra al resolver la primera', () => {
    const { q, shown, input } = setup()
    void q.request(input('a:a'))
    void q.request(input('b:b'))
    expect(shown.map((s) => s.channel)).toEqual(['a:a'])
    q.resolve((shown[0] as RemoteConfirmRequest).requestId, false)
    expect(shown.map((s) => s.channel)).toEqual(['a:a', 'b:b'])
  })

  it('rechazo automático a los 90 s (reloj falso) y se avisa a la interfaz', async () => {
    const { q, shown, dismissed, advance, input } = setup()
    const p = q.request(input())
    advance(89_999)
    expect(await settle(p)).toBe('pending')
    advance(1)
    expect((await p).outcome).toBe('expired')
    expect(dismissed).toEqual([[(shown[0] as RemoteConfirmRequest).requestId, 'expired']])
    expect(q.pendingCount).toBe(0)
    expect(q.resolve((shown[0] as RemoteConfirmRequest).requestId, true)).toBe(false) // tarde: ya no vale
  })

  it('el plazo de la segunda cuenta desde que se muestra', async () => {
    const { q, shown, advance, input } = setup()
    const a = q.request(input('a:a'))
    const b = q.request(input('b:b'))
    advance(60_000)
    q.resolve((shown[0] as RemoteConfirmRequest).requestId, true)
    await a
    advance(89_000)
    expect(await settle(b)).toBe('pending')
    advance(1_000)
    expect((await b).outcome).toBe('expired')
  })

  it('10 por minuto: la 11.ª es rate-limited y se libera pasado el minuto', async () => {
    const { q, shown, advance, input } = setup()
    for (let i = 0; i < 10; i++) {
      const p = q.request(input('c:c', { i }))
      q.resolve((shown[shown.length - 1] as RemoteConfirmRequest).requestId, false)
      await p
      advance(1000)
    }
    expect((await q.request(input('c:c', { i: 99 }))).outcome).toBe('rate-limited')
    advance(50_000)
    const p = q.request(input('c:c', { i: 100 }))
    expect(await settle(p)).toBe('pending')
  })

  it('unirse a una pendiente no gasta cupo', () => {
    const { q, input } = setup()
    for (let i = 0; i < 30; i++) void q.request(input('same:call', {}))
    expect(q.pendingCount).toBe(1)
  })

  it('cancelAll y cancelDevice rechazan lo pendiente', async () => {
    const { q, shown, dismissed, input } = setup()
    const a = q.request(input('a:a', {}, 'dev1'))
    const b = q.request(input('b:b', {}, 'dev2'))
    q.cancelDevice('dev1')
    expect((await a).outcome).toBe('cancelled')
    expect(shown.map((s) => s.channel)).toEqual(['a:a', 'b:b']) // b pasa a mostrarse
    q.cancelAll()
    expect((await b).outcome).toBe('cancelled')
    expect(q.pendingCount).toBe(0)
    expect(dismissed.map((d) => d[1])).toEqual(['cancelled', 'cancelled'])
  })
})
