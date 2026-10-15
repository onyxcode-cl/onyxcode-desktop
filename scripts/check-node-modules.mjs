#!/usr/bin/env node
// Puerta de empaquetado: el árbol de dependencias de producción debe estar íntegro. Un enlace circular `node_modules/node_modules` (lo creó
// por error un `ln -s` en una copia de trabajo, dos veces) hace que el empaquetador deje fuera dependencias y la app se cae al abrir
// («Cannot find module»). Falla si hay enlaces simbólicos a carpetas dentro de node_modules (salvo .bin) o si `npm ls --omit=dev --all`
// informa faltantes/inválidos/sobrantes.
import { execSync } from 'node:child_process'
import { lstatSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nm = join(root, 'node_modules')
const bad = []
for (const n of readdirSync(nm)) {
  if (n === '.bin') continue
  const dirs = n.startsWith('@') ? readdirSync(join(nm, n)).map((x) => join(nm, n, x)) : [join(nm, n)]
  for (const p of dirs) if (lstatSync(p).isSymbolicLink()) bad.push(p.slice(root.length + 1))
}
if (bad.length) {
  console.error(`check-node-modules FALLÓ: enlaces simbólicos dentro de node_modules (bórralos con «rm», nunca con «rm -r»): ${bad.join(', ')}`)
  process.exit(1)
}
try {
  execSync('npm ls --omit=dev --all', { cwd: root, stdio: 'pipe' })
} catch (e) {
  const out = String(e.stdout ?? '') + String(e.stderr ?? '')
  const lines = out.split('\n').filter((l) => /extraneous|missing|invalid/i.test(l)).slice(0, 6)
  console.error(`check-node-modules FALLÓ: el árbol de dependencias no coincide con package-lock.json:\n${lines.join('\n')}`)
  process.exit(1)
}
console.log('check-node-modules OK')
