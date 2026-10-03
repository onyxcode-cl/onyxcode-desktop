/**
 * Carga de la interfaz completa. El arranque ligero (este código) vincula, autentica y pide PIN/confirmación; solo cuando el
 * Mac da acceso (`online`) se descarga la interfaz React (`app/entry.json` → JS + CSS con hash) y se le entrega el enlace con
 * el Mac (`globalThis.__onyxLink`). Si no se puede cargar, se queda la interfaz ligera (lista de conversaciones) como respaldo.
 */
import { SlowTracker, type LinkStatus, type RemoteLink } from '../../src/shared/remote/link'
import type { RemoteClient } from './client'

export type FullState = 'none' | 'loading' | 'ready' | 'failed'

const ENTRY_JS = /^assets\/[A-Za-z0-9._-]{1,120}\.js$/
const ENTRY_CSS = /^assets\/[A-Za-z0-9._-]{1,120}\.css$/
/** Si la interfaz no avisa que pintó en este tiempo, se vuelve a la ligera. */
const MOUNT_TIMEOUT_MS = 25_000

export function linkStatus(k: RemoteClient['state']['conn']['k']): LinkStatus {
  switch (k) {
    case 'online':
      return 'online'
    case 'locked':
      return 'locked'
    case 'reconnecting':
      return 'reconnecting'
    case 'connecting':
    case 'pairing':
      return 'connecting'
    default:
      return 'offline'
  }
}

/** El enlace que ven los shims del renderer, sobre el multiplexor de la conexión actual (cambia al reconectar). */
export function makeLink(client: RemoteClient, tracker: SlowTracker): RemoteLink {
  return {
    status: () => linkStatus(client.state.conn.k),
    onStatus(fn) {
      let last = linkStatus(client.state.conn.k)
      return client.subscribe((s) => {
        const next = linkStatus(s.conn.k)
        if (next === last) return
        last = next
        fn(next)
      })
    },
    call: (ch, p, signal) => tracker.track(client.muxCall(ch, p, signal)),
    http: (req, signal) => tracker.track(client.muxHttp(req, signal)),
    subscribe: (eng, h, since) => client.muxSubscribe(eng, h, since),
    lock: () => client.lockNow(),
    forget: () => {
      client.forget()
      location.reload()
    }
  }
}

interface Entry {
  js: string
  css: string[]
}

async function readEntry(): Promise<Entry | null> {
  const res = await fetch('./app/entry.json', { cache: 'no-store' })
  if (!res.ok) return null
  const o = (await res.json()) as { js?: unknown; css?: unknown }
  if (typeof o.js !== 'string' || !ENTRY_JS.test(o.js)) return null
  const css = Array.isArray(o.css) ? o.css.filter((x): x is string => typeof x === 'string' && ENTRY_CSS.test(x)) : []
  return { js: o.js, css }
}

/**
 * Descarga y arranca la interfaz completa. Resuelve `true` cuando ella avisa que pintó (`__onyxAppMounted`) y `false` si no se
 * pudo cargar (sin `app/`, error de red, tiempo agotado): en ese caso quien llama deja la interfaz ligera.
 */
export function loadFullApp(link: RemoteLink): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false
    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), MOUNT_TIMEOUT_MS)
    const g = globalThis as { __onyxLink?: RemoteLink; __onyxAppMounted?: () => void }
    g.__onyxLink = link
    g.__onyxAppMounted = () => finish(true)
    void readEntry()
      .then((entry) => {
        if (!entry) return finish(false)
        for (const href of entry.css) {
          const l = document.createElement('link')
          l.rel = 'stylesheet'
          l.href = `./app/${href}`
          document.head.append(l)
        }
        const s = document.createElement('script')
        s.type = 'module'
        s.src = `./app/${entry.js}`
        s.onerror = () => finish(false)
        document.head.append(s)
      })
      .catch(() => finish(false))
  })
}
