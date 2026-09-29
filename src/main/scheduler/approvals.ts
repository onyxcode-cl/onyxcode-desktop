/**
 * Decisión de permisos en ejecuciones desatendidas (rutinas). Módulo PURO: sin Electron ni Node.
 *
 * Solo las reglas explícitas de la lista blanca de la rutina ("Permitir sin preguntar") se aprueban
 * automáticamente; todo lo demás se rechaza o espera al usuario (lo decide el scheduler).
 */
import type { RoutineAllowRule } from '@shared/ipc-tasks'

/** Escapa los metacaracteres de una expresión regular. */
function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

/**
 * Coincidencia con comodines: `*` = cualquier cosa (también vacío, `/` y espacios),
 * `?` = exactamente un carácter. Anclada a todo el valor y sensible a mayúsculas.
 */
export function wildcardMatch(pattern: string, value: string): boolean {
  let re = ''
  for (const ch of pattern) {
    if (ch === '*') re += '[\\s\\S]*'
    else if (ch === '?') re += '[\\s\\S]'
    else re += escapeRegex(ch)
  }
  return new RegExp(`^${re}$`).test(value)
}

/**
 * ¿La regla cubre este permiso? Igualdad exacta, o prefijo terminado en `*` (p. ej. `github_*`
 * para las herramientas de un MCP). Un `*` suelto NO vale como permiso: no existe "permitir todo".
 */
export function permissionMatches(rulePermission: string, permission: string): boolean {
  if (rulePermission === permission) return true
  if (rulePermission.length > 1 && rulePermission.endsWith('*') && !rulePermission.slice(0, -1).includes('*')) {
    return permission.startsWith(rulePermission.slice(0, -1))
  }
  return false
}

/**
 * Decide una petición de permiso de una ejecución desatendida: 'allow' solo si TODOS sus patrones
 * casan con alguna regla del mismo permiso; en cualquier otro caso (incluido sin reglas o sin
 * patrones) devuelve 'no-match'.
 */
export function decideUnattended(p: { permission: string; patterns: string[] }, rules: RoutineAllowRule[]): 'allow' | 'no-match' {
  if (!rules || rules.length === 0) return 'no-match'
  if (!p.patterns || p.patterns.length === 0) return 'no-match'
  const same = rules.filter((r) => r && typeof r.permission === 'string' && permissionMatches(r.permission, p.permission))
  if (same.length === 0) return 'no-match'
  const ok = p.patterns.every((pat) => same.some((r) => typeof r.pattern === 'string' && wildcardMatch(r.pattern, pat)))
  return ok ? 'allow' : 'no-match'
}
