import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OutputPathError, cleanName, parseSubfolder, writeNewFile } from './output-path'

let root: string
let outside: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lzx-docs-root-'))
  outside = mkdtempSync(join(tmpdir(), 'lzx-docs-out-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

const bytes = Buffer.from('contenido')
const req = (over: Record<string, unknown> = {}) => ({ name: 'informe', ext: 'docx', bytes, maxBytes: 1024, ...over })

function canSymlink(): boolean {
  try {
    const t = mkdtempSync(join(tmpdir(), 'lzx-sl-'))
    symlinkSync(t, join(t, 'x'))
    rmSync(t, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}
const linksOk = canSymlink()

async function fails(p: Promise<unknown>, code?: string): Promise<OutputPathError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(OutputPathError)
    if (code) expect((e as OutputPathError).code).toBe(code)
    return e as OutputPathError
  }
  throw new Error('debía fallar')
}

describe('cleanName', () => {
  it('quita separadores, símbolos y la extensión puesta por el agente', () => {
    expect(cleanName('Informe 2026')).toBe('Informe 2026')
    expect(cleanName('../../etc/passwd')).toBe('etcpasswd')
    expect(cleanName('informe.docx')).toBe('informe')
    expect(cleanName('a\\b/c:d*e?')).toBe('abcde')
  })
  it('vacío o basura → «documento»', () => {
    expect(cleanName('')).toBe('documento')
    expect(cleanName('***')).toBe('documento')
    expect(cleanName(undefined)).toBe('documento')
  })
  it('recorta a 80 caracteres', () => {
    expect(cleanName('a'.repeat(300)).length).toBe(80)
  })
  it('rechaza nombres reservados de Windows', () => {
    expect(() => cleanName('CON')).toThrow(OutputPathError)
    expect(() => cleanName('nul')).toThrow(OutputPathError)
  })
})

describe('parseSubfolder', () => {
  it('acepta relativas y normaliza separadores', () => {
    expect(parseSubfolder(undefined)).toEqual([])
    expect(parseSubfolder('')).toEqual([])
    expect(parseSubfolder('docs/ventas')).toEqual(['docs', 'ventas'])
    expect(parseSubfolder('docs\\ventas/./x')).toEqual(['docs', 'ventas', 'x'])
  })
  it.each([
    '../x',
    'a/../../b',
    '/etc',
    '\\\\srv\\share',
    'C:\\Windows',
    'C:foo',
    '~/Library',
    'a:b',
    'CON',
    'x.',
    'x ',
    'PROGRA~1',
    'a\u0000b',
    'a/b/c/d/e',
    'x'.repeat(301)
  ])('rechaza %j', (raw) => {
    expect(() => parseSubfolder(raw)).toThrow(OutputPathError)
  })
  it('rechaza tipos que no son texto', () => {
    expect(() => parseSubfolder(5)).toThrow(OutputPathError)
    expect(() => parseSubfolder({})).toThrow(OutputPathError)
  })
})

describe('writeNewFile', () => {
  it('escribe en la carpeta y devuelve la ruta relativa', async () => {
    const r = await writeNewFile(root, req())
    expect(r.rel).toBe('informe.docx')
    expect(readFileSync(r.abs, 'utf8')).toBe('contenido')
    expect(r.bytes).toBe(bytes.length)
  })

  it('crea la subcarpeta (hasta 4 niveles)', async () => {
    const r = await writeNewFile(root, req({ subfolder: 'a/b/c' }))
    expect(r.rel).toBe('a/b/c/informe.docx')
    expect(existsSync(join(root, 'a', 'b', 'c', 'informe.docx'))).toBe(true)
  })

  it('nunca pisa: añade « (2)», « (3)»…', async () => {
    writeFileSync(join(root, 'informe.docx'), 'ORIGINAL')
    const a = await writeNewFile(root, req())
    const b = await writeNewFile(root, req())
    expect(a.rel).toBe('informe (2).docx')
    expect(b.rel).toBe('informe (3).docx')
    expect(readFileSync(join(root, 'informe.docx'), 'utf8')).toBe('ORIGINAL')
  })

  it('después de 20 homónimos da error y no escribe más', async () => {
    for (let i = 0; i < 20; i++) await writeNewFile(root, req())
    await fails(writeNewFile(root, req()), 'exists')
    expect(readdirSync(root).length).toBe(20)
  })

  it('la extensión la fija el tipo, no el agente', async () => {
    const r = await writeNewFile(root, req({ name: 'virus.exe', ext: 'pdf' }))
    expect(r.rel).toBe('virus.pdf')
  })

  it('rechaza un documento más grande que el tope', async () => {
    await fails(writeNewFile(root, req({ maxBytes: 3 })), 'size')
    expect(readdirSync(root)).toEqual([])
  })

  it('rechaza una carpeta de la tarea que no existe', async () => {
    await fails(writeNewFile(join(root, 'no-existe'), req()), 'io')
  })

  it.each(['../fuera', '/etc', 'C:\\Windows', 'a:b', 'CON'])('rechaza la subcarpeta %j sin escribir nada', async (sub) => {
    await fails(writeNewFile(root, req({ subfolder: sub })), 'subfolder')
    expect(readdirSync(root)).toEqual([])
  })

  it.skipIf(!linksOk)('una subcarpeta que es un enlace hacia fuera se rechaza', async () => {
    symlinkSync(outside, join(root, 'salida'))
    await fails(writeNewFile(root, req({ subfolder: 'salida' })), 'subfolder')
    expect(readdirSync(outside)).toEqual([])
  })

  it.skipIf(!linksOk)('un nivel intermedio que es un enlace también se rechaza', async () => {
    mkdirSync(join(root, 'a'))
    symlinkSync(outside, join(root, 'a', 'b'))
    await fails(writeNewFile(root, req({ subfolder: 'a/b/c' })), 'subfolder')
    expect(readdirSync(outside)).toEqual([])
  })

  it.skipIf(!linksOk)('un nombre que ya es un enlace (a un archivo ajeno) no se sigue ni se pisa', async () => {
    const ajeno = join(outside, 'secreto.txt')
    writeFileSync(ajeno, 'NO TOCAR')
    symlinkSync(ajeno, join(root, 'informe.docx'))
    const r = await writeNewFile(root, req())
    expect(r.rel).toBe('informe (2).docx')
    expect(readFileSync(ajeno, 'utf8')).toBe('NO TOCAR')
  })

  it.skipIf(!linksOk)('si la propia carpeta de la tarea es un enlace, se escribe en su destino real', async () => {
    const link = join(outside, 'enlace-a-root')
    symlinkSync(root, link)
    const r = await writeNewFile(link, req())
    expect(readFileSync(join(root, 'informe.docx'), 'utf8')).toBe('contenido')
    expect(r.rel).toBe('informe.docx')
  })
})
