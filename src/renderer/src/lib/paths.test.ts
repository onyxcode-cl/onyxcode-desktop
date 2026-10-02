import { describe, expect, it } from 'vitest'
import { baseName, shortenPath, splitPath, tildify } from './paths'

describe('tildify', () => {
  it('macOS y Linux', () => {
    expect(tildify('/Users/ana/proyecto')).toBe('~/proyecto')
    expect(tildify('/home/ana')).toBe('~')
  })
  it('Windows con ambos separadores y cualquier unidad', () => {
    expect(tildify('C:\\Users\\Bentec\\repo\\src')).toBe('~\\repo\\src')
    expect(tildify('c:/Users/Bentec/repo')).toBe('~/repo')
    expect(tildify('D:\\Users\\x')).toBe('~')
  })
  it('no toca rutas fuera del home ni nombres parecidos', () => {
    expect(tildify('C:\\onyx\\wt')).toBe('C:\\onyx\\wt')
    expect(tildify('/Usersx/ana')).toBe('/Usersx/ana')
  })
})

describe('shortenPath', () => {
  it('rutas de Windows', () => {
    expect(shortenPath('C:\\Users\\x\\repo\\src\\a.ts')).toBe('…/src/a.ts')
    expect(shortenPath('C:/a/b')).toBe('a/b')
  })
  it('POSIX igual que antes y texto libre intacto', () => {
    expect(shortenPath('/Users/x/repo/a.ts')).toBe('…/repo/a.ts')
    expect(shortenPath('hola mundo/otro')).toBe('hola mundo/otro')
  })
})

describe('baseName / splitPath', () => {
  it('aceptan / y \\', () => {
    expect(baseName('C:\\Users\\x\\repo\\')).toBe('repo')
    expect(baseName('/a/b/c')).toBe('c')
    expect(splitPath('src\\lib\\a.ts')).toEqual({ dir: 'src\\lib', name: 'a.ts' })
    expect(splitPath('src/lib/a.ts')).toEqual({ dir: 'src/lib', name: 'a.ts' })
    expect(splitPath('a.ts')).toEqual({ dir: '', name: 'a.ts' })
  })
})
