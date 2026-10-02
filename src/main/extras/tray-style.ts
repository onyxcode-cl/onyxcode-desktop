/**
 * Estilo del icono de la bandeja por plataforma (puro, sin Electron). En macOS es una «template image»
 * negra que el sistema tiñe según la barra de menús. En Windows no existe ese mecanismo: un icono negro
 * es invisible sobre la barra de tareas oscura, así que se dibuja a color (azul de marca aclarado, legible
 * sobre fondo claro y oscuro).
 */
export interface TrayIconStyle {
  /** Color RGB del símbolo. */
  rgb: readonly [number, number, number]
  /** `setTemplateImage(true)` (solo macOS). */
  template: boolean
}

export function trayIconStyle(platform: string): TrayIconStyle {
  if (platform === 'darwin') return { rgb: [0, 0, 0], template: true }
  return { rgb: [0x6b, 0x86, 0xf2], template: false }
}
