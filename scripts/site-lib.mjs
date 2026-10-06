// Piezas puras del sitio del control remoto (`SITE_ORIGIN`): cabeceras (`_headers`), parche del `index.html` y huella
// de la publicación. Las usa `scripts/build-site.mjs` y las prueba `scripts/site-lib.test.mjs`. Sin red ni dependencias.
import { createHash } from 'node:crypto'

export const SITE_ORIGIN = 'https://remoto.onyxcode.cl' // EXTERNO-PENDIENTE: D3 (debe coincidir con CLOUD_DOMAIN de brand.ts)

/** CSP estricta del sitio: sin terceros, sin scripts en línea, sin `eval`. `wss:` del propio sitio para la señalización. */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${SITE_ORIGIN.replace('https:', 'wss:')}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

const COMMON = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
}

/** Contenido del archivo `_headers` de Cloudflare (static assets). */
export function headersFile() {
  const block = (path, extra) => [path, ...Object.entries({ ...COMMON, ...extra }).map(([k, v]) => `  ${k}: ${v}`)].join('\n')
  return (
    [
      block('/*', {}),
      block('/assets/*', { 'Cache-Control': 'public, max-age=31536000, immutable' }),
      block('/app/assets/*', { 'Cache-Control': 'public, max-age=31536000, immutable' }),
      block('/index.html', { 'Cache-Control': 'no-cache' }),
      block('/sw.js', { 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' }),
      block('/manifest.webmanifest', { 'Cache-Control': 'no-cache' }),
      block('/app/entry.json', { 'Cache-Control': 'no-cache' })
    ].join('\n\n') + '\n'
  )
}

/** Añade al `<head>` lo que solo tiene sentido en el sitio (manifiesto e icono de iOS); el `index.html` de la red local no lo lleva. */
export function patchIndex(html) {
  if (html.includes('rel="manifest"')) return html
  const tags =
    '    <link rel="manifest" href="./manifest.webmanifest" />\n' +
    '    <link rel="apple-touch-icon" href="./apple-touch-icon.png" />\n' +
    '    <meta name="mobile-web-app-capable" content="yes" />\n' +
    '    <meta name="apple-mobile-web-app-capable" content="yes" />\n' +
    '    <meta name="apple-mobile-web-app-title" content="Lazunox" />\n'
  if (!html.includes('</head>')) throw new Error('index.html sin </head>')
  return html.replace('</head>', `${tags}  </head>`)
}

/** Huella corta y reproducible de una publicación: sha256 de «ruta:sha256» ordenado. `files` = [{p, sha256}]. */
export function buildId(files) {
  const h = createHash('sha256')
  for (const f of [...files].sort((a, b) => (a.p < b.p ? -1 : 1))) h.update(`${f.p}:${f.sha256}\n`)
  return h.digest('hex').slice(0, 12)
}

/** Sustituye `__BUILD__` en el service worker (exactamente una vez; si falta, es un error). */
export function swWithBuild(src, build) {
  if (!/^[a-f0-9]{12}$/.test(build)) throw new Error('build inválido')
  const out = src.replace(/__BUILD__/g, build)
  if (out === src) throw new Error('sw.js sin __BUILD__')
  return out
}

// ---- manifiesto firmado del sitio (lo comprueba el Mac: src/shared/remote/site-manifest.ts + src/main/remote/site-watch.ts) ----

export const MANIFEST_NAME = 'site-manifest.json'
export const SIGNATURE_NAME = 'site-manifest.sig'

/** Archivos del arranque que el Mac vigila: la página, el service worker, el manifiesto de la app y todo JS/CSS que `index.html` enlaza. */
export function startupPaths(indexHtml) {
  const out = new Set(['index.html', 'sw.js', 'manifest.webmanifest'])
  for (const m of indexHtml.matchAll(/\b(?:src|href)="\.\/(assets\/[A-Za-z0-9._-]+\.(?:js|css))"/g)) out.add(m[1])
  return [...out]
}

/** Manifiesto del sitio. `files` = [{p, sha256}] de TODO lo que se sirve (sin `_headers`, que Cloudflare consume y no sirve). */
export function buildSiteManifest({ files, startup, build, version, keyId, seq, csp, publishedAt }) {
  return {
    v: 1,
    keyId,
    build,
    version,
    seq,
    publishedAt,
    csp,
    files: [...files].sort((a, b) => (a.p < b.p ? -1 : 1)).map((f) => ({ p: f.p, sha256: f.sha256 })),
    startup
  }
}

/** Bytes EXACTOS que se firman: el Mac verifica sobre ellos antes de interpretar el JSON. */
export function siteManifestBytes(m) {
  return Buffer.from(JSON.stringify(m, null, 2) + '\n', 'utf8')
}
