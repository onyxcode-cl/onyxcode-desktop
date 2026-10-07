#!/usr/bin/env node
// Genera `resources/cloudflared/pin.json` para una versión de `cloudflared` (modo viaje). LO CORRE EL DUEÑO (o un agente con red
// autorizada expresamente), NUNCA la app ni CI. Descarga el asset de macOS de la release oficial, calcula los DOS hashes y exige que
// coincidan tres fuentes (ver `pin-lib.mjs`); si algo no cuadra no escribe nada.
//
// Uso:  node scripts/cloudflared/pin.mjs <versión> --network [--platform darwin-arm64|win32-x64] [--authenticode-subject "<sujeto>"] [--write]
//   --network  obligatorio: confirma que sabes que esto descarga ~20 MB de GitHub.
//   --platform plataforma a fijar (por defecto darwin-arm64; repetible). `win32-x64` baja el .exe oficial (SHA-256 y tamaño del .exe)
//              y EXIGE --authenticode-subject: el sujeto del certificado se lee en Windows con scripts/win/cloudflared-subject.ps1
//              (esta herramienta no puede leerlo desde la Mac).
//   --write    escribe resources/cloudflared/pin.json (sin él solo imprime el resultado). Si el pin existente es de la MISMA versión,
//              conserva sus otras plataformas (fijar Windows no borra macOS); con otra versión lo reemplaza.
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { buildPin, mergePin, serializePin } from './pin-lib.mjs'

const run = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const PIN_PATH = join(ROOT, 'resources', 'cloudflared', 'pin.json')

/** Operaciones reales (red, tar, codesign). Solo se usan desde la línea de comandos. */
export function realIo() {
  return {
    async getJson(url) {
      const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'lazunox-pin' } })
      if (!r.ok) throw new Error(`GET ${url}: ${r.status}`)
      return r.json()
    },
    async download(url) {
      const r = await fetch(url, { headers: { 'User-Agent': 'lazunox-pin' }, redirect: 'follow' })
      if (!r.ok) throw new Error(`GET ${url}: ${r.status}`)
      return Buffer.from(await r.arrayBuffer())
    },
    async extract(tgz) {
      const dir = mkdtempSync(join(tmpdir(), 'cf-pin-'))
      try {
        writeFileSync(join(dir, 'a.tgz'), tgz)
        const list = (await run('/usr/bin/tar', ['-tzf', join(dir, 'a.tgz')])).stdout.split('\n').filter(Boolean)
        if (list.length !== 1 || list[0] !== 'cloudflared') throw new Error('el .tgz no trae un único archivo `cloudflared`')
        await run('/usr/bin/tar', ['-xzf', join(dir, 'a.tgz'), '-C', dir, 'cloudflared'])
        return readFileSync(join(dir, 'cloudflared'))
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    async codesign(bin) {
      const dir = mkdtempSync(join(tmpdir(), 'cf-sig-'))
      try {
        const f = join(dir, 'cloudflared')
        writeFileSync(f, bin, { mode: 0o700 })
        await run('/usr/bin/codesign', ['--verify', '--strict', f])
        const { stderr } = await run('/usr/bin/codesign', ['-d', '--verbose=2', f])
        const grab = (k) => new RegExp(`^${k}=(.+)$`, 'm').exec(stderr)?.[1]?.trim() ?? null
        return {
          identifier: grab('Identifier'),
          teamId: grab('TeamIdentifier'),
          authorities: [...stderr.matchAll(/^Authority=(.+)$/gm)].map((m) => m[1].trim())
        }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  }
}

/** Interpreta los argumentos (sin tocar red ni disco). Lanza con un mensaje de uso si algo no cuadra. */
export function parseArgs(argv) {
  const [version, ...rest] = argv
  const flags = new Set()
  const targets = []
  let authenticodeSubject
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--platform' || a === '--authenticode-subject') {
      const v = rest[++i]
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} necesita un valor`)
      if (a === '--platform') targets.push(v)
      else authenticodeSubject = v
    } else flags.add(a)
  }
  return { version, flags, targets: targets.length ? targets : undefined, authenticodeSubject }
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(String(err.message))
    process.exit(2)
  }
  const { version, flags, targets, authenticodeSubject } = args
  if (!version || !flags.has('--network')) {
    console.error(
      'Uso: node scripts/cloudflared/pin.mjs <versión> --network [--platform darwin-arm64|win32-x64] [--authenticode-subject "<sujeto>"] [--write]\n(descarga ~20 MB de GitHub por plataforma: añade --network para confirmarlo)'
    )
    process.exit(2)
  }
  const pin = await buildPin({ version, io: realIo(), targets, authenticodeSubject })
  if (flags.has('--write')) {
    let existing = null
    try {
      existing = JSON.parse(readFileSync(PIN_PATH, 'utf8'))
    } catch {
      /* sin pin previo */
    }
    writeFileSync(PIN_PATH, serializePin(mergePin(existing, pin)))
    console.log(`escrito ${PIN_PATH}`)
  } else process.stdout.write(serializePin(pin))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(String(err?.message ?? err))
    process.exit(1)
  })
}
