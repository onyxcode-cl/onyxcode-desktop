#!/usr/bin/env node
/** Prueba manual MCP de paso 2. Temporal propio, límite de 15 min. Sin abrir Lazunox instalado. */
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const temp = await mkdtemp(join(tmpdir(), 'lzx-video-render-build-'))
try {
  const entry = join(temp, 'entry.cjs')
  await build({
    entryPoints: [join(repo, 'scripts/video/render-smoke-entry.ts')],
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    alias: { '@shared': join(repo, 'src/shared') },
    define: { __dirname: JSON.stringify(join(repo, 'out/main')) }
  })
  const nodeOnly = process.argv.includes('--node')
  const executable = nodeOnly ? process.execPath : createRequire(import.meta.url)('electron')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, [entry, ...process.argv.slice(2)], { stdio: 'inherit', env, windowsHide: true })
  const timer = setTimeout(() => child.kill('SIGTERM'), 900000)
  try {
    process.exitCode = await new Promise((done, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => {
        if (signal) console.error('Render smoke ended by ' + signal)
        done(code ?? 1)
      })
    })
  } finally {
    clearTimeout(timer)
  }
} finally {
  await rm(temp, { recursive: true, force: true })
}
