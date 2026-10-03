import lightCss from './style.css?inline'
import { SlowTracker } from '../../src/shared/remote/link'
import { RemoteClient } from './client'
import { loadFullApp, makeLink, type FullState } from './full'
import { lang } from './i18n'
import { mountUi } from './ui'

document.documentElement.lang = lang

/** Extrae el secreto del QR del fragmento `#s=…` y lo borra de la barra de direcciones (no queda en el historial). */
function takeSecret(): string | null {
  const m = /^#s=([A-Za-z0-9_-]{43})$/.exec(location.hash)
  if (location.hash) {
    try {
      history.replaceState(null, '', location.pathname)
    } catch {
      /* nada */
    }
  }
  return m ? m[1] : null
}

const secret = takeSecret()
const client = new RemoteClient()
const host = document.getElementById('app')
if (host) {
  // La interfaz ligera (vinculación, PIN, estado de la conexión, respaldo) vive en un shadow root: sus estilos globales no
  // tocan a la interfaz completa que se carga después, ni al revés.
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = lightCss.replace(/:root/g, ':host')
  const root = document.createElement('div')
  root.id = 'app'
  shadow.append(style, root)

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
  // Tras autenticar (acceso abierto) se baja la interfaz completa; antes solo existe esta capa ligera.
  client.subscribe((s) => {
    if (s.conn.k !== 'online' || full !== 'none') return
    full = 'loading'
    client.lightData = false
    ui?.refresh()
    void loadFullApp(link).then((ok) => {
      full = ok ? 'ready' : 'failed'
      if (!ok) {
        client.lightData = true
        void client.refreshAll()
      }
      ui?.refresh()
    })
  })
  client.start(secret)
  // Un QR nuevo escaneado con la página ya abierta solo cambia el fragmento (no recarga).
  window.addEventListener('hashchange', () => {
    const next = takeSecret()
    if (next) client.start(next)
  })
  // Al volver de segundo plano o recuperar la red, se comprueba/rehace la conexión.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') client.wake()
  })
  window.addEventListener('online', () => client.wake())
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) client.wake()
  })
}
