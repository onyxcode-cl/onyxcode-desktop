import { afterEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ dropFolder: vi.fn(), attachDroppedFiles: vi.fn(), setState: vi.fn() }))
vi.mock('./actions', () => ({ dropFolder: h.dropFolder }))
vi.mock('./drop-files', () => ({ attachDroppedFiles: h.attachDroppedFiles }))
vi.mock('./store', () => ({ useTasks: { setState: h.setState } }))
import { acceptDrop, droppedEntries, droppedPath } from './useFolderDrop'

const files = (names: string[]): FileList => names.map((n) => ({ name: n })) as unknown as FileList

describe('droppedPath', () => {
  afterEach(() => {
    delete (window as unknown as { lzxPaths?: unknown }).lzxPaths
    vi.clearAllMocks()
  })

  it('toma la ruta real de la primera entrada soltada vía preload', () => {
    ;(window as unknown as { lzxPaths: unknown }).lzxPaths = { forFile: (f: { name: string }) => `/Users/x/${f.name}` }
    expect(droppedPath(files(['proyecto', 'otra']))).toBe('/Users/x/proyecto')
  })

  it('sin preload o sin entradas devuelve vacío (no se conecta nada)', () => {
    expect(droppedPath(files(['proyecto']))).toBe('')
    ;(window as unknown as { lzxPaths: unknown }).lzxPaths = { forFile: () => '/x' }
    expect(droppedPath(null)).toBe('')
    expect(droppedPath(files([]))).toBe('')
  })

  const data = (entries: Array<[string, boolean]>) => ({
    files: files(entries.map(([name]) => name)),
    items: entries.map(([name, directory]) => ({
      kind: 'file',
      getAsFile: () => ({ name }),
      webkitGetAsEntry: () => ({ isDirectory: directory })
    })) as unknown as DataTransferItemList
  })
  it.each(['/Users/x/deck.pptx', 'C:\\Trabajo\\deck.pptx'])('separa por tipo real, no por extensión (%s)', (path) => {
    ;(window as unknown as { lzxPaths: unknown }).lzxPaths = { forFile: () => path }
    acceptDrop(data([['deck.pptx', false]]))
    expect(h.attachDroppedFiles).toHaveBeenCalledWith([{ name: 'deck.pptx' }])
    expect(h.dropFolder).not.toHaveBeenCalled()
    h.attachDroppedFiles.mockClear()
    acceptDrop(data([['carpeta.pptx', true]]))
    expect(h.dropFolder).toHaveBeenCalledWith(path)
    expect(h.attachDroppedFiles).not.toHaveBeenCalled()
  })
  it('sin API de entradas conserva archivos; arrastre mixto pide separarlos sin cambiar de carpeta', () => {
    expect(droppedEntries({ items: [] as unknown as DataTransferItemList, files: files(['deck.pptx']) }).files).toEqual([
      { name: 'deck.pptx' }
    ])
    acceptDrop(
      data([
        ['carpeta', true],
        ['deck.pptx', false]
      ])
    )
    expect(h.setState).toHaveBeenCalledWith({ error: expect.any(String) })
    expect(h.dropFolder).not.toHaveBeenCalled()
    expect(h.attachDroppedFiles).not.toHaveBeenCalled()
  })
})
