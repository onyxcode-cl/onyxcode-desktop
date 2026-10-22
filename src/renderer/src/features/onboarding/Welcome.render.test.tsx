// @vitest-environment jsdom
// Primera pantalla del asistente: todo bien → saludo directo; algo mal → tarjeta de atención (primera vez en Mac y en Windows).
import { StrictMode, act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpencodeInfo } from '@shared/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let craft: 'missing' | 'installed' = 'installed'
let sandbox: 'ready' | 'missing' = 'ready'
let runtimes: 'none' | 'ready' | 'missing' = 'none'
const channels: string[] = []
let craftResult: { ok: boolean; error?: string } = { ok: true }

vi.mock('../tasks/impl/bridge', () => ({
  hasTasksBridge: () => true,
  cw: vi.fn(async (channel: string) => {
    channels.push(channel)
    if (channel === 'craft:status') return { status: craft === 'missing' ? { state: 'missing', sizeBytes: 300e6 } : { state: 'installed' } }
    if (channel === 'tasks:sandbox:status') return { state: sandbox }
    if (channel === 'runtimes:status')
      return {
        offered: runtimes !== 'none',
        items: [],
        ready: runtimes === 'ready',
        missingBytes: runtimes === 'missing' ? 67_329_746 : 0,
        installing: false
      }
    if (channel === 'craft:install') return craftResult
    if (channel === 'runtimes:install') return { ok: true }
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
  runtimes = 'none'
  channels.length = 0
  craftResult = { ok: true }
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

  it('bajo StrictMode (desarrollo y E2E) la revisión termina y «Empezar» queda habilitado', async () => {
    ;(window as unknown as { api: unknown }).api = { platform: 'darwin', capsFlags: { tasksWin: true } }
    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(Welcome, { info: info(), onDone: vi.fn() })))
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(section().dataset.view).toBe('greeting')
    expect((host.querySelector('button') as HTMLButtonElement).disabled).toBe(false)
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

  it('primera vez en Mac con el diseñador de documentos sin instalar: lista con la descarga y sin descargar nada solo', async () => {
    craft = 'missing'
    await mount('darwin', info())
    expect(section().dataset.view).toBe('attention')
    expect(host.textContent).toContain('ArtCraft')
    expect(host.textContent).toContain('300 MB')
    expect(host.textContent).not.toContain('Permisos de macOS')
    expect(buttons()).toContain('Preparar todo')
    expect(buttons().some((b) => /^Preparar todo \(\d+\)$/.test(b))).toBe(false)
  })

  it('Mac con Node.js y uv sin descargar: fila en lenguaje llano con tamaño y orígenes, dentro de «Preparar todo»', async () => {
    runtimes = 'missing'
    await mount('darwin', info())
    expect(section().dataset.view).toBe('attention')
    const text = host.textContent ?? ''
    expect(text).toContain('Node.js y uv (para conectar tu correo y calendario)')
    expect(text).toContain('67 MB')
    expect(text).toContain('nodejs.org y github.com')
    expect(buttons()).toContain('Preparar todo')
    expect(channels).not.toContain('runtimes:install') // nada se descarga solo
  })

  it('con Node.js y uv ya listos (o sin conectores locales, p. ej. Windows) la fila no aparece', async () => {
    runtimes = 'ready'
    await mount('darwin', info())
    expect(section().dataset.view).toBe('greeting')
    runtimes = 'none'
    await mount('win32', info())
    expect(host.textContent).not.toContain('Node.js y uv')
  })

  it('primera vez en Windows con el entorno aislado sin preparar: lista con ese componente', async () => {
    sandbox = 'missing'
    await mount('win32', info())
    expect(section().dataset.view).toBe('attention')
    expect(host.textContent).toContain('Entorno aislado')
    expect(host.querySelector('ul')).not.toBeNull()
  })
})

describe('Welcome: casillas por componente (F8-B197)', () => {
  const box = (id: string): HTMLInputElement => host.querySelector(`[data-testid="pick-${id}"]`) as HTMLInputElement
  const press = async (label: string): Promise<void> => {
    const b = [...host.querySelectorAll('button')].find((x) => x.textContent === label) as HTMLButtonElement
    await act(async () => b.click())
    await act(async () => {
      await Promise.resolve()
    })
  }

  // F8-B198: cada casilla queda descrita por su texto de ayuda (tamaño y origen) para lectores de pantalla.
  const described = (id: string): string => {
    const el = host.querySelector(`[data-testid="pick-${id}"]`) as HTMLInputElement
    const ref = el.getAttribute('aria-describedby')
    expect(ref).toBeTruthy()
    return host.querySelector(`[id="${ref}"]`)?.textContent ?? ''
  }

  it('cada casilla queda descrita por su ayuda (aria-describedby), con tamaño y origen', async () => {
    craft = 'missing'
    runtimes = 'missing'
    await mount('darwin', info())
    expect(described('craft')).toContain('300 MB')
    expect(described('runtimes')).toContain('nodejs.org')
  })

  it('ArtCraft y Node.js y uv salen con su casilla marcada, tamaño y origen', async () => {
    craft = 'missing'
    runtimes = 'missing'
    await mount('darwin', info())
    expect(box('craft').checked).toBe(true)
    expect(box('runtimes').checked).toBe(true)
    expect(host.textContent).toContain('300 MB')
    expect(host.textContent).toContain('GitHub')
    expect(host.textContent).toContain('67 MB')
    expect(host.textContent).toContain('nodejs.org')
    // El motor nunca se elige: no lleva casilla.
    expect(box('engine')).toBeNull()
  })

  it('«Preparar todo» instala solo lo marcado y deja lo demás «para más tarde»', async () => {
    craft = 'missing'
    runtimes = 'missing'
    await mount('darwin', info())
    await act(async () => box('craft').click())
    expect(box('craft').checked).toBe(false)
    await press('Preparar todo')
    expect(channels).toContain('runtimes:install')
    expect(channels).not.toContain('craft:install')
    expect(host.textContent).toContain('Más tarde')
    expect(host.textContent).toContain('Lo que dejaste sin marcar')
    // Lo dejado para más tarde se puede volver a marcar y reaparece «Preparar todo».
    await act(async () => box('craft').click())
    expect(box('craft').checked).toBe(true)
    expect([...host.querySelectorAll('button')].some((x) => x.textContent === 'Preparar todo')).toBe(true)
  })

  it('con todo desmarcado «Preparar todo» no se puede pulsar', async () => {
    craft = 'missing'
    await mount('darwin', info())
    await act(async () => box('craft').click())
    const run = [...host.querySelectorAll('button')].find((x) => x.textContent === 'Preparar todo') as HTMLButtonElement
    expect(run.disabled).toBe(true)
  })

  it('un fallo conserva su estado y se reintenta solo ese componente', async () => {
    craft = 'missing'
    runtimes = 'missing'
    craftResult = { ok: false, error: 'hash' }
    await mount('darwin', info())
    await press('Preparar todo')
    expect(channels).toContain('craft:install')
    expect(channels).toContain('runtimes:install')
    const row = host.querySelectorAll('li')
    expect([...row].map((li) => li.textContent).join('|')).toContain('No se pudo')
    craftResult = { ok: true }
    channels.length = 0
    const retry = [...host.querySelectorAll('li button')].find((x) => x.textContent === 'Reintentar') as HTMLButtonElement
    await act(async () => retry.click())
    await act(async () => {
      await Promise.resolve()
    })
    expect(channels).toContain('craft:install')
    expect(channels).not.toContain('runtimes:install')
  })
})
