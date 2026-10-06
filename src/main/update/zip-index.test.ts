import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkZipEntriesWin } from '@shared/update-install'
import { ZipIndexError, bufferSource, fileSource, readZipIndex } from './zip-index'

interface FixtureEntry {
  name: string
  data?: string
  /** Tamaño descomprimido declarado (por defecto, el de los datos). */
  declaredSize?: number
  unixMode?: number
  winAttr?: number
  flags?: number
  zip64?: boolean
}

interface FixtureOpts {
  comment?: string
  zip64Eocd?: boolean
  breakCenSig?: boolean
}

/** ZIP con método «stored»: lo justo para probar el lector del directorio central. */
function makeZip(entries: FixtureEntry[], opts: FixtureOpts = {}): Buffer {
  const parts: Buffer[] = []
  const cen: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const data = Buffer.from(e.data ?? '', 'utf8')
    const flags = (e.flags ?? 0) | 0x800
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(flags, 6)
    lh.writeUInt32LE(data.length, 18)
    lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(name.length, 26)
    parts.push(lh, name, data)
    const usize = e.declaredSize ?? data.length
    let extra = Buffer.alloc(0)
    if (e.zip64) {
      extra = Buffer.alloc(4 + 16)
      extra.writeUInt16LE(0x0001, 0)
      extra.writeUInt16LE(16, 2)
      extra.writeBigUInt64LE(BigInt(usize), 4)
      extra.writeBigUInt64LE(BigInt(data.length), 12)
    }
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(opts.breakCenSig ? 0xdeadbeef : 0x02014b50, 0)
    const host = e.unixMode !== undefined ? 3 : 10
    ch.writeUInt16LE((host << 8) | 45, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(flags, 8)
    ch.writeUInt32LE(e.zip64 ? 0xffffffff : data.length, 20)
    ch.writeUInt32LE(e.zip64 ? 0xffffffff : usize, 24)
    ch.writeUInt16LE(name.length, 28)
    ch.writeUInt16LE(extra.length, 30)
    ch.writeUInt32LE((((e.unixMode ?? 0) << 16) | (e.winAttr ?? 0)) >>> 0, 38)
    ch.writeUInt32LE(offset, 42)
    cen.push(ch, name, extra)
    offset += 30 + name.length + data.length
  }
  const cenBuf = Buffer.concat(cen)
  const comment = Buffer.from(opts.comment ?? '')
  const tail: Buffer[] = []
  const cenOffset = offset
  let eocd64At = 0
  if (opts.zip64Eocd) {
    eocd64At = cenOffset + cenBuf.length
    const e64 = Buffer.alloc(56)
    e64.writeUInt32LE(0x06064b50, 0)
    e64.writeBigUInt64LE(44n, 4)
    e64.writeUInt16LE(45, 12)
    e64.writeUInt16LE(45, 14)
    e64.writeBigUInt64LE(BigInt(entries.length), 24)
    e64.writeBigUInt64LE(BigInt(entries.length), 32)
    e64.writeBigUInt64LE(BigInt(cenBuf.length), 40)
    e64.writeBigUInt64LE(BigInt(cenOffset), 48)
    const loc = Buffer.alloc(20)
    loc.writeUInt32LE(0x07064b50, 0)
    loc.writeBigUInt64LE(BigInt(eocd64At), 8)
    loc.writeUInt32LE(1, 16)
    tail.push(e64, loc)
  }
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(opts.zip64Eocd ? 0xffff : entries.length, 8)
  eocd.writeUInt16LE(opts.zip64Eocd ? 0xffff : entries.length, 10)
  eocd.writeUInt32LE(opts.zip64Eocd ? 0xffffffff : cenBuf.length, 12)
  eocd.writeUInt32LE(opts.zip64Eocd ? 0xffffffff : cenOffset, 16)
  eocd.writeUInt16LE(comment.length, 20)
  return Buffer.concat([...parts, cenBuf, ...tail, eocd, comment])
}

const idx = (zip: Buffer, o?: Parameters<typeof readZipIndex>[1]) => readZipIndex(bufferSource(zip), o)

describe('readZipIndex', () => {
  it('lee nombres, tamaños y tipo de cada entrada', async () => {
    const zip = makeZip([
      { name: 'Lazunox/' },
      { name: 'Lazunox/Lazunox.exe', data: 'MZ-binario' },
      { name: 'Lazunox/resources/' },
      { name: 'Lazunox/resources/ñandú.txt', data: 'hola' }
    ])
    const r = await idx(zip)
    expect(r.entries.map((e) => e.name)).toEqual(['Lazunox/', 'Lazunox/Lazunox.exe', 'Lazunox/resources/', 'Lazunox/resources/ñandú.txt'])
    expect(r.entries.map((e) => e.isDirectory)).toEqual([true, false, true, false])
    expect(r.entries[1]).toMatchObject({ size: 10, compressedSize: 10, isSymlink: false })
    expect(r.totalUncompressed).toBe(14)
    expect(checkZipEntriesWin(r.entries)).toEqual({ ok: true })
  })

  it('con comentario final largo encuentra el EOCD', async () => {
    const r = await idx(makeZip([{ name: 'Lazunox/a', data: 'x' }], { comment: 'c'.repeat(60000) }))
    expect(r.entries).toHaveLength(1)
  })

  it('un comentario que imita un EOCD no engaña', async () => {
    const fake = Buffer.alloc(22)
    fake.writeUInt32LE(0x06054b50, 0)
    const r = await idx(makeZip([{ name: 'Lazunox/a' }, { name: 'Lazunox/b' }], { comment: `${fake.toString('latin1')}zz` }))
    expect(r.entries.map((e) => e.name)).toEqual(['Lazunox/a', 'Lazunox/b'])
  })

  it('detecta symlinks Unix (S_IFLNK) y puntos de reanálisis de Windows', async () => {
    const r = await idx(
      makeZip([
        { name: 'Lazunox/lnk', unixMode: 0o120777 },
        { name: 'Lazunox/file', unixMode: 0o100644 },
        { name: 'Lazunox/junction', winAttr: 0x400 },
        { name: 'Lazunox/normal', winAttr: 0x20 }
      ])
    )
    expect(r.entries.map((e) => e.isSymlink)).toEqual([true, false, true, false])
    expect(checkZipEntriesWin(r.entries)).toMatchObject({ ok: false, reason: 'symlink' })
  })

  it('soporta ZIP64 (campo extra y EOCD64)', async () => {
    const r = await idx(
      makeZip([{ name: 'Lazunox/grande.bin', data: 'abc', declaredSize: 5_000_000_000, zip64: true }], { zip64Eocd: true })
    )
    expect(r.entries[0]).toMatchObject({ name: 'Lazunox/grande.bin', size: 5_000_000_000, compressedSize: 3 })
    expect(r.totalUncompressed).toBe(5_000_000_000)
  })

  it('rechaza cuando la suma descomprimida pasa del límite (ZIP bomba)', async () => {
    const zip = makeZip([
      { name: 'Lazunox/a', data: 'x', declaredSize: 600 },
      { name: 'Lazunox/b', data: 'x', declaredSize: 600 }
    ])
    await expect(idx(zip, { maxUncompressed: 1199 })).rejects.toMatchObject({ code: 'too-big' })
    await expect(idx(zip, { maxUncompressed: 1200 })).resolves.toMatchObject({ totalUncompressed: 1200 })
  })

  it('rechaza demasiadas entradas', async () => {
    const zip = makeZip([{ name: 'Lazunox/a' }, { name: 'Lazunox/b' }, { name: 'Lazunox/c' }])
    await expect(idx(zip, { maxEntries: 2 })).rejects.toMatchObject({ code: 'too-many' })
  })

  it('rechaza entradas cifradas', async () => {
    await expect(idx(makeZip([{ name: 'Lazunox/a', flags: 1 }]))).rejects.toMatchObject({ code: 'encrypted' })
  })

  it('rechaza basura, ZIP truncado y directorio central corrupto', async () => {
    await expect(idx(Buffer.from('esto no es un zip, ni de lejos'))).rejects.toBeInstanceOf(ZipIndexError)
    await expect(idx(Buffer.alloc(5))).rejects.toMatchObject({ code: 'format' })
    const zip = makeZip([{ name: 'Lazunox/a', data: 'hola' }])
    await expect(idx(zip.subarray(0, zip.length - 10))).rejects.toMatchObject({ code: 'format' })
    await expect(idx(makeZip([{ name: 'Lazunox/a' }], { breakCenSig: true }))).rejects.toMatchObject({ code: 'format' })
  })

  it('un offset del directorio central fuera del fichero se rechaza', async () => {
    const zip = makeZip([{ name: 'Lazunox/a' }])
    zip.writeUInt32LE(0x7fffff00, zip.length - 22 + 16)
    await expect(idx(zip)).rejects.toMatchObject({ code: 'format' })
  })

  it('un directorio central con bytes sobrantes se rechaza', async () => {
    const zip = makeZip([{ name: 'Lazunox/a' }, { name: 'Lazunox/b' }])
    zip.writeUInt16LE(1, zip.length - 22 + 8)
    zip.writeUInt16LE(1, zip.length - 22 + 10)
    await expect(idx(zip)).rejects.toMatchObject({ code: 'format' })
  })

  it('lee desde un fichero en disco', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lazunox-zipidx-'))
    try {
      const file = join(dir, 't.zip')
      writeFileSync(file, makeZip([{ name: 'Lazunox/' }, { name: 'Lazunox/x.txt', data: '12345' }]))
      const src = await fileSource(file)
      try {
        const r = await readZipIndex(src)
        expect(r.entries.map((e) => e.name)).toEqual(['Lazunox/', 'Lazunox/x.txt'])
        expect(r.totalUncompressed).toBe(5)
      } finally {
        await src.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
