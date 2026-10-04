// Capa ligera de la PWA (vinculación, PIN, estados de conexión) con un cliente de mentira: solo para capturas.
// Escenarios (?s=): vinculacion (código de emparejado a comparar) · bloqueo (pide el PIN).
import lightCss from '../../pwa/src/style.css?inline'
import { mountUi } from '../../pwa/src/ui'
import type { Snapshot, RemoteClient } from '../../pwa/src/client'

const s = new URLSearchParams(location.search).get('s') ?? 'bloqueo'
const conn: Snapshot['conn'] =
  s === 'vinculacion' ? { k: 'pairing', code: '428613', pending: false } : { k: 'locked', why: 'pin-verify', left: 4 }

const snap: Snapshot = { conn, sessions: null, permissions: [], chat: null, toast: null, paired: s !== 'vinculacion' }
const noop = (): void => undefined
const client = new Proxy(
  { state: snap, subscribe: () => noop },
  { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : noop) }
) as unknown as RemoteClient

const host = document.getElementById('app') as HTMLElement
const shadow = host.attachShadow({ mode: 'open' })
const style = document.createElement('style')
style.textContent = lightCss.replace(/:root/g, ':host')
const root = document.createElement('div')
root.id = 'app'
shadow.append(style, root)
mountUi(root, client)
document.documentElement.dataset.ready = '1'
