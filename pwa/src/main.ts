import lightCss from './style.css?inline'
import { SlowTracker } from '../../src/shared/remote/link'
import { RemoteClient } from './client'
import { loadFullApp, makeLink, prefetchFullApp, type FullState } from './full'
import { lang } from './i18n'
import { codeFromHash } from '../../src/shared/remote/cloud'
import { watchInstall } from './install'
import { isCloudMode } from './mode'
import { followTheme, hostCss } from './theme'
import { mountUi } from './ui'

document.documentElement.lang = lang

/** Modo nube: HTTPS en el sitio del servicio de conexión (la vinculación entra por un código; el vínculo vive en IndexedDB). */
const cloud = isCloudMode(location.origin, window.isSecureContext)

/**
 * Extrae del fragmento el secreto del QR (`#s=…`, red local) o el código de vinculación (`#c=…`, modo nube) y lo borra de la barra
 * de direcciones (no queda en el historial). El fragmento nunca se envía a ningún servidor.
 */
function takeSecret(): { secret: string | null; code: string | null } {
  const m = /^#s=([A-Za-z0-9_-]{43})$/.exec(location.hash)
  const code = cloud ? codeFromHash(location.hash) : null
  if (location.hash) {
    try {
      history.replaceState(null, '', location.pathname)
    } catch {
      /* nada */
    }
  }
  return { secret: m && !cloud ? m[1] : null, code }
}

const first = takeSecret()
const client = new RemoteClient({ cloud })
if (cloud) {
  watchInstall()
  registerWorker(client)
}

/** Service worker del sitio (solo modo nube): caché versionada, nunca toca `/v1/*`. Una versión nueva se avisa, no se impone. */
function registerWorker(c: RemoteClient): void {
  if (!('serviceWorker' in navigator)) return
  try {
    const hadController = !!navigator.serviceWorker.controller
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) c.notice('toast.update')
    })
    void navigator.serviceWorker.register('./sw.js').catch(() => undefined)
  } catch {
    /* sin service worker la página funciona igual */
  }
}
const host = document.getElementById('app')
if (host) {
  // La interfaz ligera (vinculación, PIN, estado de la conexión, respaldo) vive en un shadow root: sus estilos globales no
  // tocan a la interfaz completa que se carga después, ni al revés.
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = hostCss(lightCss)
  const root = document.createElement('div')
  root.id = 'app'
  shadow.append(style, root)
  followTheme(host)

  let full: FullState = 'none'
  let waiting = 0
  let ui: { refresh(): void } | null = null
  const tracker = new SlowTracker((n) => {
    waiting = n
    ui?.refresh()
  })
  const link = makeLink(client, tracker)
  ui = mountUi(root, client, {
    full: () => full,
    waiting: () => waiting,
    onMode: (mode) => {
      host.dataset.mode = mode
      // Con la capa ligera tapando, la interfaz completa no recibe toques ni lectores de pantalla.
      const app = document.getElementById('root')
      if (app) app.toggleAttribute('inert', mode === 'cover')
    }
  })
  // Mientras se vincula, se conecta o se pide el PIN, se precarga la interfaz completa (solo descarga; no se ejecuta).
  let prefetched = false
  // Tras autenticar (acceso abierto) se baja la interfaz completa; antes solo existe esta capa ligera.
  client.subscribe((s) => {
    if (!cloud && !prefetched && (s.conn.k === 'connecting' || s.conn.k === 'pairing' || s.conn.k === 'locked' || s.conn.k === 'online')) {
      prefetched = true
      prefetchFullApp()
    }
    if (s.conn.k !== 'online' || full !== 'none') return
    full = 'loading'
    client.lightData = false
    ui?.refresh()
    // Nube: la interfaz se carga con los hashes que manda el Mac (su versión). Sin ellos (Mac anterior) no se carga a ciegas.
    const load = cloud
      ? client.hasCap('entry')
        ? client.waitEntry(10_000).then((e) => (e ? loadFullApp(link, e) : false))
        : Promise.resolve(false)
      : loadFullApp(link)
    void load.then((ok) => {
      full = ok ? 'ready' : 'failed'
      if (!ok) {
        client.lightData = true
        void client.refreshAll()
      }
      ui?.refresh()
    })
  })
  if (first.code) client.startWithCode(first.code)
  else client.start(first.secret)
  // Un QR nuevo escaneado con la página ya abierta solo cambia el fragmento (no recarga).
  window.addEventListener('hashchange', () => {
    const next = takeSecret()
    if (next.code) client.startWithCode(next.code)
    else if (next.secret) client.start(next.secret)
  })
  // Al volver de segundo plano o recuperar la red, se comprueba/rehace la conexión.
  // `hiddenAt` queda disponible para `client.wake()` (reconexión inmediata si estuvo oculta mucho rato).
  let hiddenAt = 0
  const wake = (awayMs = 0): void => (client.wake as (away?: number) => void).call(client, awayMs)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now()
    else {
      const away = hiddenAt ? Date.now() - hiddenAt : 0
      hiddenAt = 0
      wake(away)
    }
  })
  window.addEventListener('online', () => wake())
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) wake()
  })
}
