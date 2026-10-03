#!/usr/bin/env node
// Compila la PWA del control remoto (`pwa/` → `pwa/dist`) con Vite. Si todavía no existe la carpeta `pwa/` o su
// configuración de Vite, no hace nada (el resto del build sigue igual): el servidor local muestra un aviso en su lugar.
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const config = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs'].map((f) => join(root, 'pwa', f)).find(existsSync)

if (!config) {
  console.log('[build:pwa] no hay pwa/vite.config.*: se omite (la app incluirá un aviso en lugar de la PWA).')
  process.exit(0)
}

const res = spawnSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', config], {
  cwd: root,
  stdio: 'inherit'
})
process.exit(res.status ?? 1)
