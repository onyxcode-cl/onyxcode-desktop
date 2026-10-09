/**
 * «Doctor» de la app: lista de comprobaciones del sistema que dice, en un Mac recién instalado, qué funciona y qué falta
 * (permisos de macOS, herramientas internas, componentes opcionales). Los textos que ve el usuario salen de i18n por `id`;
 * `detail` es técnico (versiones, rutas, códigos) y solo se muestra como pista.
 */
export type DoctorLevel = 'ok' | 'warn' | 'fail' | 'info'

/** Qué botón ofrece la interfaz para arreglarlo (la acción real la hace la interfaz con canales que ya existen). */
export type DoctorFix = 'requestPermissions' | 'installOffice' | 'xcodeSelect'

export type DoctorId =
  'macos' | 'accessibility' | 'screenRecording' | 'controlHelper' | 'keyboardTool' | 'python' | 'office' | 'git' | 'disk' | 'screens'

export interface DoctorItem {
  id: DoctorId
  level: DoctorLevel
  detail?: string
  fix?: DoctorFix
}

export interface DoctorReport {
  items: DoctorItem[]
  /** `fail` = alguna comprobación imprescindible falla; `warn` = funciona con límites; `ok` = todo en orden. */
  overall: 'ok' | 'warn' | 'fail'
  at: number
}
