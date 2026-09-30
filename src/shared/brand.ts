/**
 * Identidad de la app. ÚNICO lugar donde vive el nombre (además de package.json y
 * electron-builder.js). Todo el resto del código importa desde aquí.
 */
export const APP_NAME = 'OnyxCode'

// TODO(alias): cambiar AUTHOR_ALIAS y los literales; ver docs (plan «Identidad»).
// Punto de cambio ÚNICO de la identidad. Hoy los valores derivados son EXACTAMENTE los históricos
// (cambiar el appId haría que macOS pidiera de nuevo Accesibilidad/Grabación de pantalla).
// Literales que NO pueden importar esto y deben cambiarse a la vez (los comprueba
// src/test/brand-consistency.test.ts): electron-builder.js, package.json `author`,
// resources/computer-use/build.sh y resources/launcher/build.sh.
export const AUTHOR_ALIAS = 'bentec'
/** Identificador de bundle de la app. */
export const APP_ID = `cl.${AUTHOR_ALIAS}.onyxcode`
/** Firma del helper nativo de computer use. «opendesk» se mantiene para no cambiar la firma. */
export const HELPER_ID = `cl.${AUTHOR_ALIAS}.opendesk.cu-helper`
/** Firma del lanzador «disclaim». */
export const DISCLAIM_ID = `${APP_ID}.disclaim`
/** Slug en minúsculas, útil para usuarios/identificadores técnicos. */
export const APP_SLUG = 'onyxcode'

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

/** «owner/repo» público en GitHub donde se publican las releases. Vacío = sin aviso de versión nueva (sin red). */
export const RELEASES_REPO = '' as string

/**
 * Clave PÚBLICA Ed25519 con la que se verifica el manifiesto de cada actualización (SPKI DER en base64,
 * 44 bytes, o los 32 bytes crudos). Vacía = el botón «Actualizar» no existe y el aviso solo ofrece
 * «Descargar». La clave PRIVADA la genera el mantenedor fuera del repo (docs/DISTRIBUCION.md §10) y
 * nunca se sube a GitHub ni a CI.
 */
export const UPDATE_PUBLIC_KEY = '' as string
/** Identificador de esa clave; va dentro del manifiesto firmado (`keyId`) y permite rotarla. */
export const UPDATE_KEY_ID = 'onyxcode-1' as string

/**
 * Servidor de cuentas (origen `https://…`, sin ruta). `null` = la app NO exige iniciar sesión y no
 * contacta ningún servidor de cuenta. Se rellena SOLO al activar las cuentas (ver
 * docs/CUENTAS-SERVIDOR.md y docs/SEGURIDAD.md «Cuenta»).
 */
export const ACCOUNT_API = null as string | null

/** Política de privacidad y términos publicados (URL `https://…`). Vacío = la pantalla muestra el borrador local. */
export const PRIVACY_URL = '' as string
export const TERMS_URL = '' as string
