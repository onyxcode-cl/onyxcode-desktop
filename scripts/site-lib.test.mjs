import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  CSP,
  SITE_ORIGIN,
  buildId,
  buildSiteManifest,
  headersFile,
  patchIndex,
  siteManifestBytes,
  startupPaths,
  swWithBuild
} from './site-lib.mjs'

test('CSP: estricta, sin terceros, sin eval ni scripts en línea', () => {
  for (const bad of ["'unsafe-eval'", 'http:', '*', "script-src 'self' 'unsafe-inline'"]) assert.ok(!CSP.includes(bad), bad)
  assert.match(CSP, /default-src 'none'/)
  assert.match(CSP, /script-src 'self'(;|$)/)
  assert.ok(CSP.includes(`connect-src 'self' ${SITE_ORIGIN.replace('https:', 'wss:')}`))
  assert.match(CSP, /frame-ancestors 'none'/)
  assert.match(CSP, /base-uri 'none'/)
  assert.match(CSP, /worker-src 'self'/)
})

test('_headers: todas las rutas con la CSP y el resto de cabeceras; caché inmutable solo para lo con huella', () => {
  const h = headersFile()
  const blocks = h.trim().split('\n\n')
  assert.equal(blocks.length, 7)
  for (const b of blocks) {
    assert.ok(b.includes(`Content-Security-Policy: ${CSP}`))
    assert.ok(b.includes('X-Content-Type-Options: nosniff'))
    assert.ok(b.includes('Referrer-Policy: no-referrer'))
    assert.ok(b.includes('Cross-Origin-Opener-Policy: same-origin'))
    assert.ok(b.includes('camera=()') && b.includes('microphone=()') && b.includes('geolocation=()'))
  }
  assert.match(blocks[1], /^\/assets\/\*[\s\S]*immutable/)
  assert.match(blocks[2], /^\/app\/assets\/\*[\s\S]*immutable/)
  assert.ok(!blocks[3].includes('immutable') && blocks[3].includes('no-cache'))
  assert.ok(blocks[4].startsWith('/sw.js') && blocks[4].includes('no-cache'))
})

test('patchIndex: añade manifiesto e icono una sola vez y exige </head>', () => {
  const html = '<!doctype html><html><head><title>x</title></head><body></body></html>'
  const out = patchIndex(html)
  assert.match(out, /<link rel="manifest" href="\.\/manifest\.webmanifest"/)
  assert.match(out, /apple-touch-icon/)
  assert.equal(patchIndex(out), out)
  assert.throws(() => patchIndex('<html></html>'))
})

test('buildId: reproducible, independiente del orden y sensible a cualquier cambio', () => {
  const a = [
    { p: 'a.js', sha256: '11' },
    { p: 'b.js', sha256: '22' }
  ]
  assert.equal(buildId(a), buildId([...a].reverse()))
  assert.match(buildId(a), /^[a-f0-9]{12}$/)
  assert.notEqual(
    buildId(a),
    buildId([
      { p: 'a.js', sha256: '11' },
      { p: 'b.js', sha256: '23' }
    ])
  )
  assert.notEqual(
    buildId(a),
    buildId([
      { p: 'a.js', sha256: '11' },
      { p: 'c.js', sha256: '22' }
    ])
  )
})

test('swWithBuild: sustituye la marca y falla si no está o el id es raro', () => {
  assert.equal(swWithBuild("const BUILD = '__BUILD__'", 'abcdef012345'), "const BUILD = 'abcdef012345'")
  assert.throws(() => swWithBuild('sin marca', 'abcdef012345'))
  assert.throws(() => swWithBuild("'__BUILD__'", 'xx'))
})

test('sw.js real: sin /v1/, sin otros orígenes, sin push (entrega 1), corto y con marca de publicación', () => {
  const sw = readFileSync(new URL('../pwa/public/sw.js', import.meta.url), 'utf8')
  assert.ok(sw.split('\n').length < 100)
  assert.match(sw, /startsWith\('\/v1\/'\)/)
  assert.match(sw, /url\.origin !== self\.location\.origin/)
  assert.ok(!/importScripts|\bpush\b|showNotification/.test(sw))
  assert.ok(sw.includes('__BUILD__'))
})

test('manifiesto: instalable (nombre, inicio, pantalla completa, iconos 192 y 512)', () => {
  const m = JSON.parse(readFileSync(new URL('../pwa/public/manifest.webmanifest', import.meta.url), 'utf8'))
  assert.equal(m.display, 'standalone')
  assert.equal(m.start_url, './')
  assert.deepEqual(m.icons.map((i) => i.sizes).sort(), ['192x192', '512x512', '512x512']) // la tercera es el icono maskable
})

test('startupPaths: la página, el service worker, el manifiesto y todo JS/CSS que index.html enlaza (y nada más)', () => {
  const html =
    '<html><head><link rel="stylesheet" href="./assets/style-AbCd1234.css"><script type="module" src="./assets/index-XyZ98765.js"></script>' +
    '<link rel="icon" href="data:image/svg+xml,x"><script src="https://evil.example/x.js"></script></head></html>'
  assert.deepEqual(startupPaths(html), [
    'index.html',
    'sw.js',
    'manifest.webmanifest',
    'assets/style-AbCd1234.css',
    'assets/index-XyZ98765.js'
  ])
  assert.deepEqual(startupPaths('<html></html>'), ['index.html', 'sw.js', 'manifest.webmanifest'])
})

test('manifiesto: ordenado, con los bytes exactos que se firman y terminado en salto de línea', () => {
  const m = buildSiteManifest({
    files: [
      { p: 'b.js', sha256: '2'.repeat(64) },
      { p: 'a.js', sha256: '1'.repeat(64) }
    ],
    startup: ['index.html'],
    build: 'abcdef012345',
    version: '0.3.0',
    keyId: 'k',
    seq: 5,
    csp: CSP,
    publishedAt: '2026-10-04T00:00:00.000Z'
  })
  assert.deepEqual(
    m.files.map((f) => f.p),
    ['a.js', 'b.js']
  )
  const bytes = siteManifestBytes(m)
  assert.equal(bytes.at(-1), 0x0a)
  assert.deepEqual(JSON.parse(bytes.toString('utf8')), m)
})
