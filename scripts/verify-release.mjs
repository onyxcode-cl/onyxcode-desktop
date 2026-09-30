#!/usr/bin/env node
// Comprobaciones SOLO para releases (no forma parte de `npm run verify`):
// falla si la identidad sigue siendo provisional o si la licencia está pendiente.
import { createPublicKey } from 'node:crypto'
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

// Misma regla que isValidRepo de src/shared/update-check.ts (este script no importa TS).
const repo = /export const RELEASES_REPO = '([^']*)'/.exec(brand)?.[1] ?? ''
const repoName = repo.split('/')[1]
if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(repo) || repoName === '.' || repoName === '..')
  errors.push('RELEASES_REPO está vacío o no es «owner/repo»: publica el repositorio y defínelo en src/shared/brand.ts')

// Clave pública del actualizador (src/main/update/signature.ts hace lo mismo): SPKI DER de 44 bytes o 32 crudos.
const updateKey = /export const UPDATE_PUBLIC_KEY = '([^']*)'/.exec(brand)?.[1] ?? ''
function validUpdateKey(b64) {
  try {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return false
    const raw = Buffer.from(b64, 'base64')
    const der = raw.length === 32 ? Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]) : raw
    return der.length === 44 && createPublicKey({ key: der, format: 'der', type: 'spki' }).asymmetricKeyType === 'ed25519'
  } catch {
    return false
  }
}
if (updateKey === '') errors.push('UPDATE_PUBLIC_KEY está vacía: genera el par Ed25519 (docs/DISTRIBUCION.md §10) y pon la clave pública en src/shared/brand.ts')
else if (!validUpdateKey(updateKey)) errors.push('UPDATE_PUBLIC_KEY no decodifica a una clave pública Ed25519 válida (SPKI DER en base64)')

// El script de reemplazo del actualizador debe viajar sellado dentro del .app (extraResources).
if (!existsSync(resolve(root, 'resources/updater/swap.sh'))) errors.push('Falta resources/updater/swap.sh')
else {
  const { createRequire } = await import('node:module')
  const cfg = createRequire(import.meta.url)(resolve(root, 'electron-builder.js'))
  const has = (cfg.extraResources ?? []).some((r) => r && r.from === 'resources/updater' && r.to === 'updater' && (r.filter ?? []).includes('swap.sh'))
  if (!has) errors.push('electron-builder.js no incluye resources/updater/swap.sh en extraResources')
}

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
