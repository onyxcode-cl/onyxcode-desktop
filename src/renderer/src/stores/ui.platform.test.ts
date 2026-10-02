import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function loadUi(platform: string, storedMode?: string) {
  vi.resetModules()
  const store: Record<string, string> = storedMode ? { 'ui.mode': storedMode } : {}
  vi.stubGlobal('window', { api: { platform } })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = v)
  })
  return (await import('./ui')).useUi
}

describe('modo Tareas según la plataforma', () => {
  it('en Windows un modo Tareas guardado arranca en Chat y setMode(tasks) cae a Chat', async () => {
    const useUi = await loadUi('win32', 'tasks')
    expect(useUi.getState().mode).toBe('chat')
    useUi.getState().setMode('tasks')
    expect(useUi.getState().mode).toBe('chat')
    useUi.getState().setMode('code')
    expect(useUi.getState().mode).toBe('code')
  })
  it('en macOS Tareas funciona igual que siempre', async () => {
    const useUi = await loadUi('darwin', 'tasks')
    expect(useUi.getState().mode).toBe('tasks')
  })
})
