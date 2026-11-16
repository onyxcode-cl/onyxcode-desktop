// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { OpencodeClient } from '../../lib/opencode'

vi.mock('../../lib/api', () => ({
  api: {},
  call: vi.fn(async () => ({ found: true, source: 'bundled', compatible: true }))
}))
vi.mock('../settings', () => ({
  ProviderKeyForm: () => null,
  unconnectedProviders: () => [],
  useProviderCatalog: () => ({ catalog: { all: [] }, loading: false, reload: vi.fn() }),
  useProviderConnect: () => ({ busy: false, notice: null })
}))

import { OnboardingGate } from './Wizard'
import { useSettings } from '../../stores/settings'
import { useProviders } from '../../stores/providers'
import { useServer } from '../../stores/server'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement
let root: Root
const update = vi.fn(async () => undefined)
const click = async (text: string): Promise<void> => {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === text)!
  expect(button.disabled).toBe(false)
  await act(async () => button.click())
}

beforeEach(() => {
  vi.unstubAllGlobals()
  update.mockClear()
  useSettings.setState({ loaded: true, settings: { ...DEFAULT_SETTINGS, onboarded: false }, update })
  useProviders.setState({ loaded: true, loading: false, providers: [], load: vi.fn(async () => undefined) })
  useServer.setState({
    status: { state: 'ready', restarts: 0 },
    error: null,
    client: { provider: { list: vi.fn(async () => ({ data: { all: [], connected: [] } })) } } as unknown as OpencodeClient
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('Conectar la IA conserva el último paso del recorrido', () => {
  it.each([2, 3, 4])('mantiene Paso %s en cuentas, modelo, modos y cierre, también al volver atrás', async (total) => {
    await act(async () => root.render(<OnboardingGate total={total} />))
    const expectProgress = (): void => {
      expect(host.querySelector('[data-testid="onboarding-progress"]')?.textContent).toBe(`Conectar tu IA · Paso ${total} de ${total}`)
      const bar = host.querySelector('[role="progressbar"]')!
      expect(bar.getAttribute('aria-valuenow')).toBe(String(total))
      expect(bar.getAttribute('aria-valuemax')).toBe(String(total))
    }
    expectProgress()
    const titles = new Set([host.querySelector('h2')?.textContent])
    for (let i = 0; i < 3; i++) {
      await click('Continuar')
      titles.add(host.querySelector('h2')?.textContent)
      expectProgress()
    }
    expect(titles.size).toBe(4)
    await click('Atrás')
    expectProgress()
    await click('Continuar')
    expectProgress()
    await click('Saltar')
    expect(update).toHaveBeenCalledWith({ onboarded: true })
  })
})
