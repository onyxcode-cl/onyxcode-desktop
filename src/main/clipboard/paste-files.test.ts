import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { posixOnly } from '../../test/platform'
import { PASTE_MAX_FILE_BYTES, PASTE_MAX_FILES } from '@shared/paste-files'
import { IPC_SCHEMAS } from '../ipc/schemas'
import { decide } from '../remote/policy'
import {
  fileUrlToLocalPath,
  parseFileNameW,
  parseFilenamesPlist,
  parseUriList,
  readClipboardPaths,
  readPasteFiles,
  type ClipboardReader
} from './paste-files'

let dir: string
/** Hay enlaces simbólicos: en Windows crearlos exige privilegio (modo desarrollador/admin); el CI sí los permite. */
let linked = false
/** Ruta absoluta de la plataforma para un nombre ficticio (en Windows `C:\tmp\…`) y su URL `file:`. */
const abs = (n: string): string => resolve('/tmp', n)
const furl = (n: string): string => pathToFileURL(abs(n)).href
const p = (n: string): string => join(dir, n)

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'paste-test-'))
  writeFileSync(p('nota.txt'), 'hola')
  writeFileSync(p('foto.png'), Buffer.from([1, 2, 3]))
  writeFileSync(p('doc.pdf'), '%PDF')
  writeFileSync(p('run.sh'), 'echo')
  writeFileSync(p('lanzador'), 'x')
  if (posixOnly) chmodSync(p('lanzador'), 0o755) // Windows no tiene bit de ejecución
  mkdirSync(p('carpeta'))
  try {
    symlinkSync(p('nota.txt'), p('enlace.txt'))
    linked = true
  } catch {
    linked = false
  }
  writeFileSync(p('grande.txt'), Buffer.alloc(PASTE_MAX_FILE_BYTES + 1))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function reader(raw: Record<string, Buffer>, png: Buffer | null = null): ClipboardReader {
  return { readRaw: async (f) => raw[f] ?? null, readImagePng: async () => png }
}
const plist = (paths: string[]): Buffer =>
  Buffer.from(`<plist><array>${paths.map((x) => `<string>${x}</string>`).join('')}</array></plist>`)

describe('análisis de formatos', () => {
  it('plist de Finder, con entidades XML', () => {
    expect(parseFilenamesPlist(plist(['/a/b &amp; c.txt', '/x.png']).toString())).toEqual(['/a/b & c.txt', '/x.png'])
  })
  it('FileNameW en UTF-16LE terminado en NUL', () => {
    expect(parseFileNameW(Buffer.from('C:\\u\\a.txt\0', 'utf16le'))).toEqual(['C:\\u\\a.txt'])
  })
  it('file-url y uri-list; rechaza lo que no es file:', () => {
    // Las URLs se construyen con rutas de la plataforma: `file:///tmp/…` no es una ruta absoluta en Windows (`file:///C:/tmp/…`).
    expect(fileUrlToLocalPath(`${furl('a b.txt')}\n`)).toBe(abs('a b.txt'))
    expect(fileUrlToLocalPath('http://x/a')).toBeNull()
    expect(parseUriList(`# c\n${furl('a.txt')}\r\nhttp://x\n${furl('b.txt')}`)).toEqual([abs('a.txt'), abs('b.txt')])
  })
  it('macOS: plist primero, luego file-url; Windows: FileNameW', async () => {
    expect(await readClipboardPaths(reader({ NSFilenamesPboardType: plist(['/a.txt']) }), 'darwin')).toEqual(['/a.txt'])
    expect(await readClipboardPaths(reader({ 'public.file-url': Buffer.from(furl('b.txt')) }), 'darwin')).toEqual([abs('b.txt')])
    expect(await readClipboardPaths(reader({ FileNameW: Buffer.from('C:\\a.txt\0', 'utf16le') }), 'win32')).toEqual(['C:\\a.txt'])
    expect(await readClipboardPaths(reader({}), 'darwin')).toEqual([])
  })
  it('un lector que lanza se trata como vacío', async () => {
    const bad: ClipboardReader = { readRaw: async () => Promise.reject(new Error('x')), readImagePng: async () => null }
    expect(await readClipboardPaths(bad, 'darwin')).toEqual([])
  })
})

describe('readPasteFiles: validación', () => {
  const darwin = (paths: string[], scope: 'any' | 'images' = 'any') =>
    readPasteFiles(reader({ NSFilenamesPboardType: plist(paths) }), scope, 'darwin')

  it('lee archivos regulares con nombre, mime y bytes', async () => {
    const r = await darwin([p('nota.txt'), p('foto.png'), p('doc.pdf')])
    expect(r.rejected).toEqual([])
    expect(r.files.map((f) => [f.name, f.mime])).toEqual([
      ['nota.txt', 'application/octet-stream'],
      ['foto.png', 'image/png'],
      ['doc.pdf', 'application/pdf']
    ])
    expect(Buffer.from(r.files[0]!.base64, 'base64').toString()).toBe('hola')
  })
  it('rechaza carpeta, enlace simbólico, script, inexistente y ruta relativa', async () => {
    const withLink = linked ? [p('enlace.txt')] : []
    const r = await darwin([p('carpeta'), ...withLink, p('run.sh'), p('no-existe.txt'), 'relativa.txt'])
    expect(r.files).toEqual([])
    expect(r.rejected.map((x) => x.reason)).toEqual([
      'notRegular',
      ...withLink.map(() => 'notRegular'),
      'blockedType',
      'unreadable',
      'notRegular'
    ])
  })
  // El bit de ejecución no existe en Windows (allí `readOne` lo ignora a propósito): solo se comprueba en POSIX.
  it.skipIf(!posixOnly)('rechaza un lanzador sin extensión conocida por su bit de ejecución', async () => {
    const r = await darwin([p('lanzador')])
    expect(r.files).toEqual([])
    expect(r.rejected.map((x) => x.reason)).toEqual(['blockedType'])
  })
  it('rechaza archivos por encima de 25 MB', async () => {
    const r = await darwin([p('grande.txt')])
    expect(r.rejected).toEqual([{ name: 'grande.txt', reason: 'tooBig' }])
  })
  it('máximo 10 archivos', async () => {
    const many = Array.from({ length: PASTE_MAX_FILES + 2 }, (_, i) => p(`n${i}.txt`))
    many.forEach((f) => writeFileSync(f, 'x'))
    const r = await darwin(many)
    expect(r.files).toHaveLength(PASTE_MAX_FILES)
    expect(r.rejected.map((x) => x.reason)).toEqual(['tooMany', 'tooMany'])
  })
  it('ámbito images: solo imágenes', async () => {
    const r = await darwin([p('nota.txt'), p('foto.png')], 'images')
    expect(r.files.map((f) => f.name)).toEqual(['foto.png'])
    expect(r.rejected[0]?.reason).toBe('blockedType')
  })
  it('sin archivos usa la imagen del portapapeles (PNG)', async () => {
    const r = await readPasteFiles(reader({}, Buffer.from([9, 9])), 'any', 'darwin')
    expect(r.files).toHaveLength(1)
    expect(r.files[0]).toMatchObject({ mime: 'image/png', size: 2 })
  })
  it('imagen enorme: rechazada; portapapeles vacío: nada', async () => {
    const big = await readPasteFiles(reader({}, Buffer.alloc(PASTE_MAX_FILE_BYTES + 1)), 'any', 'darwin')
    expect(big.files).toEqual([])
    expect(big.rejected[0]?.reason).toBe('tooBig')
    expect(await readPasteFiles(reader({}), 'any', 'darwin')).toEqual({ files: [], rejected: [] })
  })
  it('con archivos copiados no se usa la imagen (es el icono del archivo)', async () => {
    const r = await readPasteFiles(reader({ NSFilenamesPboardType: plist([p('nota.txt')]) }, Buffer.from([1])), 'any', 'darwin')
    expect(r.files.map((f) => f.name)).toEqual(['nota.txt'])
  })
})

describe('esquema y política remota', () => {
  it('esquema estricto: solo scope images|any', () => {
    const v = IPC_SCHEMAS['clipboard:readFilesForPaste']
    expect(v({ scope: 'any' })).toEqual({ scope: 'any' })
    expect(() => v({ scope: 'otro' })).toThrow()
    expect(() => v({ scope: 'any', ruta: '/etc/passwd' })).toThrow()
    expect(() => v({})).toThrow()
    expect(() => IPC_SCHEMAS['tasks:pasteFromClipboard']({ folder: 'relativa' })).toThrow()
  })
  it('el celular no puede usar ninguno de los dos canales (X)', () => {
    const ctx = { allowedDirs: ['/work'] }
    for (const [channel, payload] of [
      ['clipboard:readFilesForPaste', { scope: 'any' }],
      ['tasks:pasteFromClipboard', { folder: '/work' }]
    ] as const) {
      const d = decide({ kind: 'ipc', channel, payload }, ctx)
      expect('allow' in d && d.allow === false && d.reason).toBe('forbidden')
    }
  })
})
