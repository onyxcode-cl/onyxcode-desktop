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
// El diálogo de permisos va por `askButtons` (osascript en macOS): aquí se sustituye; elige «Permitir en esta tarea» (índice 1).
vi.mock('../util/native-dialog', () => ({ askButtons: vi.fn(async () => 1) }))

import { initApprovals, pendingLabels, requestApproval, respondApproval } from './approvals'

const owner = { kind: 'tasks', folder: '/Users/x' } as const
const base = { owner, sessionId: 's1', kind: 'site', url: 'https://www.google.com/', host: 'www.google.com', site: 'google.com' } as const

let shown: string[] = []
beforeEach(() => {
  shown = []
  initApprovals({ hasVisibleHost: () => true, broadcastApproval: (r) => shown.push(r.id), broadcastApprovalDone: () => undefined })
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
