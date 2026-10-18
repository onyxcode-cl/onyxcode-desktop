// @vitest-environment jsdom
// Paso «Prepara tu equipo» del asistente (F8-B197): casilla por componente, «Preparar todo» instala solo lo marcado y reintento por fila.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const channels: string[] = []
let craftResult: { ok: boolean; error?: string } = { ok: true }

vi.mock('../tasks/impl/bridge', () => ({
  hasTasksBridge: () => true,
  cw: vi.fn(async (channel: string) => {
    channels.push(channel)
    if (channel === 'craft:status') return { status: { state: 'missing', sizeBytes: 205e6 } }
    if (channel === 'runtimes:status') return { offered: true, items: [], ready: false, missingBytes: 67_329_746, installing: false }
    if (channel === 'tasks:sandbox:status') return { state: 'ready' }
    if (channel === 'craft:install') return craftResult
    if (channel === 'runtimes:install') return { ok: true }
    throw new Error(`canal inesperado ${channel}`)
  })
}))

import { StepSetup } from './Wizard'

let host: HTMLDivElement
let root: Root
const box = (id: string): HTMLInputElement => host.querySelector(`[data-testid="pick-${id}"]`) as HTMLInputElement
const button = (label: string): HTMLButtonElement | undefined => [...host.querySelectorAll('button')].find((b) => b.textContent === label)
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(async () => {
  vi.unstubAllGlobals()
  channels.length = 0
  craftResult = { ok: true }
  ;(window as unknown as { api: unknown }).api = { platform: 'darwin', capsFlags: { tasksWin: true } }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(createElement(StepSetup, { onTryExample: () => undefined }))
  })
  await flush()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('«Prepara tu equipo»: casillas por componente', () => {
  it('ArtCraft y Node.js y uv salen marcados, con su tamaño y de dónde se bajan', () => {
    expect(box('craft').checked).toBe(true)
    expect(box('runtimes').checked).toBe(true)
    expect(host.textContent).toContain('205 MB')
    expect(host.textContent).toContain('GitHub')
    expect(host.textContent).toContain('67 MB')
    expect(host.textContent).toContain('nodejs.org')
  })

  it('«Preparar todo» instala solo lo marcado', async () => {
    await act(async () => box('craft').click())
    await act(async () => button('Preparar todo')!.click())
    await flush()
    expect(channels).toContain('runtimes:install')
    expect(channels).not.toContain('craft:install')
  })

  it('con todo desmarcado el botón no se puede pulsar', async () => {
    await act(async () => box('craft').click())
    await act(async () => box('runtimes').click())
    expect(button('Preparar todo')!.disabled).toBe(true)
  })

  it('un fallo conserva su estado y su fila tiene su propio «Reintentar» que repite solo ese componente', async () => {
    craftResult = { ok: false, error: 'hash' }
    await act(async () => button('Preparar todo')!.click())
    await flush()
    expect(host.textContent).toContain('Reintentar')
    craftResult = { ok: true }
    channels.length = 0
    const rowRetry = [...host.querySelectorAll('li button')].find((b) => b.textContent === 'Reintentar') as HTMLButtonElement
    await act(async () => rowRetry.click())
    await flush()
    expect(channels).toContain('craft:install')
    expect(channels).not.toContain('runtimes:install')
  })
})
