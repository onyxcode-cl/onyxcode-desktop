// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Part } from '@opencode-ai/sdk/v2/client'
import type { ChatFileInfo } from '@shared/ipc-extras'
import { ChatFiles } from './ChatFiles'
import { ChatFilePanel } from './ChatFilePanel'
import { setChatFileViewHandler } from '../../lib/chatFileView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const FILES: ChatFileInfo[] = [
  { path: '/c/foto.png', name: 'foto.png', bytes: 2048, kind: 'image', canView: true, canOpen: true },
  { path: '/c/informe.pdf', name: 'informe.pdf', bytes: 400_000, kind: 'office', canView: true, canOpen: true },
  { path: '/c/instalar.sh', name: 'instalar.sh', bytes: 30, kind: 'blocked', canView: false, canOpen: false }
]

const parts = [{ id: 'a', type: 'text', text: 'Listo: /c/foto.png /c/informe.pdf /c/instalar.sh' }] as unknown as Part[]

let host: HTMLDivElement
let root: Root
let invoke: ReturnType<typeof vi.fn>

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.unstubAllGlobals()
  invoke = vi.fn(async (channel: string) => (channel === 'extras:chatFile:info' ? FILES : undefined))
  ;(window as unknown as { api: unknown }).api = { extras: { invoke } }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  setChatFileViewHandler(null)
  delete (window as unknown as { api?: unknown }).api
})

const buttons = (card: Element): string[] => Array.from(card.querySelectorAll('button')).map((b) => b.textContent ?? '')

describe('ChatFiles', () => {
  it('no pide nada ni pinta mientras la respuesta se escribe', async () => {
    act(() => root.render(createElement(ChatFiles, { parts, done: false })))
    await flush()
    expect(invoke).not.toHaveBeenCalled()
    expect(host.innerHTML).toBe('')
  })

  it('una tarjeta por archivo: Ver aquí / Abrir con tu programa / Mostrar en la carpeta; los scripts solo Mostrar', async () => {
    act(() => root.render(createElement(ChatFiles, { parts, done: true })))
    await flush()
    expect(invoke).toHaveBeenCalledWith('extras:chatFile:info', { paths: ['/c/foto.png', '/c/informe.pdf', '/c/instalar.sh'] })
    const cards = host.querySelectorAll('[data-chat-file]')
    expect(cards).toHaveLength(3)
    expect(buttons(cards[0])).toEqual(['Ver aquí', 'Abrir con tu programa', 'Mostrar en la carpeta'])
    expect(buttons(cards[1])).toEqual(['Ver aquí', 'Abrir con tu programa', 'Mostrar en la carpeta'])
    expect(buttons(cards[2])).toEqual(['Mostrar en la carpeta'])
    expect(cards[2].textContent).toContain('Por seguridad no se abre desde aquí')
  })

  it('cada botón llama a su canal con la ruta del archivo', async () => {
    const seen: ChatFileInfo[] = []
    setChatFileViewHandler((i) => seen.push(i))
    act(() => root.render(createElement(ChatFiles, { parts, done: true })))
    await flush()
    const card = host.querySelectorAll('[data-chat-file]')[0]
    const [view, open, reveal] = Array.from(card.querySelectorAll('button'))
    act(() => view.click())
    expect(seen.map((s) => s.path)).toEqual(['/c/foto.png'])
    await act(async () => open.click())
    expect(invoke).toHaveBeenCalledWith('extras:chatFile:open', { path: '/c/foto.png' })
    await act(async () => reveal.click())
    expect(invoke).toHaveBeenCalledWith('extras:chatFile:reveal', { path: '/c/foto.png' })
  })

  it('si main no reconoce ningún archivo no pinta nada', async () => {
    invoke.mockResolvedValue([])
    act(() => root.render(createElement(ChatFiles, { parts, done: true })))
    await flush()
    expect(host.innerHTML).toBe('')
  })

  it('si «Abrir» falla lo dice en el botón', async () => {
    invoke.mockImplementation(async (c: string) => {
      if (c === 'extras:chatFile:info') return FILES
      if (c === 'extras:chatFile:open') throw new Error('x')
      return undefined
    })
    act(() => root.render(createElement(ChatFiles, { parts, done: true })))
    await flush()
    const open = host.querySelectorAll('[data-chat-file]')[0].querySelectorAll('button')[1]
    await act(async () => open.click())
    expect(open.textContent).toBe('No se pudo abrir')
  })
})

describe('ChatFilePanel', () => {
  const base = { fullscreen: false, onToggleFullscreen: () => undefined, onClose: () => undefined }
  it('imagen: un <img> con el data URL, sin iframes ni scripts', () => {
    const file = {
      info: FILES[0],
      mode: 'inline' as const,
      status: 'ready' as const,
      content: { ok: true as const, kind: 'image' as const, dataUrl: 'data:image/png;base64,AAAA' },
      error: null
    }
    act(() => root.render(createElement(ChatFilePanel, { file, ...base })))
    expect(host.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(host.querySelector('iframe,script,object,embed')).toBeNull()
  })
  it('código: texto plano (el HTML del archivo no se interpreta)', () => {
    const file = {
      info: { ...FILES[0], name: 'x.json', kind: 'code' as const },
      mode: 'inline' as const,
      status: 'ready' as const,
      content: { ok: true as const, kind: 'code' as const, text: '<img src=x onerror=alert(1)>', truncated: true },
      error: null
    }
    act(() => root.render(createElement(ChatFilePanel, { file, ...base })))
    expect(host.querySelector('pre')?.textContent).toBe('<img src=x onerror=alert(1)>')
    expect(host.querySelector('img')).toBeNull()
    expect(host.textContent).toContain('Se muestra solo el principio del archivo.')
  })
  it('error: muestra el motivo en lenguaje llano', () => {
    const file = { info: FILES[0], mode: 'inline' as const, status: 'error' as const, content: null, error: 'chat.file.tooLarge' as const }
    act(() => root.render(createElement(ChatFilePanel, { file, ...base })))
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('demasiado grande')
  })
})
