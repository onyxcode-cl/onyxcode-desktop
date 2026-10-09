/**
 * `installViewerScheme`: revalida la ruta con `assertPath` al SERVIR (no solo al abrir), nunca
 * confía en el token guardado a ciegas; solo GET; 404 limpio en cualquier caso raro. Se mockea
 * `electron` para capturar el handler que `protocol.handle` recibiría de verdad, y se lo llama
 * directo con un `Request`/`Response` reales (globals de Node), sin levantar Electron.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
import { installViewerScheme, registerViewerPathValidator } from './scheme'
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
  dir = mkdtempSync(join(tmpdir(), 'lzx-viewer-scheme-'))
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
