#!/usr/bin/env node
// Comprueba que `out/main/index.js` (lo que carga Windows al arrancar) NO contiene código de macOS:
// Seatbelt, helper de Control del PC, actualizador (ditto/swap.sh). Rollup debe dejar esos módulos en
// `out/main/chunks/*` cargados con import() dinámico solo en darwin (src/main/index.ts + platform-caps).
// Las cadenas de i18n que mencionan esas palabras (líneas `"clave": "texto"`) se ignoran.
//   npm run build && node scripts/check-win-bundle.mjs
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const file = join(root, 'out', 'main', 'index.js')
const FORBIDDEN = ['sandbox-exec', 'cu-helper', 'ditto', 'swap.sh', 'buildSandboxProfile', 'class ComputerService', 'class TasksManager', 'class UpdateInstaller']
const I18N_LINE = /^\s*"[\w.:-]+":\s*["'`]/

const lines = readFileSync(file, 'utf8').split('\n')
const hits = []
lines.forEach((line, i) => {
  if (I18N_LINE.test(line)) return
  for (const word of FORBIDDEN) if (line.includes(word)) hits.push(`${i + 1}: «${word}» ${line.trim().slice(0, 120)}`)
})
if (hits.length) {
  console.error(`out/main/index.js contiene código de macOS (${hits.length}):\n${hits.join('\n')}`)
  process.exit(1)
}
console.log('[check-win-bundle] OK: out/main/index.js sin código de macOS (solo cadenas de i18n)')
