/**
 * Fusión profunda pura para construir la config inline de OpenCode (sin dependencias de Electron).
 *
 * Semántica: los objetos planos se fusionan recursivamente; los arrays y los escalares los
 * sustituye el argumento posterior; gana siempre el último; `undefined` se salta y las entradas
 * no se mutan (el resultado es una copia profunda de lo que aporta cada argumento).
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** Copia profunda de lo que puede aparecer en una config JSON (objetos planos y arrays). */
function clone(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(clone)
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v)) {
      if (k === '__proto__') continue
      out[k] = clone(val)
    }
    return out
  }
  return v
}

function mergeInto(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [k, val] of Object.entries(source)) {
    if (k === '__proto__') continue
    const cur = target[k]
    if (isPlainObject(val) && isPlainObject(cur)) mergeInto(cur, val)
    else target[k] = clone(val)
  }
}

/** Fusiona objetos de izquierda a derecha (ver cabecera). Devuelve un objeto nuevo. */
export function deepMerge(...parts: Array<Record<string, unknown> | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const p of parts) {
    if (p === undefined || p === null) continue
    mergeInto(out, p)
  }
  return out
}
