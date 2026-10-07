#!/usr/bin/env node
// Prepara el paquete incluido de «Tareas en Windows» (beta opcional): copia la imagen base de WSL y el opencode `linux-x64` a
// `resources/wsl-images/` (ignorada por git; la lee electron-builder.js solo con TASKS_WIN_BUILD activo).
// NO descarga nada. Verifica TAMAÑO y SHA-256 contra `resources/opencode-bin/pin.json` ANTES de copiar (el origen), copia a `.part`,
// vuelve a verificar la copia y renombra. Si algo no coincide no deja nada a medias y sale con código 1.
//   node scripts/stage-wsl-bundle.mjs [--from <carpeta>] [--to <carpeta>] [--pin <pin.json>]
// `--from` por defecto: $LAZUNOX_WSL_STAGING_SRC o ~/Documents/lazunox-staging (con `lazunox-rootfs-<versión>-x64.tar.gz` y
// `opencode-linux-x64.tar.gz`).
import { copyFile, lstat, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STAGING_DIR, bundleFilesFromPin, verifyFile } from './wsl-bundle-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * @param {{ pin: any, from: string, to: string, log?: (m: string) => void }} o
 * @returns {Promise<{ staged: string[], skipped: string[] }>} lanza Error (sin copiar nada del archivo malo) si no coincide.
 */
export async function stageBundle({ pin, from, to, log = () => undefined }) {
  const spec = bundleFilesFromPin(pin)
  // 1. TODO el origen se verifica antes de escribir nada.
  for (const f of spec.files) {
    const why = await verifyFile(join(from, f.name), f)
    if (why) throw new Error(`origen ${join(from, f.name)}: ${why} (no se copia nada)`)
  }
  await mkdir(to, { recursive: true })
  const staged = []
  const skipped = []
  for (const f of spec.files) {
    const src = join(from, f.name)
    const dest = join(to, f.name)
    if ((await verifyFile(dest, f)) === null) {
      skipped.push(f.name)
      log(`[stage-wsl-bundle] ya está y coincide: ${f.name}`)
      continue
    }
    const part = `${dest}.part`
    try {
      await copyFile(src, part)
      const why = await verifyFile(part, f)
      if (why) throw new Error(`copia ${f.name}: ${why}`)
      await rename(part, dest)
    } catch (e) {
      await rm(part, { force: true }).catch(() => undefined)
      throw e
    }
    staged.push(f.name)
    log(`[stage-wsl-bundle] copiado y verificado: ${f.name} (${f.size} bytes)`)
  }
  return { staged, skipped }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const argv = process.argv.slice(2)
  const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined)
  const from = resolve(arg('--from') ?? process.env.LAZUNOX_WSL_STAGING_SRC ?? join(homedir(), 'Documents', 'lazunox-staging'))
  const to = resolve(arg('--to') ?? join(root, STAGING_DIR))
  const pinPath = resolve(arg('--pin') ?? join(root, 'resources', 'opencode-bin', 'pin.json'))
  try {
    await lstat(from)
    const pin = JSON.parse(await readFile(pinPath, 'utf8'))
    const r = await stageBundle({ pin, from, to, log: console.log })
    console.log(`[stage-wsl-bundle] OK (${r.staged.length} copiados, ${r.skipped.length} ya estaban) → ${to}`)
  } catch (e) {
    console.error(`[stage-wsl-bundle] ERROR: ${e.message}`)
    process.exit(1)
  }
}
