import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FetchLike } from '../../remote/tunnel/binary'
import { pinnedDownload, PinnedDownloadError, type PinnedDownloadErrorCode } from './pinned-download'

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const BODY = Buffer.from('contenido-de-prueba-'.repeat(500))
const URL0 = 'https://github.com/o/r/releases/download/v1/img.tar.gz'
const CDN = 'https://release-assets.githubusercontent.com/x/img.tar.gz'

type Handler = (url: string, signal?: AbortSignal) => Response | Promise<Response>

/** Servidor simulado: tabla url -> respuesta (sin red real). */
function server(routes: Record<string, Handler>, hits: string[] = []): FetchLike {
  return async (url, init) => {
    hits.push(url)
    const h = routes[url]
    if (!h) throw new Error('ECONNREFUSED')
    return h(url, init.signal)
  }
}
const ok =
  (b: Buffer = BODY, chunk = 700): Handler =>
  () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          for (let i = 0; i < b.length; i += chunk) c.enqueue(new Uint8Array(b.subarray(i, i + chunk)))
          c.close()
        }
      }),
      { status: 200 }
    )
const redirect =
  (to: string): Handler =>
  () =>
    new Response(null, { status: 302, headers: { location: to } })

let dir: string
let dest: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pinned-dl-'))
  dest = join(dir, 'rootfs.tar.gz')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const base = (f: FetchLike, extra: object = {}) => ({ fetch: f, size: BODY.length, sha256: sha(BODY), ...extra })
async function code(p: Promise<unknown>): Promise<PinnedDownloadErrorCode | 'no-error'> {
  try {
    await p
    return 'no-error'
  } catch (e) {
    return e instanceof PinnedDownloadError ? e.code : ('other' as never)
  }
}

describe('pinnedDownload', () => {
  it('descarga con redirección válida, renombra y reporta progreso', async () => {
    const progress: number[] = []
    const r = await pinnedDownload(
      URL0,
      dest,
      base(server({ [URL0]: redirect(CDN), [CDN]: ok() }), { onBytes: (d: number) => progress.push(d) })
    )
    expect(r.cached).toBe(false)
    expect(readFileSync(dest).equals(BODY)).toBe(true)
    expect(existsSync(`${dest}.part`)).toBe(false)
    expect(progress.at(-1)).toBe(BODY.length)
    expect(progress.length).toBeGreaterThan(1)
  })

  it('rechaza una redirección a un host fuera de la lista (y no la pide)', async () => {
    const hits: string[] = []
    const evil = 'https://evil.example.com/img.tar.gz'
    const c = await code(pinnedDownload(URL0, dest, base(server({ [URL0]: redirect(evil), [evil]: ok() }, hits))))
    expect(c).toBe('bad-host')
    expect(hits).toEqual([URL0])
    expect(existsSync(dest)).toBe(false)
  })

  it('rechaza http, en la URL inicial y en una redirección', async () => {
    const hits: string[] = []
    expect(await code(pinnedDownload('http://github.com/a', dest, base(server({}, hits))))).toBe('bad-url')
    const httpUrl = 'http://objects.githubusercontent.com/a'
    expect(await code(pinnedDownload(URL0, dest, base(server({ [URL0]: redirect(httpUrl) }, hits))))).toBe('bad-url')
    expect(hits).toEqual([URL0])
  })

  it('rechaza puerto y credenciales en la URL', async () => {
    const f = server({})
    expect(await code(pinnedDownload('https://github.com:8443/a', dest, base(f)))).toBe('bad-url')
    expect(await code(pinnedDownload('https://user:pw@github.com/a', dest, base(f)))).toBe('bad-url')
    expect(await code(pinnedDownload('https://user@github.com/a', dest, base(f)))).toBe('bad-url')
    const viaRedirect = 'https://github.com:444/a'
    expect(await code(pinnedDownload(URL0, dest, base(server({ [URL0]: redirect(viaRedirect) }))))).toBe('bad-url')
    const cred = 'https://u:p@objects.githubusercontent.com/a'
    expect(await code(pinnedDownload(URL0, dest, base(server({ [URL0]: redirect(cred) }))))).toBe('bad-url')
  })

  it('corta las redirecciones en bucle', async () => {
    const c = await code(pinnedDownload(URL0, dest, base(server({ [URL0]: redirect(URL0) }))))
    expect(c).toBe('too-many-redirects')
  })

  it('bytes de más: error y sin .part', async () => {
    const more = Buffer.concat([BODY, Buffer.from('x')])
    expect(await code(pinnedDownload(URL0, dest, base(server({ [URL0]: ok(more) }))))).toBe('too-big')
    expect(existsSync(`${dest}.part`)).toBe(false)
    expect(existsSync(dest)).toBe(false)
  })

  it('content-length mayor al tope: se corta antes de leer', async () => {
    const h: Handler = () => new Response(BODY, { status: 200, headers: { 'content-length': String(BODY.length + 1) } })
    expect(await code(pinnedDownload(URL0, dest, base(server({ [URL0]: h }))))).toBe('too-big')
  })

  it('bytes de menos: error y sin .part', async () => {
    const less = BODY.subarray(0, BODY.length - 1)
    expect(await code(pinnedDownload(URL0, dest, base(server({ [URL0]: ok(Buffer.from(less)) }))))).toBe('bad-size')
    expect(existsSync(`${dest}.part`)).toBe(false)
    expect(existsSync(dest)).toBe(false)
  })

  it('sha incorrecto: borra el .part y no deja destino', async () => {
    const other = Buffer.from(BODY)
    other[0] ^= 0xff
    expect(await code(pinnedDownload(URL0, dest, base(server({ [URL0]: ok(other) }))))).toBe('bad-hash')
    expect(existsSync(`${dest}.part`)).toBe(false)
    expect(existsSync(dest)).toBe(false)
  })

  it('estado HTTP distinto de 200 y sin red', async () => {
    const h404: Handler = () => new Response('no', { status: 404 })
    expect(await code(pinnedDownload(URL0, dest, base(server({ [URL0]: h404 }))))).toBe('http')
    expect(await code(pinnedDownload(URL0, dest, base(server({}))))).toBe('offline')
  })

  it('F8-B198: disco lleno al escribir (ENOSPC) → «disk», no «offline», y sin .part', async () => {
    const enospc = (): never => {
      throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })
    }
    expect(await code(pinnedDownload(URL0, dest, base(server({ [URL0]: ok() }), { onBytes: enospc })))).toBe('disk')
    expect(existsSync(`${dest}.part`)).toBe(false)
  })
  it('F8-B198: sin permiso de escritura (EACCES) → «permission»', async () => {
    const eacces = (): never => {
      throw Object.assign(new Error('EACCES: permission denied, write'), { code: 'EACCES' })
    }
    expect(await code(pinnedDownload(URL0, dest, base(server({ [URL0]: ok() }), { onBytes: eacces })))).toBe('permission')
  })
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'F8-B198: carpeta de destino de solo lectura (EACCES real al abrir el .part) → «permission»',
    async () => {
      chmodSync(dir, 0o500)
      try {
        expect(await code(pinnedDownload(URL0, dest, base(server({ [URL0]: ok() }))))).toBe('permission')
      } finally {
        chmodSync(dir, 0o700)
      }
    }
  )
  it('cancelación por AbortSignal a mitad de flujo borra el .part', async () => {
    const ac = new AbortController()
    const h: Handler = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new Uint8Array(BODY.subarray(0, 100)))
            // no cierra: queda esperando
          }
        }),
        { status: 200 }
      )
    const p = pinnedDownload(URL0, dest, base(server({ [URL0]: h }), { signal: ac.signal, onBytes: () => ac.abort() }))
    expect(await code(p)).toBe('aborted')
    expect(existsSync(`${dest}.part`)).toBe(false)
    expect(existsSync(dest)).toBe(false)
  })

  it('cancelación previa: no hace ninguna petición', async () => {
    const hits: string[] = []
    const ac = new AbortController()
    ac.abort()
    expect(await code(pinnedDownload(URL0, dest, base(server({ [URL0]: ok() }, hits), { signal: ac.signal })))).toBe('aborted')
    expect(hits).toEqual([])
  })

  it('cancelación durante la petición (fetch rechaza)', async () => {
    const ac = new AbortController()
    const h: Handler = (_u, s) =>
      new Promise<Response>((_res, rej) => {
        s?.addEventListener('abort', () => rej(new Error('aborted')))
        ac.abort()
      })
    expect(await code(pinnedDownload(URL0, dest, base(server({ [URL0]: h }), { signal: ac.signal })))).toBe('aborted')
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('caché válida: no hay red', async () => {
    writeFileSync(dest, BODY)
    const hits: string[] = []
    const r = await pinnedDownload(URL0, dest, base(server({}, hits)))
    expect(r.cached).toBe(true)
    expect(hits).toEqual([])
  })

  it('caché con sha distinto: se vuelve a descargar y reemplaza', async () => {
    const bad = Buffer.from(BODY)
    bad[5] ^= 1
    writeFileSync(dest, bad)
    const r = await pinnedDownload(URL0, dest, base(server({ [URL0]: ok() })))
    expect(r.cached).toBe(false)
    expect(readFileSync(dest).equals(BODY)).toBe(true)
  })

  it('un .part viejo se sobrescribe', async () => {
    writeFileSync(`${dest}.part`, 'basura')
    await pinnedDownload(URL0, dest, base(server({ [URL0]: ok() })))
    expect(readFileSync(dest).equals(BODY)).toBe(true)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('parámetros de huella inválidos', async () => {
    expect(await code(pinnedDownload(URL0, dest, { fetch: server({}), size: 10, sha256: 'xyz' }))).toBe('bad-url')
  })
})
