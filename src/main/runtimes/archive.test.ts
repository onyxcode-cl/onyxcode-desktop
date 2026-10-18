import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, lstatSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { posixOnly } from '../../test/platform'
import { ArchiveError, extractArchive, safeSegments, type ExtractLimits } from './archive'

// ---- constructor mínimo de tar (ustar + pax) para las pruebas ----
interface TarEntry {
  name: string
  type?: string
  data?: Buffer | string
  mode?: number
  link?: string
  corruptSum?: boolean
}
function header(e: TarEntry, sizeOverride?: number): Buffer {
  const b = Buffer.alloc(512)
  const put = (s: string, off: number, len: number): void => void b.write(s.slice(0, len), off, 'latin1')
  const data = e.data === undefined ? Buffer.alloc(0) : Buffer.from(e.data)
  put(e.name.length > 100 ? e.name.slice(0, 100) : e.name, 0, 100)
  put((e.mode ?? 0o644).toString(8).padStart(7, '0') + '\0', 100, 8)
  put('0000000\0', 108, 8)
  put('0000000\0', 116, 8)
  put((sizeOverride ?? data.length).toString(8).padStart(11, '0') + '\0', 124, 12)
  put('00000000000\0', 136, 12)
  put('        ', 148, 8)
  put(e.type ?? '0', 156, 1)
  put(e.link ?? '', 157, 100)
  put('ustar\0', 257, 6)
  put('00', 263, 2)
  let sum = 0
  for (let i = 0; i < 512; i++) sum += b[i]!
  put((e.corruptSum ? sum + 7 : sum).toString(8).padStart(6, '0') + '\0 ', 148, 8)
  return b
}
const pad = (d: Buffer): Buffer => Buffer.concat([d, Buffer.alloc((512 - (d.length % 512)) % 512)])
function tar(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = []
  for (const e of entries) {
    const data = e.data === undefined ? Buffer.alloc(0) : Buffer.from(e.data)
    parts.push(header(e), pad(data))
  }
  parts.push(Buffer.alloc(1024))
  return Buffer.concat(parts)
}
function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`
  let len = body.length + 1
  while (String(len).length + body.length !== len) len = String(len).length + body.length
  return `${len}${body}`
}

let work: string
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'lzx-arch-'))
})
afterEach(() => rmSync(work, { recursive: true, force: true }))

const LIM: ExtractLimits = { strip: 1, into: '', unpackedMax: 10_000_000, maxEntries: 100 }
function writeTgz(entries: TarEntry[]): string {
  const f = join(work, 'a.tar.gz')
  writeFileSync(f, gzipSync(tar(entries)))
  return f
}
async function zipOf(files: Array<{ name: string; data?: string; dir?: boolean; mode?: number }>): Promise<string> {
  const z = new JSZip()
  for (const f of files) {
    const opts = { unixPermissions: f.mode, createFolders: false }
    if (f.dir) z.file(f.name, null, { ...opts, dir: true })
    else z.file(f.name, f.data ?? '', opts)
  }
  const out = join(work, 'a.zip')
  writeFileSync(out, await z.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }))
  return out
}
const dest = (): string => join(work, 'out')

describe('safeSegments', () => {
  it('limpia «.» y vacíos y rechaza lo peligroso', () => {
    expect(safeSegments('a//./b/c', 'tar')).toEqual(['a', 'b', 'c'])
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:/x', 'a\\b', 'a\0b'])
      expect(() => safeSegments(bad, 'tar')).toThrow(ArchiveError)
    expect(() => safeSegments('a/b:stream', 'zip')).toThrow(ArchiveError)
    expect(() => safeSegments('a/b:c', 'tar')).not.toThrow()
  })
})

describe('tar.gz', () => {
  it('extrae archivos y carpetas quitando la carpeta de primer nivel, y conserva el bit de ejecución', async () => {
    const f = writeTgz([
      { name: 'raiz/', type: '5' },
      { name: 'raiz/bin/', type: '5' },
      { name: 'raiz/bin/node', data: 'binario', mode: 0o755 },
      { name: 'raiz/lib/leeme.txt', data: 'hola', mode: 0o644 }
    ])
    const r = await extractArchive(f, 'tar.gz', dest(), LIM)
    expect(r.files).toBe(2)
    expect(readFileSync(join(dest(), 'bin/node'), 'utf8')).toBe('binario')
    expect(statSync(join(dest(), 'bin/node')).mode & 0o111).not.toBe(0)
    expect(statSync(join(dest(), 'lib/leeme.txt')).mode & 0o111).toBe(0)
  })
  it('`into` deja todo en una subcarpeta (uv va en bin/)', async () => {
    const f = writeTgz([{ name: 'uv-x/uv', data: 'u', mode: 0o755 }])
    await extractArchive(f, 'tar.gz', dest(), { ...LIM, into: 'bin' })
    expect(readFileSync(join(dest(), 'bin/uv'), 'utf8')).toBe('u')
  })
  it('entiende los nombres largos de las cabeceras pax', async () => {
    const long = 'raiz/' + 'carpeta-larga/'.repeat(12) + 'archivo.txt'
    const px = Buffer.from(paxRecord('path', long))
    const f = writeTgz([
      { name: 'PaxHeader', type: 'x', data: px },
      { name: 'corto', data: 'ok' }
    ])
    await extractArchive(f, 'tar.gz', dest(), LIM)
    expect(readFileSync(join(dest(), ...long.split('/').slice(1)), 'utf8')).toBe('ok')
  })
  it.skipIf(!posixOnly)('permite un enlace relativo que se queda dentro (como npm → npm-cli.js)', async () => {
    const f = writeTgz([
      { name: 'raiz/bin/', type: '5' },
      { name: 'raiz/lib/x.js', data: 'js' },
      { name: 'raiz/bin/npm', type: '2', link: '../lib/x.js' }
    ])
    await extractArchive(f, 'tar.gz', dest(), LIM)
    expect(readlinkSync(join(dest(), 'bin/npm'))).toBe('../lib/x.js')
    expect(readFileSync(join(dest(), 'bin/npm'), 'utf8')).toBe('js')
  })

  const rejects: Array<[string, TarEntry[], string]> = [
    ['ruta con ..', [{ name: 'raiz/../../fuera.txt', data: 'x' }], 'unsafe-path'],
    ['ruta absoluta', [{ name: '/tmp/fuera.txt', data: 'x' }], 'unsafe-path'],
    ['ruta con letra de unidad', [{ name: 'C:/fuera.txt', data: 'x' }], 'unsafe-path'],
    ['enlace que sale del destino', [{ name: 'raiz/mal', type: '2', link: '../../../etc/passwd' }], 'unsafe-link'],
    ['enlace con destino absoluto', [{ name: 'raiz/mal', type: '2', link: '/etc/passwd' }], 'unsafe-link'],
    ['enlace que sale por una subcarpeta', [{ name: 'raiz/a/b/mal', type: '2', link: '../../../fuera' }], 'unsafe-link'],
    [
      'enlace duro',
      [
        { name: 'raiz/a', data: 'x' },
        { name: 'raiz/dura', type: '1', link: 'raiz/a' }
      ],
      'unsupported-entry'
    ],
    ['dispositivo', [{ name: 'raiz/dev', type: '3' }], 'unsupported-entry'],
    ['FIFO', [{ name: 'raiz/fifo', type: '6' }], 'unsupported-entry'],
    ['suma de control mala', [{ name: 'raiz/a', data: 'x', corruptSum: true }], 'corrupt'],
    [
      'escritura a través de un enlace creado antes',
      [
        { name: 'raiz/dir/', type: '5' },
        { name: 'raiz/ln', type: '2', link: 'dir' },
        { name: 'raiz/ln/x.txt', data: 'x' }
      ],
      'unsafe-link'
    ]
  ]
  for (const [title, entries, code] of rejects)
    it.skipIf(!posixOnly)(`rechaza: ${title}`, async () => {
      const f = writeTgz(entries)
      await expect(extractArchive(f, 'tar.gz', dest(), LIM)).rejects.toMatchObject({ code })
      // Nada fuera del destino.
      expect(existsSync(join(work, 'fuera.txt'))).toBe(false)
      expect(existsSync('/tmp/fuera.txt')).toBe(false)
    })

  it('rechaza una bomba: más bytes de los que fija el pin', async () => {
    const f = writeTgz([{ name: 'raiz/a', data: Buffer.alloc(5000, 1) }])
    await expect(extractArchive(f, 'tar.gz', dest(), { ...LIM, unpackedMax: 1000 })).rejects.toMatchObject({ code: 'too-big' })
  })
  it('rechaza más entradas de las que fija el pin', async () => {
    const f = writeTgz(Array.from({ length: 10 }, (_, i) => ({ name: `raiz/f${i}`, data: 'x' })))
    await expect(extractArchive(f, 'tar.gz', dest(), { ...LIM, maxEntries: 5 })).rejects.toMatchObject({ code: 'too-many' })
  })
  it('rechaza un archivo truncado', async () => {
    const full = tar([{ name: 'raiz/a', data: Buffer.alloc(3000, 2) }])
    const f = join(work, 't.tar.gz')
    writeFileSync(f, gzipSync(full.subarray(0, 1500)))
    await expect(extractArchive(f, 'tar.gz', dest(), LIM)).rejects.toMatchObject({ code: 'corrupt' })
  })
  it('rechaza algo que ni es gzip', async () => {
    const f = join(work, 'x.tar.gz')
    writeFileSync(f, 'esto no es un archivo comprimido')
    await expect(extractArchive(f, 'tar.gz', dest(), LIM)).rejects.toBeInstanceOf(ArchiveError)
  })
  it('un tamaño declarado mayor que el contenido real se detecta (no lee más allá)', async () => {
    const b = header({ name: 'raiz/a' }, 4096)
    const f = join(work, 'y.tar.gz')
    writeFileSync(f, gzipSync(Buffer.concat([b, Buffer.alloc(512)])))
    await expect(extractArchive(f, 'tar.gz', dest(), LIM)).rejects.toMatchObject({ code: 'corrupt' })
  })
  it('no sobrescribe un archivo que ya existe (flag wx)', async () => {
    mkdirSync(dest(), { recursive: true })
    writeFileSync(join(dest(), 'a'), 'previo')
    const f = writeTgz([{ name: 'raiz/a', data: 'nuevo' }])
    await expect(extractArchive(f, 'tar.gz', dest(), LIM)).rejects.toBeInstanceOf(Error)
    expect(readFileSync(join(dest(), 'a'), 'utf8')).toBe('previo')
  })
  it('un setuid del original no sobrevive (0755 o 0644)', async () => {
    const f = writeTgz([{ name: 'raiz/s', data: 'x', mode: 0o4777 }])
    await extractArchive(f, 'tar.gz', dest(), LIM)
    expect(statSync(join(dest(), 's')).mode & 0o7000).toBe(0)
    expect(lstatSync(join(dest(), 's')).isFile()).toBe(true)
  })
})

describe('zip', () => {
  it('extrae con strip e into', async () => {
    const f = await zipOf([
      { name: 'raiz/', dir: true },
      { name: 'raiz/node.exe', data: 'exe' },
      { name: 'raiz/node_modules/npm/bin/npm-cli.js', data: 'js' }
    ])
    const r = await extractArchive(f, 'zip', dest(), LIM)
    expect(r.files).toBe(2)
    expect(readFileSync(join(dest(), 'node.exe'), 'utf8')).toBe('exe')
    expect(readFileSync(join(dest(), 'node_modules/npm/bin/npm-cli.js'), 'utf8')).toBe('js')
    const g = await zipOf([{ name: 'uv.exe', data: 'u' }])
    await extractArchive(g, 'zip', join(work, 'out2'), { ...LIM, strip: 0, into: 'bin' })
    expect(readFileSync(join(work, 'out2/bin/uv.exe'), 'utf8')).toBe('u')
  })
  const bad: Array<[string, Array<{ name: string; data?: string; mode?: number }>, string]> = [
    ['ruta con ..', [{ name: 'raiz/../../fuera.txt', data: 'x' }], 'unsafe-path'],
    ['ruta absoluta', [{ name: '/fuera.txt', data: 'x' }], 'unsafe-path'],
    ['flujo de datos alternativo de NTFS', [{ name: 'raiz/a.txt:malo', data: 'x' }], 'unsafe-path'],
    ['letra de unidad', [{ name: 'C:/fuera.txt', data: 'x' }], 'unsafe-path'],
    ['enlace simbólico', [{ name: 'raiz/ln', data: '../../etc', mode: 0o120777 }], 'unsafe-link']
  ]
  for (const [title, files, code] of bad)
    it(`rechaza: ${title}`, async () => {
      const f = await zipOf(files)
      await expect(extractArchive(f, 'zip', dest(), LIM)).rejects.toMatchObject({ code })
      expect(existsSync(join(work, 'fuera.txt'))).toBe(false)
    })
  it('rechaza una bomba (tamaño declarado mayor que el presupuesto) antes de descomprimir', async () => {
    const f = await zipOf([{ name: 'raiz/a', data: 'x'.repeat(5000) }])
    await expect(extractArchive(f, 'zip', dest(), { ...LIM, unpackedMax: 1000 })).rejects.toMatchObject({ code: 'too-big' })
  })
  it('rechaza más entradas de las permitidas', async () => {
    const f = await zipOf(Array.from({ length: 10 }, (_, i) => ({ name: `raiz/f${i}`, data: 'x' })))
    await expect(extractArchive(f, 'zip', dest(), { ...LIM, maxEntries: 5 })).rejects.toMatchObject({ code: 'too-many' })
  })
  it('rechaza un zip ilegible', async () => {
    const f = join(work, 'mal.zip')
    writeFileSync(f, 'no soy un zip')
    await expect(extractArchive(f, 'zip', dest(), LIM)).rejects.toMatchObject({ code: 'corrupt' })
  })
})
