/**
 * Tarjeta de permiso del celular (rediseño PWA T3): propiedades de seguridad que NO dependen del marcado exacto —ningún botón con
 * autoFocus, todos de 44 px, textos de seguridad completos— y el orden de decisiones-pwa #1 (destructivo: «Rechazar» primero).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'
import { t } from '@shared/i18n'
import { stripDesk } from '../../../../../test/strip-desk'

// Stub del store de Tareas (como en PermissionPrompt.render.test.tsx, pero con estado que el
// selector sí evalúa, para que ApprovalBar encuentre `autoPending`).
const mock = vi.hoisted(() => ({ state: { autoPending: {}, policy: {} } as Record<string, unknown> }))
vi.mock('./store', () => ({
  useTasks: Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(mock.state) : mock.state), {
    getState: () => mock.state,
    setState: () => undefined,
    subscribe: () => () => undefined
  })
}))
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

import { PermissionCard } from './PermissionPrompt'

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
function surface(platform: string | null): void {
  if (platform === null) delete g.window
  else g.window = { api: { platform } }
}
afterEach(() => surface(null))

const req = (over: Partial<PermissionRequest> = {}): PermissionRequest =>
  ({ id: 'per_1', sessionID: 's', permission: 'bash', patterns: ['ls'], metadata: {}, always: [], ...over }) as PermissionRequest
const html = (el: ReactNode): string => stripDesk(renderToStaticMarkup(el))
const labels = (h: string): string[] => [...h.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1])

describe('celular/PWA: tarjeta de permiso (propiedades de seguridad)', () => {
  const destructive = req({ patterns: ['rm -rf x'], metadata: { command: 'rm -rf x' } })
  const plain = req({ patterns: ['ls'], metadata: { command: 'ls' } })
  it('ningún autofocus y todos los botones de 44 px', () => {
    surface('remote')
    for (const r of [destructive, plain]) {
      const h = html(<PermissionCard request={r} />)
      expect(h).not.toContain('autofocus')
      const buttons = [...h.matchAll(/<button[^>]*class="([^"]*)"/g)].map((m) => m[1])
      expect(buttons.length).toBeGreaterThanOrEqual(3)
      for (const c of buttons) expect(c).toContain('min-h-11')
    }
  })
  it('destructivo: «Rechazar» primero y sin «Permitir siempre»; no destructivo: «Permitir una vez» primero', () => {
    surface('remote')
    expect(labels(html(<PermissionCard request={destructive} />))).toEqual(['Rechazar', 'Permitir una vez', 'Rechazar con indicaciones'])
    expect(labels(html(<PermissionCard request={plain} />))).toEqual([
      'Permitir una vez',
      'Rechazar',
      'Rechazar con indicaciones',
      'Permitir siempre'
    ])
  })
  it('caracteres ocultos: sigue el aviso de seguridad', () => {
    surface('remote')
    const h = html(<PermissionCard request={req({ metadata: { command: 'ls\u202Ecat' }, patterns: ['ls'] })} />)
    expect(h).toContain(t('tasksComputer.perm.hidden'))
  })
})
