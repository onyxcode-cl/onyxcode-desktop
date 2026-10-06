import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildManifest, encodeLzpk, LZPK_MAGIC, LZPK_MAX_TOTAL, LzpkError, sha256Hex, type LzpkInputFile } from './wsl-payload'

const b = (s: string): Uint8Array => Buffer.from(s)
const base = (): LzpkInputFile[] => [
  { path: 'launcher.py', data: b('print(1)\n') },
  { path: 'bin/opencode', data: b('tgz-bytes') }
]
const reason = (fn: () => unknown): string | undefined => {
  try {
    fn()
  } catch (e) {
    return e instanceof LzpkError ? e.reason : `otro:${String(e)}`
  }
  return undefined
}

describe('LZPK1: codificador', () => {
  it('estructura: magia, longitud BE, manifiesto y cuerpos en orden de ruta', () => {
    const r = encodeLzpk(base())
    expect(r.buffer.subarray(0, 6).toString('latin1')).toBe(LZPK_MAGIC)
    const n = r.buffer.readUInt32BE(6)
    const manifest = JSON.parse(r.buffer.subarray(10, 10 + n).toString('utf8'))
    expect(manifest.v).toBe(1)
    expect(manifest.files.map((f: { path: string }) => f.path)).toEqual(['bin/opencode', 'launcher.py'])
    expect(r.buffer.subarray(10 + n).toString()).toBe('tgz-bytesprint(1)\n')
    expect(r.buffer.length).toBe(10 + n + 9 + 9)
  })
  it('sha por archivo, modos y tipos; payloadSha = sha256 del manifiesto', () => {
    const r = encodeLzpk([...base(), { path: 'mux.py', data: b('x') }])
    const by = Object.fromEntries(r.manifest.files.map((f) => [f.path, f]))
    expect(by['launcher.py']).toMatchObject({ size: 9, mode: 0o755, kind: 'file', sha256: sha256Hex(b('print(1)\n')) })
    expect(by['mux.py']).toMatchObject({ mode: 0o644, kind: 'file' })
    expect(by['bin/opencode']).toMatchObject({ mode: 0o755, kind: 'opencode-tgz', sha256: sha256Hex(b('tgz-bytes')) })
    const n = r.buffer.readUInt32BE(6)
    expect(r.payloadSha).toBe(sha256Hex(r.buffer.subarray(10, 10 + n)))
  })
  it('determinista e independiente del orden de entrada', () => {
    const a = encodeLzpk(base())
    const c = encodeLzpk([...base()].reverse())
    expect(c.buffer.equals(a.buffer)).toBe(true)
    expect(c.payloadSha).toBe(a.payloadSha)
  })
  it('rechaza rutas fuera de la lista cerrada', () => {
    for (const p of [
      '../launcher.py',
      '/launcher.py',
      'sub/x.py',
      'bin/other',
      'Launcher.py',
      'a b.py',
      'x.sh',
      'bin/opencode/x',
      'x.py\n',
      ''
    ]) {
      expect(
        reason(() => encodeLzpk([...base(), { path: p, data: b('x') }])),
        JSON.stringify(p)
      ).toBe('bad-path')
    }
  })
  it('rechaza duplicados, vacíos, faltantes y exceso de tamaño o de archivos', () => {
    expect(reason(() => encodeLzpk([...base(), { path: 'launcher.py', data: b('y') }]))).toBe('duplicate')
    expect(reason(() => encodeLzpk([{ path: 'launcher.py', data: b('') }, base()[1]!]))).toBe('empty')
    expect(reason(() => encodeLzpk([base()[0]!]))).toBe('missing')
    expect(reason(() => encodeLzpk([base()[1]!]))).toBe('missing')
    const big = { byteLength: LZPK_MAX_TOTAL + 1 } as unknown as Uint8Array
    expect(reason(() => buildManifest([{ path: 'launcher.py', data: big }, base()[1]!]))).toBe('too-large')
    const many = Array.from({ length: 17 }, (_, i) => ({ path: `m${i}.py`, data: b('x') }))
    expect(reason(() => encodeLzpk([...base(), ...many]))).toBe('too-many')
  })
})

describe('LZPK1: vectores compartidos con el instalador de Python (resources/wsl/payload-vectors.json)', () => {
  const file = join(process.cwd(), 'resources/wsl/payload-vectors.json')
  type Case = { name: string; files: { path: string; dataHex: string }[]; payloadHex?: string; payloadSha?: string }
  const vectors = JSON.parse(readFileSync(file, 'utf8')) as { cases: Case[] }
  // Regenerar a propósito: LZPK_WRITE_VECTORS=1 npx vitest run src/main/tasks/backends/wsl-payload.test.ts
  if (process.env.LZPK_WRITE_VECTORS === '1') {
    for (const c of vectors.cases) {
      const r = encodeLzpk(c.files.map((f) => ({ path: f.path, data: Buffer.from(f.dataHex, 'hex') })))
      c.payloadHex = r.buffer.toString('hex')
      c.payloadSha = r.payloadSha
    }
    writeFileSync(file, JSON.stringify(vectors, null, 1) + '\n')
  }
  it('cada caso codifica exactamente a los bytes y al payloadSha del vector', () => {
    expect(vectors.cases.length).toBeGreaterThan(1)
    for (const c of vectors.cases) {
      const r = encodeLzpk(c.files.map((f) => ({ path: f.path, data: Buffer.from(f.dataHex, 'hex') })))
      expect(r.buffer.toString('hex'), c.name).toBe(c.payloadHex)
      expect(r.payloadSha, c.name).toBe(c.payloadSha)
    }
  })
})
