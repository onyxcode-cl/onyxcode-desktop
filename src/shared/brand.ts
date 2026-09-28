/**
 * Identidad de la app. ÚNICO lugar donde vive el nombre (además de package.json y
 * electron-builder.js). Todo el resto del código importa desde aquí.
 */
export const APP_NAME = 'Lapis'
export const APP_ID = 'cl.bentec.lapis'
/** Slug en minúsculas, útil para usuarios/identificadores técnicos. */
export const APP_SLUG = 'lapis'

/**
 * Colores de marca para el proceso principal (p.ej. `backgroundColor` de BrowserWindow,
 * que se pinta antes de cargar el CSS). Deben coincidir con `--bg` de
 * renderer/src/app/globals.css. El renderer usa SIEMPRE los tokens CSS, no esto.
 */
export const BRAND_COLORS = {
  /** Fondo de ventana, tema claro. */
  bgLight: '#f7f8fb',
  /** Fondo de ventana, tema oscuro. */
  bgDark: '#11131a',
  /** Azul lapislázuli (acento). */
  accent: '#2c4fd8',
  /** Dorado pirita (chispa del logo). */
  spark: '#f0c35a'
} as const
