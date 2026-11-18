/**
 * `installViewerScheme`: revalida la ruta con `assertPath` al SERVIR (no solo al abrir), nunca
 * confía en el token guardado a ciegas; solo GET; 404 limpio en cualquier caso raro. Se mockea
 * `electron` para capturar el handler que `protocol.handle` recibiría de verdad, y se lo llama
 * directo con un `Request`/`Response` reales (globals de Node), sin levantar Electron.
 */
import { mkdtempSync, rmSync, writeFileSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type SchemeHandler = (request: Request) => Promise<Response>
const state = vi.hoisted(() => ({ handler: null as SchemeHandler | null, oversizedPath: null as string | null }))

vi.mock('electron', () => ({
  session: {
    fromPartition: () => ({
      protocol: {
        handle: (_scheme: string, fn: SchemeHandler) => {
          state.handler = fn
        }
      },
      webRequest: { onBeforeRequest: () => undefined },
      setPermissionRequestHandler: () => undefined,
      setPermissionCheckHandler: () => undefined,
      on: () => undefined
    })
  }
}))

// Solo el tamaño reportado se falsea (para no escribir un archivo de 100 MB en el test); todo lo
// demás (lectura real de bytes, etc.) sigue siendo el módulo real.
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    stat: async (path: string) => {
      const info = await real.stat(path)
      if (path === state.oversizedPath) return { ...info, size: Number.MAX_SAFE_INTEGER }
      return info
    }
  }
})

import { VIEWER_SCHEME } from '../security/app-protocol'
import { installViewerScheme, registerViewerPathValidator, VIEWER_CSP } from './scheme'
import { issueToken, revokeActive } from './tokens'

let dir: string
let file: string
// `installViewerScheme` solo puede instalarse una vez por sesión (igual que en producción), así que
// se registra un solo validador para todo el archivo y se cambia este `ref` para simular que
// `assertPath` (la revalidación de carpeta) empieza a fallar a mitad de la vida del proceso.
let assertRef: (path: string) => string = (p) => p

beforeAll(() => {
  registerViewerPathValidator((p) => assertRef(p))
  installViewerScheme()
})

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-viewer-scheme-')))
  file = join(dir, 'a.pdf')
  writeFileSync(file, '%PDF-1.4 contenido de prueba')
  revokeActive()
  state.oversizedPath = null
  assertRef = (p) => p
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function handler(): SchemeHandler {
  if (!state.handler) throw new Error('el handler no se instaló')
  return state.handler
}

const req = (path: string, method = 'GET'): Request => new Request(`${VIEWER_SCHEME}://viewer${path}`, { method })

describe('installViewerScheme: /doc/<token>', () => {
  it('con un token válido, sirve los bytes con el content-type del tipo y sin caché', async () => {
    const token = issueToken({ path: file, kind: 'pdf' })
    const res = await handler()(req(`/doc/${token}`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await res.text()).toContain('contenido de prueba')
  })

  it('token inventado o ya revocado: 404', async () => {
    const h = handler()
    expect((await h(req(`/doc/${'a'.repeat(64)}`))).status).toBe(404)
    const token = issueToken({ path: file, kind: 'pdf' })
    revokeActive()
    expect((await h(req(`/doc/${token}`))).status).toBe(404)
  })

  it('la carpeta ya no se puede validar al servir (aunque el token sea válido): 404', async () => {
    const token = issueToken({ path: file, kind: 'pdf' })
    assertRef = () => {
      throw new Error('no aprobada')
    }
    const res = await handler()(req(`/doc/${token}`))
    expect(res.status).toBe(404)
  })

  it('el archivo pesa más que el tope del tipo: 413', async () => {
    state.oversizedPath = file
    const token = issueToken({ path: file, kind: 'pdf' })
    const res = await handler()(req(`/doc/${token}`))
    expect(res.status).toBe(413)
  })

  it('método distinto de GET: 404', async () => {
    const token = issueToken({ path: file, kind: 'pdf' })
    const res = await handler()(req(`/doc/${token}`, 'POST'))
    expect(res.status).toBe(404)
  })

  it('host distinto de "viewer": 404', async () => {
    const h = handler()
    const res = await h(new Request(`${VIEWER_SCHEME}://otro/doc/${'a'.repeat(64)}`))
    expect(res.status).toBe(404)
  })
})

describe('installViewerScheme: estáticos del propio visor', () => {
  it('una ruta con ".." no puede salir de la raíz: 404', async () => {
    const res = await handler()(req('/../../../etc/passwd'))
    expect(res.status).toBe(404)
  })
})

describe('MP4 por streaming', () => {
  function video(): { token: string; bytes: Buffer } {
    file = join(dir, 'promo.mp4')
    const bytes = Buffer.alloc(4096, 42)
    bytes.writeUInt32BE(32, 0)
    bytes.write('ftypisom', 4)
    writeFileSync(file, bytes)
    return { token: issueToken({ path: file, kind: 'mp4' }), bytes }
  }
  const rangeReq = (token: string, range?: string): Request =>
    new Request(`${VIEWER_SCHEME}://viewer/doc/${token}`, { headers: range ? { Range: range } : {} })
  it.each([
    ['bytes=0-31', 0, 31],
    ['bytes=1024-2047', 1024, 2047],
    ['bytes=4000-', 4000, 4095],
    ['bytes=-16', 4080, 4095]
  ])('sirve exactamente %s', async (range, start, end) => {
    const { token, bytes } = video()
    const res = await handler()(rangeReq(token, range))
    expect(res.status).toBe(206)
    expect(res.headers.get('content-type')).toBe('video/mp4')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('content-range')).toBe(`bytes ${start}-${end}/4096`)
    expect(res.headers.get('content-length')).toBe(String(end - start + 1))
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes.subarray(start, end + 1))
  })
  it.each(['bytes=9000-', 'bytes=20-10', 'bytes=-0', 'bytes=0-1,4-5', 'bytes=a-b', 'bytes=9007199254740992-'])(
    'rechaza %s',
    async (range) => {
      const { token } = video()
      const res = await handler()(rangeReq(token, range))
      expect(res.status).toBe(416)
      expect(res.headers.get('content-range')).toBe('bytes */4096')
    }
  )
  it('MP4 por encima de 500 MB: 413 antes de leer el flujo', async () => {
    const { token } = video()
    state.oversizedPath = file
    expect((await handler()(rangeReq(token, 'bytes=0-31'))).status).toBe(413)
  })
  it('sin rango sirve el flujo completo; cancelarlo no deja el descriptor abierto', async () => {
    const { token, bytes } = video()
    const res = await handler()(rangeReq(token))
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes)
    const cancelled = await handler()(rangeReq(token))
    await cancelled.body!.cancel()
  })
  it('revalida carpeta y token en cada salto', async () => {
    const { token } = video()
    await (await handler()(rangeReq(token, 'bytes=0-31'))).arrayBuffer()
    assertRef = () => {
      throw new Error('fuera de carpeta permitida')
    }
    expect((await handler()(rangeReq(token, 'bytes=32-63'))).status).toBe(404)
    assertRef = (p) => p
    revokeActive()
    expect((await handler()(rangeReq(token, 'bytes=32-63'))).status).toBe(404)
  })
  it('rechaza extensión falsa, truncado y reemplazo por enlace', async () => {
    const { token } = video()
    writeFileSync(file, '%PDF-1.4 falso')
    expect((await handler()(rangeReq(token))).status).toBe(404)
    writeFileSync(file, Buffer.from('0000ftyp'))
    expect((await handler()(rangeReq(token))).status).toBe(404)
    const other = join(dir, 'otro.mp4')
    writeFileSync(other, Buffer.alloc(32))
    rmSync(file)
    symlinkSync(other, file)
    expect((await handler()(rangeReq(token))).status).toBe(404)
    rmSync(file)
    expect((await handler()(rangeReq(token))).status).toBe(404)
  })
  it('la CSP de cabecera y del HTML abre media solo al origen del visor', async () => {
    const { readFileSync } = await import('node:fs')
    const html = readFileSync(join(__dirname, '../../viewer/index.html'), 'utf8')
    expect(VIEWER_CSP).toContain('media-src lazunox-viewer://viewer;')
    expect(html).toContain('media-src lazunox-viewer://viewer;')
    expect(VIEWER_CSP).not.toMatch(/media-src[^;]*(blob:|data:|https?:|\*)/)
    expect(VIEWER_CSP).toContain("frame-src 'none'")
    const { token } = video()
    const res = await handler()(rangeReq(token, 'bytes=0-31'))
    expect(res.headers.get('content-security-policy')).toBe(VIEWER_CSP)
    await res.arrayBuffer()
  })
})
