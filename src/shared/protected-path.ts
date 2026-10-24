/**
 * Rutas protegidas del motor propio (.git, .opencode, .claude, .vscode, .idea, .husky, .mcp.json, .gitmodules…): editarlas cambia cómo se
 * ejecuta código o la configuración de la IA, así que el motor SIEMPRE pregunta aunque haya una regla «allow» y marca la petición
 * `permission.asked` con `metadata.lazunoxProtegido === true` (y manda `always: []`). Funciones puras, compartidas por main y UI.
 *
 * Reglas de la app: (1) ninguna aprobación automática (modo Auto de Tareas, Code «Automático», rutinas) aprueba una petición protegida;
 * (2) las tarjetas no ofrecen «Permitir siempre» y avisan con una línea clara; (3) un «siempre» que llegara igual se degrada a «una vez».
 * No se apaga desde la app (`LAZUNOX_PROTECTED_PATHS=0` no se pasa nunca).
 */

/** ¿La petición de permiso trae la marca de ruta protegida? Solo el booleano `true` exacto cuenta (un texto «true» no). */
export function isProtectedPermission(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  return (metadata as Record<string, unknown>).lazunoxProtegido === true
}
