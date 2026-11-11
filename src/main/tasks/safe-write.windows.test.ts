/**
 * Casos de Windows y de discos sin enlaces duros en `safe-write.ts` (revisión 2, 1.8.18), SIN Windows: se simulan los códigos de error
 * del sistema con los puntos de enganche de prueba (`safeWriteOps`). Usa archivos reales en una carpeta temporal.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from '@shared/i18n'
import { safeWriteFile, safeWriteNewFile, safeWriteOps } from './safe-write'

const real = { ...safeWriteOps }
const fail = (code: string): Error => Object.assign(new Error(`${code}: simulado`), { code })

let root: string
let sleeps: number[]
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-sw-win-')))
  sleeps = []
  safeWriteOps.sleep = (ms) => void sleeps.push(ms)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  Object.assign(safeWriteOps, real)
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})
const names = (n: string): string[] => [n, n.replace('.', ' (2).'), n.replace('.', ' (3).')]
const tmps = (): string[] => readdirSync(root).filter((f) => f.startsWith('.lzx-'))

describe('2. el temporal que no se puede borrar no cambia el resultado (antivirus con el archivo abierto)', () => {
  it('link bien y unlink del temporal con EPERM: se crea UN archivo con el nombre pedido, sin copias (2)', () => {
    let unlinks = 0
    safeWriteOps.unlink = (p) => {
      unlinks++
      throw fail('EPERM')
    }
    const out = safeWriteNewFile(root, root, 'datos', names('informe.txt'))
    expect(out).toBe(join(root, 'informe.txt'))
    expect(readdirSync(root).filter((f) => !f.startsWith('.lzx-'))).toEqual(['informe.txt'])
    expect(readFileSync(out!, 'utf8')).toBe('datos')
    expect(unlinks).toBeGreaterThan(1) // se reintentó el borrado
    expect(sleeps.length).toBeGreaterThan(0)
    expect(vi.mocked(console.warn)).toHaveBeenCalled() // se registra
    expect(tmps()).toHaveLength(1) // se deja el temporal
  })

  it('safeWriteFile sin replace: no da un «ya existe» falso', () => {
    safeWriteOps.unlink = () => {
      throw fail('EBUSY')
    }
    expect(safeWriteFile(root, join(root, 'a.txt'), 'x')).toBe(join(root, 'a.txt'))
  })

  it('si el borrado funciona al segundo intento, no queda ningún temporal', () => {
    let n = 0
    safeWriteOps.unlink = (p) => {
      if (n++ === 0) throw fail('EPERM')
      unlinkSync(p)
    }
    safeWriteNewFile(root, root, 'datos', names('informe.txt'))
    expect(tmps()).toEqual([])
    expect(readdirSync(root)).toEqual(['informe.txt'])
  })

  it('un EEXIST real del link sigue probando el nombre siguiente', () => {
    writeFileSync(join(root, 'informe.txt'), 'viejo')
    expect(safeWriteNewFile(root, root, 'datos', names('informe.txt'))).toBe(join(root, 'informe (2).txt'))
    expect(readFileSync(join(root, 'informe.txt'), 'utf8')).toBe('viejo')
  })
})

describe('3. disco sin enlaces duros (memoria USB FAT): EISDIR entra al camino de copia', () => {
  it.each(['EISDIR', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'])('link con %s: se copia por descriptor', (code) => {
    safeWriteOps.link = () => {
      throw fail(code)
    }
    const out = safeWriteNewFile(root, root, 'contenido', names('a.txt'))
    expect(out).toBe(join(root, 'a.txt'))
    expect(readFileSync(out!, 'utf8')).toBe('contenido')
    expect(tmps()).toEqual([])
  })

  it('otro código (EIO) sigue fallando', () => {
    safeWriteOps.link = () => {
      throw fail('EIO')
    }
    expect(() => safeWriteNewFile(root, root, 'x', names('a.txt'))).toThrow('EIO')
  })

  it('con el camino alternativo, un nombre ya ocupado prueba el siguiente', () => {
    safeWriteOps.link = () => {
      throw fail('EISDIR')
    }
    writeFileSync(join(root, 'a.txt'), 'viejo')
    expect(safeWriteNewFile(root, root, 'nuevo', names('a.txt'))).toBe(join(root, 'a (2).txt'))
  })
})
