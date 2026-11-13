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
let trustResult: { ok: boolean; error?: string } = { ok: true }
let craftResult: { ok: boolean; error?: string } = { ok: true }
let craftRun: (() => Promise<typeof craftResult>) | undefined
let freeBytes = 50e9
const report = (): PreflightReport => ({
  at: 1,
  platform,
  appVersion: '1.8.9',
  freeBytes,
  components: [
    c('storage'),
    c('disk'),
    c('engine'),
    c('craft', { ok: false, reason: 'missing', sizeBytes: 205e6 }),
    c('runtimes', { ok: false, reason: 'missing', sizeBytes: 67e6 }),
    ...(platform === 'darwin' ? [c('trust', { ok: false, reason: 'missing', installable: true })] : []),
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
    if (channel === 'preflight:trust') return trustResult
    if (channel === 'craft:install') return craftRun ? craftRun() : craftResult
    if (channel === 'tasks:sandbox:status') return { state: 'ready', setup: null }
    return undefined
  })
}))
vi.mock('./Wizard', () => ({ OnboardingGate: () => createElement('div', { 'data-testid': 'wizard-step' }, 'Conecta tu IA') }))
const runtimesInstall = vi.fn(async () => ({ ok: true }))
vi.mock('../settings/impl/runtimes-view', () => ({
  runtimesApi: { install: (...a: unknown[]) => runtimesInstall(...(a as [])), status: vi.fn(async () => ({})) },
  runtimesPct: () => null
}))
vi.mock('../code/impl/client', () => ({ nativeCode: () => null }))

import { FirstRunGate } from './FirstRunGate'
import { openPreflight } from './preflight-open'
import { useSettings } from '../../stores/settings'
import { resetAutoInstall } from './auto-install'

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
  runtimesInstall.mockClear()
  trustResult = { ok: true }
  craftResult = { ok: true }
  craftRun = undefined
  freeBytes = 50e9
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  resetAutoInstall()
  localStorage.clear?.()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('primera vez: Bienvenida → Aceptar todo → Permisos → Conectar IA', () => {
  const start = async (onboarded = false, os: 'darwin' | 'win32' = 'darwin'): Promise<void> => {
    await mount(onboarded, os)
    if (!onboarded) {
      await act(async () => btn('Empezar')!.click())
      await flush()
    }
  }

  it('1) bienvenida primero: no revisa nada ni muestra la lista ni el asistente', async () => {
    await mount(false)
    expect(q('welcome')).not.toBeNull()
    expect(q('preflight-screen')).toBeNull()
    expect(q('wizard-step')).toBeNull()
    expect(calls).not.toContain('preflight:run')
  })

  it('2) «Empezar» → «Instalar lo necesario» (paso 2 de 4 en Mac): solo lo que pide una persona; ArtCraft y Node.js y uv se instalan solos, sin botón', async () => {
    await start()
    expect(q('preflight-step')?.textContent).toContain('Paso 2 de 4')
    expect(q('preflight-row-trust')).not.toBeNull()
    expect(q('preflight-row-craft')).toBeNull()
    expect(q('preflight-row-runtimes')).toBeNull()
    expect(q('pick-craft')).toBeNull()
    expect(calls).toContain('craft:install')
    expect(runtimesInstall).toHaveBeenCalledTimes(1)
    expect(q('welcome')).toBeNull()
    expect(q('wizard-step')).toBeNull()
  })

  it('el paso de instalar NO lleva permisos; esos van aparte', async () => {
    await start()
    expect(q('preflight-row-perms')).toBeNull()
    expect(q('preflight-row-files')).toBeNull()
    expect(q('preflight-row-trust')).not.toBeNull()
  })

  it('la instalación automática nunca pide permisos de macOS', async () => {
    await start()
    expect(calls).not.toContain('computer:requestPermissions')
    expect(calls).not.toContain('preflight:trust')
  })

  it('Mac: «Confiar en la firma» sale en la lista de instalar, con su explicación, y entra en «Aceptar todo» (sin tocar permisos)', async () => {
    await start()
    const row = q('preflight-row-trust')!
    expect(row.textContent).toContain('Confiar en la firma de Lazunox')
    expect(row.textContent).toContain('Te pedirá tu contraseña una vez')
    expect(row.textContent).toContain('Falta tu clic')
    expect(calls).not.toContain('preflight:trust')
    await act(async () => btn('Aceptar todo e instalar')!.click())
    await flush()
    await flush()
    expect(calls).toContain('preflight:trust')
    expect(calls).not.toContain('computer:requestPermissions')
  })

  it('cancelar el aviso de contraseña de macOS no es un error: la fila queda «Falta tu clic» y el recorrido sigue', async () => {
    trustResult = { ok: false, error: 'cancelled' }
    await start()
    await act(async () => btn('Aceptar todo e instalar')!.click())
    await flush()
    await flush()
    const row = q('preflight-row-trust')!
    expect(row.getAttribute('data-state')).toBe('pending')
    expect(row.textContent).toContain('Falta tu clic')
    expect(host.textContent).not.toContain('macOS no aceptó el cambio')
    expect(btn('Más tarde')).toBeDefined()
  })

  it('si macOS rechaza el cambio: «No se pudo» con el motivo y «Reintentar» en su fila', async () => {
    trustResult = { ok: false, error: 'failed' }
    await start()
    await act(async () => btn('Aceptar todo e instalar')!.click())
    await flush()
    await flush()
    const row = q('preflight-row-trust')!
    expect(row.getAttribute('data-state')).toBe('failed')
    expect(row.textContent).toContain('macOS no aceptó el cambio')
    expect(row.textContent).toContain('Reintentar')
  })

  it('Windows: no hay pieza de firma', async () => {
    await start(false, 'win32')
    expect(q('preflight-row-trust')).toBeNull()
  })

  it('3) «Más tarde» en Mac pasa al paso de permisos (paso 3 de 4), con su aviso de «se activan a mano», y de ahí al asistente', async () => {
    await start()
    await act(async () => btn('Más tarde')!.click())
    await flush()
    expect(q('preflight-step')?.textContent).toContain('Paso 3 de 4')
    expect(q('preflight-row-perms')).not.toBeNull()
    expect(q('preflight-row-craft')).toBeNull()
    expect(q('preflight-perms-note')?.textContent).toContain('a mano')
    expect(q('preflight-row-perms')?.textContent).toContain('Falta tu clic')
    expect(q('wizard-step')).toBeNull()
    await act(async () => btn('Más tarde')!.click())
    await flush()
    expect(q('preflight-screen')).toBeNull()
    expect(q('wizard-step')).not.toBeNull()
    expect(localStorage.getItem('lazunox.preflight.dismissed')).toContain('trust')
    expect(localStorage.getItem('lazunox.preflight.dismissed')).not.toContain('craft')
  })

  it('Windows: sin firma ni permisos y con ArtCraft, Node.js y uv y el entorno aislado ya instalándose solos, no hay nada que pida una persona: pasa directo al asistente', async () => {
    await start(false, 'win32')
    expect(q('preflight-screen')).toBeNull()
    expect(q('wizard-step')).not.toBeNull()
    expect(calls).toContain('craft:install')
    expect(calls).toContain('tasks:sandbox:setup')
    expect(runtimesInstall).toHaveBeenCalledTimes(1)
  })
})

describe('quien ya terminó el asistente', () => {
  it('no ve la bienvenida y, tras «Más tarde» en un arranque anterior, la lista no vuelve sola', async () => {
    localStorage.setItem('lazunox.preflight.dismissed', JSON.stringify({ version: '1.8.9', ids: ['craft', 'runtimes', 'trust', 'perms'] }))
    await mount(true)
    expect(q('welcome')).toBeNull()
    expect(q('preflight-screen')).toBeNull()
  })

  it('Ajustes › «Instalar o activar piezas» vuelve a abrir la lista aunque se haya dejado para más tarde, con el mismo botón, sin numerar pasos', async () => {
    localStorage.setItem('lazunox.preflight.dismissed', JSON.stringify({ version: '1.8.9', ids: ['craft', 'runtimes', 'trust', 'perms'] }))
    await mount(true)
    await act(async () => openPreflight())
    await flush()
    expect(q('preflight-screen')).not.toBeNull()
    expect(q('preflight-step')).toBeNull()
    // Mismo recorrido: primero instalar, luego (en Mac) permisos; cada «Más tarde» avanza y el último cierra.
    await act(async () => btn('Más tarde')!.click())
    await flush()
    expect(q('preflight-row-perms')).not.toBeNull()
    await act(async () => btn('Más tarde')!.click())
    await flush()
    expect(q('preflight-screen')).toBeNull()
  })
})

describe('instalación automática en segundo plano', () => {
  it('en cada arranque en que falten, instala ArtCraft y Node.js y uv solo: sin pantalla, sin casillas y con la app ya usable', async () => {
    await mount(true, 'win32')
    expect(q('preflight-screen')).toBeNull()
    expect(q('pick-craft')).toBeNull()
    expect(calls).toContain('craft:install')
    expect(calls).toContain('tasks:sandbox:setup')
    expect(runtimesInstall).toHaveBeenCalledTimes(1)
    expect(host.textContent).not.toContain('Aceptar todo e instalar')
  })

  it('sin internet no descarga nada y deja un aviso discreto; al volver la conexión, instala', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    await mount(true, 'win32')
    expect(calls).not.toContain('craft:install')
    expect(q('autoinstall-pill')?.getAttribute('data-phase')).toBe('offline')
    expect(q('autoinstall-pill')?.textContent).toContain('Sin internet')
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    await act(async () => window.dispatchEvent(new Event('online')))
    await flush()
    await flush()
    expect(calls).toContain('craft:install')
  })

  it.each(['darwin', 'win32'] as const)(
    '%s: falla una descarga, el aviso sigue sin red y al reconectar termina solo lo pendiente',
    async (os) => {
      craftRun = async () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
        return { ok: false, error: 'offline' }
      }
      await mount(true, os)
      await flush()
      await flush()
      expect(calls.filter((channel) => channel === 'craft:install')).toHaveLength(1)
      expect(q('autoinstall-pill')?.getAttribute('data-phase')).toBe('offline')
      expect(runtimesInstall).toHaveBeenCalledTimes(1)
      // La revisión posterior al fallo y otra revisión manual no deben borrar el aviso ni descargar sin conexión.
      await act(async () => openPreflight())
      await flush()
      expect(q('autoinstall-pill')?.textContent).toContain('Sin internet')
      expect(calls.filter((channel) => channel === 'craft:install')).toHaveLength(1)

      let finish!: (result: typeof craftResult) => void
      craftRun = () => new Promise((resolve) => (finish = resolve))
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
      await act(async () => window.dispatchEvent(new Event('online')))
      await flush()
      expect(calls.filter((channel) => channel === 'craft:install')).toHaveLength(2)
      expect(q('autoinstall-pill')?.getAttribute('data-phase')).toBe('running')
      expect(runtimesInstall).toHaveBeenCalledTimes(1)
      if (os === 'win32') expect(calls.filter((channel) => channel === 'tasks:sandbox:setup')).toHaveLength(1)

      await act(async () => finish({ ok: true }))
      await flush()
      expect(q('autoinstall-pill')).toBeNull()
      expect(calls.filter((channel) => channel === 'craft:install')).toHaveLength(2)
    }
  )

  it('sin espacio suficiente (regla del disco) no instala nada y avisa con «Reintentar»', async () => {
    freeBytes = 100e6
    await mount(true, 'win32')
    expect(calls).not.toContain('craft:install')
    expect(runtimesInstall).not.toHaveBeenCalled()
    const pill = q('autoinstall-pill')!
    expect(pill.getAttribute('data-phase')).toBe('nodisk')
    expect(pill.textContent).toContain('No hay espacio suficiente')
    freeBytes = 50e9
    await act(async () => btn('Reintentar')!.click())
    await flush()
    await flush()
    expect(calls).toContain('craft:install')
  })

  it('si falla de verdad (p. ej. la comprobación de integridad) dice el motivo y ofrece «Reintentar», sin bloquear la app', async () => {
    craftResult = { ok: false, error: 'hash' }
    await mount(true, 'win32')
    await flush()
    const pill = q('autoinstall-pill')!
    expect(pill.getAttribute('data-phase')).toBe('failed')
    expect(btn('Reintentar')).toBeDefined()
    expect(q('preflight-screen')).toBeNull()
    craftResult = { ok: true }
    const before = calls.filter((x) => x === 'craft:install').length
    await act(async () => btn('Reintentar')!.click())
    await flush()
    await flush()
    expect(calls.filter((x) => x === 'craft:install').length).toBe(before + 1)
  })

  it('Ajustes › «Instalar o activar piezas» sigue mostrando todo con sus casillas (recomendado marcado, Node.js y uv desmarcado)', async () => {
    await mount(true)
    await act(async () => openPreflight())
    await flush()
    expect(q('preflight-row-craft')).not.toBeNull()
    await act(async () => btn('Elegir qué instalar')!.click())
    expect((q('pick-craft') as HTMLInputElement).checked).toBe(true)
    expect((q('pick-runtimes') as HTMLInputElement).checked).toBe(false)
    expect(btn('Instalar lo marcado')).toBeDefined()
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
