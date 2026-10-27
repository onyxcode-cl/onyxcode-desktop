/** Validación del icono de una app (`AccessRequestApp.icon`): lo comparten main (al generarlo) y el renderer (antes de pintarlo). */
export const ICON_DATA_URL_PREFIX = 'data:image/png;base64,'
/** Tope por icono (caracteres del data URL completo). */
export const ICON_MAX_CHARS = 24 * 1024

/** `data:image/png;base64,…` acotado y solo con caracteres base64: lo único que se acepta como `<img src>`. */
export function isSafeIconDataUrl(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length > ICON_DATA_URL_PREFIX.length &&
    v.length <= ICON_MAX_CHARS &&
    v.startsWith(ICON_DATA_URL_PREFIX) &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(v.slice(ICON_DATA_URL_PREFIX.length))
  )
}
