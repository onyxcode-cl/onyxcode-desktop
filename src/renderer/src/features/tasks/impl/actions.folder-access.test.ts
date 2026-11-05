/**
 * Carpeta rechazada en macOS («No permitir») al agregarla en Tareas (EXP-189): ya no queda sin salida. Elegir la MISMA carpeta otra vez
 * borra la decisión guardada de Lazunox y de su motor (macOS vuelve a preguntar) y, si sigue negada, deja la tarjeta con Ajustes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const dir = '/Users/ana/Documents/proyecto'
const native = vi.hoisted(() => ({
  dialog: {
    checkFolderAccess: vi.fn(),
    resetFolderPermission: vi.fn()
  }
}))
const cwMock = vi.hoisted(() => vi.fn())
vi.mock('../../code/impl/client', async (orig) => ({
  ...(await orig<typeof import('../../code/impl/client')>()),
  nativeCode: () => native
}))
vi.mock('./bridge', async (orig) => ({ ...(await orig<typeof import('./bridge')>()), cw: cwMock }))

let A: typeof import('./actions')
let C: typeof import('./store')
let F: typeof import('../../code/impl/folder-access')

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  native.dialog.checkFolderAccess.mockReset()
  native.dialog.resetFolderPermission.mockReset()
  native.dialog.resetFolderPermission.mockResolvedValue({ result: 'reset' })
  cwMock.mockReset()
  cwMock.mockImplementation((ch: string) => (ch === 'tasks:pickFolder' ? Promise.resolve(dir) : Promise.resolve([])))
  C = await import('./store')
  A = await import('./actions')
  F = await import('../../code/impl/folder-access')
  C.useTasks.setState({ folders: [], pendingApproval: null, error: null })
})

describe('Tareas: carpeta negada por macOS', () => {
  it('«No permitir» guardado: al elegir la misma carpeta se borra la decisión, macOS vuelve a preguntar y sigue la confirmación de siempre', async () => {
    native.dialog.checkFolderAccess.mockResolvedValueOnce({ status: 'denied', canReset: true, cause: 'app' })
    native.dialog.checkFolderAccess.mockResolvedValueOnce({ status: 'ok', canReset: false, cause: 'app' })
    await A.chooseFolder()
    expect(native.dialog.resetFolderPermission).toHaveBeenCalledExactlyOnceWith(dir, 'all')
    expect(native.dialog.checkFolderAccess).toHaveBeenCalledTimes(2)
    expect(C.useTasks.getState().pendingApproval).toBe(dir) // nada se autoriza solo: pide la confirmación
  })
  it('si la persona vuelve a negar: una sola vez, sin bucle, no se pide autorizar y la tarjeta es de Tareas', async () => {
    native.dialog.checkFolderAccess.mockResolvedValue({ status: 'denied', canReset: true, cause: 'app' })
    await A.chooseFolder()
    expect(native.dialog.resetFolderPermission).toHaveBeenCalledTimes(1)
    expect(native.dialog.checkFolderAccess).toHaveBeenCalledTimes(2)
    expect(C.useTasks.getState().pendingApproval).toBeNull()
    expect(F.getBlockedFolder()).toMatchObject({ dir, reason: 'denied', owner: 'tasks' })
  })
  it('sin zona TCC restablecible (Acceso total al disco): no se resetea a ciegas', async () => {
    native.dialog.checkFolderAccess.mockResolvedValue({ status: 'denied', canReset: false, cause: 'app' })
    expect(await A.ensureTasksFolderReadable(dir)).toBe(false)
    expect(native.dialog.resetFolderPermission).not.toHaveBeenCalled()
  })
  it('reintento pasivo (tras «Volver a preguntar»): no vuelve a borrar nada', async () => {
    native.dialog.checkFolderAccess.mockResolvedValue({ status: 'denied', canReset: true, cause: 'app' })
    expect(await A.ensureTasksFolderReadable(dir, { passive: true })).toBe(false)
    expect(native.dialog.resetFolderPermission).not.toHaveBeenCalled()
  })
  it('carpeta ya autorizada en la lista: también se comprueba antes de conectar', async () => {
    native.dialog.checkFolderAccess.mockResolvedValue({ status: 'denied', canReset: false, cause: 'app' })
    await A.selectFolderChecked(dir)
    expect(C.useTasks.getState().phase).not.toBe('ready')
    expect(C.useTasks.getState().folder).not.toBe(dir)
  })
  it('legible: sigue al camino normal; error de la comprobación: falla abierto', async () => {
    native.dialog.checkFolderAccess.mockResolvedValue({ status: 'ok', canReset: false, cause: 'app' })
    await A.chooseFolder()
    expect(C.useTasks.getState().pendingApproval).toBe(dir)
    C.useTasks.setState({ pendingApproval: null })
    native.dialog.checkFolderAccess.mockRejectedValue(new Error('boom'))
    await A.chooseFolder()
    expect(C.useTasks.getState().pendingApproval).toBe(dir)
  })
})
