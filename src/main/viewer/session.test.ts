/**
 * Contención de red de la sesión del visor: nada que no sea el propio esquema `lazunox-viewer:`
 * sale de la vista. Esto es lo que detiene a un PDF "hostil" (acción `/URI`, `/Launch`, una imagen
 * de Word enlazada a `http://…`): aunque el documento intente una petición, `webRequest` la cancela
 * antes de que salga. Mismo patrón de mock que `embedded-browser/session.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (details: { url: string }, cb: (r: { cancel: boolean }) => void) => void
const state = vi.hoisted(() => ({
  listener: null as Listener | null,
  reqH: null as null | ((...a: any[]) => void),
  chkH: null as null | ((...a: any[]) => boolean),
  downloadPrevented: false
}))

vi.mock('electron', () => ({
  session: {
    fromPartition: () => ({
      webRequest: { onBeforeRequest: (l: Listener) => (state.listener = l) },
      setPermissionRequestHandler: (h: (...a: unknown[]) => void) => (state.reqH = h),
      setPermissionCheckHandler: (h: (...a: unknown[]) => boolean) => (state.chkH = h),
      on: (event: string, cb: (e: { preventDefault: () => void }) => void) => {
        if (event === 'will-download') cb({ preventDefault: () => (state.downloadPrevented = true) })
      }
    })
  }
}))

import { VIEWER_SCHEME } from '../security/app-protocol'

function cancelFor(url: string): boolean {
  let cancelled: boolean | null = null
  state.listener!({ url }, (r) => (cancelled = r.cancel))
  expect(cancelled).not.toBeNull()
  return cancelled === true
}

describe('viewerSession', () => {
  // `viewerSession()` guarda la sesión en una variable de módulo (solo se configura una vez por
  // proceso); se resetea el módulo en cada test para que `session.fromPartition` se vuelva a
  // invocar de verdad y los mocks (`on('will-download', …)`, etc.) corran de nuevo.
  beforeEach(async () => {
    state.downloadPrevented = false
    vi.resetModules()
    const { viewerSession } = await import('./session')
    viewerSession()
  })

  it('deja pasar el propio esquema del visor (documento y estáticos)', () => {
    expect(cancelFor(`${VIEWER_SCHEME}://viewer/doc/${'a'.repeat(64)}`)).toBe(false)
    expect(cancelFor(`${VIEWER_SCHEME}://viewer/assets/index.js`)).toBe(false)
  })

  it('cancela cualquier otro destino: http(s), file, un esquema con el mismo prefijo pero distinto', () => {
    expect(cancelFor('http://evil.example/leak')).toBe(true)
    expect(cancelFor('https://evil.example/leak')).toBe(true)
    expect(cancelFor('file:///etc/passwd')).toBe(true)
    expect(cancelFor(`${VIEWER_SCHEME}evil://viewer/doc/x`)).toBe(true)
  })

  it('niega todo permiso y bloquea la descarga', () => {
    expect(state.reqH).not.toBeNull()
    let granted: boolean | null = null
    state.reqH!({}, 'clipboard-sanitized-write', (g: boolean) => (granted = g))
    expect(granted).toBe(false)
    expect(state.chkH!()).toBe(false)
    expect(state.downloadPrevented).toBe(true)
  })

  it('configura la sesión una sola vez (misma partición reutilizada)', async () => {
    const before = state.listener
    const { viewerSession } = await import('./session')
    viewerSession()
    expect(state.listener).toBe(before)
  })
})
