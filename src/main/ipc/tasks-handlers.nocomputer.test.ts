/**
 * H2: con `caps.computer` apagada (Windows con `tasksWin` y sin Control del PC) `registerTasksHandlers` NO construye ni cablea
 * Control del PC: ningún `computer:*` queda registrado por él, no hay `ComputerService` y los stubs cubren exactamente lo que falta.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'lzx-tasks-handlers-'))
const built = vi.hoisted(() => ({ computer: 0 }))

vi.mock('electron', () => ({
  app: { getPath: () => dir, getAppPath: () => '/x', isPackaged: false, getVersion: () => '0' },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class {},
  dialog: {},
  shell: {},
  powerSaveBlocker: { start: () => 1, stop: () => undefined, isStarted: () => false },
  safeStorage: { isEncryptionAvailable: () => false },
  net: {},
  powerMonitor: { on: () => undefined, removeListener: () => undefined }
}))
vi.mock('./guard', () => ({ guardInvoke: (_e: unknown, _c: string, a: unknown[]) => a[0], IpcGuardError: class extends Error {} }))
vi.mock('../computer/service', () => ({
  ComputerService: class {
    constructor() {
      built.computer++
    }
  }
}))
vi.mock('../embedded-browser/service', () => ({ embeddedBrowser: {} }))
vi.mock('../embedded-browser/mcp-server', () => ({ embeddedBrowserMcp: { setApi: () => undefined, configFor: async () => null } }))

import { TASKS_INVOKE_CHANNELS } from '@shared/ipc-tasks'
import { capsFor } from '@shared/platform-caps'
import { registerTasksHandlers } from './tasks-handlers'
import { registerUnsupportedHandlers } from './unsupported-handlers'

afterAll(() => rmSync(dir, { recursive: true, force: true }))

function fakeIpc(): { ipc: never; registered: string[] } {
  const registered: string[] = []
  const ipc = { removeHandler: () => undefined, handle: (ch: string) => void registered.push(ch) }
  return { ipc: ipc as never, registered }
}

describe('registerTasksHandlers sin Control del PC', () => {
  it('no construye ComputerService ni registra computer:*; con los stubs cada canal queda cubierto UNA vez', async () => {
    const { ipc, registered } = fakeIpc()
    const mod = registerTasksHandlers(ipc, () => null, {
      getMainConnection: async () => ({}) as never,
      chatDirectory: dir,
      computer: false
    })
    try {
      expect(built.computer).toBe(0)
      expect(mod.computer).toBeUndefined()
      expect(registered.filter((c) => c.startsWith('computer:'))).toEqual([])
      expect(registered).toContain('tasks:start')
      const caps = capsFor('win32', { tasksWin: true })
      expect(caps.tasks).toBe(true)
      expect(caps.computer).toBe(false)
      const before = registered.length
      const stubs = registerUnsupportedHandlers(ipc, caps)
      // Los stubs son los `computer:*` (más el neutro de `tasks:winBeta`, que no registra `registerTasksHandlers`) y no pisan nada.
      expect(stubs.every((c) => c.startsWith('computer:') || c === 'tasks:winBeta')).toBe(true)
      expect(registered.slice(before)).toEqual(stubs)
      for (const ch of TASKS_INVOKE_CHANNELS) expect(registered.filter((c) => c === ch).length, ch).toBe(1)
    } finally {
      await mod.shutdown()
    }
  })

  it('tasks-handlers.ts ya no instancia nada de Control del PC por su cuenta (todo vive en tasks-computer-wiring.ts)', () => {
    const src = readFileSync(join(__dirname, 'tasks-handlers.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
    expect(src).not.toMatch(/new (ComputerService|ComputerOverlay|AssistWindow|SkillRecorder|AppVisibility)\(/)
    expect(src).not.toMatch(/handle\('computer:/)
    expect(src).toMatch(/import type \{ ComputerService \}/)
  })
})
