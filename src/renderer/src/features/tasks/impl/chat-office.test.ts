// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({
  available: vi.fn(),
  cw: vi.fn(),
  connect: vi.fn(),
  mode: vi.fn(),
  unified: vi.fn(),
  state: {} as Record<string, unknown>
}))
vi.mock('../../chat/office-overdrive', () => ({ chatOfficeAvailable: h.available }))
vi.mock('./bridge', () => ({ cw: h.cw }))
vi.mock('./unified', () => ({ useUnified: { setState: h.unified } }))
vi.mock('../../../stores/ui', () => ({ useUi: { getState: () => ({ setMode: h.mode }) } }))
vi.mock('./store', () => ({
  connectFolder: h.connect,
  useTasks: { getState: () => h.state, setState: (s: object) => Object.assign(h.state, s) }
}))
import { prepareOfficeTask } from './chat-office'
const files = [{ name: 'propuesta.docx', base64: 'UEsDBA==' }]
beforeEach(() => {
  vi.clearAllMocks()
  h.state = { folders: [{ path: '/anterior' }], fullAccess: true, draft: 'anterior', attachments: [] }
  h.available.mockResolvedValue(true)
})
describe('preparar una tarea Office sin enviar', () => {
  it.each(['/Users/prueba/Lazunox/Chats/tarea ñ', 'C:\\Users\\Prueba ñ\\Lazunox\\Chats\\tarea nueva'])(
    'conserva la ruta de main (%s), borrador y adjunto, sin heredar acceso total/automático',
    async (path) => {
      const copied = [
        { path: path.startsWith('C:') ? `${path}\\propuesta.docx` : `${path}/propuesta.docx`, relPath: 'propuesta.docx', size: 4, mtime: 1 }
      ]
      h.cw.mockResolvedValue({ folder: { path, name: 'tarea' }, files: copied })
      h.connect.mockImplementation(async () =>
        Object.assign(h.state, { phase: 'ready', folder: path, conn: { sandboxed: true, fullAccess: false } })
      )
      await prepareOfficeTask('Corrige el título', files)
      expect(h.cw.mock.calls).toEqual([['tasks:chatOffice:prepare', { files }]])
      expect(h.connect).toHaveBeenCalledWith(path, false)
      expect(h.unified).toHaveBeenCalledWith({ wantAuto: false })
      expect(h.state).toMatchObject({ draft: 'Corrige el título', attachments: copied, activeTaskId: null })
      expect(h.mode).toHaveBeenCalledExactlyOnceWith('tasks')
    }
  )
  it('sin disponibilidad o ante un fallo de copia no conecta ni navega', async () => {
    h.available.mockResolvedValueOnce(false)
    await expect(prepareOfficeTask('edita', files)).rejects.toThrow()
    expect(h.cw).not.toHaveBeenCalled()
    h.cw.mockRejectedValueOnce(new Error('copia fallida'))
    await expect(prepareOfficeTask('edita', files)).rejects.toThrow('copia fallida')
    expect(h.connect).not.toHaveBeenCalled()
    expect(h.mode).not.toHaveBeenCalled()
    expect(h.state.draft).toBe('anterior')
  })
  it.each(['error', 'idle', 'starting'])('si connectFolder recoge el fallo y resuelve (%s), no anuncia éxito', async (phase) => {
    h.cw.mockResolvedValue({ folder: { path: '/nueva' }, files: [] })
    h.connect.mockImplementation(async () => Object.assign(h.state, { phase, folder: '/nueva', conn: null }))
    await expect(prepareOfficeTask('edita', files)).rejects.toThrow()
    expect(h.mode).not.toHaveBeenCalled()
    expect(h.state.draft).toBe('anterior')
  })
  it('rechaza una conexión que cambió de carpeta o quedó en Control total', async () => {
    h.cw.mockResolvedValue({ folder: { path: '/nueva' }, files: [] })
    for (const state of [
      { folder: '/otra', conn: { sandboxed: true, fullAccess: false } },
      { folder: '/nueva', conn: { sandboxed: false, fullAccess: true } }
    ]) {
      h.connect.mockImplementation(async () => Object.assign(h.state, { phase: 'ready', ...state }))
      await expect(prepareOfficeTask('edita', files)).rejects.toThrow()
    }
    expect(h.mode).not.toHaveBeenCalled()
  })
  it('bloquea otro clic mientras se prepara', async () => {
    let finish!: (r: unknown) => void
    h.cw.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const first = prepareOfficeTask('edita', files)
    await Promise.resolve()
    await expect(prepareOfficeTask('edita', files)).rejects.toThrow()
    finish({ folder: { path: '/nueva' }, files: [] })
    h.connect.mockImplementation(async () =>
      Object.assign(h.state, { phase: 'ready', folder: '/nueva', conn: { sandboxed: true, fullAccess: false } })
    )
    await first
    expect(h.cw).toHaveBeenCalledTimes(1)
  })
})
