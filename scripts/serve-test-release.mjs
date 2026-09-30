#!/usr/bin/env node
// Servidor LOCAL (127.0.0.1) que imita una release de GitHub para la prueba manual del actualizador
// (docs/DISTRIBUCION.md §11): `releases/latest`, update.json, update.json.sig y el ZIP (detrás de una redirección 302,
// como hace GitHub). Sirve los archivos que dejó `publish-update.mjs`. No sale a internet ni escucha en otra interfaz.
//
//   node scripts/serve-test-release.mjs --dir <carpeta con update.json + .sig + zip> [--repo owner/repo] [--port 8799]
import { createServer } from 'node:http'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const dir = resolve(arg('--dir', '.'))
const repo = arg('--repo', 'test-owner/test-repo')
const port = Number(arg('--port', '0'))
const manifest = JSON.parse(readFileSync(join(dir, 'update.json'), 'utf8'))
const tag = manifest.tag
const zipName = manifest.zip.name

const files = {
  [`/${repo}/releases/download/${tag}/update.json`]: join(dir, 'update.json'),
  [`/${repo}/releases/download/${tag}/update.json.sig`]: join(dir, 'update.json.sig'),
  [`/cdn/${zipName}`]: join(dir, zipName)
}

const server = createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0]
  console.log(`${req.method} ${req.url}`)
  if (path === `/repos/${repo}/releases/latest`) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ tag_name: tag, html_url: `https://github.com/${repo}/releases/tag/${tag}`, draft: false, prerelease: false }))
  } else if (path === `/${repo}/releases/download/${tag}/${zipName}`) {
    res.writeHead(302, { location: `/cdn/${zipName}` })
    res.end()
  } else if (files[path]) {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(statSync(files[path]).size) })
    createReadStream(files[path]).pipe(res)
  } else {
    res.writeHead(404)
    res.end()
  }
})
server.listen(port, '127.0.0.1', () => console.log(`listening http://127.0.0.1:${server.address().port} (${repo} ${tag})`))
