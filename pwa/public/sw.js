/*
 * Service worker del sitio del control remoto (solo el origen `CLOUD_DOMAIN` de brand.ts; EXTERNO-PENDIENTE: D3). Escrito a mano, sin librerías.
 *  - `index.html` y el resto de lo que no tiene huella: RED PRIMERO; la caché solo sirve si no hay red.
 *  - `assets/*` y `app/assets/*` (nombre con huella: nunca cambian): CACHÉ PRIMERO.
 *  - NUNCA toca `/v1/*` (la señalización va siempre directa a la red) ni nada de otro origen.
 *  - Una versión nueva del sitio no se impone: se activa al cerrar las pestañas viejas o cuando la página lo pide.
 * Nota: un service worker NO puede fijar la versión del sitio (el navegador revisa este archivo en cada navegación y lo
 * sustituye si cambia). La integridad de la interfaz la cubre el SRI con los hashes que manda el Mac (docs/SEGURIDAD.md).
 * `__BUILD__` lo sustituye `scripts/build-site.mjs` por la huella de esta publicación.
 */
const BUILD = '__BUILD__'
const SHELL = `lazunox-shell-${BUILD}`
const ASSETS = 'lazunox-assets'
const HASHED = /^\/(?:app\/)?assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest'])))
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip') self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith('lazunox-shell-') && n !== SHELL).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/v1/')) return
  if (HASHED.test(url.pathname)) {
    event.respondWith(
      caches.open(ASSETS).then(async (cache) => {
        const hit = await cache.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) await cache.put(req, res.clone())
        return res
      })
    )
    return
  }
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (req.mode === 'navigate' || url.pathname.endsWith('/manifest.webmanifest'))) {
          const copy = res.clone()
          caches.open(SHELL).then((c) => c.put(req, copy))
        }
        return res
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  )
})
