import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ parent: null as unknown, show: vi.fn(async () => ({ response: 1 })), native: vi.fn(async () => 1) }))
vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => h.parent, getAllWindows: () => [] },
  dialog: { showMessageBox: h.show }
}))
vi.mock('../util/native-dialog', () => ({ askButtons: h.native }))
import { askVideoInstall } from './consent'
const options = { message: 'Instalar', buttons: ['Ahora no', 'Instalar (193 MB)'] }
beforeEach(() => {
  vi.clearAllMocks()
  h.parent = null
})
it('Mac restaura y enfoca Lazunox y adjunta la hoja; no usa osascript ni runModal', async () => {
  const parent = { isDestroyed: () => false, isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn() }
  h.parent = parent
  expect(await askVideoInstall(options, 'darwin')).toBe(1)
  expect(parent.restore).toHaveBeenCalledOnce()
  expect(parent.show).toHaveBeenCalledOnce()
  expect(parent.focus).toHaveBeenCalledOnce()
  expect(h.show).toHaveBeenCalledWith(parent, expect.objectContaining({ defaultId: 0, cancelId: 0, buttons: options.buttons }))
  expect(h.native).not.toHaveBeenCalled()
})
it('Mac sin ventana o cancelado no instala; Windows conserva su diálogo', async () => {
  expect(await askVideoInstall(options, 'darwin')).toBe(0)
  expect(await askVideoInstall({ ...options, signal: AbortSignal.abort() }, 'darwin')).toBe(0)
  expect(h.show).not.toHaveBeenCalled()
  expect(await askVideoInstall(options, 'win32')).toBe(1)
  expect(h.native).toHaveBeenCalledWith(options)
})
