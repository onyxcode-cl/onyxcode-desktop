import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OfficeError, downloadVerified, parseTeamId, toOfficeError, type FetchLike } from './download'

const BYTES = Buffer.from('contenido-simulado-del-instalador'.repeat(50))
const SHA = createHash('sha256').update(BYTES).digest('hex')
const URL0 = 'https://github.com/example/releases/download/v1/x.zip'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dl-test-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const okFetch =
  (bytes: Buffer = BYTES, headers: Record<string, string> = {}): FetchLike =>
  async () =>
    new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-length': String(bytes.length), ...headers } })

describe('descarga verificada', () => {
  it('sigue redirecciones https hasta el espejo', async () => {
    let n = 0
    const f: FetchLike = async (url) => {
      n++
      return n === 1
        ? new Response(null, { status: 302, headers: { location: 'https://espejo.example/pub/x.zip' } })
        : (expect(url).toBe('https://espejo.example/pub/x.zip'), okFetch()(url, { redirect: 'manual' }))
    }
    const dest = join(dir, 'a.zip')
    await downloadVerified(f, URL0, dest, { size: BYTES.length, sha256: SHA }, () => undefined)
    expect(readFileSync(dest).equals(BYTES)).toBe(true)
  })
  it('rechaza una redirección a http', async () => {
    const f: FetchLike = async () => new Response(null, { status: 302, headers: { location: 'http://espejo.example/x.zip' } })
    await expect(downloadVerified(f, URL0, join(dir, 'a'), { size: 1, sha256: SHA }, () => undefined)).rejects.toMatchObject({
      code: 'download'
    })
  })
  it('F8-B198: sin red → «offline»; cancelar → «cancelled»', async () => {
    const down: FetchLike = async () => {
      throw new TypeError('fetch failed')
    }
    await expect(downloadVerified(down, URL0, join(dir, 'a'), { size: 1, sha256: SHA }, () => undefined)).rejects.toMatchObject({
      code: 'offline'
    })
    const ac = new AbortController()
    ac.abort()
    const aborted: FetchLike = async () => {
      throw new DOMException('abortado', 'AbortError')
    }
    await expect(
      downloadVerified(aborted, URL0, join(dir, 'a'), { size: 1, sha256: SHA }, () => undefined, ac.signal)
    ).rejects.toMatchObject({ code: 'cancelled' })
  })
  it('F8-B198: toOfficeError separa disco lleno, falta de permiso y lo demás', () => {
    const e = (code: string): Error => Object.assign(new Error(code), { code })
    expect(toOfficeError(e('ENOSPC')).code).toBe('disk')
    expect(toOfficeError(e('EACCES')).code).toBe('permission')
    expect(toOfficeError(e('EPERM')).code).toBe('permission')
    expect(toOfficeError(e('EROFS')).code).toBe('permission')
    expect(toOfficeError(new Error('otra cosa')).code).toBe('copy')
    const own = new OfficeError('hash', 'x')
    expect(toOfficeError(own)).toBe(own)
  })
  it('rechaza hash distinto, tamaño distinto y descarga más larga que lo declarado, y no deja archivos', async () => {
    const dest = join(dir, 'b.zip')
    const tampered = Buffer.from(BYTES)
    tampered[3] ^= 0xff
    await expect(
      downloadVerified(okFetch(tampered), 'https://x/y', dest, { size: BYTES.length, sha256: SHA }, () => undefined)
    ).rejects.toMatchObject({ code: 'hash' })
    expect(existsSync(dest)).toBe(false)
    await expect(
      downloadVerified(okFetch(BYTES.subarray(0, 100)), 'https://x/y', dest, { size: BYTES.length, sha256: SHA }, () => undefined)
    ).rejects.toMatchObject({ code: 'size' })
    expect(existsSync(dest)).toBe(false)
    const long = Buffer.concat([BYTES, Buffer.from('extra')])
    await expect(
      downloadVerified(
        okFetch(long, { 'content-length': String(BYTES.length) }),
        'https://x/y',
        dest,
        { size: BYTES.length, sha256: SHA },
        () => undefined
      )
    ).rejects.toMatchObject({ code: 'size' })
  })
  it('cancelar la descarga lo deja todo limpio', async () => {
    const ac = new AbortController()
    ac.abort()
    const f: FetchLike = async (_u, init) => {
      if (init.signal?.aborted) throw new Error('aborted')
      return okFetch()('', init)
    }
    await expect(
      downloadVerified(f, URL0, join(dir, 'c.zip'), { size: BYTES.length, sha256: SHA }, () => undefined, ac.signal)
    ).rejects.toMatchObject({ code: 'cancelled' })
  })
})

describe('utilidades', () => {
  it('lee el equipo de codesign -dvv', () => {
    expect(parseTeamId('Authority=X\nTeamIdentifier=ABCDE12345\n')).toBe('ABCDE12345')
    expect(parseTeamId('TeamIdentifier=not set')).toBeNull()
  })
})
