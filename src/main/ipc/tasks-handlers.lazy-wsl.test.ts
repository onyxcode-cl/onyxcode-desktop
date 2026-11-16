/** R8: registro real de IPC y primer uso en Windows, con backend falso y sin arrancar Electron ni el motor. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it, vi } from 'vitest'

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

const inventory = vi.hoisted(() => ({
  run: vi.fn(async (spec: { args: string[] }) => ({
    code: 0,
    stdout: Buffer.from(spec.args.includes('--version') ? 'WSL: 2.6.0.0\nKernel: 6.6.0.0' : '* Lazunox-Tareas Stopped 2', 'utf16le'),
    stderr: Buffer.alloc(0)
  }))
}))
vi.mock('../tasks/backends/wsl-real-deps', () => ({ realRun: inventory.run }))

const preflight = vi.hoisted(() => ({ configure: vi.fn() }))
vi.mock('../preflight/real', () => ({
  configurePreflight: preflight.configure,
  runPreflight: vi.fn(),
  reportPreflightFailure: vi.fn(),
  trustSignature: vi.fn(),
  untrustSignature: vi.fn()
}))
const { TasksManager } = await import('../tasks/manager')

// Los servicios importados consultan userData al cargar: el temporal debe existir antes.
const { registerTasksHandlers } = await import('./tasks-handlers')

afterAll(() => rmSync(dir, { recursive: true, force: true }))

it('V30: arrancar solo lista WSL sin probe ni carga; primer uso comparte la preparación con la tarjeta', async () => {
  vi.useFakeTimers()
  const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  let state = 'needsSetup'
  const status = vi.fn(async () => ({ state, detail: state === 'needsSetup' ? 'update:payload' : undefined }))
  const setup = vi.fn(async (progress: (pct: number, phase: string) => void) => {
    progress(50, 'installing')
    state = 'ready'
  })
  const backend = { id: 'wsl', status, setup, launch: vi.fn() }
  const provider = { build: true, gate: vi.fn(async () => ({ ok: true as const })), create: vi.fn(() => backend) }
  // La prueba usa el start público real (incluida la preparación); solo sustituye el arranque del motor.
  const launch = vi
    .spyOn(TasksManager.prototype as never as { startServer: () => Promise<unknown> }, 'startServer')
    .mockImplementation(async () => {
      expect(state).toBe('ready')
      return {}
    })
  const handlers = new Map<string, (event: unknown, req?: unknown) => Promise<unknown>>()
  const ipc = { removeHandler: () => undefined, handle: (ch: string, fn: never) => handlers.set(ch, fn) }
  const mod = registerTasksHandlers(ipc as never, () => null, {
    getMainConnection: async () => ({}) as never,
    chatDirectory: dir,
    computer: false,
    tasksWin: true,
    winBackend: provider as never
  })
  try {
    await vi.advanceTimersByTimeAsync(2500)
    expect(preflight.configure).toHaveBeenLastCalledWith(expect.objectContaining({ sandboxStatus: expect.any(Function) }))
    const startup = preflight.configure.mock.lastCall![0].sandboxStatus
    expect(await startup()).toMatchObject({ state: 'ready' })
    expect(inventory.run.mock.calls.map(([spec]) => spec.args)).toEqual([['--version'], ['-l', '-v']])
    expect(provider.create).not.toHaveBeenCalled()
    expect(provider.gate).not.toHaveBeenCalled()
    expect(status).not.toHaveBeenCalled()
    expect(setup).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
    await Promise.all([
      handlers.get('tasks:start')!({ sender: {} }, { folder: 'C:\\Users\\ana\\proyecto' }),
      handlers.get('tasks:sandbox:setup')!({ sender: {} })
    ])
    expect(setup).toHaveBeenCalledTimes(1)
    expect(launch).toHaveBeenCalledTimes(1)
    await handlers.get('tasks:start')!({ sender: {} }, { folder: 'C:\\Users\\ana\\proyecto' })
    expect(setup).toHaveBeenCalledTimes(1)
  } finally {
    await mod.shutdown()
    launch.mockRestore()
    platform.mockRestore()
    vi.useRealTimers()
  }
})
