import { describe, expect, it, vi } from 'vitest'
import type { RemoteConfirmRequest } from '@shared/ipc-remote'
import { REMOTE_INVOKE_CHANNELS } from '@shared/ipc-remote'
import { MuxError, type MuxDispatch } from '@shared/remote/mux'
import type { AuditInput } from './audit'
import { ConfirmHost, CONNECT_CHANNEL, type ConfirmHostDeps } from './confirm-host'
import { deviceFingerprint } from './confirm-queue'
import { decide } from './policy'

const DEV = 'a'.repeat(32)
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function host(over: Partial<ConfirmHostDeps> = {}): {
  h: ConfirmHost
  shown: RemoteConfirmRequest[]
  dismissed: string[]
  audits: AuditInput[]
  alerts: number
} {
  const shown: RemoteConfirmRequest[] = []
  const dismissed: string[] = []
  const audits: AuditInput[] = []
  const state = { alerts: 0 }
  const h = new ConfirmHost({
    sendToWindow: (i) => {
      shown.push(i)
      return true
    },
    dismissInWindow: (id) => void dismissed.push(id),
    fallback: async () => true,
    alert: () => void state.alerts++,
    audit: (e) => void audits.push(e),
    ...over
  })
  return {
    h,
    shown,
    dismissed,
    audits,
    get alerts() {
      return state.alerts
    }
  } as never
}

const action = {
  deviceId: DEV,
  deviceName: 'iPhone',
  channel: 'git:removeWorktree',
  payload: { dir: '/x' },
  summary: { es: 'Quitar', en: 'Remove' },
  detail: ['~/p']
}

describe('ConfirmHost (interfaz real de la cola)', () => {
  it('envía el detalle a la ventana con nombre y huella; el dueño aprueba y se audita', async () => {
    const t = host()
    const p = t.h.requestAction(action)
    expect(t.shown).toHaveLength(1)
    expect(t.shown[0]).toMatchObject({
      deviceName: 'iPhone',
      deviceFingerprint: deviceFingerprint(DEV),
      channel: 'git:removeWorktree',
      detail: ['~/p']
    })
    expect(t.shown[0]!.expiresAt - t.shown[0]!.createdAt).toBeGreaterThanOrEqual(90_000)
    expect(t.shown[0]!.expiresAt - t.shown[0]!.createdAt).toBeLessThan(90_050)
    expect(t.alerts).toBe(1)
    expect(t.h.answer(t.shown[0]!.requestId, true)).toBe(true)
    const r = await p
    expect(r.outcome).toBe('approved')
    expect(t.dismissed).toEqual([t.shown[0]!.requestId])
    expect(t.audits).toEqual([expect.objectContaining({ kind: 'confirm-approved', ch: 'git:removeWorktree' })])
    expect(JSON.stringify(t.audits)).not.toContain('/x')
  })

  it('rechazar y caducar (90 s) quedan auditados distinto', async () => {
    vi.useFakeTimers()
    try {
      const t = host()
      const p1 = t.h.requestAction(action)
      t.h.answer(t.shown[0]!.requestId, false)
      expect((await p1).outcome).toBe('rejected')
      const p2 = t.h.requestAction({ ...action, payload: { dir: '/y' } })
      await vi.advanceTimersByTimeAsync(90_000)
      expect((await p2).outcome).toBe('expired')
      expect(t.audits.map((a) => a.kind)).toEqual(['confirm-rejected', 'confirm-expired'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('sin ventana: diálogo nativo sin padre; si el dueño lo permite, se aprueba', async () => {
    const fallback = vi.fn(async () => true)
    const t = host({ sendToWindow: () => false, fallback })
    const r = await t.h.requestAction(action)
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(r.outcome).toBe('approved')
  })

  it('respaldo que rechaza: si el diálogo falla, lanza o devuelve otra cosa, se RECHAZA', async () => {
    for (const fallback of [
      async () => {
        throw new Error('boom')
      },
      () => {
        throw new Error('síncrono')
      },
      async () => false,
      async () => undefined as unknown as boolean
    ]) {
      const t = host({ sendToWindow: () => false, fallback })
      const r = await t.h.requestAction({ ...action, payload: { n: Math.random() } })
      expect(r.outcome).toBe('rejected')
    }
    // Si enviar a la ventana lanza, también se usa el respaldo (y rechaza).
    const t = host({
      sendToWindow: () => {
        throw new Error('ventana destruida')
      },
      fallback: async () => {
        throw new Error('x')
      }
    })
    expect((await t.h.requestAction(action)).outcome).toBe('rejected')
  })

  it('«recordar 12 h» solo cuenta en la confirmación de conexión y solo si se aprueba', async () => {
    const t = host()
    const p = t.h.requestConnection({ deviceId: DEV, deviceName: 'Pixel' })
    expect(t.shown[0]!.channel).toBe(CONNECT_CHANNEL)
    t.h.answer(t.shown[0]!.requestId, true, true)
    expect(await p).toMatchObject({ outcome: 'approved', remember: true })

    const p2 = t.h.requestConnection({ deviceId: DEV, deviceName: 'Pixel' })
    t.h.answer(t.shown[1]!.requestId, true, false)
    expect(await p2).toMatchObject({ remember: false })

    const p3 = t.h.requestConnection({ deviceId: DEV, deviceName: 'Pixel' })
    t.h.answer(t.shown[2]!.requestId, false, true)
    expect(await p3).toMatchObject({ outcome: 'rejected', remember: false })

    // En una acción «D» el flag se ignora.
    const p4 = t.h.requestAction(action)
    t.h.answer(t.shown[3]!.requestId, true, true)
    expect(await p4).toMatchObject({ outcome: 'approved', remember: false })
    expect(t.audits.filter((a) => a.name === 'Pixel')).toHaveLength(3)
  })

  it('un id desconocido o ya resuelto no hace nada', async () => {
    const t = host()
    expect(t.h.answer('inventado', true)).toBe(false)
    const p = t.h.requestAction(action)
    const id = t.shown[0]!.requestId
    expect(t.h.answer(id, true)).toBe(true)
    await p
    expect(t.h.answer(id, true)).toBe(false)
  })

  it('revocar el dispositivo o «Cortar todo» rechaza lo pendiente', async () => {
    const t = host()
    const a = t.h.requestAction(action)
    t.h.cancelDevice(DEV)
    expect((await a).outcome).toBe('cancelled')
    const b = t.h.requestConnection({ deviceId: DEV, deviceName: 'x' })
    t.h.cancelAll()
    expect((await b).outcome).toBe('cancelled')
    await tick()
  })
})

describe('el celular no puede invocar los canales de confirmación (despachador)', () => {
  it('la política rechaza todo remote:* y el despachador del celular no llega al anfitrión', async () => {
    for (const ch of [...REMOTE_INVOKE_CHANNELS, 'remote:connect', 'remote:confirmAction']) {
      expect(decide({ kind: 'ipc', channel: ch, payload: { requestId: 'abc', accept: true } }, { allowedDirs: [] })).toEqual({
        allow: false,
        reason: 'forbidden'
      })
    }
    // Un despachador real aplica `decide` y lanza forbidden: `remote:confirmAction` nunca se ejecuta.
    const t = host()
    const answer = vi.spyOn(t.h, 'answer')
    const dispatcher: MuxDispatch = {
      call: async (req) => {
        const d = decide({ kind: 'ipc', channel: req.ch, payload: req.p }, { allowedDirs: [] })
        if (!('allow' in d) || !d.allow) throw new MuxError('forbidden')
        return null
      },
      http: async () => null
    }
    await expect(
      dispatcher.call({ ch: 'remote:confirmAction', p: { requestId: 'x', accept: true } }, { id: 1, signal: new AbortController().signal })
    ).rejects.toMatchObject({
      code: 'forbidden'
    })
    expect(answer).not.toHaveBeenCalled()
  })
})
