#!/usr/bin/env node
/** Con red: HEAD y, con --download, tamaño/SHA de todas las piezas y SHA-512 de los tarballs del lock. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const pin = JSON.parse(readFileSync(resolve(root, 'resources/video/pin.json'), 'utf8'))
const lock = JSON.parse(readFileSync(resolve(root, 'resources/video/hyperframes/package-lock.json'), 'utf8'))
const download = process.argv.includes('--download')
const platforms = [
  ['darwin', 'arm64'],
  ['win32', 'x64']
]
const totals = Object.fromEntries(platforms.map(([p, a]) => [`${p}-${a}`, 0]))
// Solo dependencias alcanzables: los hijos de un opcional de otra plataforma tampoco se descargan.
const selected = Object.fromEntries(
  platforms.map(([os, cpu]) => {
    const seen = new Set()
    function visit(name) {
      const p = lock.packages[name]
      if (!p || seen.has(name) || (p.os && !p.os.includes(os)) || (p.cpu && !p.cpu.includes(cpu))) return
      seen.add(name)
      for (const dep of Object.keys({ ...p.dependencies, ...p.optionalDependencies })) {
        let prefix = name
        while (prefix && !lock.packages[`${prefix}/node_modules/${dep}`]) {
          const index = prefix.lastIndexOf('/node_modules/')
          prefix = index >= 0 ? prefix.slice(0, index) : ''
        }
        visit(prefix ? `${prefix}/node_modules/${dep}` : `node_modules/${dep}`)
      }
    }
    visit('')
    return [`${os}-${cpu}`, seen]
  })
)
let failures = 0

async function response(url, method = 'GET') {
  const r = await fetch(url, { method, signal: AbortSignal.timeout(120_000) })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return r
}
async function measure(url, algorithm = 'sha256') {
  const r = await response(url)
  const h = createHash(algorithm)
  let bytes = 0
  for await (const chunk of r.body) {
    bytes += chunk.byteLength
    if (bytes > 500_000_000) throw new Error('tope de descarga')
    h.update(chunk)
  }
  return { bytes, hash: h.digest(algorithm === 'sha512' ? 'base64' : 'hex') }
}
function equal(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: ${actual} ≠ ${expected}`)
}
async function check(label, fn) {
  try {
    await fn()
    console.log(`OK ${label}`)
  } catch (e) {
    failures++
    console.error(`FALLA ${label}: ${e.message}`)
  }
}

for (const [file, field] of [
  ['package.json', 'packageSha256'],
  ['package-lock.json', 'lockSha256']
]) {
  await check(file, async () =>
    equal(
      createHash('sha256')
        .update(readFileSync(resolve(root, 'resources/video/hyperframes', file)))
        .digest('hex'),
      pin.hyperframes[field],
      file
    )
  )
}
for (const id of ['chrome', 'ffmpeg', 'ffprobe']) {
  for (const [key, a] of Object.entries(pin[id].assets)) {
    await check(`${id} ${key}`, async () => {
      equal(Number((await response(a.url, 'HEAD')).headers.get('content-length')), a.size, 'HEAD bytes')
      if (download) {
        const got = await measure(a.url)
        equal(got.bytes, a.size, 'bytes')
        equal(got.hash, a.sha256, 'SHA-256')
        console.log(JSON.stringify({ id, key, ...got }))
      }
      if (key === 'darwin-arm64' && id !== 'chrome') {
        const official = (await (await response(`${a.url}.sha256`)).text()).trim().split(/\s/)[0]
        equal(official, a.sha256, 'SHA-256 publicado')
      }
    })
  }
}
for (const [name, p] of Object.entries(lock.packages)) {
  if (!name) continue
  const applies = platforms.filter(([os, cpu]) => selected[`${os}-${cpu}`].has(name))
  if (!applies.length) continue
  await check(name, async () => {
    if (!p.resolved?.startsWith('https://registry.npmjs.org/') || !p.integrity?.startsWith('sha512-'))
      throw new Error('fuente o integridad no fijada')
    let bytes
    if (download) {
      const got = await measure(p.resolved, 'sha512')
      equal(`sha512-${got.hash}`, p.integrity, 'integrity')
      bytes = got.bytes
    } else bytes = Number((await response(p.resolved, 'HEAD')).headers.get('content-length'))
    for (const [os, cpu] of applies) totals[`${os}-${cpu}`] += bytes
  })
}
for (const [key, n] of Object.entries(totals))
  await check(`npm ${key}: ${n} bytes`, async () => equal(n, pin.hyperframes.downloadBytes[key], 'total npm'))
console.log(failures ? `${failures} fallo(s). No usar el pin.` : 'Todas las piezas coinciden. Windows aún requiere prueba de ejecución.')
process.exitCode = failures ? 1 : 0
