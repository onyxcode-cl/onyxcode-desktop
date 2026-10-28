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
import { selectFolder, setAccessMode } from './actions'
import { isChatFolderForDisplay, isChatFolderPath, useUnified } from './unified'

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
  useUnified.setState({ on: true, loaded: true, wantAuto: false, chatFolder: null })
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

  it('reconoce la carpeta del chat por la ruta REAL guardada, no por su forma', async () => {
    expect(isChatFolderPath('/Users/x/Lazunox/Chats/abc')).toBe(false)
    await openChatFolder()
    expect(isChatFolderPath('/Users/x/Lazunox/Chats/abc')).toBe(true)
    expect(isChatFolderPath('/Users/x/Lazunox/Chats/abc/')).toBe(true)
    expect(isChatFolderPath('/Users/x/Lazunox/Chats/otra')).toBe(false)
    expect(isChatFolderPath('/Users/x/Proyecto')).toBe(false)
    // Para mostrar un nombre (chats antiguos tras reiniciar) basta la forma.
    expect(isChatFolderForDisplay('/Users/x/Lazunox/Chats/otra')).toBe(true)
    expect(isChatFolderForDisplay('C:\\Users\\x\\Lazunox\\Chats\\abc')).toBe(true)
    expect(isChatFolderForDisplay('/Users/x/Proyecto')).toBe(false)
  })
})

describe('modo unificado: «Automático» elegido sin carpeta', () => {
  it('elegir una carpeta y enviar NO activa Automático', async () => {
    useUnified.setState({ wantAuto: true })
    await selectFolder('/Users/x/Proyecto')
    useTasks.setState({ folder: '/Users/x/Proyecto' } as never)
    await expect(ensureFolderForSend()).resolves.toBe(true)
    expect(h.setAutoModeSettings).not.toHaveBeenCalled()
    expect(useUnified.getState().wantAuto).toBe(false)
  })

  it('«Avanzado» (Control total) y enviar NO activa Automático', async () => {
    useUnified.setState({ wantAuto: true })
    h.cw.mockImplementation(async () => ({ consentAt: 1, workspace: '/Users/x', home: '/Users/x' }))
    await setAccessMode(true, true).catch(() => undefined)
    useTasks.setState({ folder: '/Users/x', fullAccess: true } as never)
    await ensureFolderForSend()
    expect(h.setAutoModeSettings).not.toHaveBeenCalled()
    expect(useUnified.getState().wantAuto).toBe(false)
  })

  it('con Control total activo la carpeta del chat tampoco recibe Automático', async () => {
    useUnified.setState({ wantAuto: true })
    useTasks.setState({ fullAccess: true } as never)
    await openChatFolder()
    expect(h.setAutoModeSettings).not.toHaveBeenCalled()
    useTasks.setState({ fullAccess: false } as never)
  })

  it('con la carpeta automática del chat sí se activa, y solo esa carpeta', async () => {
    useUnified.setState({ wantAuto: true })
    await ensureFolderForSend()
    expect(h.setAutoModeSettings).toHaveBeenCalledTimes(1)
    expect(h.setAutoModeSettings).toHaveBeenCalledWith({ enabled: true, folder: { path: '/Users/x/Lazunox/Chats/abc', on: true } })
  })

  it('con el interruptor general apagado, las carpetas y tareas que ya estaban en la lista se quitan antes de encenderlo', async () => {
    useUnified.setState({ wantAuto: true })
    useTasks.setState({
      autoMode: {
        settings: { enabled: false, folders: ['/Users/x/Vieja'], tasks: ['ses_1'], viewApps: [] },
        log: [],
        policyDisabled: false
      }
    } as never)
    await openChatFolder()
    expect(h.setAutoModeSettings.mock.calls).toEqual([
      [{ folder: { path: '/Users/x/Vieja', on: false } }],
      [{ task: { sessionId: 'ses_1', on: false } }],
      [{ enabled: true, folder: { path: '/Users/x/Lazunox/Chats/abc', on: true } }]
    ])
    useTasks.setState({ autoMode: null } as never)
  })
})
