/**
 * «Dar permisos» en macOS: la petición la hace el PROCESO PRINCIPAL (la app «Lazunox»), no el ayudante hijo. Así macOS
 * registra la entrada «Lazunox» en las listas de Ajustes (el ayudante vive un instante y su petición se pierde, o crea otra
 * entrada aparte) y la persona solo tiene que encender el interruptor.
 */
export interface RequestPermsDeps {
  /** `isTrustedAccessibilityClient(true)`: muestra el aviso nativo de Accesibilidad si falta. */
  askAccessibility: () => boolean
  /** `getMediaAccessStatus('screen') === 'granted'`. */
  screenGranted: () => boolean
  /** Pide capturar pantalla (desktopCapturer): hace que macOS muestre el aviso y añada la app a Grabación de pantalla. */
  triggerScreen: () => Promise<void>
  openPane: (pane: 'accessibility' | 'screen') => Promise<void>
}

export interface RequestPermsResult {
  accessibility: boolean
  screenRecording: boolean
}

export async function requestMacPermissions(d: RequestPermsDeps): Promise<RequestPermsResult> {
  const accessibility = d.askAccessibility()
  let screenRecording = d.screenGranted()
  if (!screenRecording) {
    await d.triggerScreen().catch(() => undefined)
    screenRecording = d.screenGranted()
  }
  // Se abre el panel de lo que falta (primero Accesibilidad); si ya está todo, no se abre nada.
  if (!accessibility) await d.openPane('accessibility')
  else if (!screenRecording) await d.openPane('screen')
  return { accessibility, screenRecording }
}
