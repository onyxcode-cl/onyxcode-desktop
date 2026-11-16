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
vi.mock('../../../stores/sessions', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../stores/sessions')>()
  return {
    ...mod,
    useSessions: Object.assign((selector: (s: unknown) => unknown) => selector(mod.useSessions.getState()), mod.useSessions)
  }
})
vi.mock('../../../lib/ai-gate', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../lib/ai-gate')>()
  return { ...mod, useAiGate: (model: unknown) => ({ effective: model, gate: { blocked: false }, avail: 'available' }) }
})
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

import { TasksComposer } from './TasksComposer'
import { useSessions } from '../../../stores/sessions'

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
    expect(html).toContain('Preparando tu tarea')
    expect(html).not.toContain('aria-label="Enviar"')
    expect(html).toMatch(/<textarea[^>]*disabled/)
    over.patch = {}
  })
})

it.each(['retry', 'busy'] as const)('con texto durante %s muestra enviar o detener', (run) => {
  over.patch = { sending: false, draft: 'continúa', activeTaskId: 's1' }
  useSessions.setState({ status: { s1: run } })
  const html = renderToStaticMarkup(<TasksComposer onSend={() => undefined} busy />)
  const label = run === 'retry' ? 'Enviar' : 'Detener'
  const button = html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0]
  expect(button).toBeDefined()
  expect(html).not.toContain(`aria-label="${run === 'retry' ? 'Detener' : 'Enviar'}"`)
  expect(html).not.toContain('tasks-message-queue')
  expect(button).not.toMatch(/\sdisabled(?:=|\s|>)/)
  over.patch = {}
})
