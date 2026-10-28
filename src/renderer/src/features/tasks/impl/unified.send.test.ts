/** Modo unificado: enviar sin carpeta crea la carpeta del chat y conecta aislado; con carpeta, el flujo de siempre. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const h = vi.hoisted(() => ({
  cw: vi.fn(),
  connectFolder: vi.fn(async () => undefined),
  setAutoModeSettings: vi.fn(async () => undefined)
}))
vi.mock('./bridge', async (orig) => ({ ...(await orig<typeof import('./bridge')>()), cw: h.cw }))
vi.mock('./store', async (orig) => ({
  ...(await orig<typeof import('./store')>()),
  connectFolder: h.connectFolder,
  setAutoModeSettings: h.setAutoModeSettings
}))

import { ensureFolderForSend, openChatFolder } from './actions'
import { useTasks } from './store'
import { isChatFolderPath, useUnified } from './unified'

beforeEach(() => {
  h.cw.mockReset()
  h.connectFolder.mockClear()
  h.setAutoModeSettings.mockClear()
  h.cw.mockImplementation(async (channel: string) => {
    if (channel === 'tasks:chatFolder:create') return { path: '/Users/x/Lazunox/Chats/abc', name: 'abc', approvedAt: 1 }
    if (channel === 'tasks:folders:list') return []
    return undefined
  })
  useTasks.setState({ folder: null } as never)
  useUnified.setState({ on: true, loaded: true, wantAuto: false })
})

describe('modo unificado: enviar sin carpeta', () => {
  it('crea la carpeta del chat y conecta con connectFolder(path, false)', async () => {
    await expect(ensureFolderForSend()).resolves.toBe(true)
    expect(h.cw).toHaveBeenCalledWith('tasks:chatFolder:create')
    expect(h.connectFolder).toHaveBeenCalledWith('/Users/x/Lazunox/Chats/abc', false)
  })

  it('si el canal falla, lanza un mensaje claro en español y no conecta nada', async () => {
    h.cw.mockImplementation(async () => {
      throw new Error('disco lleno')
    })
    await expect(ensureFolderForSend()).rejects.toThrow(/No se pudo preparar el espacio de este chat: .*disco lleno.*Tu texto sigue aquí/)
    expect(h.connectFolder).not.toHaveBeenCalled()
  })

  it('con «Automático» elegido antes de tener carpeta, se aplica a la carpeta creada (una sola vez)', async () => {
    useUnified.setState({ wantAuto: true })
    await openChatFolder()
    expect(h.setAutoModeSettings).toHaveBeenCalledWith({ enabled: true, folder: { path: '/Users/x/Lazunox/Chats/abc', on: true } })
    expect(useUnified.getState().wantAuto).toBe(false)
  })

  it('con carpeta elegida no se crea ninguna: flujo de siempre', async () => {
    useTasks.setState({ folder: '/Users/x/Proyecto' } as never)
    await expect(ensureFolderForSend()).resolves.toBe(true)
    expect(h.cw).not.toHaveBeenCalledWith('tasks:chatFolder:create')
  })

  it('sin la bandera, sin carpeta se abre el selector de siempre y no se crea nada', async () => {
    useUnified.setState({ on: false })
    await expect(ensureFolderForSend()).resolves.toBe(false)
    expect(h.cw).toHaveBeenCalledWith('tasks:pickFolder')
    expect(h.cw).not.toHaveBeenCalledWith('tasks:chatFolder:create')
  })

  it('reconoce la carpeta propia del chat por su ruta', () => {
    expect(isChatFolderPath('/Users/x/Lazunox/Chats/abc')).toBe(true)
    expect(isChatFolderPath('C:\\Users\\x\\Lazunox\\Chats\\abc')).toBe(true)
    expect(isChatFolderPath('/Users/x/Proyecto')).toBe(false)
  })
})
