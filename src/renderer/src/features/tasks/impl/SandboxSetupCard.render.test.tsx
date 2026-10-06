/** La tarjeta del entorno aislado (render estático): nada en macOS ni con el entorno listo; solo los botones que hacen algo en Windows. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { TasksSandboxState, TasksSandboxStatus } from '@shared/ipc-tasks'

const override = vi.hoisted(() => ({ status: null as unknown }))
vi.mock('./sandbox-store', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./sandbox-store')>()
  const useSandbox = Object.assign(
    (selector: (s: unknown) => unknown) => selector({ ...mod.useSandbox.getState(), status: override.status }),
    mod.useSandbox
  )
  return { ...mod, useSandbox }
})

import { SandboxSetupCard } from './SandboxSetupCard'

const win = (): void => void ((globalThis as { window?: unknown }).window = { api: { platform: 'win32', capsFlags: { tasksWin: true } } })
afterEach(() => {
  override.status = null
  delete (globalThis as { window?: unknown }).window
})

const render = (status: Partial<TasksSandboxStatus> & { state: TasksSandboxState }): string => {
  override.status = { backend: 'wsl', setup: null, ...status }
  return renderToStaticMarkup(<SandboxSetupCard />)
}
const buttons = (html: string): number => (html.match(/<button/g) ?? []).length

describe('SandboxSetupCard', () => {
  it('macOS: no pinta nada (ni «comprobando»)', () => {
    override.status = null
    expect(renderToStaticMarkup(<SandboxSetupCard />)).toBe('')
    override.status = { backend: 'seatbelt', state: 'needsSetup', setup: null }
    expect(renderToStaticMarkup(<SandboxSetupCard />)).toBe('')
  })
  it('Windows listo: no pinta nada', () => {
    win()
    expect(render({ state: 'ready' })).toBe('')
  })
  it('Windows sin respuesta: «comprobando», sin botones', () => {
    win()
    override.status = null
    const html = renderToStaticMarkup(<SandboxSetupCard />)
    expect(html).toContain('data-kind="checking"')
    expect(buttons(html)).toBe(0)
  })
  it('por instalar: un botón; instalando: barra de progreso y solo «cancelar»', () => {
    win()
    const a = render({ state: 'needsSetup' })
    expect(a).toContain('data-kind="needsSetup"')
    expect(buttons(a)).toBe(1)
    const b = render({ state: 'needsSetup', setup: { running: true, pct: 42, phase: 'downloading' } })
    expect(b).toContain('role="progressbar"')
    expect(b).toContain('aria-valuenow="42"')
    expect(b).toContain('width:42%')
    expect(buttons(b)).toBe(1)
  })
  it('guías y bloqueos: sin botón de instalar; política y puertas cerradas, sin ningún botón', () => {
    win()
    expect(buttons(render({ state: 'needsWsl' }))).toBe(1) // volver a comprobar
    expect(buttons(render({ state: 'policyDisabled' }))).toBe(0)
    expect(buttons(render({ state: 'unsupported', detail: 'report' }))).toBe(0)
  })
  it('el fallo de instalación se explica con texto traducido y ofrece reintentar y comprobar', () => {
    win()
    const html = render({ state: 'needsSetup', setup: { running: false, pct: 0, phase: '', error: 'no-space' } })
    expect(html).toContain('data-kind="setupError"')
    expect(buttons(html)).toBe(2)
    expect(html).not.toContain('no-space')
  })
})
