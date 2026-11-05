// @vitest-environment jsdom
// Recorrido de la primera vez: bienvenida → «Preparando» (lista con casillas) → conectar la IA, una sola pantalla a la vez y en ese orden.
// Quien ya terminó el asistente no ve la bienvenida. «Más tarde» deja pasar y Ajustes puede volver a abrir la lista.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { PreflightComponent, PreflightReport } from '@shared/preflight'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const c = (id: PreflightComponent['id'], o: Partial<PreflightComponent> = {}): PreflightComponent => ({
  id,
  essential: ['storage', 'engine'].includes(id),
  ok: true,
  installable: ['craft', 'runtimes', 'sandbox'].includes(id),
  ...o
})
let platform: 'darwin' | 'win32' = 'darwin'
const report = (): PreflightReport => ({
  at: 1,
  platform,
  appVersion: '1.8.9',
  freeBytes: 50e9,
  components: [
    c('storage'),
    c('disk'),
    c('engine'),
    c('craft', { ok: false, reason: 'missing', sizeBytes: 205e6 }),
    c('runtimes', { ok: false, reason: 'missing', sizeBytes: 67e6 }),
    ...(platform === 'darwin'
      ? [c('perms', { ok: false, reason: 'both' }), c('location')]
      : [c('sandbox', { ok: false, reason: 'needsSetup', sizeBytes: 2e9 })])
  ]
})
const calls: string[] = []
vi.mock('../tasks/impl/bridge', () => ({
  hasTasksBridge: () => true,
  cw: vi.fn(async (channel: string) => {
    calls.push(channel)
    if (channel === 'preflight:run') return report()
    return undefined
  })
}))
vi.mock('./Wizard', () => ({ OnboardingGate: () => createElement('div', { 'data-testid': 'wizard-step' }, 'Conecta tu IA') }))
vi.mock('../settings/impl/runtimes-view', () => ({
  runtimesApi: { install: vi.fn(), status: vi.fn() },
  runtimesPct: () => null
}))
vi.mock('../code/impl/client', () => ({ nativeCode: () => null }))

import { FirstRunGate } from './FirstRunGate'
import { openPreflight } from './preflight-open'
import { useSettings } from '../../stores/settings'

let host: HTMLDivElement
let root: Root
const q = (id: string): Element | null => host.querySelector(`[data-testid="${id}"]`)
const btn = (label: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}
const mount = async (onboarded: boolean, os: 'darwin' | 'win32' = 'darwin'): Promise<void> => {
  platform = os
  ;(window as unknown as { api: unknown }).api = { platform: os, capsFlags: { tasksWin: true } }
  useSettings.setState({ loaded: true, settings: { ...DEFAULT_SETTINGS, onboarded } })
  await act(async () => {
    root.render(createElement(FirstRunGate))
  })
  await flush()
}

beforeEach(() => {
  vi.unstubAllGlobals()
  calls.length = 0
  localStorage.clear?.()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('primera vez: orden de los tres pasos', () => {
  it('1) bienvenida primero: no revisa nada ni muestra la lista ni el asistente', async () => {
    await mount(false)
    expect(q('welcome')).not.toBeNull()
    expect(q('preflight-screen')).toBeNull()
    expect(q('wizard-step')).toBeNull()
    expect(calls).not.toContain('preflight:run')
  })

  it('2) «Empezar» → la lista «Preparando» con «Paso 2 de 3», sin bienvenida ni asistente a la vez', async () => {
    await mount(false)
    await act(async () => btn('Empezar')!.click())
    await flush()
    expect(q('preflight-screen')).not.toBeNull()
    expect(q('preflight-step')?.textContent).toContain('Paso 2 de 3')
    expect(q('welcome')).toBeNull()
    expect(q('wizard-step')).toBeNull()
  })

  it('casillas: lo recomendado (ArtCraft) marcado y lo opcional (Node.js y uv) desmarcado; el botón dice «Instalar lo marcado»', async () => {
    await mount(false)
    await act(async () => btn('Empezar')!.click())
    await flush()
    expect((q('pick-craft') as HTMLInputElement).checked).toBe(true)
    expect((q('pick-runtimes') as HTMLInputElement).checked).toBe(false)
    expect(btn('Instalar lo marcado')).toBeDefined()
    expect(q('preflight-size')?.textContent).toContain('205 MB')
  })

  it('3) «Más tarde» deja pasar al asistente de conectar la IA y lo recuerda', async () => {
    await mount(false)
    await act(async () => btn('Empezar')!.click())
    await flush()
    await act(async () => btn('Más tarde')!.click())
    await flush()
    expect(q('preflight-screen')).toBeNull()
    expect(q('wizard-step')).not.toBeNull()
    expect(localStorage.getItem('lazunox.preflight.dismissed')).toContain('craft')
  })

  it('Mac: la lista trae la fila de permisos de macOS', async () => {
    await mount(false, 'darwin')
    await act(async () => btn('Empezar')!.click())
    await flush()
    expect(q('preflight-row-perms')).not.toBeNull()
  })

  it('Windows: sin fila de permisos de macOS ni de ubicación; sí el entorno aislado, marcado', async () => {
    await mount(false, 'win32')
    await act(async () => btn('Empezar')!.click())
    await flush()
    expect(q('preflight-row-perms')).toBeNull()
    expect(q('preflight-row-location')).toBeNull()
    expect(q('preflight-row-sandbox')).not.toBeNull()
    expect((q('pick-sandbox') as HTMLInputElement).checked).toBe(true)
  })
})

describe('quien ya terminó el asistente', () => {
  it('no ve la bienvenida y, tras «Más tarde» en un arranque anterior, la lista no vuelve sola', async () => {
    localStorage.setItem('lazunox.preflight.dismissed', JSON.stringify({ version: '1.8.9', ids: ['craft', 'runtimes', 'perms'] }))
    await mount(true)
    expect(q('welcome')).toBeNull()
    expect(q('preflight-screen')).toBeNull()
  })

  it('Ajustes › «Instalar o activar piezas» vuelve a abrir la lista aunque se haya dejado para más tarde, sin «Paso 2 de 3»', async () => {
    localStorage.setItem('lazunox.preflight.dismissed', JSON.stringify({ version: '1.8.9', ids: ['craft', 'runtimes', 'perms'] }))
    await mount(true)
    await act(async () => openPreflight())
    await flush()
    expect(q('preflight-screen')).not.toBeNull()
    expect(q('preflight-step')).toBeNull()
    await act(async () => btn('Más tarde')!.click())
    await flush()
    expect(q('preflight-screen')).toBeNull()
  })
})

describe('antes de cargar los ajustes', () => {
  it('cubre la pantalla (nada de inicio detrás) y no revisa todavía', async () => {
    ;(window as unknown as { api: unknown }).api = { platform: 'darwin', capsFlags: {} }
    useSettings.setState({ loaded: false })
    await act(async () => {
      root.render(createElement(FirstRunGate))
    })
    expect(q('firstrun-loading')?.className).toContain('fixed inset-0')
    expect(calls).not.toContain('preflight:run')
  })
})
