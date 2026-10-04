/**
 * Sesiones del navegador integrado (Lote D, B.2 «Sesión»/«Identidad»/«Permisos»/«Red»/«Descargas»):
 * primer contenido web ARBITRARIO de la app. Dos particiones persistentes, separadas entre sí y de
 * la `defaultSession` de `onyxcode://app`: `persist:onyxcode-web-code` y `persist:onyxcode-web-tasks`.
 *
 * `isEmbeddedBrowserSession` es la exención exacta de `web-security.ts` (B.3): compara la
 * IDENTIDAD del objeto `Session` (nunca una cadena), y solo la llenan las dos líneas de abajo.
 */
import { app, session, type Session } from 'electron'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isLocalHostname } from './ip-class'
import { APP_NAME } from '@shared/brand'
import type { BrowserProduct } from '@shared/ipc-browser'
import { isLocalOriginApproved } from './store'
import { hostPortOf, localSubresourceAllowed, schemeOf } from './sites'
import { handleWillDownload } from './downloads'

const PARTITION_BY_PRODUCT: Record<BrowserProduct, string> = {
  code: 'persist:onyxcode-web-code',
  tasks: 'persist:onyxcode-web-tasks'
}

/** Identidad de objeto: NUNCA comparar por nombre de partición (B.3). */
const embeddedSessions = new Set<Session>()

/** `web-security.ts` llama a esto para exentar la superficie del navegador de su endurecimiento. */
export function isEmbeddedBrowserSession(s: Session): boolean {
  return embeddedSessions.has(s)
}

/** Exportado: `service.ts` la reutiliza para reconocer un destino "local" al pedir aprobación (clasifica por la IP real, ver `ip-class.ts`). */
export function isLoopbackOrPrivateHost(hostname: string): boolean {
  return isLocalHostname(hostname)
}

const DNS_TTL_MS = 3_000
const DNS_TIMEOUT_MS = 2_500
const dnsCache = new Map<string, { at: number; local: boolean }>()

/**
 * Anti-rebinding: un NOMBRE público cuyo DNS apunta a una IP local/privada también cuenta como destino local.
 * Falla abierta si no resuelve (Chromium tampoco podrá conectar). Resolución de red y de Chromium son
 * independientes: reduce la ventana, no la elimina (documentado en docs/SEGURIDAD.md).
 */
async function resolvesToLocal(hostname: string): Promise<boolean> {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!h || isIP(h) !== 0 || /^[0-9.x]+$/i.test(h)) return false
  const hit = dnsCache.get(h)
  if (hit && Date.now() - hit.at < DNS_TTL_MS) return hit.local
  let local = false
  try {
    const addrs = await Promise.race([
      lookup(h, { all: true, verbatim: true }),
      new Promise<never>((_r, rej) => setTimeout(() => rej(new Error('dns-timeout')), DNS_TIMEOUT_MS).unref?.())
    ])
    local = addrs.some((a) => isLocalHostname(a.address))
  } catch {
    local = false
  }
  if (dnsCache.size > 500) dnsCache.clear()
  dnsCache.set(h, { at: Date.now(), local })
  return local
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
    return hostPortOf(wc.getURL())
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
      // Mismo origen que la página (su CSS/JS/imágenes) o página aprobada con «Permitir siempre»; ver `localSubresourceAllowed`.
      if (localSubresourceAllowed(url, top, isLocalOriginApproved)) {
        callback({ cancel: false })
        return
      }
      console.warn(`[embedded-browser] destino local bloqueado: ${url.hostname} (top=${top ?? '?'}, tipo=${details.resourceType})`)
      callback({ cancel: true })
      return
    }
    if (
      details.resourceType === 'mainFrame' ||
      (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'ws:' && url.protocol !== 'wss:')
    ) {
      callback({ cancel: false })
      return
    }
    // Nombre «público» que resuelve a una IP local (DNS rebinding): solo si ese origen está aprobado con «Permitir siempre».
    const origin = hostPortOf(url)
    void resolvesToLocal(url.hostname).then((local) => {
      if (local && !(origin && isLocalOriginApproved(origin))) {
        console.warn(`[embedded-browser] destino bloqueado (DNS resuelve a IP local): ${url.hostname}`)
        callback({ cancel: true })
      } else callback({ cancel: false })
    })
  })
}

const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write'])

/**
 * `clipboard-sanitized-write` solo para un origen web válido (https, o http local para desarrollo) y que sea el de la
 * página de nivel superior: ni `file:`/`data:`/`about:blank` ni opacos, ni un subframe de otro origen.
 */
export function permissionOriginOk(permission: string, requestingOrigin: string | undefined, topUrl: string | undefined): boolean {
  if (!ALLOWED_PERMISSIONS.has(permission)) return false
  if (!requestingOrigin || requestingOrigin === 'null') return false
  try {
    const o = new URL(requestingOrigin)
    if (o.protocol !== 'https:' && !(o.protocol === 'http:' && isLoopbackOrPrivateHost(o.hostname))) return false
    return !!topUrl && new URL(topUrl).origin === o.origin
  } catch {
    return false
  }
}

type ExternalOpenListener = (wc: Electron.WebContents, url: string) => void
let externalOpenListener: ExternalOpenListener | null = null

/** `surface.ts` se registra aquí (sin ciclo de imports) para registrar/avisar cuando se deniega `openExternal`. */
export function setExternalOpenBlockedListener(fn: ExternalOpenListener): void {
  externalOpenListener = fn
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

function safeTopUrl(wc: Electron.WebContents | null): string | undefined {
  try {
    return wc && !wc.isDestroyed() ? wc.getURL() : undefined
  } catch {
    return undefined
  }
}

function installPermissionHandlers(ses: Session, product: BrowserProduct): void {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (permission === 'openExternal') {
      // Un esquema externo (`mailto:`, `tel:`…) nunca abre otra aplicación desde el navegador integrado.
      const url = (details as { externalURL?: string }).externalURL ?? ''
      if (externalOpenListener) externalOpenListener(wc, url)
      else console.warn(`[embedded-browser:${product}] navegación bloqueada: ${schemeOf(url) ?? 'esquema desconocido'} (openExternal)`)
      callback(false)
      return
    }
    const requesting = (details as { requestingUrl?: string }).requestingUrl
    const ok =
      details.isMainFrame !== false && permissionOriginOk(permission, requesting ? safeOrigin(requesting) : undefined, safeTopUrl(wc))
    if (!ok) console.warn(`[embedded-browser:${product}] permiso denegado: ${permission}`)
    callback(ok)
  })
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => permissionOriginOk(permission, requestingOrigin, safeTopUrl(wc)))
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
