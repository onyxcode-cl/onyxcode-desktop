#!/usr/bin/env node
// Comprobaciones SOLO para releases (no forma parte de `npm run verify`):
// falla si la identidad sigue siendo provisional o si la licencia está pendiente.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const errors = []

const brand = readFileSync(resolve(root, 'src/shared/brand.ts'), 'utf8')
const alias = /export const AUTHOR_ALIAS = '([^']*)'/.exec(brand)?.[1]
if (!alias) errors.push('No se encontró AUTHOR_ALIAS en src/shared/brand.ts')
else if (alias === 'aliaspendiente' || alias === 'bentec')
  errors.push(`AUTHOR_ALIAS sigue siendo provisional («${alias}»): definí el alias público`)

for (const f of [
  'src/shared/brand.ts',
  'electron-builder.js',
  'package.json',
  'resources/computer-use/build.sh',
  'resources/launcher/build.sh'
]) {
  if (readFileSync(resolve(root, f), 'utf8').includes('aliaspendiente'))
    errors.push(`${f} contiene el placeholder «aliaspendiente»`)
}

const licensePath = resolve(root, 'LICENSE')
if (!existsSync(licensePath)) errors.push('Falta el fichero LICENSE')
else if (readFileSync(licensePath, 'utf8').includes('LICENCIA PENDIENTE'))
  errors.push('LICENSE contiene «LICENCIA PENDIENTE»')

if (errors.length) {
  console.error('verify:release FALLÓ:\n - ' + errors.join('\n - '))
  process.exit(1)
}
console.log('verify:release OK')
