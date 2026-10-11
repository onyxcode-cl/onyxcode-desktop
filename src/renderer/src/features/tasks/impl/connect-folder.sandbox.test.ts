/**
 * Windows: si el servidor no arranca porque el entorno aislado necesita instalarse/actualizarse, NO hay banner rojo
 * (lo explica `SandboxSetupCard`); cualquier otra razón de la puerta sigue mostrando su error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const GATE_TEXT = 'Tareas en Windows no está disponible en este equipo (la comprobación de seguridad no pasó).'
const FOLDER = 'C:\\Users\\ana\\proyecto'

function setup(sandbox: { state: string; detail?: string }, startError: string): ReturnType<typeof vi.fn> {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'tasks:start') return { ok: false, error: startError }
    if (channel === 'tasks:sandbox:status') return { ok: true, data: { backend: 'wsl', setup: null, ...sandbox } }
    return { ok: true, data: null }
  })
  ;(globalThis as { window?: unknown }).window = {
    api: { platform: 'win32', tasks: { invoke, on: () => () => undefined }, capsFlags: { tasksWin: true } }
  }
  return invoke
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
})
afterEach(() => delete (globalThis as { window?: unknown }).window)

describe('connectFolder en Windows con el entorno por actualizar', () => {
  it('needsSetup (update:rootfs): sin banner rojo y se reconectará al quedar listo', async () => {
    setup({ state: 'needsSetup', detail: 'update:rootfs' }, GATE_TEXT)
    const { useTasks, connectFolder } = await import('./store')
    await connectFolder(FOLDER, false)
    const s = useTasks.getState()
    expect(s.phase).toBe('idle')
    expect(s.error).toBeNull()
    expect(s.awaitingSandbox).toBe(true)
    expect(s.folder).toBe(FOLDER)
  })

  it.each([
    ['elevado', { state: 'unsupported', detail: 'elevated' }, 'Lazunox corre como administrador'],
    ['paquete alterado', { state: 'unsupported', detail: 'bundle' }, 'El paquete no coincide'],
    ['política de la organización', { state: 'policyDisabled' }, 'Tu organización desactivó Tareas'],
    ['puerta cerrada con el entorno listo', { state: 'ready' }, GATE_TEXT],
    ['entorno roto', { state: 'broken', detail: 'payload' }, GATE_TEXT]
  ])('%s: el error se sigue mostrando', async (_n, sandbox, msg) => {
    setup(sandbox, msg)
    const { useTasks, connectFolder } = await import('./store')
    await connectFolder(FOLDER, false)
    const s = useTasks.getState()
    expect(s.phase).toBe('error')
    expect(s.error).toContain(msg)
    expect(s.awaitingSandbox).toBe(false)
  })

  it('Control total (sin entorno aislado): el error se muestra aunque el entorno necesite actualizarse', async () => {
    const invoke = setup({ state: 'needsSetup', detail: 'update:rootfs' }, 'fallo')
    const { useTasks, connectFolder } = await import('./store')
    await connectFolder(FOLDER, true)
    expect(useTasks.getState().phase).toBe('error')
    expect(invoke).not.toHaveBeenCalledWith('tasks:sandbox:status', expect.anything())
  })

  it('macOS: no consulta el entorno y muestra el error', async () => {
    const invoke = setup({ state: 'needsSetup' }, 'fallo')
    ;(globalThis as { window?: { api: { platform: string } } }).window!.api.platform = 'darwin'
    const { useTasks, connectFolder } = await import('./store')
    await connectFolder('/Users/ana/p', false)
    expect(useTasks.getState().phase).toBe('error')
    expect(invoke).not.toHaveBeenCalledWith('tasks:sandbox:status', expect.anything())
  })
})
