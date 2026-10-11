/**
 * Identidad de la app. ÚNICO lugar donde vive el nombre (además de package.json y
 * electron-builder.js). Todo el resto del código importa desde aquí.
 */
/** Nombre VISIBLE al usuario (ventanas, menús, textos, PWA). Es el único que se muestra. */
export const DISPLAY_NAME = 'Lazunox'

/** Quién hace la app: el crédito de la pantalla de bienvenida («Hecho por …»). */
export const MADE_BY = 'Onyx Code'
/**
 * Nombre INTERNO. Identidad de almacenamiento: userData, Llavero («<nombre> Safe Storage»,
 * `app.setName(INTERNAL_NAME)`), User-Agent, `TERM_PROGRAM` y rutas de administrador.
 * Cambiarla exige migración de datos.
 */
export const INTERNAL_NAME = 'Lazunox'

// TODO(alias): cambiar AUTHOR_ALIAS y los literales; ver docs (plan «Identidad»).
// Punto de cambio ÚNICO de la identidad. Hoy los valores derivados son EXACTAMENTE los históricos
// (cambiar el appId haría que macOS pidiera de nuevo Accesibilidad/Grabación de pantalla).
// Literales que NO pueden importar esto y deben cambiarse a la vez (los comprueba
// src/test/brand-consistency.test.ts): electron-builder.js, package.json `author`,
// resources/computer-use/build.sh y resources/launcher/build.sh.
export const AUTHOR_ALIAS = 'bentec'
/** Identificador de bundle de la app. */
export const APP_ID = `cl.${AUTHOR_ALIAS}.lazunox`
/** Firma del helper nativo de computer use. */
export const HELPER_ID = `cl.${AUTHOR_ALIAS}.lazunox.cu-helper`
/** Id del helper de dictado. */
export const DICTATE_ID = `cl.${AUTHOR_ALIAS}.lazunox.dictate`
/** Firma del lanzador «disclaim». */
export const DISCLAIM_ID = `${APP_ID}.disclaim`
/** Slug en minúsculas, útil para usuarios/identificadores técnicos. */
export const APP_SLUG = 'lazunox'

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

/** Dominio del servicio de conexión del control remoto. */
export const CLOUD_DOMAIN = 'remoto.onyxcode.cl' // EXTERNO-PENDIENTE: D3

/**
 * Canal de actualizaciones: GitHub Releases (gratis, sin servidor). La app consulta la API (`RELEASES_API_ORIGIN`:
 * `/repos/<repo>/releases/latest`) y descarga de `RELEASES_ORIGIN` (`/<repo>/releases/download/<tag>/<archivo>`). No hace falta que
 * el canal sea de confianza: cada actualización lleva su firma Ed25519 y la app la comprueba antes de instalar.
 * Alternativa con servidor propio (misma estructura, archivos estáticos): `VPS_RELEASES_*` más abajo y docs/VPS.md; para usarla se
 * ponen esos valores en estas tres constantes (el origen y el de la API son el mismo en el servidor propio).
 */
export const RELEASES_ORIGIN = 'https://github.com'

/** Origen de la API de releases (en GitHub es otro host que las descargas; en el servidor propio es el mismo `RELEASES_ORIGIN`). */
export const RELEASES_API_ORIGIN = 'https://api.github.com'

/** «dueño/repositorio» de las releases. Vacío = sin aviso de versión nueva (sin red). */
export const RELEASES_REPO = 'onyxcode-cl/onyxcode-desktop' as string

/** Servidor propio de releases (alternativa a GitHub, ver docs/VPS.md). Lo usa `scripts/publish-vps.mjs`; la app NO lo consulta salvo que se cambien las tres constantes de arriba. */
export const VPS_RELEASES_ORIGIN = 'https://lazunox.onyxcode.cl'
export const VPS_RELEASES_REPO = 'lazunox/lazunox'

/**
 * Clave PÚBLICA Ed25519 con la que se verifica el manifiesto de cada actualización (SPKI DER en base64,
 * 44 bytes, o los 32 bytes crudos). Vacía = el botón «Actualizar» no existe y el aviso solo ofrece
 * «Descargar». La clave PRIVADA la genera el mantenedor fuera del repo (docs/DISTRIBUCION.md §10) y
 * nunca se sube a GitHub ni a CI.
 */
export const UPDATE_PUBLIC_KEY = 'MCowBQYDK2VwAyEAmGn11rPIhRz472wOGMTERVlaq7sWqoLynBTasttdFQs=' as string
/** Identificador de esa clave; va dentro del manifiesto firmado (`keyId`) y permite rotarla. */
export const UPDATE_KEY_ID = 'lazunox-1' as string

/**
 * Clave PÚBLICA Ed25519 (SPKI DER en base64, 44 bytes, o los 32 crudos) con la que el Mac comprueba el manifiesto firmado del sitio
 * del control remoto («También fuera de casa»; `site-manifest.json` + `.sig`). Vacía = la vigilancia queda «sin verificar» y el modo
 * nube funciona igual, avisando en Ajustes. La PRIVADA la genera el dueño fuera del repo y nunca va a CI ni a Cloudflare
 * (cloud/remoto-worker/README.md); el sitio se firma y publica solo desde su Mac con `scripts/site-release.mjs`.
 */
export const SITE_PUBLIC_KEY = '' as string
/** Identificador de esa clave; va dentro del manifiesto firmado (`keyId`) y permite rotarla con una versión nueva de la app. */
export const SITE_KEY_ID = 'lazunox-site-1' as string
