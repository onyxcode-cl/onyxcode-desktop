/**
 * Aprobaciones del navegador integrado: una acción repetida del agente mientras el usuario aún no responde COMPARTE la tarjeta
 * pendiente (antes abría una segunda, y la primera quedaba huérfana tras el «timeout» de la herramienta).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
  Notification: class {
    static isSupported(): boolean {
      return false
    }
    show(): void {}
  }
}))
vi.mock('@shared/i18n', () => ({ t: (k: string) => k }))
// Se simula el aviso del sistema: el índice 1 solo abre la tarjeta.
vi.mock('../util/native-dialog', () => ({ askButtons: vi.fn(async () => 1) }))

import { initApprovals, pendingFor, pendingLabels, requestApproval, respondApproval } from './approvals'

import { askButtons } from '../util/native-dialog'

const owner = { kind: 'tasks', folder: '/Users/x' } as const
const base = { owner, sessionId: 's1', kind: 'site', url: 'https://www.google.com/', host: 'www.google.com', site: 'google.com' } as const

let shown: string[] = []
beforeEach(() => {
  shown = []
  vi.mocked(askButtons).mockReset().mockResolvedValue(1)
  initApprovals({
    showHost: vi.fn(),
    hasVisibleHost: () => true,
    broadcastApproval: (r) => shown.push(r.id),
    broadcastApprovalDone: () => undefined
  })
})

describe('requestApproval: peticiones repetidas', () => {
  it('el mismo sitio, dueño y sesión comparte UNA tarjeta y ambas esperas reciben la misma decisión', async () => {
    const a = requestApproval({ ...base })
    const b = requestApproval({ ...base })
    expect(shown).toHaveLength(1)
    respondApproval(shown[0], 'task')
    await expect(Promise.all([a, b])).resolves.toEqual(['task', 'task'])
  })

  it('tras responder, una petición nueva del mismo sitio abre otra tarjeta', async () => {
    const a = requestApproval({ ...base })
    respondApproval(shown[0], 'deny')
    await a
    const b = requestApproval({ ...base })
    expect(shown).toHaveLength(2)
    respondApproval(shown[1], 'always')
    await expect(b).resolves.toBe('always')
  })

  it('sitios o sesiones distintos NO se mezclan', async () => {
    const a = requestApproval({ ...base })
    const b = requestApproval({ ...base, site: 'wikipedia.org', host: 'www.wikipedia.org', url: 'https://www.wikipedia.org/' })
    const c = requestApproval({ ...base, sessionId: 's2' })
    expect(shown).toHaveLength(3)
    shown.forEach((id) => respondApproval(id, 'deny'))
    await Promise.all([a, b, c])
  })

  it('las acciones sensibles y las descargas NO se reutilizan (cada una es una acción distinta)', async () => {
    const a = requestApproval({ ...base, kind: 'sensitive', summary: 'Pagar' })
    const b = requestApproval({ ...base, kind: 'sensitive', summary: 'Pagar' })
    expect(shown).toHaveLength(2)
    shown.forEach((id) => respondApproval(id, 'deny'))
    await Promise.all([a, b])
  })
})

describe('pendingLabels', () => {
  it('lista los sitios que esperan respuesta y se vacía al responder', async () => {
    expect(pendingLabels()).toEqual([])
    const a = requestApproval({ ...base })
    expect(pendingLabels()).toEqual(['google.com'])
    respondApproval(shown[0], 'deny')
    await a
    expect(pendingLabels()).toEqual([])
  })
})

describe('aviso con la ventana oculta', () => {
  it.each(['site', 'local-origin', 'sensitive', 'download'] as const)(
    '%s: abrir no concede nada; la tarjeta sigue pendiente',
    async (kind) => {
      const showHost = vi.fn()
      initApprovals({ hasVisibleHost: () => false, showHost, broadcastApproval: (r) => shown.push(r.id), broadcastApprovalDone: vi.fn() })
      const settled = vi.fn()
      const answer = requestApproval({ ...base, kind }).then((d) => {
        settled(d)
        return d
      })
      await vi.waitFor(() => expect(showHost).toHaveBeenCalledWith(owner))
      expect(askButtons).toHaveBeenCalledWith(
        expect.objectContaining({ buttons: ['merr.dialog.no', 'merr.hostExec.openApp'], defaultIndex: 0, cancelIndex: 0 })
      )
      expect(settled).not.toHaveBeenCalled()
      expect(pendingFor(owner)).toHaveLength(1)
      expect(shown).toEqual([shown[0], shown[0]])
      respondApproval(shown[0], 'allow')
      expect(await answer).toBe('allow')
      expect(pendingFor(owner)).toEqual([])
      expect(vi.mocked(askButtons).mock.calls[0]![0].signal!.aborted).toBe(true)
    }
  )
  it('No deniega y no abre ninguna ventana', async () => {
    const showHost = vi.fn()
    vi.mocked(askButtons).mockResolvedValue(0)
    initApprovals({ hasVisibleHost: () => false, showHost, broadcastApproval: (r) => shown.push(r.id), broadcastApprovalDone: vi.fn() })
    expect(await requestApproval(base)).toBe('deny')
    expect(showHost).not.toHaveBeenCalled()
    expect(pendingFor(owner)).toEqual([])
  })
  it('si se responde en la app antes de cerrar el aviso, su respuesta tardía no abre ni concede', async () => {
    let done!: (i: number) => void
    vi.mocked(askButtons).mockImplementation(
      () =>
        new Promise((r) => {
          done = r
        })
    )
    const showHost = vi.fn()
    initApprovals({ hasVisibleHost: () => false, showHost, broadcastApproval: (r) => shown.push(r.id), broadcastApprovalDone: vi.fn() })
    const answer = requestApproval(base)
    respondApproval(shown[0], 'deny')
    done(1)
    expect(await answer).toBe('deny')
    await Promise.resolve()
    expect(showHost).not.toHaveBeenCalled()
  })
})
