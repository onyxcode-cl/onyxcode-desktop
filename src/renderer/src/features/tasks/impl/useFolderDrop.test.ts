import { afterEach, describe, expect, it } from 'vitest'
import { droppedPath } from './useFolderDrop'

const files = (names: string[]): FileList => names.map((n) => ({ name: n })) as unknown as FileList

describe('droppedPath', () => {
  afterEach(() => {
    delete (window as unknown as { lzxPaths?: unknown }).lzxPaths
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
})
