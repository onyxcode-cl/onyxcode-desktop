#!/usr/bin/env node
/** Visor real, userData temporal y proceso propio. --node: diagnóstico HTTP local con Chrome fijado. */
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const temp = await mkdtemp(join(tmpdir(), 'lzx-video-viewer-'))
try {
  const entry = join(temp, 'entry.cjs')
  const node = process.argv.includes('--node')
  await build({
    entryPoints: [join(repo, 'scripts/video/viewer-smoke-entry.ts')],
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    alias: {
      '@shared': join(repo, 'src/shared'),
      ...(node ? { electron: join(repo, 'scripts/video/viewer-smoke-electron-stub.ts') } : {})
    },
    define: { __dirname: JSON.stringify(join(repo, 'out/main')) }
  })
  const env = { ...process.env, VIDEO_VIEWER_TEMP: temp }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(
    node ? process.execPath : createRequire(import.meta.url)('electron'),
    [entry, ...(node ? [] : ['--user-data-dir=' + join(temp, 'userData')]), ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env,
      windowsHide: true
    }
  )
  const timer = setTimeout(() => child.kill('SIGKILL'), 90000)
  try {
    process.exitCode = await new Promise((done, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => {
        if (signal) console.error(signal)
        done(code ?? 1)
      })
    })
  } finally {
    clearTimeout(timer)
  }
} finally {
  await rm(temp, { recursive: true, force: true })
}
