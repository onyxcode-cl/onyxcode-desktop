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

export interface Entry {
  js: string
  css: string[]
  /** JS que se puede precargar (entrada, dependencias estáticas y el trozo `boot`); `entry.json` v2. */
  preload: string[]
  /** CSS del trozo `boot`, para pedirlo sin esperar a que se evalúe. */
  bootCss: string[]
}

const onlyPaths = (v: unknown, re: RegExp): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && re.test(x)) : []

/** Valida `entry.json` (v1 sin `preload`, o v2): solo rutas `assets/*.js|css`, nada que salga de ahí. */
export function parseEntry(o: unknown): Entry | null {
  if (typeof o !== 'object' || o === null) return null
  const e = o as { js?: unknown; css?: unknown; preload?: unknown; bootCss?: unknown }
  if (typeof e.js !== 'string' || !ENTRY_JS.test(e.js)) return null
  return { js: e.js, css: onlyPaths(e.css, ENTRY_CSS), preload: onlyPaths(e.preload, ENTRY_JS), bootCss: onlyPaths(e.bootCss, ENTRY_CSS) }
}

/** Una sola lectura de `entry.json` por carga de página (la comparten la precarga y `loadFullApp`). */
let entryPromise: Promise<Entry | null> | null = null

function readEntry(): Promise<Entry | null> {
  entryPromise ??= fetch('./app/entry.json', { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .then(parseEntry)
    .catch(() => null)
    .then((e) => {
      // Un fallo no se recuerda: un reintento vuelve a pedirlo.
      if (!e) entryPromise = null
      return e
    })
  return entryPromise
}

/** Solo para pruebas. */
export function resetEntryCache(): void {
  entryPromise = null
}

function addLink(rel: string, href: string, as?: string): void {
  const url = `./app/${href}`
  if (document.head.querySelector(`link[rel="${rel}"][href="${url}"]`)) return
  const l = document.createElement('link')
  l.rel = rel
  l.href = url
  if (as) l.setAttribute('as', as)
  document.head.append(l)
}

/**
 * Precarga la interfaz completa (descarga y compilación) mientras se hace el apretón de manos y se escribe el PIN. No ejecuta
 * nada: `modulepreload` solo baja y compila, y `main.tsx` no arranca hasta `loadFullApp`. En navegadores sin soporte se ignora.
 */
export function prefetchFullApp(): void {
  void readEntry().then((entry) => {
    if (!entry) return
    for (const js of new Set([entry.js, ...entry.preload])) addLink('modulepreload', js)
    for (const css of new Set([...entry.css, ...entry.bootCss])) addLink('preload', css, 'style')
  })
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
        // Los CSS (también los del trozo `boot`) se piden ya como hojas de estilo, sin esperar a que `boot` se evalúe.
        for (const href of new Set([...entry.css, ...entry.bootCss])) addLink('stylesheet', href)
        const s = document.createElement('script')
        s.type = 'module'
        s.src = `./app/${entry.js}`
        s.onerror = () => finish(false)
        document.head.append(s)
      })
      .catch(() => finish(false))
  })
}
