/**
 * Permisos «siempre» guardados por el motor (Ola 7, 7.22): contrato de las rutas `GET /permission/siempre` y
 * `DELETE /permission/siempre/{id}`. La respuesta del motor es dato NO confiable: se valida y se acota aquí antes de llegar a la vista.
 * Puro, sin Electron.
 */

export interface AlwaysRule {
  /** Id estable (hash de permiso + patrón) que el motor entiende para quitar una sola regla. */
  id: string
  permission: string
  pattern: string
}

export type AlwaysListResult =
  { available: false } | { available: true; active: boolean; rules: AlwaysRule[]; notice?: string; truncated: boolean }

export type AlwaysRevokeResult = { available: false } | { available: true; ok: boolean }

export const ALWAYS_LIMITS = { rules: 500, text: 500, id: 128 } as const

/** Id aceptado hacia el motor y desde él: solo caracteres de un hash o identificador. */
export const ALWAYS_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

/** Quita controles y saltos (una regla nunca debe poder pintar líneas falsas) y acota el largo. */
function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').trim()
  return s ? s.slice(0, ALWAYS_LIMITS.text) : null
}

export function parseAlwaysList(body: unknown): { active: boolean; rules: AlwaysRule[]; notice?: string; truncated: boolean } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const b = body as { activo?: unknown; reglas?: unknown; aviso?: unknown }
  if (!Array.isArray(b.reglas)) return null
  const rules: AlwaysRule[] = []
  for (const r of b.reglas) {
    if (!r || typeof r !== 'object') continue
    const { id, permission, pattern } = r as Record<string, unknown>
    const permissionText = clean(permission)
    const patternText = clean(pattern)
    if (typeof id !== 'string' || !ALWAYS_ID_RE.test(id) || !permissionText || !patternText) continue
    rules.push({ id, permission: permissionText, pattern: patternText })
    if (rules.length >= ALWAYS_LIMITS.rules) break
  }
  const notice = clean(b.aviso)
  return {
    active: b.activo === true,
    rules,
    ...(notice ? { notice } : {}),
    truncated: b.reglas.length > rules.length
  }
}
