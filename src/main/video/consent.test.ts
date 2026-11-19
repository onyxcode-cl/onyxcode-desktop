import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({
  parent: null as unknown,
  windows: [] as unknown[],
  show: vi.fn(async () => ({ response: 1 })),
  native: vi.fn(async () => 1)
}))
vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => h.parent, getAllWindows: () => h.windows },
  dialog: { showMessageBox: h.show }
}))
import { askVideoInstall, registerVideoConversationWindow } from './consent'
const webContents = {}
const options = { message: 'Instalar', buttons: ['Ahora no', 'Instalar (193 MB)'] }
beforeEach(() => {
  vi.clearAllMocks()
  h.parent = null
  h.windows = []
})
it('Mac restaura y enfoca Lazunox y adjunta la hoja; no usa osascript ni runModal', async () => {
  const parent = { webContents, isDestroyed: () => false, isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn() }
  registerVideoConversationWindow(parent as never)
  h.parent = parent
  expect(await askVideoInstall(options, 'darwin')).toBe(1)
  expect(parent.restore).toHaveBeenCalledOnce()
  expect(parent.show).toHaveBeenCalledOnce()
  expect(parent.focus).toHaveBeenCalledOnce()
  expect(h.show).toHaveBeenCalledWith(parent, expect.objectContaining({ defaultId: -1, cancelId: 0, buttons: options.buttons }))
  expect(h.native).not.toHaveBeenCalled()
})
it('sin ventana o cancelado no instala; Windows espera la respuesta nativa', async () => {
  expect(await askVideoInstall(options, 'darwin')).toBe(-1)
  expect(await askVideoInstall({ ...options, signal: AbortSignal.abort() }, 'darwin')).toBe(-1)
  expect(h.show).not.toHaveBeenCalled()
  h.parent = { webContents, isDestroyed: () => false, isMinimized: () => false, show: vi.fn(), focus: vi.fn() }
  registerVideoConversationWindow(h.parent as never)
  expect(await askVideoInstall(options, 'win32')).toBe(1)
  expect(h.show).toHaveBeenCalledOnce()
})

it('no elige ningún botón por tiempo; abortar no equivale a Ahora no', async () => {
  vi.useFakeTimers()
  try {
    h.parent = { webContents, isDestroyed: () => false, isMinimized: () => false, show: vi.fn(), focus: vi.fn() }
    registerVideoConversationWindow(h.parent as never)
    let answer!: (value: { response: number }) => void
    h.show.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve
        })
    )
    const ac = new AbortController()
    let settled = false
    const pending = askVideoInstall({ ...options, signal: ac.signal }, 'darwin').then((r) => {
      settled = true
      return r
    })
    await vi.advanceTimersByTimeAsync(600_000)
    expect(settled).toBe(false)
    ac.abort()
    answer({ response: 0 })
    expect(await pending).toBe(-1)
  } finally {
    vi.useRealTimers()
  }
})

it('ignora el panel rápido oculto aunque sea la ventana enfocada y restaura solo la conversación', async () => {
  const quick = { webContents: {}, isDestroyed: () => false, show: vi.fn(), focus: vi.fn() }
  const main = { webContents, isDestroyed: () => false, isMinimized: () => false, show: vi.fn(), focus: vi.fn() }
  h.parent = quick
  registerVideoConversationWindow(main as never)
  h.windows = [quick, main]
  expect(await askVideoInstall(options, 'darwin')).toBe(1)
  expect(h.show).toHaveBeenCalledWith(main, expect.anything())
  expect(quick.show).not.toHaveBeenCalled()
  expect(quick.focus).not.toHaveBeenCalled()
  h.windows = [quick]
  expect(await askVideoInstall(options, 'darwin')).toBe(-1)
})
