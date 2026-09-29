/**
 * Endurecimiento global de Electron (AUDIT.md 2.1 / S8), aplicado a TODO webContents que se cree:
 *
 * - Navegación: `will-navigate`, `will-redirect` y `will-frame-navigate` solo permiten los orígenes
 *   propios (`lapis://app`, dev server); los enlaces http(s) se abren en el navegador del sistema y
 *   todo lo demás (file:, data:, javascript:, otros esquemas) se bloquea. Las ventanas de artifacts
 *   (esquema propio en su partición) conservan además sus propias reglas, más estrictas.
 * - `window.open`: denegado siempre (http(s) → navegador del sistema).
 * - `<webview>`: prohibido (`will-attach-webview` → preventDefault).
 * - Permisos de la sesión por defecto: denegados salvo notificaciones y escritura sanitizada del
 *   portapapeles, y solo para páginas propias en el frame principal. Sin dispositivos (HID/USB/
 *   serie), sin captura de pantalla desde el renderer.
 * - Menú de aplicación propio en producción (sin Recargar ni Herramientas de desarrollo).
 */
import { app, Menu, session, shell, type WebContents } from 'electron'
import { isTrustedUrl, originOf } from './app-protocol'
import { isEmbeddedBrowserSession } from '../embedded-browser/session'

/** Permisos que la UI usa: notificaciones de Cowork y botones "Copiar". */
const ALLOWED_PERMISSIONS = new Set(['notifications', 'clipboard-sanitized-write'])

function openExternalSafe(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
}

/** El artifact usa su propio esquema en su propia partición: sus reglas viven en artifact-window.ts. */
function isArtifactUrl(url: string): boolean {
  return /^[a-z0-9.+-]*-artifact:/i.test(url)
}

function allowedNavigation(url: string): boolean {
  return isTrustedUrl(url) || isArtifactUrl(url)
}

function harden(wc: WebContents): void {
  // Superficie de navegación (Lote D): sus reglas viven en embedded-browser/surface.ts y session.ts,
  // NUNCA en este endurecimiento global (bloquearía toda navegación de la pestaña). La exención es
  // por identidad de objeto de sesión (`Set<Session>`, ver embedded-browser/session.ts), no por
  // cadena: solo esas dos particiones quedan fuera de este endurecimiento.
  if (isEmbeddedBrowserSession(wc.session)) return
  // Solo las ventanas de la app (sesión por defecto) abren enlaces en el navegador: un artifact
  // (partición propia, sin red por CSP) no debe poder sacar datos abriendo una URL externa.
  const mayOpenExternal = (): boolean => wc.session === session.defaultSession
  wc.setWindowOpenHandler(({ url }) => {
    if (mayOpenExternal()) openExternalSafe(url)
    return { action: 'deny' }
  })
  const guardNav = (event: Electron.Event, url: string, isMainFrame = true): void => {
    if (allowedNavigation(url)) return
    event.preventDefault()
    if (isMainFrame && mayOpenExternal()) openExternalSafe(url)
    console.warn(`[security] navegación bloqueada: ${url.slice(0, 200)}`)
  }
  wc.on('will-navigate', (event, url) => guardNav(event, url))
  wc.on('will-redirect', (event, url) => guardNav(event, url, false))
  wc.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return // ya lo cubre will-navigate
    guardNav(event, event.url, false)
  })
  wc.on('will-attach-webview', (event) => {
    event.preventDefault()
    console.warn('[security] <webview> bloqueado')
  })
}

function installPermissionHandlers(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = details.requestingUrl || wc.getURL()
    const ok = ALLOWED_PERMISSIONS.has(permission) && details.isMainFrame !== false && isTrustedUrl(url)
    if (!ok) console.warn(`[security] permiso denegado: ${permission} (${originOf(url) ?? '?'})`)
    callback(ok)
  })
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && isTrustedUrl(requestingOrigin)
  })
  ses.setDevicePermissionHandler(() => false)
  ses.setDisplayMediaRequestHandler((_request, callback) => callback({}))
  ses.on('will-download', (event, item) => {
    // La UI no descarga nada; los artifacts se guardan con diálogo nativo desde main.
    console.warn(`[security] descarga bloqueada: ${item.getURL().slice(0, 200)}`)
    event.preventDefault()
  })
}

function installProductionMenu(): void {
  if (!app.isPackaged) return // en desarrollo, el menú por defecto (DevTools, recargar)
  const isMac = process.platform === 'darwin'
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: 'appMenu' as const }] : []),
      { role: 'fileMenu' as const },
      { role: 'editMenu' as const },
      {
        label: 'Ver',
        submenu: [
          { role: 'resetZoom' as const },
          { role: 'zoomIn' as const },
          { role: 'zoomOut' as const },
          { type: 'separator' as const },
          { role: 'togglefullscreen' as const }
        ]
      },
      { role: 'windowMenu' as const }
    ])
  )
}

let installed = false

/** Llamar una vez tras `app.whenReady()` y ANTES de crear ventanas. */
export function installWebSecurity(): void {
  if (installed) return
  installed = true
  app.on('web-contents-created', (_event, wc) => harden(wc))
  installPermissionHandlers()
  installProductionMenu()
}
