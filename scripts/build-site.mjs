#!/usr/bin/env node
// Arma `pwa/dist-site/`: el sitio que publica el dueño en https://remoto.onyxcode.cl (NO se despliega desde aquí ni desde CI).
//
//   node scripts/build-site.mjs            usa `pwa/dist` ya compilado (`npm run build:pwa`)
//   node scripts/build-site.mjs --build    compila antes la PWA (ligera + completa)
//
// Contenido: el arranque ligero y la interfaz completa de `pwa/dist` (sin los `.gz`: Cloudflare comprime), `sw.js` con la huella de
// la publicación, `manifest.webmanifest`, iconos, `_headers` (CSP estricta) y el `index.html` con el manifiesto. El manifiesto del
// sitio firmado (`site-manifest.json`) lo genera `scripts/site-release.mjs` con la clave del dueño.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildId, headersFile, patchIndex, swWithBuild } from './site-lib.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'pwa', 'dist')
const pub = join(root, 'pwa', 'public')
const out = join(root, 'pwa', 'dist-site')

if (process.argv.includes('--build')) {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'build-pwa.mjs')], { cwd: root, stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
if (!existsSync(join(dist, 'index.html')) || !existsSync(join(dist, 'app', 'entry.json'))) {
  console.error('[build:site] falta pwa/dist (arranque + app/). Ejecuta `npm run build:pwa` o usa --build.')
  process.exit(1)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(dist, out, { recursive: true, filter: (src) => !src.endsWith('.gz') })
for (const name of readdirSync(pub)) cpSync(join(pub, name), join(out, name))

const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

// index.html con el manifiesto; la huella sale del contenido (reproducible) y va en el service worker.
const index = join(out, 'index.html')
writeFileSync(index, patchIndex(readFileSync(index, 'utf8')))
const swPath = join(out, 'sw.js')
const sw = readFileSync(swPath, 'utf8')
const pre = walk(out)
  .filter((p) => p !== swPath)
  .map((p) => ({ p: relative(out, p).split('\\').join('/'), sha256: sha(p) }))
const build = buildId(pre)
writeFileSync(swPath, swWithBuild(sw, build))
writeFileSync(join(out, '_headers'), headersFile())

const n = walk(out).length
console.log(
  `[build:site] pwa/dist-site listo: ${n} archivos, publicación ${build}. Siguiente: scripts/site-release.mjs (firma el manifiesto).`
)
