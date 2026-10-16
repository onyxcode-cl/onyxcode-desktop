// @vitest-environment jsdom
// Primera pantalla del asistente: todo bien → saludo directo; algo mal → tarjeta de atención (primera vez en Mac y en Windows).
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpencodeInfo } from '@shared/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let craft: 'missing' | 'installed' = 'installed'
let sandbox: 'ready' | 'missing' = 'ready'
const channels: string[] = []

vi.mock('../tasks/impl/bridge', () => ({
  hasTasksBridge: () => true,
  cw: vi.fn(async (channel: string) => {
    channels.push(channel)
    if (channel === 'craft:status') return { status: craft === 'missing' ? { state: 'missing', sizeBytes: 300e6 } : { state: 'installed' } }
    if (channel === 'tasks:sandbox:status') return { state: sandbox }
    throw new Error(`canal inesperado ${channel}`)
  })
}))

import { Welcome } from './Welcome'

const info = (over: Partial<OpencodeInfo> = {}): OpencodeInfo => ({
  found: true,
  path: '/x/opencode',
  source: 'bundled',
  version: '1.19.0',
  sdkVersion: '1.19.0',
  compatible: true,
  bundledAvailable: true,
  ...over
})

let host: HTMLDivElement
let root: Root

const mount = async (platform: string, i: OpencodeInfo | null, onDone = vi.fn()): Promise<typeof onDone> => {
  ;(window as unknown as { api: unknown }).api = { platform, capsFlags: { tasksWin: true } }
  await act(async () => {
    root.render(createElement(Welcome, { info: i, onDone }))
  })
  await act(async () => {
    await Promise.resolve()
  })
  return onDone
}
const section = (): HTMLElement => host.querySelector('[data-testid="welcome"]') as HTMLElement
const buttons = (): string[] => [...host.querySelectorAll('button')].map((b) => b.textContent ?? '')

beforeEach(() => {
  vi.unstubAllGlobals()
  craft = 'installed'
  sandbox = 'ready'
  channels.length = 0
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('Welcome: todo bien → saludo directo', () => {
  it('Mac: sin lista de chequeos, con «Empezar» y sin pedir permisos', async () => {
    const onDone = await mount('darwin', info())
    expect(section().dataset.view).toBe('greeting')
    expect(host.querySelector('ul')).toBeNull()
    expect(host.textContent).toContain('Bienvenido a')
    expect(host.textContent).not.toMatch(/OpenCode|Permisos de macOS|No se pudo/)
    expect(buttons()).toEqual(['Empezar'])
    expect(channels).not.toContain('computer:status')
    expect(channels).not.toContain('computer:requestPermissions')
    const start = host.querySelector('button') as HTMLButtonElement
    expect(start.disabled).toBe(false)
    act(() => start.click())
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('Windows con el entorno aislado ya preparado: también saludo directo', async () => {
    await mount('win32', info())
    expect(section().dataset.view).toBe('greeting')
    expect(host.querySelector('ul')).toBeNull()
    expect(channels).toContain('tasks:sandbox:status')
  })
})

describe('Welcome: algo requiere atención → tarjeta con la lista', () => {
  it('falta el motor: fila en lenguaje llano, sin «binario», «CLI» ni «OpenCode»', async () => {
    await mount('darwin', info({ found: false, path: undefined, source: null }))
    expect(section().dataset.view).toBe('attention')
    const text = host.textContent ?? ''
    expect(text).toContain('Lo que hace funcionar la IA')
    expect(text).toContain('En el paso siguiente te ayudamos a resolverlo')
    expect(text).not.toMatch(/binario|CLI|OpenCode/i)
    expect(buttons()).toContain('Continuar')
  })

  it('primera vez en Mac con el diseñador de documentos sin instalar: lista con la descarga y cuenta atrás', async () => {
    craft = 'missing'
    await mount('darwin', info())
    expect(section().dataset.view).toBe('attention')
    expect(host.textContent).toContain('ArtCraft')
    expect(host.textContent).toContain('300 MB')
    expect(host.textContent).not.toContain('Permisos de macOS')
    expect(buttons().some((b) => /^Preparar todo \(\d+\)$/.test(b))).toBe(true)
  })

  it('primera vez en Windows con el entorno aislado sin preparar: lista con ese componente', async () => {
    sandbox = 'missing'
    await mount('win32', info())
    expect(section().dataset.view).toBe('attention')
    expect(host.textContent).toContain('Entorno aislado')
    expect(host.querySelector('ul')).not.toBeNull()
  })
})
