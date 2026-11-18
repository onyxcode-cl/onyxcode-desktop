#!/usr/bin/env node
/** Prueba manual con Electron de desarrollo y userData NUEVO. Nunca abre la app instalada. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
if (!process.argv.includes('--install'))
  throw new Error('Uso: node scripts/video/smoke.mjs --install --project RUTA_VIDEO_PRUEBA [--report informe.json]')
const work = await mkdtemp(join(tmpdir(), 'lzx-video-smoke-build-'))
try {
  const outfile = join(work, 'smoke.cjs')
  const nodeOnly = process.argv.includes('--node')
  await build({
    entryPoints: [join(root, `scripts/video/${nodeOnly ? 'smoke-node-entry' : 'smoke-entry'}.ts`)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    alias: { '@shared': join(root, 'src/shared') },
    define: { __dirname: JSON.stringify(join(root, 'out/main')) }
  })
  const require = createRequire(import.meta.url)
  const electron = nodeOnly ? process.execPath : require('electron')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(
    electron,
    [...(!nodeOnly && process.platform === 'darwin' ? ['--use-mock-keychain'] : []), outfile, ...process.argv.slice(2)],
    { stdio: 'inherit', env, windowsHide: true, detached: process.platform !== 'win32' }
  )
  const stop = () => {
    if (!child.pid) return
    if (process.platform === 'win32')
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 15_000 })
    else {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        /* el grupo ya terminó */
      }
    }
  }
  const timer = setTimeout(stop, 600_000)
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    process.exitCode = await new Promise((done, reject) => {
      child.on('error', reject)
      child.on('exit', (code, signal) => {
        if (signal) console.error(`Proceso terminado por ${signal}`)
        done(code ?? 1)
      })
    })
  } finally {
    clearTimeout(timer)
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
} finally {
  await rm(work, { recursive: true, force: true })
}
