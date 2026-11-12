import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermissionRequest, ToolPart } from '@opencode-ai/sdk/v2/client'
interface MockState {
  folder: string
  conn: { fullAccess: boolean }
  client: { session: { abort: ReturnType<typeof vi.fn> } }
  permissions: Record<string, PermissionRequest>
  phase: string
  activeTaskId?: string
}
const m = vi.hoisted(() => ({
  state: {} as MockState,
  log: [] as string[],
  confirm: vi.fn(),
  reply: vi.fn(),
  grant: vi.fn(),
  open: vi.fn(),
  send: vi.fn(),
  abort: vi.fn()
}))
vi.mock('./store', () => ({
  useTasks: { getState: () => m.state },
  rootTaskId: () => 'root',
  currentTasksModel: () => ({ providerID: 'fake', modelID: 'fake' })
}))
vi.mock('./conn-paths', () => ({ sdkDir: () => '/win/c/fixture' }))
vi.mock('./actions', () => ({
  confirmInterruptRunning: m.confirm,
  replyPermission: m.reply,
  setDeleteGrantAllowed: m.grant,
  openTask: m.open,
  sendToTask: m.send
}))
import { enableDeleteAndRetry } from './delete-grant-retry'
const req = { id: 'p', sessionID: 'child' } as PermissionRequest
beforeEach(() => {
  vi.resetAllMocks()
  m.log = []
  m.state = {
    folder: 'C:\\fixture',
    conn: { fullAccess: false },
    client: { session: { abort: m.abort } },
    permissions: { p: req },
    phase: 'ready',
    activeTaskId: 'root'
  }
  m.confirm.mockResolvedValue(true)
  m.reply.mockImplementation(async () => {
    m.log.push('reject')
  })
  m.abort.mockImplementation(async () => {
    m.log.push('abort')
    return {}
  })
  m.grant.mockImplementation(async () => {
    m.log.push('grant/restart')
    m.state.conn = { fullAccess: false }
  })
  m.open.mockImplementation(async (id) => {
    m.log.push('open')
    m.state.activeTaskId = id
  })
  m.send.mockImplementation(async () => {
    m.log.push('retry')
  })
})
describe('activar permiso real y reintentar', () => {
  it('rechaza la pregunta antigua, aborta hija y raíz, cambia perfil, reabre raíz y reintenta con su modelo', async () => {
    await enableDeleteAndRetry(req)
    expect(m.log).toEqual(['reject', 'abort', 'abort', 'grant/restart', 'open', 'retry'])
    expect(m.confirm).toHaveBeenCalledWith('root')
    expect(m.reply.mock.calls[0].slice(0, 2)).toEqual(['p', 'reject'])
    expect(m.abort.mock.calls).toEqual([
      [{ sessionID: 'child', directory: '/win/c/fixture' }],
      [{ sessionID: 'root', directory: '/win/c/fixture' }]
    ])
    expect(m.grant).toHaveBeenCalledWith(true)
    expect(m.open).toHaveBeenCalledWith('root')
    expect(m.send).toHaveBeenCalledWith(expect.stringContaining('reintenta'), { providerID: 'fake', modelID: 'fake' })
  })
  it('herramienta ya denegada: aborta y reinicia igual, sin responder a un permiso inexistente', async () => {
    m.state.permissions = {}
    const attempt = { id: 'tool', type: 'tool', sessionID: 'child' } as ToolPart
    await enableDeleteAndRetry(attempt)
    expect(m.log).toEqual(['abort', 'abort', 'grant/restart', 'open', 'retry'])
    expect(m.reply).not.toHaveBeenCalled()
    expect(m.grant).toHaveBeenCalledExactlyOnceWith(true)
  })
  it('herramienta denegada de una tarea que ya no está activa: no concede', async () => {
    m.state.activeTaskId = 'otra'
    await expect(enableDeleteAndRetry({ id: 'tool', type: 'tool', sessionID: 'child' } as ToolPart)).rejects.toThrow('cambió')
    expect(m.log).toEqual([])
  })
  it('cambiar de tarea durante el abort de una herramienta fallida no concede el permiso', async () => {
    m.abort.mockImplementation(async () => {
      m.state.activeTaskId = 'otra'
      return {}
    })
    await expect(enableDeleteAndRetry({ id: 'tool', type: 'tool', sessionID: 'child' } as ToolPart)).rejects.toThrow('cambió')
    expect(m.grant).not.toHaveBeenCalled()
    expect(m.send).not.toHaveBeenCalled()
  })
  it('cancelar la interrupción de otras tareas no cambia permisos ni responde al motor', async () => {
    m.confirm.mockResolvedValue(false)
    await enableDeleteAndRetry(req)
    expect(m.log).toEqual([])
  })
  it('fallar la concesión no reabre ni reintenta, y libera el cerrojo', async () => {
    m.grant.mockRejectedValueOnce(new Error('fallo simulado'))
    await expect(enableDeleteAndRetry(req)).rejects.toThrow('fallo simulado')
    expect(m.open).not.toHaveBeenCalled()
    await enableDeleteAndRetry(req)
    expect(m.send).toHaveBeenCalledTimes(1)
  })
  it('un arranque fallido o cambio de carpeta no envía el reintento', async () => {
    m.grant.mockImplementation(async () => {
      m.state.phase = 'error'
    })
    await expect(enableDeleteAndRetry(req)).rejects.toThrow('no se pudo reabrir')
    expect(m.send).not.toHaveBeenCalled()
    m.state.phase = 'ready'
    m.confirm.mockImplementation(async () => {
      m.state.folder = 'otra'
      return true
    })
    await expect(enableDeleteAndRetry(req)).rejects.toThrow('cambió')
    expect(m.send).not.toHaveBeenCalled()
  })
  it('no actúa sobre Control total o petición resuelta', async () => {
    m.state.conn.fullAccess = true
    await expect(enableDeleteAndRetry(req)).rejects.toThrow('cambió')
    m.state.conn.fullAccess = false
    m.state.permissions = {}
    await expect(enableDeleteAndRetry(req)).rejects.toThrow('cambió')
    expect(m.log).toEqual([])
  })
  it('un doble clic simultáneo hace una sola concesión', async () => {
    await Promise.all([enableDeleteAndRetry(req), enableDeleteAndRetry(req)])
    expect(m.grant).toHaveBeenCalledTimes(1)
  })
  it('no sigue si falla el abort ni si la persona cambia de tarea al reabrir', async () => {
    m.abort.mockResolvedValueOnce({ error: 'fallo' })
    await expect(enableDeleteAndRetry(req)).rejects.toThrow('cambió')
    expect(m.grant).not.toHaveBeenCalled()
    m.open.mockImplementation(async () => {
      m.state.activeTaskId = 'otra'
    })
    await expect(enableDeleteAndRetry(req)).rejects.toThrow('cambió')
    expect(m.send).not.toHaveBeenCalled()
  })
})
