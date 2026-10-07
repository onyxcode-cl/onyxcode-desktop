/**
 * Memoria aprendida (decisión del dueño, 2026-10-07): vive en `userData/memoria/`, NUNCA dentro de la
 * carpeta del proyecto. Usa SIEMPRE un `userData` de prueba (tmpdir): nunca el real (AGENTS.md §9).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `vi.mock` se iza por encima de los imports: `state.userData` arranca vacío y se rellena en `beforeEach`
// (ya con los imports normales ligados), como `manager.fullaccess.test.ts`. `getPath` lo lee al llamarse, no antes.
const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))

import {
  acceptLearnedMemory,
  clearLearnedMemory,
  getLearnedMemory,
  learnedMemoryForPrompt,
  removeLearnedMemoryEntry
} from './learned-memory'

let folderA: string
let folderB: string

beforeEach(() => {
  state.userData = mkdtempSync(join(tmpdir(), 'lzx-learned-mem-'))
  folderA = mkdtempSync(join(tmpdir(), 'lzx-proyecto-a-'))
  folderB = mkdtempSync(join(tmpdir(), 'lzx-proyecto-b-'))
})
afterEach(() => {
  rmSync(state.userData, { recursive: true, force: true })
  rmSync(folderA, { recursive: true, force: true })
  rmSync(folderB, { recursive: true, force: true })
})

describe('acceptLearnedMemory', () => {
  it('guarda una propuesta de alcance usuario sin necesitar carpeta', () => {
    const { bundle, savedCount } = acceptLearnedMemory(null, [{ alcance: 'usuario', tipo: 'preferencia', texto: 'prefiere tablas' }])
    expect(savedCount).toBe(1)
    expect(bundle.usuario).toHaveLength(1)
    expect(bundle.usuario[0].texto).toBe('prefiere tablas')
  })

  it('guarda una de alcance proyecto solo si hay carpeta', () => {
    const sinCarpeta = acceptLearnedMemory(null, [{ alcance: 'proyecto', tipo: 'convencion', texto: 'usa Prettier' }])
    expect(sinCarpeta.savedCount).toBe(0)
    const conCarpeta = acceptLearnedMemory(folderA, [{ alcance: 'proyecto', tipo: 'convencion', texto: 'usa Prettier' }])
    expect(conCarpeta.savedCount).toBe(1)
  })

  it('la memoria de proyecto queda separada por carpeta (A y B no se mezclan)', () => {
    acceptLearnedMemory(folderA, [{ alcance: 'proyecto', tipo: 'decision', texto: 'de A' }])
    acceptLearnedMemory(folderB, [{ alcance: 'proyecto', tipo: 'decision', texto: 'de B' }])
    expect(getLearnedMemory(folderA).proyecto.map((e) => e.texto)).toEqual(['de A'])
    expect(getLearnedMemory(folderB).proyecto.map((e) => e.texto)).toEqual(['de B'])
  })

  it('una propuesta con un secreto se descarta por completo (no se guarda nada de ella)', () => {
    const { savedCount, bundle } = acceptLearnedMemory(null, [
      { alcance: 'usuario', tipo: 'decision', texto: 'la clave es sk-ant-abcdefgh12345678' }
    ])
    expect(savedCount).toBe(0)
    expect(bundle.usuario).toHaveLength(0)
  })

  it('tipo inválido o texto vacío se ignora sin romper el resto del lote', () => {
    const { savedCount, bundle } = acceptLearnedMemory(null, [
      { alcance: 'usuario', tipo: 'no-existe', texto: 'x' },
      { alcance: 'usuario', tipo: 'preferencia', texto: '' },
      { alcance: 'usuario', tipo: 'preferencia', texto: 'esta sí' }
    ])
    expect(savedCount).toBe(1)
    expect(bundle.usuario.map((e) => e.texto)).toEqual(['esta sí'])
  })

  it('se escribe en disco de verdad: una segunda llamada ve lo que la primera guardó', () => {
    acceptLearnedMemory(null, [{ alcance: 'usuario', tipo: 'preferencia', texto: 'uno' }])
    acceptLearnedMemory(null, [{ alcance: 'usuario', tipo: 'preferencia', texto: 'dos' }])
    expect(
      getLearnedMemory(null)
        .usuario.map((e) => e.texto)
        .sort()
    ).toEqual(['dos', 'uno'])
  })

  it('más de 20 propuestas en un lote: solo se procesan las primeras 20', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ alcance: 'usuario' as const, tipo: 'preferencia' as const, texto: `h${i}` }))
    const { savedCount } = acceptLearnedMemory(null, many)
    expect(savedCount).toBe(20)
  })
})

describe('removeLearnedMemoryEntry', () => {
  it('quita una entrada de usuario por id y conserva las demás', () => {
    const { bundle } = acceptLearnedMemory(null, [
      { alcance: 'usuario', tipo: 'preferencia', texto: 'A' },
      { alcance: 'usuario', tipo: 'preferencia', texto: 'B' }
    ])
    const idA = bundle.usuario.find((e) => e.texto === 'A')!.id
    const after = removeLearnedMemoryEntry('usuario', null, idA)
    expect(after.usuario.map((e) => e.texto)).toEqual(['B'])
  })

  it('quita una entrada de proyecto sin afectar la de otro proyecto', () => {
    const { bundle } = acceptLearnedMemory(folderA, [{ alcance: 'proyecto', tipo: 'solucion', texto: 'solo en A' }])
    acceptLearnedMemory(folderB, [{ alcance: 'proyecto', tipo: 'solucion', texto: 'solo en B' }])
    removeLearnedMemoryEntry('proyecto', folderA, bundle.proyecto[0].id)
    expect(getLearnedMemory(folderA).proyecto).toHaveLength(0)
    expect(getLearnedMemory(folderB).proyecto).toHaveLength(1)
  })
})

describe('clearLearnedMemory', () => {
  it('borra toda la memoria de usuario sin tocar la de proyecto', () => {
    acceptLearnedMemory(folderA, [
      { alcance: 'usuario', tipo: 'preferencia', texto: 'global' },
      { alcance: 'proyecto', tipo: 'convencion', texto: 'de A' }
    ])
    clearLearnedMemory('usuario', null)
    expect(getLearnedMemory(folderA).usuario).toHaveLength(0)
    expect(getLearnedMemory(folderA).proyecto).toHaveLength(1)
  })

  it('borrar sin que exista el archivo no lanza', () => {
    expect(() => clearLearnedMemory('usuario', null)).not.toThrow()
    expect(() => clearLearnedMemory('proyecto', folderA)).not.toThrow()
  })
})

describe('learnedMemoryForPrompt', () => {
  it('da texto listo para el prompt, sin comentarios de metadatos', () => {
    acceptLearnedMemory(folderA, [{ alcance: 'proyecto', tipo: 'convencion', texto: 'usa Prettier' }])
    const { proyecto } = learnedMemoryForPrompt(folderA)
    expect(proyecto).toContain('usa Prettier')
    expect(proyecto).not.toMatch(/<!--/)
  })

  it('sin carpeta, la de proyecto queda vacía', () => {
    expect(learnedMemoryForPrompt(null).proyecto).toBe('')
  })
})

describe('ubicación en disco', () => {
  it('nunca escribe dentro de la carpeta del proyecto, solo bajo userData/memoria/proyectos', () => {
    acceptLearnedMemory(folderA, [{ alcance: 'proyecto', tipo: 'convencion', texto: 'x' }])
    expect(() => readFileSync(join(folderA, '.lazunox', 'memoria.md'))).toThrow()
    const files = readdirSync(join(state.userData, 'memoria', 'proyectos'))
    expect(files).toHaveLength(1)
    expect(readFileSync(join(state.userData, 'memoria', 'proyectos', files[0]), 'utf8')).toContain('x')
  })
})
