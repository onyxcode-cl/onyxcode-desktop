// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatFileInfo } from '@shared/ipc-extras'
import { useChatDocPanel } from './useChatDocPanel'
import { requestViewChatFile } from '../../lib/chatFileView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../lib/platform', async (orig) => ({
  ...(await orig<typeof import('../../lib/platform')>()),
  platformCaps: () => ({ docViewer: true })
}))

const XLSX: ChatFileInfo = { path: '/c/ventas.xlsx', name: 'ventas.xlsx', bytes: 2048, kind: 'office', canView: true, canOpen: true }

let host: HTMLDivElement
let root: Root
let invoke: ReturnType<typeof vi.fn>

function Probe(): null {
  useChatDocPanel('s1', [])
  return null
}
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
const opens = (): string[] =>
  invoke.mock.calls.filter((c) => c[0] === 'extras:chatFile:viewNative').map((c) => (c[1] as { theme: string }).theme)

beforeEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.dataset.theme = 'light'
  invoke = vi.fn(async (channel: string) => (channel === 'extras:chatFile:viewNative' ? { ok: true } : undefined))
  ;(window as unknown as { api: unknown }).api = { extras: { invoke, on: () => () => undefined } }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete document.documentElement.dataset.theme
  delete (window as unknown as { api?: unknown }).api
})

describe('useChatDocPanel: tema del visor', () => {
  it('con un Excel abierto, cambiar el tema de la app lo vuelve a abrir con el tema nuevo', async () => {
    act(() => root.render(createElement(Probe)))
    act(() => requestViewChatFile(XLSX))
    await flush()
    expect(opens()).toEqual(['light'])
    await act(async () => {
      document.documentElement.dataset.theme = 'dark'
      await Promise.resolve()
    })
    await flush()
    expect(opens()).toEqual(['light', 'dark'])
  })

  it('sin nada abierto, cambiar el tema no abre nada', async () => {
    act(() => root.render(createElement(Probe)))
    await flush()
    await act(async () => {
      document.documentElement.dataset.theme = 'dark'
      await Promise.resolve()
    })
    await flush()
    expect(opens()).toEqual([])
  })
})
