/**
 * Tabla ÚNICA de pistas de recuperación del puente de control: código estable de `[rechazo: <código>]` ⇒ pista corta (≤240 caracteres)
 * y SIGUIENTE llamada inocua. La llamada siguiente es siempre de solo lectura (`app_screenshot`, `app_find`) o ninguna: nunca un paso
 * que pida consentimiento, abra algo o cambie estado. Por señal observada, nunca por tipo de app o de proceso.
 *
 * Módulo puro: sin Electron, sin disco, sin red. Lo usa `mcp-server.ts` (`reject`) y lo prueban `recovery-hints.test.ts`.
 */

/** Llamadas que una pista puede sugerir: solo lectura. Cualquier otra se rechaza en la prueba de la tabla. */
export const SAFE_NEXT_CALLS = ['app_screenshot', 'app_find'] as const
export type SafeNextCall = (typeof SAFE_NEXT_CALLS)[number]

export const MAX_HINT_CHARS = 240

export interface RecoveryHint {
  /** Qué hacer, en una o dos frases. */
  hint: string
  /** Siguiente llamada inocua, o `null` si lo que sigue lo decide la persona (consentimiento, otra app). */
  next: SafeNextCall | null
}

const RETAKE = 'Toma app_screenshot otra vez'

export const RECOVERY_HINTS: Readonly<Record<string, RecoveryHint>> = {
  'no-capture': { hint: `${RETAKE} de la app antes de actuar: las x/y van en píxeles de esa imagen.`, next: 'app_screenshot' },
  'capture-expired': { hint: 'toma app_screenshot otra vez antes de actuar.', next: 'app_screenshot' },
  'capture-required': { hint: `${RETAKE} y usa el capture de esa captura junto con el element.`, next: 'app_screenshot' },
  stale: {
    hint: 'Toma app_screenshot otra vez, elige de la lista nueva (con su capture) o usa x/y de la imagen nueva.',
    next: 'app_screenshot'
  },
  'window-moved': { hint: 'Toma app_screenshot otra vez.', next: 'app_screenshot' },
  'outside-window': { hint: 'Apunta dentro de la ventana capturada; si dudas, toma app_screenshot otra vez.', next: 'app_screenshot' },
  'off-screen': { hint: 'Toma app_screenshot otra vez.', next: 'app_screenshot' },
  'zoom-unavailable': { hint: 'toma app_screenshot otra vez.', next: 'app_screenshot' },
  covered: {
    hint: 'Pide a la persona que deje la ventana a la vista y toma app_screenshot otra vez; no pidas acceso a otras apps para sortearlo.',
    next: 'app_screenshot'
  },
  'front-changed': { hint: 'Toma una captura y revisa dónde estás antes de reintentar.', next: 'app_screenshot' },
  'focus-stolen': { hint: 'Revisa ambas apps con app_screenshot antes de seguir; lo que faltaba NO se escribió.', next: 'app_screenshot' },
  'own-app-front': {
    hint: 'Lazunox está al frente: vuelve a la app de trabajo y toma app_screenshot; no pidas acceso a Lazunox.',
    next: null
  },
  'unknown-app': { hint: 'Pide a la persona que enfoque una app concreta y luego toma app_screenshot.', next: null },
  'no-grant': { hint: 'No hay permiso vigente para esa app: lo concede la persona, no se sortea.', next: null },
  'low-tier': { hint: 'El permiso de esa app no alcanza para esta acción: lo amplía la persona, no se sortea.', next: null },
  'exempt-app': { hint: 'Esa app no se controla desde aquí; usa otra vía o pide ayuda a la persona.', next: null },
  'file-manager': {
    hint: 'No uses el gestor de archivos para crear, copiar, mover, renombrar ni abrir archivos: usa equipo_ejecutar con un comando (mkdir, cp, mv, open). Para manejarlo de verdad, app_find y app_press.',
    next: 'app_find'
  },
  'key-sequence': { hint: 'Llama a key una vez por combinación.', next: null },
  'key-unknown': { hint: 'Usa nombres de tecla como "return", "tab", "cmd+a", "shift+left", "f5".', next: null },
  'key-blocked': { hint: 'Esa combinación no se pulsa en este modo; usa los menús con app_press o app_find.', next: 'app_find' },
  'batch-wait-limit': { hint: 'Divide el lote en pasos separados para esperar más.', next: null }
}

/** Pista de un código, o `undefined` si no está en la tabla. */
export function recoveryHint(code: string): string | undefined {
  return RECOVERY_HINTS[code]?.hint
}

/** Siguiente llamada inocua de un código, o `undefined` si no hay (código desconocido o decide la persona). */
export function recoveryNext(code: string): SafeNextCall | undefined {
  return RECOVERY_HINTS[code]?.next ?? undefined
}

/** Sufijo para anteponer al final de un mensaje de rechazo: « (siguiente: app_screenshot)» o cadena vacía. */
export function recoverySuffix(code: string): string {
  const next = recoveryNext(code)
  return next ? ` (siguiente: ${next})` : ''
}
