/**
 * Sesiones del navegador integrado (Lote D, B.2 «Sesión»/«Identidad»/«Permisos»/«Red»/«Descargas»):
 * primer contenido web ARBITRARIO de la app. Dos particiones persistentes, separadas entre sí y de
 * la `defaultSession` de `onyxcode://app`: `persist:onyxcode-web-code` y `persist:onyxcode-web-cowork`.
 *
 * `isEmbeddedBrowserSession` es la exención exacta de `web-security.ts` (B.3): compara la
 * IDENTIDAD del objeto `Session` (nunca una cadena), y solo la llenan las dos líneas de abajo.
 */
import { app, session, type Session } from 'electron'
import { APP_NAME } from '@shared/brand'
import type { BrowserProduct } from '@shared/ipc-browser'
import { isLocalOriginApproved } from './store'
import { handleWillDownload } from './downloads'

const PARTITION_BY_PRODUCT: Record<BrowserProduct, string> = {
  code: 'persist:onyxcode-web-code',
  cowork: 'persist:onyxcode-web-cowork'
}

/** Identidad de objeto: NUNCA comparar por nombre de partición (B.3). */
const embeddedSessions = new Set<Session>()

/** `web-security.ts` llama a esto para exentar la superficie del navegador de su endurecimiento. */
export function isEmbeddedBrowserSession(s: Session): boolean {
  return embeddedSessions.has(s)
}

/** Exportado: `service.ts` la reutiliza para reconocer un destino "local" al pedir aprobación. */
export function isLoopbackOrPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.local')) return true
  if (h === '::1' || h === '[::1]') return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a === 127) return true // 127.0.0.0/8
  if (a === 10) return true // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 169 && b === 254) return true // 169.254.0.0/16 (link-local)
  return false
}

/**
 * Origen `host:puerto` del frame de nivel superior de la petición, o `null` si no se puede
 * resolver (petición huérfana, webContents destruido…). El formato coincide con `localOrigins`
 * (`store.ts`): `localhost:PUERTO`, `127.0.0.1:PUERTO` o `[::1]:PUERTO`.
 */
function topLevelOrigin(details: Electron.OnBeforeRequestListenerDetails): string | null {
  try {
    const wc = details.webContents
    if (!wc || wc.isDestroyed()) return null
    const u = new URL(wc.getURL())
    const port = u.port || (u.protocol === 'https:' ? '443' : '80')
    const host = u.hostname === '::1' ? '[::1]' : u.hostname
    return `${host}:${port}`
  } catch {
    return null
  }
}

/**
 * Regla de red obligatoria (B.2 «Red», corrección de D0 §2): esta build de Electron trae
 * `LocalNetworkAccessChecks` desactivado, así que los permission handlers de `loopback-network`/
 * `local-network-access` NO bloquean un `fetch` real. Esta es la ÚNICA defensa que funciona.
 */
function installNetworkGuard(ses: Session): void {
  const allowedSchemes = new Set(['http:', 'https:', 'ws:', 'wss:', 'data:', 'blob:', 'about:'])
  ses.webRequest.onBeforeRequest((details, callback) => {
    let url: URL
    try {
      url = new URL(details.url)
    } catch {
      callback({ cancel: true })
      return
    }
    if (!allowedSchemes.has(url.protocol)) {
      callback({ cancel: true })
      return
    }
    if (isLoopbackOrPrivateHost(url.hostname)) {
      // La navegación de frame principal hacia un origen local pasa por su PROPIA puerta (B.8,
      // aprobación `local-origin` en service.ts) antes de llamar a `loadURL`; si la dejáramos
      // bloqueada aquí también, nunca podría aprobarse un origen nuevo (ni siquiera la primera vez
      // que el usuario escribe `localhost:5173`). Esta regla existe para las peticiones que NO
      // pasan por esa puerta: subrecursos (`fetch`/`xhr`/imágenes/scripts) y subframes, que una
      // página ya cargada podría lanzar hacia otro puerto local sin que el usuario lo vea.
      if (details.resourceType === 'mainFrame') {
        callback({ cancel: false })
        return
      }
      const top = topLevelOrigin(details)
      if (top && isLocalOriginApproved(top)) {
        callback({ cancel: false })
        return
      }
      console.warn(`[embedded-browser] destino local bloqueado: ${url.hostname} (top=${top ?? '?'}, tipo=${details.resourceType})`)
      callback({ cancel: true })
      return
    }
    callback({ cancel: false })
  })
}

const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write'])

function installPermissionHandlers(ses: Session, product: BrowserProduct): void {
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const ok = ALLOWED_PERMISSIONS.has(permission) && details.isMainFrame !== false
    if (!ok) console.warn(`[embedded-browser:${product}] permiso denegado: ${permission}`)
    callback(ok)
  })
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))
  ses.setDevicePermissionHandler(() => false)
  ses.setDisplayMediaRequestHandler((_request, callback) => callback({}))
  for (const evt of ['select-hid-device', 'select-serial-port', 'select-usb-device', 'select-bluetooth-device'] as const) {
    // @ts-expect-error -- las cuatro firmas comparten (event, details, callback) con callback(null/undefined).
    ses.on(evt, (event: Electron.Event, _details: unknown, callback: (id?: string) => void) => {
      event.preventDefault()
      callback()
    })
  }
  ses.on('will-download', (event, item, wc) => handleWillDownload(event, item, wc))
}

/** `app.on('select-client-certificate'|'login')`: filtrados por identidad de sesión (B.2). */
function installAppLevelGuards(): void {
  app.on('select-client-certificate', (event, wc, _url, _certList, callback) => {
    if (!wc || !isEmbeddedBrowserSession(wc.session)) return
    event.preventDefault()
    callback() // sin certificado
  })
  app.on('login', (event, wc, _details, _authInfo, callback) => {
    if (!wc || !isEmbeddedBrowserSession(wc.session)) return
    event.preventDefault()
    callback('') // cancela la autenticación HTTP (v1)
  })
  // `certificate-error`: deliberadamente SIN handler (B.2): el comportamiento por defecto de
  // Electron ya rechaza certificados inválidos; no añadimos ninguno que conceda.
}

let appLevelGuardsInstalled = false
const ready = new Map<BrowserProduct, Session>()

/** Crea (o reutiliza) la sesión persistente del producto, con todas sus guardas instaladas. */
export function sessionFor(product: BrowserProduct): Session {
  const cached = ready.get(product)
  if (cached) return cached
  const ses = session.fromPartition(PARTITION_BY_PRODUCT[product])
  embeddedSessions.add(ses)
  ses.setUserAgent(strippedUserAgent(ses.getUserAgent()))
  installPermissionHandlers(ses, product)
  installNetworkGuard(ses)
  ready.set(product, ses)
  if (!appLevelGuardsInstalled) {
    appLevelGuardsInstalled = true
    installAppLevelGuards()
  }
  return ses
}

/** UA sin `Electron/…` ni `${APP_NAME}/…`: no debe delatar el motor nativo. */
function strippedUserAgent(ua: string): string {
  return ua
    .replace(new RegExp(`\\s*${APP_NAME}/\\S+`, 'gi'), '')
    .replace(/\s*Electron\/\S+/gi, '')
    .trim()
}

export function partitionNameFor(product: BrowserProduct): string {
  return PARTITION_BY_PRODUCT[product]
}
