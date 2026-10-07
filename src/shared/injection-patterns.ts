/**
 * Patrones de inyección y detector de instrucciones sospechosas.
 *
 * Módulo puro: sin Electron, sin node:fs. Usado por `main` (clasificador de permisos en modo auto)
 * y por el renderer (validación de entrada en formularios).
 */

/**
 * Frases que delatan un intento de inyección (en el texto de un permiso, sus metadatos, el motivo
 * de una tarjeta de acceso o el nombre de una app). Es/en, insensible a mayúsculas. Ante cualquier
 * coincidencia se pregunta SIEMPRE: el modo auto nunca es el que decide sobre texto sospechoso.
 */
export const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|the\s+)?(previous|prior)\s+instructions/i,
  /ignora\s+(las\s+)?instrucciones/i,
  /auto-?approv/i,
  /aprobaci[oó]n\s+autom/i,
  /bypass/i,
  /salt(ar|ate)\s+(la\s+)?(aprobaci|permiso)/i,
  /(disable|desactiva\w*)\s+(the\s+|el\s+|la\s+)?(approval|permission|sandbox|gate|modo|permiso|aprobaci)/i,
  /lazunox_session/i,
  /plan-gate/i,
  /killswitch/i,
  /OPENCODE_(SERVER|AUTH|CONFIG)/,
  /system\s+prompt/i,
  /you\s+are\s+now/i,
  /eres\s+ahora/i,
  /developer\s+mode/i,
  /<\|im_start\|>/i
]

export function looksLikeInjection(text: string): boolean {
  if (!text) return false
  return INJECTION_PATTERNS.some((re) => re.test(text))
}
