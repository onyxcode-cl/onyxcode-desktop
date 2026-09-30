#!/usr/bin/env node
// Test de contrato con la API de OpenCode (`npm run check:opencode`).
//
// Arranca un binario de OpenCode con HOME/XDG TEMPORALES en un puerto libre, pide su OpenAPI (`/doc`) y:
//   (a) comprueba que TODAS las rutas que la app usa existen (método + ruta);
//   (b) compara el conjunto de rutas con la instantánea resources/opencode-bin/api-routes.json;
//   (c) compara la forma (request/response, con $ref resueltos) de las rutas usadas con la instantánea.
//
// Uso: node scripts/check-opencode.mjs [--bin <ruta>] [--latest] [--update-snapshot]
//   --bin <ruta>        binario a probar (por defecto resources/opencode-bin/bin/opencode).
//   --latest            descarga la última release oficial a un directorio temporal (SHA-256 contra el
//                       `digest` de GitHub) y prueba ESE binario; no toca pin.json ni el binario fijado.
//   --update-snapshot   reescribe api-routes.json con el binario probado (solo a mano, al subir el pin).
// Salida: 0 sin problemas (rutas nuevas = informativo) · 1 falta una ruta usada · 2 cambió el esquema de una
// ruta usada (revisión humana) · 3 error de infraestructura (no arranca, sin red…).
// El binario se mata SIEMPRE y el temporal se borra. Sin dependencias.
import { spawn, execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { binaryVersion, downloadFile, verifyDownload } from './fetch-opencode.mjs'
import { ROOT, SNAPSHOT_PATH, compareContract, routesFromOpenApi, schemaDigests, sdkRoutes, usedRoutes } from './opencode-contract-lib.mjs'

const DEFAULT_BIN = join(ROOT, 'resources', 'opencode-bin', 'bin', 'opencode')
const LATEST_API = 'https://api.github.com/repos/anomalyco/opencode/releases/latest'
const ASSET = 'opencode-darwin-arm64.zip'
const STARTUP_TIMEOUT_MS = 30_000

const log = (m = '') => console.log(m)

function parseArgs(argv) {
  const o = { bin: null, latest: false, update: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--bin') o.bin = argv[++i]
    else if (a === '--latest') o.latest = true
    else if (a === '--update-snapshot') o.update = true
    else throw new Error(`Opción desconocida: ${a}`)
  }
  if (o.bin === undefined || (o.bin !== null && !o.bin)) throw new Error('--bin necesita una ruta')
  if (o.latest && o.bin) throw new Error('--latest y --bin son excluyentes')
  if (o.latest && o.update) throw new Error('--update-snapshot solo se usa con el binario fijado (o --bin), nunca con --latest')
  return o
}

function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer()
    srv.on('error', rej)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => res(port))
    })
  })
}

function run(cmd, args) {
  return new Promise((res, rej) => {
    execFile(cmd, args, { timeout: 60_000 }, (err, _out, stderr) =>
      err ? rej(new Error(`${cmd} ${args.join(' ')} falló: ${String(stderr).trim() || err.message}`)) : res()
    )
  })
}

/** Descarga la última release oficial a `dir` y devuelve `{ bin, tag }` (verificada contra el digest). */
async function fetchLatest(dir) {
  const res = await fetch(LATEST_API, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'onyxcode-check-opencode' } })
  if (!res.ok) throw new Error(`GitHub respondió HTTP ${res.status} al consultar la última release.`)
  const rel = await res.json()
  const asset = (rel.assets ?? []).find((a) => a.name === ASSET)
  if (!asset) throw new Error(`La release ${rel.tag_name} no tiene el asset ${ASSET}.`)
  const sha256 = /^sha256:([0-9a-f]{64})$/.exec(asset.digest ?? '')?.[1]
  if (!sha256) throw new Error(`El asset no publica un digest sha256 utilizable (${asset.digest}).`)
  const zip = join(dir, ASSET)
  log(`Descargando ${rel.tag_name} (${asset.size} bytes)…`)
  await downloadFile(asset.browser_download_url, zip)
  await verifyDownload(zip, { size: asset.size, sha256 }) // ANTES de descomprimir
  const out = join(dir, 'latest')
  mkdirSync(out)
  await run('ditto', ['-x', '-k', zip, out])
  const bin = join(out, 'opencode')
  if (!existsSync(bin)) throw new Error('El ZIP no contiene el binario `opencode`.')
  chmodSync(bin, 0o755)
  return { bin, tag: rel.tag_name }
}

/** Arranca `bin serve` aislado, ejecuta `fn(baseUrl)` y lo mata SIEMPRE. */
async function withServer(bin, workDir, fn) {
  const home = join(workDir, 'home')
  mkdirSync(home, { recursive: true })
  const port = await freePort()
  const child = spawn(bin, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
    cwd: home,
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      PATH: '/usr/bin:/bin',
      HOME: home,
      XDG_CONFIG_HOME: join(home, 'config'),
      XDG_DATA_HOME: join(home, 'data'),
      XDG_CACHE_HOME: join(home, 'cache'),
      XDG_STATE_HOME: join(home, 'state'),
      TMPDIR: home,
      OPENCODE_DISABLE_AUTOUPDATE: '1'
    }
  })
  let stderr = ''
  child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)))
  let exited = false
  child.on('exit', () => (exited = true))
  child.on('error', () => (exited = true))
  const kill = (sig) => {
    try {
      process.kill(-child.pid, sig)
    } catch {
      /* ya terminó */
    }
  }
  const onSignal = () => {
    kill('SIGKILL')
    process.exit(3)
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  try {
    const base = `http://127.0.0.1:${port}`
    const deadline = Date.now() + STARTUP_TIMEOUT_MS
    for (;;) {
      if (exited) throw new Error(`El binario terminó durante el arranque. ${stderr.trim()}`)
      try {
        const r = await fetch(`${base}/global/health`, { signal: AbortSignal.timeout(2000) })
        if (r.ok) break
      } catch {
        /* aún no escucha */
      }
      if (Date.now() > deadline) throw new Error(`/global/health no respondió en ${STARTUP_TIMEOUT_MS / 1000} s.`)
      await new Promise((r) => setTimeout(r, 200))
    }
    return await fn(base)
  } finally {
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    kill('SIGTERM')
    for (let i = 0; i < 30 && !exited; i++) await new Promise((r) => setTimeout(r, 100))
    if (!exited) kill('SIGKILL')
  }
}

function readSnapshot() {
  try {
    return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
  } catch {
    return null
  }
}

function printList(title, items) {
  if (!items.length) return
  log(`${title} (${items.length}):`)
  for (const i of items) log(`  ${i}`)
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (process.platform !== 'darwin') throw new Error('solo macOS (binario darwin-arm64)')
  const work = mkdtempSync(join(tmpdir(), 'onyx-check-opencode-'))
  try {
    let bin = resolve(opts.bin ?? DEFAULT_BIN)
    let label = 'binario fijado'
    if (opts.latest) {
      const latest = await fetchLatest(work)
      bin = latest.bin
      label = `última release oficial ${latest.tag}`
    }
    if (!existsSync(bin)) throw new Error(`No existe el binario: ${bin} (¿falta \`node scripts/fetch-opencode.mjs\`?)`)
    const version = (await binaryVersion(bin)) ?? 'desconocida'
    log(`OpenCode ${version} (${label})`)

    const used = usedRoutes({ sdk: sdkRoutes() })
    if (used.unmatched.length) throw new Error(`Rutas directas del código que no existen en el SDK fijado:\n  ${used.unmatched.join('\n  ')}`)

    const doc = await withServer(bin, work, async (base) => {
      const r = await fetch(`${base}/doc`, { signal: AbortSignal.timeout(15_000) })
      if (!r.ok) throw new Error(`/doc respondió HTTP ${r.status}`)
      return r.json()
    })
    const actual = routesFromOpenApi(doc)
    const actualSchemas = schemaDigests(doc, used.routes)
    log(`Rutas del binario: ${actual.size} · rutas que la app usa: ${used.routes.length}`)

    if (opts.update) {
      const missingNow = used.routes.filter((r) => !actual.has(r))
      if (missingNow.length) throw new Error(`No se actualiza la instantánea: faltan rutas usadas:\n  ${missingNow.join('\n  ')}`)
      const snap = {
        opencodeVersion: version,
        routeCount: actual.size,
        routes: [...actual].sort(),
        usedSchemas: Object.fromEntries(used.routes.map((r) => [r, actualSchemas[r]]))
      }
      writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2) + '\n')
      log(`Instantánea reescrita: ${SNAPSHOT_PATH} (${snap.routeCount} rutas, ${used.routes.length} esquemas usados).`)
      return 0
    }

    const snapshot = readSnapshot()
    if (!snapshot) throw new Error(`Falta la instantánea ${SNAPSHOT_PATH} (genérala con --update-snapshot).`)
    const res = compareContract({
      used: used.routes,
      actual,
      snapshot: snapshot.routes,
      actualSchemas,
      snapshotSchemas: snapshot.usedSchemas
    })
    printList('RUTAS USADAS QUE FALTAN (error)', res.missing)
    printList('ESQUEMA CAMBIADO en rutas usadas (revisar a mano)', res.changed)
    printList('Rutas usadas sin esquema en la instantánea (regenerarla)', res.unbaselined)
    printList('Rutas nuevas respecto a la instantánea (informativo)', res.added)
    printList('Rutas eliminadas respecto a la instantánea', res.removed)
    const clean = !res.missing.length && !res.changed.length && !res.added.length && !res.removed.length && !res.unbaselined.length
    if (clean) log(`Sin cambios respecto a la instantánea (OpenCode ${snapshot.opencodeVersion}): 0 rutas faltantes.`)
    log(res.code === 0 ? 'RESULTADO: OK' : res.code === 1 ? 'RESULTADO: FALLA (falta una ruta usada)' : 'RESULTADO: REVISAR (cambió un esquema usado)')
    return res.code
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`[check-opencode] ERROR: ${err instanceof Error ? err.message : err}`)
      process.exit(3)
    }
  )
}
