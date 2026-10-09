/**
 * Endurecimiento global de Electron (AUDIT.md 2.1 / S8), aplicado a TODO webContents que se cree:
 *
 * - Navegación: `will-navigate`, `will-redirect` y `will-frame-navigate` solo permiten los orígenes
 *   propios (`lazunox://app`, dev server); los enlaces http(s) se abren en el navegador del sistema y
 *   todo lo demás (file:, data:, javascript:, otros esquemas) se bloquea. Las ventanas de artifacts
 *   (esquema propio en su partición) conservan además sus propias reglas, más estrictas.
 * - `window.open`: denegado siempre (http(s) → navegador del sistema).
 * - `<webview>`: prohibido (`will-attach-webview` → preventDefault).
 * - Permisos de la sesión por defecto: denegados salvo notificaciones, escritura sanitizada del
 *   portapapeles y `media` (micrófono — F8-B141, dictado por voz; esta app nunca pide video, pero
 *   Electron no distingue micrófono de cámara a este nivel, así que `media` cubre ambos — el sistema
 *   operativo igual pregunta la primera vez), y solo para páginas propias en el frame principal. Sin
 *   dispositivos (HID/USB/serie), sin captura de pantalla desde el renderer.
 * - Menú de aplicación propio en producción (sin Recargar ni Herramientas de desarrollo).
 */
import { app, dialog, Menu, session, shell, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { DISPLAY_NAME } from '@shared/brand'
import { onLangChange, t } from '@shared/i18n'
import { isTrustedUrl, originOf } from './app-protocol'
import { isEmbeddedBrowserSession } from '../embedded-browser/session'

/** Permisos que la UI usa: notificaciones de Tareas, botones "Copiar" y micrófono (dictado por voz,
 * F8-B141 — `media` es lo único que pide `getUserMedia({audio:true})`; esta app nunca pide video). */
const ALLOWED_PERMISSIONS = new Set(['notifications', 'clipboard-sanitized-write', 'media'])

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
    // i18n-ignore: registro de consola, no se muestra
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

/**
 * Plantilla del menú de producción. En macOS `{ role: 'appMenu' }` rotula «Acerca de/Ocultar/Salir de» con
 * `app.name`, que se mantiene en «Lazunox» (clave del Llavero y userData); por eso el menú de la app es
 * propio y usa el nombre visible. Exportada para probarla sin Electron.
 */
export function buildProductionMenuTemplate(isMac: boolean, platform: string = isMac ? 'darwin' : 'linux'): MenuItemConstructorOptions[] {
  if (platform === 'win32') return buildWindowsMenuTemplate()
  const app_ = { app: DISPLAY_NAME }
  return [
    ...(isMac
      ? [
          {
            label: DISPLAY_NAME,
            submenu: [
              { role: 'about' as const, label: t('main.menu.about', app_) },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const, label: t('main.menu.hide', app_) },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const, label: t('main.menu.quit', app_) }
            ]
          }
        ]
      : []),
    { role: 'fileMenu' as const },
    { role: 'editMenu' as const },
    {
      label: t('main.menu.view'),
      submenu: [
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const }
      ]
    },
    { role: 'windowMenu' as const }
  ]
}

/**
 * Menú de Windows: con `{ role: 'fileMenu'|… }` los rótulos salen en inglés aunque la interfaz esté en
 * español. Cada ítem conserva su `role` (así siguen los aceleradores y el comportamiento nativo) pero con
 * etiqueta propia traducida. La ventana arranca con `autoHideMenuBar`: Alt muestra el menú.
 */
export function buildWindowsMenuTemplate(): MenuItemConstructorOptions[] {
  return [
    {
      label: t('main.menu.file'),
      submenu: [{ role: 'quit' as const, label: t('main.menu.exit') }]
    },
    {
      label: t('main.menu.edit'),
      submenu: [
        { role: 'undo' as const, label: t('main.menu.undo') },
        { role: 'redo' as const, label: t('main.menu.redo') },
        { type: 'separator' as const },
        { role: 'cut' as const, label: t('main.menu.cut') },
        { role: 'copy' as const, label: t('main.menu.copy') },
        { role: 'paste' as const, label: t('main.menu.paste') },
        { role: 'selectAll' as const, label: t('main.menu.selectAll') }
      ]
    },
    {
      label: t('main.menu.view'),
      submenu: [
        { role: 'resetZoom' as const, label: t('main.menu.resetZoom') },
        { role: 'zoomIn' as const, label: t('main.menu.zoomIn') },
        { role: 'zoomOut' as const, label: t('main.menu.zoomOut') },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const, label: t('main.menu.fullscreen') }
      ]
    },
    {
      label: t('main.menu.window'),
      submenu: [
        { role: 'minimize' as const, label: t('main.menu.minimize') },
        { role: 'close' as const, label: t('main.menu.closeWindow') }
      ]
    },
    {
      label: t('main.menu.help'),
      submenu: [
        {
          label: t('main.menu.about', { app: DISPLAY_NAME }),
          // `role: 'about'` no abre panel en Windows: diálogo propio.
          click: () => {
            void dialog.showMessageBox({ type: 'info', title: DISPLAY_NAME, message: DISPLAY_NAME, detail: app.getVersion() })
          }
        }
      ]
    }
  ]
}

function buildProductionMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildProductionMenuTemplate(process.platform === 'darwin', process.platform)))
}

function installProductionMenu(): void {
  if (!app.isPackaged) return // en desarrollo, el menú por defecto (DevTools, recargar)
  buildProductionMenu()
  // Se reconstruye al cambiar de idioma.
  onLangChange(() => buildProductionMenu())
}

let installed = false

/** Llamar una vez tras `app.whenReady()` y ANTES de crear ventanas. */
export function installWebSecurity(): void {
  if (installed) return
  installed = true
  app.on('web-contents-created', (_event, wc) => harden(wc))
  installPermissionHandlers()
  // Panel «Acerca de» con el nombre visible (app.name sigue siendo «Lazunox»: Llavero y userData).
  app.setAboutPanelOptions({ applicationName: DISPLAY_NAME, applicationVersion: app.getVersion() })
  installProductionMenu()
}
