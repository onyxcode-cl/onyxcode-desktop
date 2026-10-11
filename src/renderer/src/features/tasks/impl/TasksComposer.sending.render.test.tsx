/** Compositor de Tareas mientras un envío está en curso: se ve «Enviando…», el cuadro y el botón quedan bloqueados. */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const over = vi.hoisted(() => ({ patch: {} as Record<string, unknown> }))
vi.mock('./store', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./store')>()
  const useTasks = Object.assign(
    (selector: (s: unknown) => unknown) => selector({ ...mod.useTasks.getState(), ...over.patch }),
    mod.useTasks
  )
  return { ...mod, useTasks }
})
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

import { TasksComposer } from './TasksComposer'

const render = (): string => renderToStaticMarkup(<TasksComposer onSend={() => undefined} busy={false} />)

describe('TasksComposer: envío en curso', () => {
  it('sin envío: botón de enviar y sin aviso', () => {
    over.patch = { sending: false, draft: 'hola' }
    const html = render()
    expect(html).not.toContain('composer-sending')
    expect(html).toContain('aria-label="Enviar"')
  })
  it('con envío: botón «Enviando…» deshabilitado, cuadro bloqueado y aviso de preparación', () => {
    over.patch = { sending: true, draft: 'hola', fullAccess: false }
    const html = render()
    expect(html).toContain('data-testid="composer-sending"')
    expect(html).toContain('Enviando…')
    expect(html).toContain('Preparando el entorno aislado')
    expect(html).not.toContain('aria-label="Enviar"')
    expect(html).toMatch(/<textarea[^>]*disabled/)
    over.patch = {}
  })
})
