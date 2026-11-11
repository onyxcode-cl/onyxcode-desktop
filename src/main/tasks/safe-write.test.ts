/**
 * Escritura segura (`safe-write.ts`). La carrera NO se reproduce con un proceso real: la propia prueba cambia una carpeta por un enlace
 * en el momento intermedio con los puntos de enganche (`hooks`) y comprueba que la escritura se rechaza y que un archivo señuelo en una
 * carpeta temporal «de fuera» queda intacto. Enlaces simbólicos sin privilegios: solo macOS/Linux.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { posixOnly } from '../../test/platform'
import { LinkRefusedError } from './no-follow'
import { safeCopyIntoDir, safeCopyIntoDirSync, safeWriteFile, SafeTempFile } from './safe-write'

let root: string
let base: string
let outside: string
const DECOY = 'SEÑUELO-ORIGINAL'

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-safewrite-')))
  base = join(root, 'tarea')
  outside = join(root, 'fuera')
  mkdirSync(base)
  mkdirSync(outside)
  writeFileSync(join(outside, 'a.txt'), DECOY)
  writeFileSync(join(outside, 'x.plist'), DECOY)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

/** Lo de fuera sigue exactamente igual: solo los dos señuelos, con su contenido. */
function outsideIntact(): void {
  expect(readdirSync(outside).sort()).toEqual(['a.txt', 'x.plist'])
  expect(readFileSync(join(outside, 'a.txt'), 'utf8')).toBe(DECOY)
  expect(readFileSync(join(outside, 'x.plist'), 'utf8')).toBe(DECOY)
}

/** Simula lo que haría un proceso de la tarea: aparta la carpeta real y deja en su lugar un enlace a la de fuera. */
function swapForLink(dir: string): () => void {
  return () => {
    renameSync(dir, `${dir}-apartada`)
    symlinkSync(outside, dir)
  }
}

const tmpLeftovers = (dir: string): string[] => readdirSync(dir).filter((n) => n.startsWith('.lzx-'))

describe.skipIf(!posixOnly)('safeWriteFile: uso normal', () => {
  it('escribe un archivo nuevo, crea las carpetas que faltan y no deja temporales', () => {
    const f = join(base, '.lazunox', 'memoria.md')
    expect(safeWriteFile(base, f, 'hola')).toBe(f)
    expect(readFileSync(f, 'utf8')).toBe('hola')
    expect(tmpLeftovers(join(base, '.lazunox'))).toEqual([])
  })

  it('escribe en la propia carpeta base', () => {
    expect(safeWriteFile(base, join(base, 'AGENTS.md'), 'x', { replace: true })).toBe(join(base, 'AGENTS.md'))
    expect(readFileSync(join(base, 'AGENTS.md'), 'utf8')).toBe('x')
  })

  it('reemplaza un archivo existente con replace (y sin replace da EEXIST y no lo toca)', () => {
    const f = join(base, 'a.md')
    writeFileSync(f, 'viejo')
    expect(() => safeWriteFile(base, f, 'nuevo')).toThrow(/EEXIST/)
    expect(readFileSync(f, 'utf8')).toBe('viejo')
    safeWriteFile(base, f, 'nuevo', { replace: true })
    expect(readFileSync(f, 'utf8')).toBe('nuevo')
    expect(tmpLeftovers(base)).toEqual([])
  })

  it('fija los permisos del archivo resultante (sin depender de la umask)', () => {
    const prev = process.umask(0o077)
    try {
      safeWriteFile(base, join(base, 'a'), 'x')
      safeWriteFile(base, join(base, 'b'), 'x', { mode: 0o755 })
      safeWriteFile(base, join(base, 'c'), 'x', { mode: 0o600 })
    } finally {
      process.umask(prev)
    }
    expect(statSync(join(base, 'a')).mode & 0o777).toBe(0o644)
    expect(statSync(join(base, 'b')).mode & 0o777).toBe(0o755)
    expect(statSync(join(base, 'c')).mode & 0o777).toBe(0o600)
  })

  it('no acepta destinos fuera de la base', () => {
    expect(() => safeWriteFile(base, join(outside, 'a.txt'), 'x', { replace: true })).toThrow(LinkRefusedError)
    expect(() => safeWriteFile(base, join(base, '..', 'fuera', 'a.txt'), 'x', { replace: true })).toThrow(LinkRefusedError)
    outsideIntact()
  })

  it('un temporal de nombre fijo dejado como enlace ya no importa (el nombre es al azar)', () => {
    symlinkSync(join(outside, 'a.txt'), join(base, 'AGENTS.md.lazunox-tmp'))
    symlinkSync(join(outside, 'a.txt'), join(base, 'SKILL.md.tmp'))
    safeWriteFile(base, join(base, 'AGENTS.md'), 'instrucciones', { replace: true })
    expect(readFileSync(join(base, 'AGENTS.md'), 'utf8')).toBe('instrucciones')
    outsideIntact()
  })
})

describe.skipIf(!posixOnly)('safeWriteFile: destino que es un enlace', () => {
  it('replace: reemplaza EL ENLACE por un archivo propio; nunca escribe en su destino', () => {
    symlinkSync(join(outside, 'a.txt'), join(base, 'm.md'))
    safeWriteFile(base, join(base, 'm.md'), 'propio', { replace: true })
    expect(lstatSync(join(base, 'm.md')).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(base, 'm.md'), 'utf8')).toBe('propio')
    outsideIntact()
  })

  it('replace + refuseLinkTarget: falla y deja el enlace y su destino como estaban', () => {
    symlinkSync(join(outside, 'a.txt'), join(base, 'm.md'))
    expect(() => safeWriteFile(base, join(base, 'm.md'), 'x', { replace: true, refuseLinkTarget: true })).toThrow(LinkRefusedError)
    expect(lstatSync(join(base, 'm.md')).isSymbolicLink()).toBe(true)
    expect(tmpLeftovers(base)).toEqual([])
    outsideIntact()
  })

  it('sin replace: un enlace (también roto) ocupa el nombre: EEXIST, sin seguirlo', () => {
    symlinkSync(join(outside, 'a.txt'), join(base, 'm.md'))
    symlinkSync(join(outside, 'no-existe.plist'), join(base, 'roto.plist'))
    expect(() => safeWriteFile(base, join(base, 'm.md'), 'x')).toThrow(/EEXIST/)
    expect(() => safeWriteFile(base, join(base, 'roto.plist'), 'x')).toThrow(/EEXIST/)
    expect(tmpLeftovers(base)).toEqual([])
    outsideIntact()
  })

  it('una carpeta intermedia que ya es un enlace se rechaza antes de abrir nada', () => {
    symlinkSync(outside, join(base, 'descargas'))
    expect(() => safeWriteFile(base, join(base, 'descargas', 'x.plist'), 'ATACANTE', { replace: true })).toThrow(LinkRefusedError)
    outsideIntact()
  })
})

describe.skipIf(!posixOnly)('safeWriteFile: carpeta cambiada por un enlace en el paso intermedio (carrera simulada)', () => {
  const dir = (): string => join(base, '.lazunox', 'trabajo', 'descargas')
  beforeEach(() => mkdirSync(dir(), { recursive: true }))

  it('después de comprobar las carpetas y antes de abrir: se rechaza; fuera no queda ni el temporal', () => {
    expect(() =>
      safeWriteFile(base, join(dir(), 'x.plist'), 'ATACANTE', { replace: true, hooks: { afterDirCheck: swapForLink(dir()) } })
    ).toThrow(LinkRefusedError)
    outsideIntact()
  })

  it('lo mismo con una carpeta más arriba (.lazunox) y sin replace', () => {
    const lz = join(base, '.lazunox')
    expect(() => safeWriteFile(base, join(dir(), 'x.plist'), 'ATACANTE', { hooks: { afterDirCheck: swapForLink(lz) } })).toThrow(
      LinkRefusedError
    )
    outsideIntact()
  })

  it('después de abrir y antes de escribir: el contenido va al archivo verificado y no se confirma fuera', () => {
    expect(() =>
      safeWriteFile(base, join(dir(), 'x.plist'), 'ATACANTE', { replace: true, hooks: { afterOpen: swapForLink(dir()) } })
    ).toThrow(LinkRefusedError)
    outsideIntact()
  })

  it('con el contenido escrito y antes de rename: rename no encuentra el temporal en el destino del enlace', () => {
    expect(() =>
      safeWriteFile(base, join(dir(), 'x.plist'), 'ATACANTE', { replace: true, hooks: { beforeCommit: swapForLink(dir()) } })
    ).toThrow()
    outsideIntact()
  })

  it('con el contenido escrito y antes de link (sin replace): igual', () => {
    expect(() => safeWriteFile(base, join(dir(), 'x.plist'), 'ATACANTE', { hooks: { beforeCommit: swapForLink(dir()) } })).toThrow()
    outsideIntact()
  })
})

describe.skipIf(!posixOnly)('safeCopyIntoDir (descargas, importar archivos)', () => {
  let src: string
  beforeEach(() => {
    src = join(root, 'origen.bin')
    writeFileSync(src, Buffer.alloc(3 * 1024 * 1024 + 17, 7)) // más de un bloque de copia
  })

  it('copia por descriptor y usa el primer nombre libre', async () => {
    const dir = join(base, '.lazunox', 'trabajo', 'descargas')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'a.bin'), 'ocupado')
    symlinkSync(join(outside, 'a.txt'), join(dir, 'a (2).bin'))
    const out = await safeCopyIntoDir(base, dir, src, ['a.bin', 'a (2).bin', 'a (3).bin'])
    expect(out).toBe(join(dir, 'a (3).bin'))
    expect(readFileSync(out!).equals(readFileSync(src))).toBe(true)
    expect(statSync(out!).mode & 0o777).toBe(0o644)
    expect(readFileSync(join(dir, 'a.bin'), 'utf8')).toBe('ocupado')
    expect(tmpLeftovers(dir)).toEqual([])
    outsideIntact()
  })

  it('sin nombres libres devuelve null y no deja temporales', async () => {
    writeFileSync(join(base, 'a.bin'), 'ocupado')
    expect(await safeCopyIntoDir(base, base, src, ['a.bin'])).toBeNull()
    expect(tmpLeftovers(base)).toEqual([])
  })

  it('carpeta cambiada por un enlace antes de abrir o antes de confirmar: se rechaza y fuera no aparece nada', async () => {
    const dir = join(base, 'descargas')
    mkdirSync(dir)
    await expect(safeCopyIntoDir(base, dir, src, ['x.plist'], { hooks: { afterDirCheck: swapForLink(dir) } })).rejects.toThrow(
      LinkRefusedError
    )
    outsideIntact()
    rmSync(dir)
    rmSync(`${dir}-apartada`, { recursive: true })
    mkdirSync(dir)
    await expect(safeCopyIntoDir(base, dir, src, ['x.plist'], { hooks: { beforeCommit: swapForLink(dir) } })).rejects.toThrow()
    outsideIntact()
  })

  it('versión síncrona: igual', () => {
    expect(safeCopyIntoDirSync(base, base, src, ['b.bin'])).toBe(join(base, 'b.bin'))
    expect(statSync(join(base, 'b.bin')).size).toBe(statSync(src).size)
    const dir = join(base, 'sub')
    mkdirSync(dir)
    expect(() => safeCopyIntoDirSync(base, dir, src, ['x.plist'], { hooks: { afterDirCheck: swapForLink(dir) } })).toThrow(
      LinkRefusedError
    )
    outsideIntact()
  })
})

describe.skipIf(!posixOnly)('SafeTempFile', () => {
  it('discard quita el temporal y es idempotente', () => {
    const t = SafeTempFile.create(base, base)
    t.writeAll('x')
    expect(existsSync(t.tmpPath)).toBe(true)
    t.discard()
    t.discard()
    expect(existsSync(t.tmpPath)).toBe(false)
  })

  it('rechaza nombres con separadores', () => {
    const t = SafeTempFile.create(base, base)
    try {
      expect(() => t.commit('../fuera/a.txt', { replace: true })).toThrow(LinkRefusedError)
      expect(() => t.commit('..', { replace: true })).toThrow(LinkRefusedError)
    } finally {
      t.discard()
    }
    outsideIntact()
  })
})
