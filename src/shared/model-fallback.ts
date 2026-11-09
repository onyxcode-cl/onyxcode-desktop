/**
 * «Modelo de respaldo» (paquete B6, motor lazunox.15): cuando el modelo gratuito en uso se queda sin cuota, el motor cambia solo a otro de
 * una lista corta y avisa en la conversación («El modelo X no respondió; este turno se hizo con Y»). Funciones puras, sin Electron.
 *
 * El motor lee `respaldo: { modelos: ["proveedor/modelo", …], otro_proveedor?: boolean }` de la config en línea (`OPENCODE_CONFIG_CONTENT`),
 * hasta 3, y vuelve a comprobar por su cuenta que cada modelo sea de coste 0 (y de otro servicio solo con `otro_proveedor: true`). Aquí
 * solo se guarda y se escribe lo que la persona eligió. Sin modelos no se escribe nada (apagado).
 */
import type { ModelFallback } from './types'

export const MODEL_FALLBACK_MAX = 3
export const MODEL_FALLBACK_REF_MAX = 400
/** `proveedor/modelo`: los dos lados no vacíos, sin espacios ni controles. El id del modelo puede llevar más barras (p. ej. `openrouter/x/y:free`). */
export const MODEL_FALLBACK_REF_RE = /^[^\s/\u0000-\u001f]+\/[^\s\u0000-\u001f]+$/

export const MODEL_FALLBACK_DEFAULTS: ModelFallback = { models: [], otherProvider: false }

/** Lee lo guardado o recibido: solo textos `proveedor/modelo` válidos, sin repetidos, como mucho 3; `otherProvider` solo con `true` exacto. Nunca lanza. */
export function normalizeModelFallback(raw: unknown): ModelFallback {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const models: string[] = []
  if (Array.isArray(r.models)) {
    for (const v of r.models) {
      if (typeof v !== 'string' || v.length > MODEL_FALLBACK_REF_MAX || !MODEL_FALLBACK_REF_RE.test(v) || models.includes(v)) continue
      models.push(v)
      if (models.length >= MODEL_FALLBACK_MAX) break
    }
  }
  return { models, otherProvider: r.otherProvider === true }
}

/** Bloque `respaldo` de la config en línea del motor, o `null` si no hay modelos (apagado: no se escribe la clave). */
export function modelFallbackInline(raw: unknown): { modelos: string[]; otro_proveedor: boolean } | null {
  const n = normalizeModelFallback(raw)
  return n.models.length ? { modelos: n.models, otro_proveedor: n.otherProvider } : null
}

/** Texto estable de la parte de respaldo, para la huella de la config inline (cambia → hay que relanzar el motor). */
export function modelFallbackKey(raw: unknown): string {
  const b = modelFallbackInline(raw)
  return b ? `${b.modelos.join(',')}|${b.otro_proveedor ? 'otro' : 'mismo'}` : 'sin-respaldo'
}
