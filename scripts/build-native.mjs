#!/usr/bin/env node
// Compila (si faltan) el helper de computer use y el lanzador "disclaim" de macOS. Fuera de macOS no
// hace nada (esos binarios solo existen en darwin): así `npm run dev` / `npm run build` no dependen
// de `sh` en Windows. Sin dependencias.
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

if (process.platform !== 'darwin') {
  console.log('[build-native] omitido (solo macOS: cu-helper y onyxcode-disclaim)')
  process.exit(0)
}

for (const dir of ['computer-use', 'launcher']) {
  const r = spawnSync('sh', [join(root, 'resources', dir, 'build.sh'), '--if-missing'], { stdio: 'inherit', cwd: root })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
