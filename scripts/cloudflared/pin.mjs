#!/usr/bin/env node
// Genera `resources/cloudflared/pin.json` para una versión de `cloudflared` (modo viaje). LO CORRE EL DUEÑO (o un agente con red
// autorizada expresamente), NUNCA la app ni CI. Descarga el asset de macOS de la release oficial, calcula los DOS hashes y exige que
// coincidan tres fuentes (ver `pin-lib.mjs`); si algo no cuadra no escribe nada.
//
// Uso:  node scripts/cloudflared/pin.mjs <versión> --network [--write]
//   --network  obligatorio: confirma que sabes que esto descarga ~20 MB de GitHub.
//   --write    escribe resources/cloudflared/pin.json (sin él solo imprime el resultado).
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { buildPin, serializePin } from './pin-lib.mjs'

const run = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const PIN_PATH = join(ROOT, 'resources', 'cloudflared', 'pin.json')

/** Operaciones reales (red, tar, codesign). Solo se usan desde la línea de comandos. */
export function realIo() {
  return {
    async getJson(url) {
      const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'onyxcode-pin' } })
      if (!r.ok) throw new Error(`GET ${url}: ${r.status}`)
      return r.json()
    },
    async download(url) {
      const r = await fetch(url, { headers: { 'User-Agent': 'onyxcode-pin' }, redirect: 'follow' })
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

async function main() {
  const [version, ...flags] = process.argv.slice(2)
  if (!version || !flags.includes('--network')) {
    console.error(
      'Uso: node scripts/cloudflared/pin.mjs <versión> --network [--write]\n(descarga ~20 MB de GitHub: añade --network para confirmarlo)'
    )
    process.exit(2)
  }
  const pin = await buildPin({ version, io: realIo() })
  if (flags.includes('--write')) {
    writeFileSync(PIN_PATH, serializePin(pin))
    console.log(`escrito ${PIN_PATH}`)
  } else process.stdout.write(serializePin(pin))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(String(err?.message ?? err))
    process.exit(1)
  })
}
