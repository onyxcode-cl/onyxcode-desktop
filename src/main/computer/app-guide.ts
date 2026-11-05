/**
 * Guía de un clic para dar un permiso de macOS que NO se concede solo (Grabación de pantalla, Acceso total al disco): en
 * macOS 27 la app no aparece sola en esas listas. Abre el panel, muestra «Lazunox.app» en Finder para arrastrarla y deja su
 * ruta en el portapapeles (para el «+» con Cmd+Mayús+G). No concede nada: la persona enciende el interruptor.
 */
export type GuidePane = 'screen' | 'allFiles'

export const GUIDE_PANES: Record<GuidePane, string> = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  allFiles: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
}

/** Ruta del paquete «.app» a partir del ejecutable (`…/Lazunox.app/Contents/MacOS/Lazunox`); `null` si no corre desde un paquete. */
export function appBundlePath(execPath: string): string | null {
  const i = execPath.indexOf('.app/')
  return i < 0 ? null : execPath.slice(0, i + 4)
}

export interface AppGuideDeps {
  execPath: string
  openPane: (url: string) => Promise<void>
  reveal: (path: string) => void
  copy: (text: string) => void
}

export async function guideAppAccess(pane: GuidePane, d: AppGuideDeps): Promise<{ path: string | null }> {
  const path = appBundlePath(d.execPath)
  if (path) {
    d.copy(path)
    d.reveal(path)
  }
  await d.openPane(GUIDE_PANES[pane])
  return { path }
}
