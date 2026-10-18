// @vitest-environment jsdom
// F8-B195: la ficha de un conector local ya no manda a instalar uv/Node a mano: ofrece «Instalar lo necesario».
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findLocalItem, type LocalConnectorReadiness } from '@shared/mcp-catalog'
import type { RuntimesSnapshot } from '@shared/runtimes'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const calls: string[] = []
let installResult: { ok: true } | { ok: false; error: string; message: string } = { ok: true }
const snap = (o: Partial<RuntimesSnapshot> = {}): RuntimesSnapshot => ({
  offered: true,
  items: [
    { id: 'node', state: 'missing', version: '24.22.0' },
    { id: 'uv', state: 'missing', version: '0.13.1' }
  ],
  missingBytes: 67_329_746,
  ready: false,
  installing: false,
  ...o
})
vi.mock('../tasks/impl/bridge', () => ({
  hasTasksBridge: () => true,
  cw: vi.fn(async (channel: string) => {
    calls.push(channel)
    if (channel === 'runtimes:install') return installResult
    if (channel === 'runtimes:status')
      return snap({ installing: true, progress: { phase: 'download', done: 33_664_873, total: 67_329_746 } })
    throw new Error(`canal inesperado ${channel}`)
  })
}))

import { LocalConnectWizard } from './ConectarLocal'

const google = findLocalItem('google-workspace')!
const MISSING: LocalConnectorReadiness = {
  platformOk: true,
  manager: 'uv',
  managerFound: false,
  runtime: 'missing',
  installBytes: 67_329_746
}
const APP: LocalConnectorReadiness = { ...MISSING, managerFound: true, runtime: 'app', installBytes: 0 }

let host: HTMLDivElement
let root: Root
const flush = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
  })
}
const click = async (el: Element | null): Promise<void> => {
  if (!el) throw new Error('elemento no encontrado')
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}
const check = async (testId: string): Promise<void> => {
  const el = document.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)!
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'))!
  const props = (el as unknown as Record<string, { onChange: (e: unknown) => void }>)[key]
  await act(async () => props.onChange({ target: { checked: true }, currentTarget: { checked: true } }))
}
const q = (id: string): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)

async function openStep2(readiness: LocalConnectorReadiness, over: Partial<Parameters<typeof LocalConnectWizard>[0]> = {}) {
  const props = {
    item: google,
    existingNames: [],
    readiness,
    onPickClient: vi.fn(async () => ({ fileName: 'client_secret_1.json', hint: '12345678…' })),
    onInstall: vi.fn(async () => undefined),
    onRuntimeChanged: vi.fn(async () => undefined),
    onClose: vi.fn(),
    ...over
  }
  await act(async () => {
    root.render(createElement(LocalConnectWizard, props))
  })
  await flush()
  await check('pers-local-ack-third')
  await check('pers-local-ack-data')
  await click(q('pers-local-next'))
  return props
}

beforeEach(() => {
  vi.unstubAllGlobals()
  localStorage.setItem('lazunox.langPref', 'es')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  calls.length = 0
  installResult = { ok: true }
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

describe('ficha de un conector local sin uv ni Node', () => {
  it('no manda a instalar a mano: explica qué se descarga (tamaño y sitios) y ofrece «Instalar lo necesario»', async () => {
    await openStep2(MISSING)
    const box = q('pers-local-need-manager')!
    const text = box.textContent ?? ''
    expect(text).toContain('Node.js y uv')
    expect(text).toContain('67 MB')
    expect(text).toContain('nodejs.org')
    expect(text).toContain('github.com')
    expect(text).toContain('No pide contraseña de administrador')
    expect(text).not.toMatch(/Instálalo desde|https?:\/\//)
    expect(q('pers-local-install-runtime')!.textContent).toContain('Instalar lo necesario')
  })

  it('«Instalar lo necesario» descarga (runtimes:install) y avisa para releer el estado del equipo', async () => {
    const p = await openStep2(MISSING)
    await click(q('pers-local-install-runtime'))
    expect(calls).toContain('runtimes:install')
    expect(p.onRuntimeChanged).toHaveBeenCalledTimes(1)
    expect(q('pers-local-runtime-error')).toBeNull()
  })

  it('si la descarga falla, dice el motivo real y se puede reintentar', async () => {
    installResult = { ok: false, error: 'hash', message: 'x' }
    const p = await openStep2(MISSING)
    await click(q('pers-local-install-runtime'))
    expect(q('pers-local-runtime-error')!.textContent).toContain('no coincide')
    expect(p.onRuntimeChanged).not.toHaveBeenCalled()
    expect(q('pers-local-install-runtime')!.disabled).toBe(false)
  })

  it('«Instalar» con el archivo elegido descarga primero lo necesario y sigue con el conector', async () => {
    const order: string[] = []
    const p = await openStep2(MISSING, {
      onInstall: vi.fn(async () => void order.push('conector')),
      onRuntimeChanged: vi.fn(async () => void order.push('runtime-listo'))
    })
    await click(q('pers-local-pick'))
    expect(q('pers-local-install')!.disabled).toBe(false)
    await click(q('pers-local-install'))
    expect(order).toEqual(['runtime-listo', 'conector'])
    expect(p.onInstall).toHaveBeenCalledTimes(1)
  })

  it('si la descarga falla, «Instalar» NO instala el conector', async () => {
    installResult = { ok: false, error: 'offline', message: '' }
    const p = await openStep2(MISSING)
    await click(q('pers-local-pick'))
    await click(q('pers-local-install'))
    expect(p.onInstall).not.toHaveBeenCalled()
    expect(q('pers-local-runtime-error')!.textContent).toContain('revisa tu conexión')
  })

  it('con el runtime de la app listo lo dice y no ofrece descargar nada', async () => {
    await openStep2(APP)
    expect(q('pers-local-need-manager')).toBeNull()
    expect(q('pers-local-runtime-ready')!.textContent).toContain('descargó y verificó')
  })

  it('con el del sistema (respaldo) también lo dice', async () => {
    await openStep2({ ...APP, runtime: 'system' })
    expect(q('pers-local-runtime-ready')!.textContent).toContain('ya tenías instalado')
  })
})
