import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, Display } from 'electron'

const mocks = vi.hoisted(() => ({
  getPath: vi.fn(),
  getAllDisplays: vi.fn(),
  getPrimaryDisplay: vi.fn(),
  showMessageBox: vi.fn(),
  getFocusedWindow: vi.fn(),
  getAllWindows: vi.fn()
}))
const events = new EventEmitter()
vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
  BrowserWindow: { getFocusedWindow: mocks.getFocusedWindow, getAllWindows: mocks.getAllWindows },
  dialog: { showMessageBox: mocks.showMessageBox },
  screen: {
    ...mocks,
    on: (...args: [string, (...args: unknown[]) => void]) => events.on(...args),
    removeListener: (...args: [string, (...args: unknown[]) => void]) => events.removeListener(...args)
  }
}))
const { choosePresentationDisplay, bindPresentationDisplay } = await import('./presentation-display')
const first = {
  id: 1,
  label: 'Built-in',
  size: { width: 1440, height: 900 },
  scaleFactor: 2,
  bounds: { x: 0, y: 0, width: 1440, height: 900 }
} as Display
const second = {
  id: 2,
  label: 'Projector',
  size: { width: 1920, height: 1080 },
  scaleFactor: 1,
  bounds: { x: 1440, y: 0, width: 1920, height: 1080 }
} as Display
let dir: string
const parent = { isDestroyed: vi.fn(() => false), isVisible: () => true }
beforeEach(async () => {
  vi.clearAllMocks()
  dir = await mkdtemp(join(tmpdir(), 'presentation-display-'))
  mocks.getPath.mockReturnValue(dir)
  mocks.getAllDisplays.mockReturnValue([first, second])
  mocks.getPrimaryDisplay.mockReturnValue(first)
  mocks.showMessageBox.mockResolvedValue({ response: 1 })
  parent.isDestroyed.mockReturnValue(false)
  mocks.getFocusedWindow.mockReturnValue(parent)
  mocks.getAllWindows.mockReturnValue([])
})
afterEach(async () => {
  vi.useRealTimers()
  events.removeAllListeners()
  await rm(dir, { recursive: true, force: true })
})

describe('presentation display', () => {
  it('does not prompt on a single display', async () => {
    mocks.getAllDisplays.mockReturnValue([first])
    expect(await choosePresentationDisplay()).toBe(first)
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
  })
  it('labels physical resolution/primary and remembers the last chosen ID', async () => {
    await writeFile(join(dir, 'presentation-display.json'), JSON.stringify({ displayId: 2 }))
    expect(await choosePresentationDisplay()).toBe(second)
    expect(mocks.showMessageBox).toHaveBeenCalledWith(
      parent,
      expect.objectContaining({
        defaultId: 1,
        cancelId: 2,
        buttons: ['Built-in · 2880 × 1800 (principal)', 'Projector · 1920 × 1080', 'Cancelar']
      })
    )
    expect(JSON.parse(await readFile(join(dir, 'presentation-display.json'), 'utf8'))).toEqual({ displayId: 2 })
  })
  it('uses a live visible parent when no window is focused', async () => {
    mocks.getFocusedWindow.mockReturnValue(null)
    mocks.getAllWindows.mockReturnValue([
      { isDestroyed: () => true, isVisible: () => true },
      { isDestroyed: () => false, isVisible: () => false },
      parent
    ])
    expect(await choosePresentationDisplay()).toBe(second)
    expect(mocks.showMessageBox).toHaveBeenCalledWith(parent, expect.any(Object))
  })
  it.each(['missing', 'destroyed'])('cancels without opening an unparented dialog if the parent is %s', async (state) => {
    if (state === 'missing') mocks.getFocusedWindow.mockReturnValue(null)
    else parent.isDestroyed.mockReturnValue(true)
    mocks.getAllWindows.mockReturnValue([
      { isDestroyed: () => true, isVisible: () => true },
      { isDestroyed: () => false, isVisible: () => false }
    ])
    expect(await choosePresentationDisplay()).toBeNull()
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
    await expect(readFile(join(dir, 'presentation-display.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('cancels if the parent closes while choosing a display', async () => {
    mocks.showMessageBox.mockImplementationOnce(async () => {
      parent.isDestroyed.mockReturnValue(true)
      return { response: 1 }
    })
    expect(await choosePresentationDisplay()).toBeNull()
    await expect(readFile(join(dir, 'presentation-display.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('cancel creates no presentation and disconnected selection falls back to primary', async () => {
    mocks.showMessageBox.mockResolvedValueOnce({ response: 2 })
    expect(await choosePresentationDisplay()).toBeNull()
    mocks.getAllDisplays.mockReturnValueOnce([first, second]).mockReturnValue([first])
    expect(await choosePresentationDisplay()).toBe(first)
  })
  it('moves fullscreen to primary on unplug and removes listeners when closed', () => {
    vi.useFakeTimers()
    const win = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      isFullScreen: () => true,
      setBounds: vi.fn(),
      setFullScreen: vi.fn(),
      close: vi.fn()
    })
    bindPresentationDisplay(win as unknown as BrowserWindow, second)
    expect(win.setBounds).toHaveBeenLastCalledWith(second.bounds)
    mocks.getAllDisplays.mockReturnValue([first])
    events.emit('display-removed', {}, second)
    expect(win.setFullScreen).toHaveBeenLastCalledWith(false)
    win.emit('leave-full-screen')
    expect(win.close).not.toHaveBeenCalled()
    expect(win.setBounds).toHaveBeenLastCalledWith(first.bounds)
    expect(win.setFullScreen).toHaveBeenLastCalledWith(true)
    win.emit('enter-full-screen')
    win.emit('leave-full-screen')
    expect(win.close).toHaveBeenCalledOnce()
    win.emit('closed')
    expect(events.listenerCount('display-removed')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('falls back if fullscreen exits before display-removed is emitted', () => {
    vi.useFakeTimers()
    const win = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      isFullScreen: () => false,
      setBounds: vi.fn(),
      setFullScreen: vi.fn(),
      close: vi.fn()
    })
    bindPresentationDisplay(win as unknown as BrowserWindow, second)
    mocks.getAllDisplays.mockReturnValue([first])
    win.emit('leave-full-screen')
    expect(win.close).not.toHaveBeenCalled()
    expect(win.setBounds).toHaveBeenLastCalledWith(first.bounds)
    expect(win.setFullScreen).toHaveBeenLastCalledWith(true)
    win.emit('closed')
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each([2100, 4100])('re-enters fullscreen after an exit delayed by %i ms', (delay) => {
    vi.useFakeTimers()
    const win = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      isFullScreen: () => true,
      setBounds: vi.fn(),
      setFullScreen: vi.fn(),
      close: vi.fn()
    })
    bindPresentationDisplay(win as unknown as BrowserWindow, second)
    mocks.getAllDisplays.mockReturnValue([first])
    events.emit('display-removed', {}, second)
    vi.advanceTimersByTime(delay)
    expect(win.setFullScreen.mock.calls).toEqual([[false], [true]])
    win.emit('leave-full-screen')
    expect(win.close).not.toHaveBeenCalled()
    expect(win.setFullScreen.mock.calls).toEqual([[false], [true], [true]])
    expect(win.setBounds).toHaveBeenLastCalledWith(first.bounds)
    win.emit('enter-full-screen')
    expect(vi.getTimerCount()).toBe(0)
    win.emit('leave-full-screen')
    expect(win.close).toHaveBeenCalledOnce()
    win.emit('closed')
  })
  it('finishes relocation even without a fullscreen transition event', () => {
    vi.useFakeTimers()
    const win = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      isFullScreen: () => true,
      setBounds: vi.fn(),
      setFullScreen: vi.fn(),
      close: vi.fn()
    })
    bindPresentationDisplay(win as unknown as BrowserWindow, second)
    mocks.getAllDisplays.mockReturnValue([first])
    events.emit('display-removed', {}, second)
    vi.advanceTimersByTime(4000)
    expect(win.setBounds).toHaveBeenLastCalledWith(first.bounds)
    expect(vi.getTimerCount()).toBe(0)
    win.emit('closed')
  })
})
