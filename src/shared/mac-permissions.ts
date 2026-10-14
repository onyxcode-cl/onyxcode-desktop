/**
 * Lógica pura de los permisos de macOS (Accesibilidad y Grabación de pantalla) y de la ubicación de la app. Sin Electron ni React:
 * la comparten el proceso principal (estado, registro de problemas) y la interfaz (bienvenida, asistente, Ajustes).
 */
import { APP_ID } from './brand'

/** Dónde corre la app: `translocated` = App Translocation de macOS (abierta desde Descargas o un .dmg), `volume` = desde un volumen montado. */
export type AppLocation = 'translocated' | 'volume'

/**
 * ¿La app corre desde un sitio donde macOS no guarda bien los permisos ni deja actualizarla? Solo mira la ruta del ejecutable
 * (`process.execPath`). `null` = ubicación normal (o no es macOS). Los desarrollos (`node_modules/electron`) no coinciden.
 */
export function classifyAppLocation(execPath: string, platform: string = process.platform): AppLocation | null {
  if (platform !== 'darwin') return null
  if (execPath.includes('/AppTranslocation/')) return 'translocated'
  if (execPath.startsWith('/Volumes/')) return 'volume'
  return null
}

/** Qué falta tras comprobar: `ready` = ambos; `restart` = Accesibilidad sí y Pantalla no (macOS exige reiniciar); `pending` = el resto. */
export type PermsStage = 'ready' | 'restart' | 'pending'

export function permsStage(s: { accessibility: boolean; screenRecording: boolean }): PermsStage {
  if (s.accessibility && s.screenRecording) return 'ready'
  if (s.accessibility && !s.screenRecording) return 'restart'
  return 'pending'
}

/** Identificadores cuyos permisos se pueden reparar: la app y su ayudante nativo. */
export const TCC_BUNDLE_IDS: readonly string[] = [APP_ID, `${APP_ID}.cu-helper`]
export const TCC_SERVICES: readonly string[] = ['ScreenCapture', 'Accessibility']

/** Comandos de reparación de permisos (se copian al portapapeles; la app NUNCA los ejecuta). */
export function tccResetCommands(): string[] {
  return TCC_BUNDLE_IDS.flatMap((id) => TCC_SERVICES.map((svc) => `tccutil reset ${svc} ${id}`))
}

/** Texto a copiar: un comando por línea. */
export function tccResetText(): string {
  return tccResetCommands().join('\n')
}

/** Datos para el registro de problemas cuando tras la espera siguen faltando permisos (sin rutas ni datos personales). */
export function permsStallDetail(
  s: { helperOk: boolean; accessibility: boolean; screenRecording: boolean },
  location: AppLocation | null
): Record<string, string | number> {
  return {
    helperOk: s.helperOk ? 'sí' : 'no',
    accessibility: s.accessibility ? 'sí' : 'no',
    screenRecording: s.screenRecording ? 'sí' : 'no',
    ubicacion: location ?? 'normal'
  }
}
