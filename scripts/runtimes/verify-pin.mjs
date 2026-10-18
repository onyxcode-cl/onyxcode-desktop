#!/usr/bin/env node
/**
 * Comprueba (CON RED) que `resources/runtimes/pin.json` coincide con las sumas OFICIALES publicadas por cada proyecto:
 *   - Node.js: `https://nodejs.org/dist/v<versión>/SHASUMS256.txt`;
 *   - uv: el archivo `<activo>.sha256` de la release de GitHub de astral-sh/uv.
 * Además compara el tamaño con el `Content-Length` de la descarga (HEAD). Con `--download` baja cada archivo, calcula su SHA-256 y
 * tamaño reales y los compara con el pin y con la suma oficial (lo que se hizo al fijar las versiones).
 *
 * Uso:  node scripts/runtimes/verify-pin.mjs [--download]
 * Sale con código 1 si algo no coincide. Para ACTUALIZAR las versiones: edita `resources/runtimes/pin.json` (versión, URL, tamaño, sha256
 * copiados de la suma oficial), corre este script con `--download` y recién entonces confirma el cambio. Ver docs/SEGURIDAD.md.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const pin = JSON.parse(readFileSync(join(root, 'resources/runtimes/pin.json'), 'utf8'))
const download = process.argv.includes('--download')

let failures = 0
const ok = (msg) => console.log(`  ok   ${msg}`)
const bad = (msg) => {
  failures++
  console.log(`  FALLA ${msg}`)
}

async function text(url) {
  const r = await fetch(url, { redirect: 'follow' })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return r.text()
}

async function officialSum(id, asset) {
  const name = asset.url.split('/').pop()
  if (id === 'node') {
    const sums = await text(`https://nodejs.org/dist/v${pin.node.version}/SHASUMS256.txt`)
    const line = sums.split('\n').find((l) => l.trim().endsWith(`  ${name}`))
    return line ? line.trim().split(/\s+/)[0] : null
  }
  const body = (await text(`${asset.url}.sha256`)).trim()
  return body.split(/\s+/)[0] ?? null
}

for (const id of ['node', 'uv']) {
  console.log(`${id} ${pin[id].version}`)
  for (const [key, a] of Object.entries(pin[id].assets)) {
    const label = `${id} ${key}`
    if (!/^[0-9a-f]{64}$/.test(a.sha256 ?? '')) {
      bad(`${label}: el pin no trae un SHA-256 válido`)
      continue
    }
    try {
      const official = await officialSum(id, a)
      if (!official) bad(`${label}: no aparece en la suma oficial`)
      else if (official !== a.sha256) bad(`${label}: SHA-256 del pin ${a.sha256} ≠ oficial ${official}`)
      else ok(`${label}: SHA-256 coincide con la suma oficial`)
      const head = await fetch(a.url, { method: 'HEAD', redirect: 'follow' })
      const len = Number(head.headers.get('content-length'))
      if (!head.ok) bad(`${label}: la URL responde HTTP ${head.status}`)
      else if (len !== a.size) bad(`${label}: tamaño del pin ${a.size} ≠ Content-Length ${len}`)
      else ok(`${label}: tamaño ${a.size} bytes`)
      if (download) {
        const r = await fetch(a.url, { redirect: 'follow' })
        const buf = Buffer.from(await r.arrayBuffer())
        const got = createHash('sha256').update(buf).digest('hex')
        if (buf.length !== a.size) bad(`${label}: descargado ${buf.length} bytes ≠ ${a.size}`)
        else if (got !== a.sha256) bad(`${label}: SHA-256 calculado ${got} ≠ pin ${a.sha256}`)
        else ok(`${label}: archivo descargado y calculado, coincide con el pin`)
      }
    } catch (e) {
      bad(`${label}: ${e instanceof Error ? e.message : e}`)
    }
  }
}

console.log(failures === 0 ? '\nTodo coincide con las fuentes oficiales.' : `\n${failures} desacuerdo(s). NO uses este pin.`)
process.exit(failures === 0 ? 0 : 1)
