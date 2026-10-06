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

export interface TrayIconRep {
  /** Lado en píxeles físicos del bitmap. */
  size: number
  /** Escala respecto a los 16 pt lógicos. */
  scaleFactor: number
}

/**
 * Representaciones del icono por plataforma. macOS: 32 px @2x (sin cambios). Windows: 16/20/24/32 px
 * (100/125/150/200 % de escala) para evitar el reescalado borroso del icono de la zona de notificación.
 */
export function trayIconReps(platform: string): TrayIconRep[] {
  if (platform === 'win32') {
    return [16, 20, 24, 32].map((size) => ({ size, scaleFactor: size / 16 }))
  }
  return [{ size: 32, scaleFactor: 2 }]
}
