import './style.css'
import { RemoteClient } from './client'
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
const root = document.getElementById('app')
if (root) {
  mountUi(root, client)
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
