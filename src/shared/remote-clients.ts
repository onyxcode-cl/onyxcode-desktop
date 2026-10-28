/**
 * Apps de escritorio remoto (Windows App, AnyDesk, TeamViewer…, y máquinas virtuales): su ventana es una puerta a OTRO equipo. Lo usan el
 * servidor de control (teclas físicas, imagen con retraso) y la tarjeta de permiso (avisa de que el permiso alcanza a todo lo que haya allí).
 */
const REMOTE_CLIENT_BUNDLES = new Set([
  'com.microsoft.rdc.macos',
  'com.microsoft.rdc.mac',
  'com.philandro.anydesk',
  'com.teamviewer.teamviewer',
  'com.carriez.rustdesk',
  'com.apple.screensharing',
  'com.parallels.desktop.console'
])
const REMOTE_CLIENT_NAME = /anydesk|teamviewer|rustdesk|windows app|remote desktop|escritorio remoto|screen sharing|vnc/i

/** ¿Es un cliente de escritorio remoto? (por identificador de la app o por su nombre) */
export function isRemoteClientApp(app: { bundleId?: string; name?: string }): boolean {
  return REMOTE_CLIENT_BUNDLES.has((app.bundleId ?? '').toLowerCase()) || REMOTE_CLIENT_NAME.test(app.name ?? '')
}
