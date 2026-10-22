#!/usr/bin/env node
/**
 * Empaqueta el servidor MCP `shell_bg` (src/main/background-shell/main.ts) en UN archivo CommonJS autocontenido que ejecuta el
 * Node incluido de la app (sin Electron, sin node_modules). Uso: `node scripts/build-shell-bg.mjs [--out ruta.cjs]`.
 * Por defecto escribe `resources/shell-bg/shell-bg-mcp.cjs` (generado: no se versiona; el paquete de integración lo cablea al build).
 */
import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const i = process.argv.indexOf('--out')
const outfile = i > 0 ? resolve(process.argv[i + 1]) : resolve(root, 'resources/shell-bg/shell-bg-mcp.cjs')

await build({
  entryPoints: [resolve(root, 'src/main/background-shell/main.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  legalComments: 'none',
  logLevel: 'warning'
})
console.log(outfile)
