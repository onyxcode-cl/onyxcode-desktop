#!/usr/bin/env node
// Fija la imagen base de «Tareas en Windows» y el `opencode` de Linux en `resources/opencode-bin/pin.json`. LO CORRE EL DUEÑO (o un
// agente con red autorizada expresamente), NUNCA la app ni CI. Sin --write solo imprime el pin resultante; sin --network no hace nada.
//
// Uso:  node scripts/wsl-rootfs/pin.mjs <versión> --build <rootfs-build.json CI> --build <rootfs-build.json local> --network [--write]
//   --build    exactamente DOS veces: los `rootfs-build.json` de las dos construcciones independientes (CI y local).
//   --network  obligatorio: confirma que sabes que esto descarga ~110-180 MB de GitHub (la imagen) y el opencode de Linux.
//   --write    escribe las claves `wsl-rootfs` y `assets["linux-x64"]` en pin.json (no toca el resto).
// Si algo no cuadra (sha, tamaño, inspect, versión, digest de la API) no escribe nada.
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildOpencodeLinuxAsset, buildRootfsPin, mergePin, OPENCODE_MAX_SIZE, serializePin } from './pin-lib.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const PIN_PATH = join(ROOT, 'resources', 'opencode-bin', 'pin.json')
export const WSL_CONF_PATH = join(ROOT, 'resources', 'wsl', 'wsl.conf')
export const DOWNLOAD_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'])
const MAX_REDIRECTS = 5
const MAX_ROOTFS_DOWNLOAD = 400_000_000

/** Descarga con redirecciones manuales: solo https, sin credenciales ni puerto y solo hosts de la lista. */
export async function download(url, maxBytes) {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = new URL(current)
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !DOWNLOAD_HOSTS.has(u.hostname))
      throw new Error(`URL no permitida: ${current}`)
    const r = await fetch(u, { headers: { 'User-Agent': 'lazunox-pin' }, redirect: 'manual' })
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location')
      if (!loc) throw new Error(`redirección sin destino desde ${current}`)
      current = new URL(loc, u).toString()
      continue
    }
    if (!r.ok) throw new Error(`GET ${current}: ${r.status}`)
    const len = Number(r.headers.get('content-length') ?? 0)
    if (len > maxBytes) throw new Error('la descarga excede el tope')
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > maxBytes) throw new Error('la descarga excede el tope')
    return buf
  }
  throw new Error('demasiadas redirecciones')
}

export function realIo() {
  return {
    async getJson(url) {
      const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'lazunox-pin' } })
      if (!r.ok) throw new Error(`GET ${url}: ${r.status}`)
      return r.json()
    },
    download: (url) => download(url, OPENCODE_MAX_SIZE)
  }
}

async function main() {
  const args = process.argv.slice(2)
  const version = args[0]
  const builds = []
  for (let i = 1; i < args.length; i++) if (args[i] === '--build') builds.push(args[++i])
  if (!version || version.startsWith('--') || !args.includes('--network') || builds.length !== 2 || builds.some((b) => !b)) {
    console.error(
      'Uso: node scripts/wsl-rootfs/pin.mjs <versión> --build <ci.json> --build <local.json> --network [--write]\n' +
        '(descarga la imagen y el opencode de Linux de GitHub: añade --network para confirmarlo)'
    )
    process.exit(2)
  }
  const existing = JSON.parse(readFileSync(PIN_PATH, 'utf8'))
  const io = realIo()
  const rootfs = await buildRootfsPin({
    version,
    builds: builds.map((b) => JSON.parse(readFileSync(b, 'utf8'))),
    download: (url) => download(url, MAX_ROOTFS_DOWNLOAD),
    wslConf: readFileSync(WSL_CONF_PATH, 'utf8')
  })
  const opencodeLinux = await buildOpencodeLinuxAsset({ version: existing.version, io })
  const pin = mergePin(existing, { rootfs, opencodeLinux })
  if (args.includes('--write')) {
    // Escritura atómica: temporal junto al destino y renombre.
    const dir = mkdtempSync(join(dirname(PIN_PATH), '.pin-'))
    try {
      const tmp = join(dir, 'pin.json')
      writeFileSync(tmp, serializePin(pin))
      renameSync(tmp, PIN_PATH)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    console.log(`escrito ${PIN_PATH}`)
  } else process.stdout.write(serializePin(pin))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(String(err?.message ?? err))
    process.exit(1)
  })
}
