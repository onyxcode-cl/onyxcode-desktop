import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { videoMb } from '@shared/video'
import type { VideoMcpServer } from './mcp-server'

const state = vi.hoisted(() => ({
  deps: null as ConstructorParameters<typeof VideoMcpServer>[0] | null,
  options: {} as Electron.BrowserWindowConstructorOptions,
  url: '',
  setMenu: vi.fn(),
  destroy: vi.fn(),
  ask: vi.fn<(options: import('../util/native-dialog').ButtonsDialog) => Promise<number>>(async () => 1),
  install: vi.fn(async () => ({ ok: true }))
}))
vi.mock('electron', () => ({
  app: { getAppPath: () => '/app', getPath: () => '/test' },
  BrowserWindow: class extends EventEmitter {
    webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn() }
    setMenu = state.setMenu
    destroy = state.destroy
    isDestroyed = () => false
    constructor(options: Electron.BrowserWindowConstructorOptions) {
      super()
      state.options = options
    }
    async loadURL(url: string) {
      state.url = url
    }
  }
}))
vi.mock('../util/native-dialog', () => ({ askButtons: state.ask }))
vi.mock('../runtimes/service', () => ({ runtimesService: () => ({ bins: () => ({}) }) }))
vi.mock('./service', () => ({
  videoService: () => ({ estado: () => ({ installing: false }), instalar: state.install, cancelar: vi.fn() })
}))
vi.mock('./mcp-server', () => ({
  VideoMcpServer: class {
    constructor(deps: ConstructorParameters<typeof VideoMcpServer>[0]) {
      state.deps = deps
    }
  }
}))
vi.mock('./render-process', () => ({ createRenderProcess: () => vi.fn() }))
import { videoMcpServer } from './index'

afterEach(() => vi.clearAllMocks())
describe('instalación desde las herramientas de video', () => {
  it('el aviso nativo usa los mismos MB decimales que Ajustes', async () => {
    videoMcpServer()
    for (const bytes of [274_400_000, 274_500_000, 196_558_939]) {
      expect(await state.deps!.consent(bytes, new AbortController().signal)).toBe(true)
      const buttons = state.ask.mock.calls.at(-1)![0].buttons
      expect(buttons[1]).toContain(`${videoMb(bytes)} MB`)
    }
  })
  it('quita el menú y reserva área de contenido con texto ajustable', async () => {
    videoMcpServer()
    await state.deps!.install(new AbortController().signal)
    expect(state.setMenu).toHaveBeenCalledWith(null)
    expect(state.options).toMatchObject({ width: 480, height: 200, useContentSize: true })
    const html = decodeURIComponent(state.url.split(',').slice(1).join(','))
    expect(html).toContain('overflow-wrap:anywhere')
    expect(html).toContain('margin:0')
    expect(state.destroy).toHaveBeenCalledOnce()
  })
})
