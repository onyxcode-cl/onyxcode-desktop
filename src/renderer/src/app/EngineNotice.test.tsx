// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpencodeInfo } from '@shared/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const calls: string[] = []
let infoRes: OpencodeInfo
let switchRes: unknown
let restartFails = false

vi.mock('../lib/api', () => ({
  api: { invoke: vi.fn(), on: vi.fn(() => () => undefined), send: vi.fn() },
  call: vi.fn(async (channel: string) => {
    calls.push(channel)
    if (channel === 'app:opencodeInfo') return infoRes
    if (channel === 'app:useBundledEngine') return switchRes
    if (channel === 'opencode:restart') {
      if (restartFails) throw new Error('no arrancó\nmás detalle')
      return { baseUrl: 'http://x', authorization: 'a' }
    }
    return undefined
  })
}))

import { EngineNotice } from './EngineNotice'
import { useServer } from '../stores/server'
import { useSessions } from '../stores/sessions'

const outside = (over: Partial<OpencodeInfo> = {}): OpencodeInfo => ({
  found: true,
  path: '/x/opencode',
  source: 'settings',
  version: '1.18.32',
  sdkVersion: '1.19.0',
  compatible: false,
  bundledAvailable: true,
  ...over
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.unstubAllGlobals()
  calls.length = 0
  restartFails = false
  switchRes = { status: 'ok', info: outside({ source: 'bundled', version: '1.19.0', compatible: true }) }
  useServer.setState({ status: { state: 'ready', restarts: 0 }, error: null })
  useSessions.setState({ status: {} })
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
const mount = async (): Promise<void> => {
  act(() => root.render(createElement(EngineNotice)))
  await flush()
}
const remount = async (): Promise<void> => {
  act(() => root.unmount())
  root = createRoot(host)
  await mount()
}
const btn = (label: string): HTMLButtonElement => {
  const b = [...host.querySelectorAll('button')].find((x) => x.textContent === label)
  if (!b) throw new Error(`sin botón «${label}»: ${host.textContent}`)
  return b
}
const click = async (label: string): Promise<void> => {
  act(() => btn(label).click())
  await flush()
  await flush()
}

describe('EngineNotice', () => {
  it('motor de fuera más viejo: tarjeta en lenguaje llano, role=status y dos botones', async () => {
    infoRes = outside()
    await mount()
    const bar = host.querySelector('[role="status"]')!
    expect(bar.textContent).toContain('motor de IA instalado aparte (versión 1.18.32)')
    expect(bar.textContent).toContain('motor incluido (versión 1.19.0)')
    expect(bar.textContent).not.toMatch(/Si algo falla, usa/)
    expect([...bar.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Usar el motor incluido', 'Ahora no'])
  })

  it('motor más nuevo: texto tranquilo distinto', async () => {
    infoRes = outside({ version: '1.20.1' })
    await mount()
    expect(host.textContent).toContain('más nuevo que el probado (versión 1.20.1)')
    expect(host.textContent).toContain('Suele funcionar bien')
  })

  it('no aparece con el motor incluido, con la misma versión, sin motor incluido al que volver, ni si una variable lo fija', async () => {
    for (const over of [
      { source: 'bundled' as const, version: '1.19.0', compatible: true },
      { version: '1.19.0', compatible: true },
      { bundledAvailable: false },
      { source: 'env' as const }
    ]) {
      infoRes = outside(over)
      await remount()
      expect(host.textContent, JSON.stringify(over)).toBe('')
    }
  })

  it('«Ahora no» lo cierra y se recuerda por versión detectada', async () => {
    infoRes = outside()
    await mount()
    await click('Ahora no')
    expect(host.textContent).toBe('')
    expect(localStorage.getItem('lazunox.engineNotice.dismissed')).toBe('1.18.32')
    await remount()
    expect(host.textContent).toBe('')
    infoRes = outside({ version: '1.17.0' })
    await remount()
    expect(host.textContent).toContain('1.17.0')
  })

  it('«Usar el motor incluido» sin trabajo en marcha: cambia, reinicia el motor y dice «Listo»', async () => {
    infoRes = outside()
    await mount()
    await click('Usar el motor incluido')
    expect(calls.indexOf('app:useBundledEngine')).toBeGreaterThan(-1)
    expect(calls.indexOf('app:useBundledEngine')).toBeLessThan(calls.indexOf('opencode:restart'))
    expect(host.querySelector('[role="status"]')!.textContent).toContain('Listo, ahora usas el motor incluido.')
    expect(document.activeElement).toBe(btn('Cerrar'))
    await click('Cerrar')
    expect(host.textContent).toBe('')
  })

  it('con trabajo en marcha pide confirmar antes de tocar nada; «Cancelar» no cambia nada', async () => {
    useSessions.setState({ status: { s1: 'busy' } })
    infoRes = outside()
    await mount()
    await click('Usar el motor incluido')
    expect(calls).not.toContain('app:useBundledEngine')
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('Hay trabajo en marcha')
    expect(document.activeElement).toBe(btn('Cancelar'))
    await click('Cancelar')
    expect(calls).not.toContain('app:useBundledEngine')
    expect(host.querySelector('button')!.textContent).toBe('Usar el motor incluido')
    await click('Usar el motor incluido')
    await click('Cambiar y reiniciar')
    expect(calls).toContain('opencode:restart')
    expect(host.textContent).toContain('Listo')
  })

  it('si una variable de entorno fija el motor, explica el motivo sin jerga', async () => {
    infoRes = outside()
    switchRes = { status: 'pinned' }
    await mount()
    await click('Usar el motor incluido')
    expect(calls).not.toContain('opencode:restart')
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('no se puede cambiar desde aquí')
  })

  it('si el motor no reinicia, lo dice con la primera línea del motivo', async () => {
    infoRes = outside()
    restartFails = true
    await mount()
    await click('Usar el motor incluido')
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('no se pudo reiniciar: no arrancó')
    expect(host.textContent).not.toContain('más detalle')
  })
})
