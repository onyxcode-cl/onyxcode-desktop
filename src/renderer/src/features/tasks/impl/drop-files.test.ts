import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PASTE_MAX_FILE_BYTES } from '@shared/paste-files'

const h = vi.hoisted(() => ({
  cw: vi.fn(),
  connect: vi.fn(),
  unified: vi.fn(),
  state: {
    folder: '/tarea' as string | null,
    activeTaskId: null as string | null,
    folders: [] as unknown[],
    phase: 'ready',
    error: null as string | null,
    attachments: [] as unknown[]
  }
}))
vi.mock('./bridge', () => ({ cw: h.cw }))
vi.mock('./unified', () => ({ useUnified: { setState: h.unified } }))
vi.mock('./store', () => ({
  connectFolder: h.connect,
  useTasks: {
    getState: () => h.state,
    setState: (update: unknown) => Object.assign(h.state, typeof update === 'function' ? update(h.state) : update)
  }
}))
import { attachDroppedFiles } from './drop-files'

const file = (name: string, content = 'PPTX') =>
  ({ name, size: content.length, arrayBuffer: async () => Uint8Array.from(Buffer.from(content)).buffer }) as File
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(h.state, { folder: '/tarea', activeTaskId: null, folders: [], phase: 'ready', error: null, attachments: [] })
  h.cw.mockImplementation(async (channel, req) =>
    channel === 'tasks:chatFolder:create'
      ? { path: '/chat-propio', name: 'Chat', approvedAt: 1 }
      : { path: `${req.folder}/${req.name}`, relPath: req.name, size: 4, mtime: 1 }
  )
  h.connect.mockImplementation(async (path) => {
    h.state.folder = path
    h.state.phase = 'ready'
  })
})

describe('arrastrar archivos a Tareas', () => {
  it.each(['/tarea', 'C:\\Trabajo'])('adjunta en la carpeta actual %s sin tratar el PPTX como carpeta', async (folder) => {
    h.state.folder = folder
    await attachDroppedFiles([file('deck.pptx')])
    expect(h.cw).toHaveBeenCalledExactlyOnceWith('tasks:attachDroppedFile', { folder, name: 'deck.pptx', base64: 'UFBUWA==' })
    expect(h.state.attachments).toEqual([expect.objectContaining({ relPath: 'deck.pptx' })])
    expect(h.connect).not.toHaveBeenCalled()
  })
  it('desde el inicio crea una carpeta propia aislada y conserva el adjunto sin enviar al modelo', async () => {
    h.state.folder = null
    await attachDroppedFiles([file('deck.pptx')])
    expect(h.connect).toHaveBeenCalledWith('/chat-propio', false)
    expect(h.unified).toHaveBeenCalledWith({ wantAuto: false, chatFolder: '/chat-propio' })
    expect(h.cw.mock.calls.map((call) => call[0])).toEqual(['tasks:chatFolder:create', 'tasks:attachDroppedFile'])
    expect(h.state.attachments).toHaveLength(1)
  })
  it('si falla el adjunto muestra error y permite otro arrastre', async () => {
    h.cw.mockRejectedValueOnce(new Error('no se puede copiar'))
    await attachDroppedFiles([file('deck.pptx')])
    expect(h.state.error).toBe('no se puede copiar')
    await attachDroppedFiles([file('deck.pptx')])
    expect(h.state.error).toBeNull()
    expect(h.state.attachments).toHaveLength(1)
  })
  it('limita tamaño antes de leer o crear carpeta y no añade a otra tarea si cambia mientras lee', async () => {
    const oversized = { ...file('enorme.pptx'), size: PASTE_MAX_FILE_BYTES + 1, arrayBuffer: vi.fn() }
    await attachDroppedFiles([oversized])
    expect(oversized.arrayBuffer).not.toHaveBeenCalled()
    expect(h.cw).not.toHaveBeenCalled()
    const changing = file('deck.pptx')
    changing.arrayBuffer = async () => {
      h.state.folder = '/otra'
      return new ArrayBuffer(1)
    }
    await attachDroppedFiles([changing])
    expect(h.cw).not.toHaveBeenCalled()
    expect(h.state.attachments).toEqual([])
  })
  it('no cambia de carpeta si la persona navega mientras se crea la carpeta del arrastre', async () => {
    h.state.folder = null
    h.cw.mockImplementationOnce(async () => {
      h.state.folder = '/otra'
      return { path: '/chat-propio', name: 'Chat', approvedAt: 1 }
    })
    await attachDroppedFiles([file('deck.pptx')])
    expect(h.connect).not.toHaveBeenCalled()
    expect(h.state.folder).toBe('/otra')
    expect(h.state.attachments).toEqual([])
  })
})
