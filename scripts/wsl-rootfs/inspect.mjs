#!/usr/bin/env node
// Inspecciona una imagen base de «Tareas en Windows» ya construida (solo lectura; no extrae nada ni usa red).
// Uso:  node scripts/wsl-rootfs/inspect.mjs <lazunox-rootfs-<ver>-x64.tar.gz> [--version V]
// Sale con 0 si cumple todas las exigencias de inspect-lib.mjs, con 1 si no (y las lista), con 2 si el uso es incorrecto.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectTarGz } from './inspect-lib.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const WSL_CONF_PATH = join(ROOT, 'resources', 'wsl', 'wsl.conf')

function main() {
  const args = process.argv.slice(2)
  const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--version')
  const vi = args.indexOf('--version')
  const expectedVersion = vi === -1 ? null : (args[vi + 1] ?? null)
  if (!file || (vi !== -1 && !expectedVersion)) {
    console.error('Uso: node scripts/wsl-rootfs/inspect.mjs <imagen.tar.gz> [--version V]')
    process.exit(2)
  }
  const r = inspectTarGz(readFileSync(file), { wslConf: readFileSync(WSL_CONF_PATH, 'utf8'), expectedVersion })
  if (r.ok) {
    console.log(`imagen correcta: ${r.info.entries} entradas, ${r.info.unpackedSize} bytes, versión ${r.info.version}`)
    return
  }
  for (const e of r.errors) console.error(`- ${e}`)
  process.exit(1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (err) {
    console.error(String(err?.message ?? err))
    process.exit(1)
  }
}
