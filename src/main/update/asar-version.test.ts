import { describe, expect, it } from 'vitest'
import { AsarVersionError, readAsarPackageInfo, verifyAsarVersion } from './asar-version'
import { bufferSource } from './zip-index'

interface AsarFile {
  path: string
  content: string
}

/** Construye un asar mínimo con el formato real (pickle de cabecera + datos), sin dependencias. */
function makeAsar(files: AsarFile[], tweak?: (header: Record<string, unknown>) => void): Buffer {
  const tree: Record<string, unknown> = {}
  const data: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const parts = f.path.split('/')
    let dir = tree
    for (const d of parts.slice(0, -1)) {
      const node = (dir[d] ??= { files: {} }) as { files: Record<string, unknown> }
      dir = node.files
    }
    const buf = Buffer.from(f.content, 'utf8')
    dir[parts[parts.length - 1]] = { size: buf.length, offset: String(offset) }
    data.push(buf)
    offset += buf.length
  }
  const header: Record<string, unknown> = { files: tree }
  tweak?.(header)
  const json = Buffer.from(JSON.stringify(header), 'utf8')
  const padded = Math.ceil(json.length / 4) * 4
  const head = Buffer.alloc(16 + padded - json.length + json.length)
  head.writeUInt32LE(4, 0)
  head.writeUInt32LE(8 + padded, 4) // tamaño del pickle de cabecera (payload)
  head.writeUInt32LE(4 + padded, 8) // payload del pickle JSON
  head.writeUInt32LE(json.length, 12)
  json.copy(head, 16)
  return Buffer.concat([head, ...data])
}

const pkg = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ name: 'lazunox', version: '0.5.1', main: 'out/main/index.js', ...over })
const asar = (over?: Record<string, unknown>): Buffer =>
  makeAsar([
    { path: 'out/main/index.js', content: 'console.log(1)' },
    { path: 'package.json', content: pkg(over) },
    { path: 'out/renderer/index.html', content: '<html></html>' }
  ])

describe('readAsarPackageInfo', () => {
  it('lee name y version del package.json de la raíz', async () => {
    expect(await readAsarPackageInfo(bufferSource(asar()))).toEqual({ name: 'lazunox', version: '0.5.1' })
  })

  it('funciona aunque package.json sea el primero o el único fichero', async () => {
    const solo = makeAsar([{ path: 'package.json', content: pkg() }])
    expect((await readAsarPackageInfo(bufferSource(solo))).version).toBe('0.5.1')
  })

  it('con longitudes de JSON que no son múltiplo de 4 (relleno del pickle)', async () => {
    for (let n = 0; n < 5; n++) {
      const a = makeAsar([{ path: 'package.json', content: pkg({ pad: 'x'.repeat(n) }) }])
      expect((await readAsarPackageInfo(bufferSource(a))).name).toBe('lazunox')
    }
  })

  it('ignora un package.json de una subcarpeta', async () => {
    const a = makeAsar([{ path: 'node_modules/x/package.json', content: pkg({ name: 'x' }) }])
    await expect(readAsarPackageInfo(bufferSource(a))).rejects.toMatchObject({ code: 'missing' })
  })

  it('rechaza lo que no es un asar', async () => {
    await expect(readAsarPackageInfo(bufferSource(Buffer.from('no es un asar')))).rejects.toBeInstanceOf(AsarVersionError)
    await expect(readAsarPackageInfo(bufferSource(Buffer.alloc(4)))).rejects.toMatchObject({ code: 'format' })
    const bad = asar()
    bad.writeUInt32LE(7, 0)
    await expect(readAsarPackageInfo(bufferSource(bad))).rejects.toMatchObject({ code: 'format' })
  })

  it('rechaza una cabecera que se sale del fichero o un asar truncado', async () => {
    const a = asar()
    const huge = Buffer.from(a)
    huge.writeUInt32LE(0x7fffffff, 4)
    await expect(readAsarPackageInfo(bufferSource(huge))).rejects.toMatchObject({ code: 'format' })
    await expect(readAsarPackageInfo(bufferSource(a.subarray(0, a.length - 20)))).rejects.toMatchObject({ code: 'format' })
  })

  it('rechaza package.json sin desempaquetar, con offset raro o tamaño absurdo', async () => {
    const un = makeAsar([{ path: 'package.json', content: pkg() }], (h) => {
      ;(h.files as Record<string, Record<string, unknown>>)['package.json'].unpacked = true
    })
    await expect(readAsarPackageInfo(bufferSource(un))).rejects.toMatchObject({ code: 'unsupported' })
    const off = makeAsar([{ path: 'package.json', content: pkg() }], (h) => {
      ;(h.files as Record<string, Record<string, unknown>>)['package.json'].offset = '-5'
    })
    await expect(readAsarPackageInfo(bufferSource(off))).rejects.toMatchObject({ code: 'format' })
    const big = makeAsar([{ path: 'package.json', content: pkg() }], (h) => {
      ;(h.files as Record<string, Record<string, unknown>>)['package.json'].size = 10 * 1024 * 1024
    })
    await expect(readAsarPackageInfo(bufferSource(big))).rejects.toMatchObject({ code: 'format' })
  })

  it('rechaza package.json inválido o sin name/version', async () => {
    await expect(readAsarPackageInfo(bufferSource(makeAsar([{ path: 'package.json', content: '{no json' }])))).rejects.toMatchObject({
      code: 'invalid'
    })
    await expect(
      readAsarPackageInfo(bufferSource(makeAsar([{ path: 'package.json', content: '{"name":"lazunox"}' }])))
    ).rejects.toMatchObject({
      code: 'invalid'
    })
  })

  it('no sigue claves heredadas del prototipo', async () => {
    const a = makeAsar([{ path: 'x', content: 'y' }], (h) => {
      h.files = JSON.parse('{"__proto__":{"package.json":{"size":1,"offset":"0"}}}')
    })
    await expect(readAsarPackageInfo(bufferSource(a))).rejects.toMatchObject({ code: 'missing' })
  })
})

describe('verifyAsarVersion', () => {
  it('acepta name lazunox y la versión esperada', async () => {
    expect(await verifyAsarVersion(bufferSource(asar()), '0.5.1')).toEqual({ ok: true, version: '0.5.1' })
  })
  it('rechaza otra versión', async () => {
    expect(await verifyAsarVersion(bufferSource(asar()), '0.6.0')).toMatchObject({ ok: false, reason: expect.stringContaining('versión') })
  })
  it('rechaza otro nombre', async () => {
    expect(await verifyAsarVersion(bufferSource(asar({ name: 'otra-app' })), '0.5.1')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('nombre')
    })
  })
  it('un asar roto devuelve el motivo en vez de lanzar', async () => {
    expect(await verifyAsarVersion(bufferSource(Buffer.alloc(100)), '0.5.1')).toMatchObject({ ok: false })
  })
})
