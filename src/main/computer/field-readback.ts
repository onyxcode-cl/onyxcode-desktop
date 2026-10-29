/**
 * Lectura de vuelta del CAMPO ENFOCADO tras `type_text` físico y `key`, y pre-chequeo de `app_press` (F8-B…, mejoras 1 y 2 de
 * `docs/ESTUDIO-CUA-HERMES.md`). Funciones PURAS sobre lo que ya devuelve `ax-tree` (macOS y Windows); no importa `electron`.
 *
 * Regla de oro: solo se afirma lo que se leyó. Sin lectura fiable ⇒ `unverifiable`; nunca se devuelve contenido del campo al modelo.
 * Todo se decide por la señal observada (valor antes/después, rol, acciones anunciadas), nunca por el nombre de una app o proceso.
 */

import { AX_VALUE_CLIP, normField } from './window-probe'

/** Lo mínimo que hace falta de un nodo de `ax-tree`. */
export interface AxNodeLike {
  ref: string
  role: string
  subrole?: string
  value?: string
  secure?: boolean
  enabled?: boolean
  focused?: boolean
  actions?: string[]
}

/** Campo enfocado leído de un árbol. El valor de un campo seguro NUNCA se conserva. */
export interface FocusedField {
  ref: string
  role: string
  secure: boolean
  value: string
  /** Cuelga de un `AXWebArea`: su valor puede ir con retraso o hacer eco, así que solo se usa para CONFIRMAR, nunca para negar. */
  underWebArea: boolean
}

const EDITABLE_ROLES = /^(AXTextField|AXTextArea|AXComboBox|AXSearchField|AXSecureTextField|Edit|ComboBox|Document)$/
const EDITABLE_SUBROLES = /^(AXSearchField|AXSecureTextField)$/

/** El campo editable con foco (el más profundo si hay varios); `null` si no hay ninguno. */
export function pickFocusedField(nodes: readonly AxNodeLike[]): FocusedField | null {
  let best: AxNodeLike | null = null
  for (const n of nodes) {
    if (n.focused !== true) continue
    if (!EDITABLE_ROLES.test(n.role) && !(n.subrole && EDITABLE_SUBROLES.test(n.subrole))) continue
    if (!best || n.ref.length > best.ref.length) best = n
  }
  if (!best) return null
  const secure = best.secure === true || best.role === 'AXSecureTextField' || best.subrole === 'AXSecureTextField'
  const underWebArea = nodes.some((x) => x.role === 'AXWebArea' && best!.ref.startsWith(`${x.ref}.`))
  // Sin atributo de valor (campo vacío en Windows) ⇒ vacío.
  return { ref: best.ref, role: best.role, secure, value: secure ? '' : typeof best.value === 'string' ? best.value : '', underWebArea }
}

export type TypedProgress =
  | { kind: 'complete' }
  | { kind: 'partial'; typed: number; total: number }
  /** El valor cambió pero lo agregado NO es el texto escrito (letras cambiadas o perdidas): evidencia EN CONTRA. `firstDiff` = posición (0) del primer carácter distinto. */
  | { kind: 'mismatch'; firstDiff: number; total: number }
  | { kind: 'unchanged' }
  | { kind: 'unverifiable'; why: string }

/** Pista para el modelo cuando lo escrito salió distinto de lo pedido (no lleva contenido del campo). */
export const TYPE_RETRY_HINT =
  'no lo des por escrito: míralo con app_screenshot y, si salió distinto, bórralo y repítelo en trozos más cortos, con input "paste" (si la plataforma lo ofrece) o con app_set_value (escritura por accesibilidad)'

const countOf = (hay: string, needle: string): number => (needle ? hay.split(needle).length - 1 : 0)

/**
 * ¿Llegó `written` al campo enfocado? Compara el valor de ANTES y el de DESPUÉS del MISMO campo (misma ref y rol):
 * - `complete`: el texto aparece más veces que antes (o es justo lo que se agregó).
 * - `partial`: se agregó solo el comienzo del texto (se cortó o va con retraso). Solo fuera de una vista web.
 * - `unchanged`: el valor es idéntico. Solo fuera de una vista web (allí el valor puede ir con retraso).
 * - `mismatch`: el valor cambió y lo agregado no es lo escrito (ni su comienzo): letras cambiadas o perdidas. Solo fuera de una vista web.
 * - `unverifiable`: campo seguro, valor recortado (200), foco en otro campo, texto terminado en Return (puede haberse enviado y vaciado)
 *   o falta una de las dos lecturas.
 */
export function typedProgress(written: string, before: FocusedField | null, after: FocusedField | null): TypedProgress {
  const unv = (why: string): TypedProgress => ({ kind: 'unverifiable', why })
  if (!before || !after) return unv('no se pudo leer el campo enfocado')
  if (before.secure || after.secure) return unv('es un campo seguro y no se lee su valor')
  if (before.ref !== after.ref || before.role !== after.role) return unv('el foco pasó a otro campo')
  const submitted = /[\r\n]\s*$/.test(written)
  const w = normField(written)
  if (!w) return unv('no hay texto que comparar')
  const a0 = normField(before.value)
  const a1 = normField(after.value)
  const clipped = before.value.length >= AX_VALUE_CLIP || after.value.length >= AX_VALUE_CLIP
  if (countOf(a1, w) > countOf(a0, w)) return { kind: 'complete' }
  if (clipped) return unv('el campo es largo y su final no se puede leer')
  if (submitted) return unv('el texto terminaba en Return: el campo pudo enviarse o vaciarse')
  if (after.underWebArea) return unv('el valor de una vista web puede ir con retraso')
  if (a0 === a1) return { kind: 'unchanged' }
  // Lo agregado = lo que queda entre el prefijo y el sufijo comunes.
  let p = 0
  while (p < a0.length && p < a1.length && a0[p] === a1[p]) p++
  let s = 0
  while (s < a0.length - p && s < a1.length - p && a0[a0.length - 1 - s] === a1[a1.length - 1 - s]) s++
  const inserted = a1.slice(p, a1.length - s).trim()
  if (inserted && inserted.length < w.length && w.startsWith(inserted)) return { kind: 'partial', typed: inserted.length, total: w.length }
  if (!inserted) return unv('el valor cambió pero no se pudo aislar lo agregado')
  let firstDiff = 0
  while (firstDiff < inserted.length && firstDiff < w.length && inserted[firstDiff] === w[firstDiff]) firstDiff++
  return { kind: 'mismatch', firstDiff, total: w.length }
}

/** `key`: ¿cambió el valor del campo enfocado? Solo `changed` es una evidencia; lo demás no prueba nada (Return, Tab, atajos pueden no tocar el campo). */
export function keyFieldChange(before: FocusedField | null, after: FocusedField | null): 'changed' | 'unknown' {
  if (!before || !after || before.secure || after.secure) return 'unknown'
  if (before.ref !== after.ref || before.role !== after.role) return 'unknown'
  const clip0 = before.value.length >= AX_VALUE_CLIP
  const clip1 = after.value.length >= AX_VALUE_CLIP
  if (normField(before.value) !== normField(after.value) || clip0 !== clip1) return 'changed'
  return 'unknown'
}

export type PressPrecheck = { ok: true } | { ok: false; code: 'disabled'; message: string }

/** Antes de pulsar por accesibilidad: un elemento deshabilitado no acepta la pulsación (se rechaza SIN enviar nada). */
export function pressPrecheck(node: { enabled?: boolean } | null | undefined, ref: string): PressPrecheck {
  if (node && node.enabled === false) {
    return {
      ok: false,
      code: 'disabled',
      message:
        `El elemento ${ref} está deshabilitado y no acepta la pulsación; no se envió nada. ` +
        'Vuelve a pedir app_find (otro elemento puede cumplir), o haz antes lo que lo habilita (rellenar un campo, elegir una opción).'
    }
  }
  return { ok: true }
}

/** Pulsación hueca probable: el elemento publica sus acciones y `AXPress` no está entre ellas (si no publica ninguna lista, no se afirma nada). */
export function pressNotAnnounced(actions: readonly string[] | undefined): boolean {
  return Array.isArray(actions) && !actions.includes('AXPress')
}
