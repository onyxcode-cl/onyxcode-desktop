/**
 * `FetchLike` de producción para la descarga de `cloudflared`: `net.request` de Electron con `redirect: 'manual'`.
 *
 * Por qué no `net.fetch(url, { redirect: 'manual' })`: en Electron LANZA «Redirect was cancelled» ante cualquier redirección (medido
 * con Electron 44 real; GitHub redirige la release a `release-assets.githubusercontent.com`), así que la descarga fallaba al instante.
 * `net.request` con `redirect: 'manual'` emite el evento `redirect` y espera a que se decida; aquí SIEMPRE se aborta la petición y se
 * devuelve la redirección como una `Response` 3xx con su `Location`: quien llama (`CloudflaredBinary.download`) valida cada salto
 * (lista cerrada de hosts, https, sin puerto ni credenciales) y pide el siguiente. Nunca se sigue una redirección sin validar.
 *
 * Respeta el proxy del sistema (es la pila de red de Chromium). Sin cookies ni credenciales (`credentials: 'omit'` equivalente: sesión
 * por defecto, pero se pide `useSessionCookies: false`).
 */
import type { FetchLike } from './binary'

interface ResponseLike {
  statusCode: number
  headers: Record<string, string | string[]>
  on(event: 'data', cb: (chunk: Buffer) => void): unknown
  on(event: 'end' | 'aborted', cb: () => void): unknown
  on(event: 'error', cb: (err: Error) => void): unknown
}

/** Subconjunto de `ClientRequest` de Electron que se usa (inyectable en pruebas). */
export interface RequestLike {
  on(event: 'response', cb: (res: ResponseLike) => void): unknown
  on(event: 'redirect', cb: (statusCode: number, method: string, redirectUrl: string, headers: Record<string, string[]>) => void): unknown
  on(event: 'error', cb: (err: Error) => void): unknown
  on(event: 'abort', cb: () => void): unknown
  end(): void
  abort(): void
}

export interface NetLike {
  request(opts: { url: string; method: 'GET'; redirect: 'manual'; useSessionCookies?: boolean }): RequestLike
}

const headerValue = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

export function createManualFetch(net: NetLike): FetchLike {
  return (url, init) =>
    new Promise<Response>((resolve, reject) => {
      let settled = false
      const req = net.request({ url, method: 'GET', redirect: 'manual', useSessionCookies: false })
      const done = (fn: () => void): void => {
        if (settled) return
        settled = true
        init.signal?.removeEventListener('abort', onAbort)
        fn()
      }
      const onAbort = (): void => {
        try {
          req.abort()
        } catch {
          /* ya cerrada */
        }
        done(() => reject(new Error('aborted')))
      }
      if (init.signal?.aborted) return onAbort()
      init.signal?.addEventListener('abort', onAbort, { once: true })
      req.on('redirect', (statusCode, _method, redirectUrl, headers) => {
        // No se sigue: se devuelve el salto para que lo valide quien llama.
        const loc = redirectUrl || headerValue(headers?.location)
        try {
          req.abort()
        } catch {
          /* ya cerrada */
        }
        done(() =>
          resolve(
            new Response(null, { status: statusCode >= 300 && statusCode < 400 ? statusCode : 302, headers: loc ? { location: loc } : {} })
          )
        )
      })
      req.on('error', (err) => done(() => reject(err)))
      req.on('abort', () => done(() => reject(new Error('aborted'))))
      req.on('response', (res) => {
        let controller: ReadableStreamDefaultController<Uint8Array> | null = null
        let finished = false
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c
          },
          cancel() {
            finished = true
            try {
              req.abort()
            } catch {
              /* ya cerrada */
            }
          }
        })
        res.on('data', (chunk) => {
          if (!finished) controller?.enqueue(new Uint8Array(chunk))
        })
        res.on('end', () => {
          if (finished) return
          finished = true
          controller?.close()
        })
        const fail = (err: Error): void => {
          if (finished) return
          finished = true
          controller?.error(err)
        }
        res.on('error', fail)
        res.on('aborted', () => fail(new Error('aborted')))
        const headers = new Headers()
        for (const [k, v] of Object.entries(res.headers)) {
          const val = headerValue(v)
          if (val !== null) headers.set(k, val)
        }
        const status = res.statusCode
        // Una redirección que llegara como respuesta (sin evento `redirect`) tampoco se sigue: sin cuerpo.
        done(() => resolve(new Response(status >= 300 && status < 400 ? null : body, { status, headers })))
      })
      req.end()
    })
}
