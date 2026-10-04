/**
 * Tema resuelto que el celular recuerda para que la capa ligera (arranque, PIN, errores) pinte igual que la interfaz completa.
 * El tema lo decide el ajuste del Mac; la interfaz completa lo escribe aquí cuando cambia `data-theme` en <html>.
 * Tolerante: un almacenamiento que lanza o un valor ajeno se tratan como «sin valor».
 */
export const THEME_PREF_KEY = 'onyx.theme'
export type ThemePref = 'light' | 'dark'

type Reader = Pick<Storage, 'getItem'>
type Writer = Pick<Storage, 'setItem'>

export const isThemePref = (v: unknown): v is ThemePref => v === 'light' || v === 'dark'

export function readThemePref(storage: Reader | null | undefined): ThemePref | null {
  try {
    const v = storage?.getItem(THEME_PREF_KEY)
    return isThemePref(v) ? v : null
  } catch {
    return null
  }
}

/** Devuelve `true` si se guardó. Un valor inválido no se escribe. */
export function writeThemePref(storage: Writer | null | undefined, value: unknown): boolean {
  if (!isThemePref(value)) return false
  try {
    storage?.setItem(THEME_PREF_KEY, value)
    return true
  } catch {
    return false
  }
}
