'use strict'

/**
 * Piezas comunes de firma y notarización (sin Electron y sin red; todo lo que ejecuta algo recibe `run` por parámetro
 * para poder probarlo con un doble). Las usan `notarize.js` (Developer ID), `after-sign-self-signed.js` (autofirmado)
 * y `notarize-dmg.js`.
 *
 * Los SECRETOS (clave `.p8`, contraseña de app) solo se leen de variables de entorno; nunca se escriben en archivos ni se
 * imprimen. `APPLE_API_KEY` es la RUTA de un `.p8` (el workflow de release lo escribe en `$RUNNER_TEMP` y lo borra).
 */
const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const defaultRun = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })

/** Identificadores derivados de src/shared/brand.ts (no se duplican literales; lo comprueba src/test/brand-consistency.test.ts). */
function idsFromBrandSource(src) {
  const alias = /export const AUTHOR_ALIAS = '([^']*)'/.exec(src)?.[1]
  if (!alias) throw new Error('No se encontró AUTHOR_ALIAS en src/shared/brand.ts')
  const appId = `cl.${alias}.lazunox`
  return {
    appId,
    helperId: `cl.${alias}.lazunox.cu-helper`,
    keysId: `cl.${alias}.lazunox.cu-keys`,
    disclaimId: `${appId}.disclaim`,
    keyboxId: `${appId}.keybox`
  }
}

function readIds(root = join(__dirname, '..')) {
  return idsFromBrandSource(readFileSync(join(root, 'src', 'shared', 'brand.ts'), 'utf8'))
}

/**
 * Qué credenciales de notarización hay en el entorno. Prioridad: clave API de App Store Connect; si no, Apple ID + contraseña
 * de app. `kind`: 'none' (ninguna), 'api-key', 'apple-id' o 'incomplete' (alguna variable, pero no un conjunto completo:
 * `missing` dice cuáles faltan para completar cada forma).
 */
function resolveNotarizeCreds(env = process.env) {
  const has = (k) => typeof env[k] === 'string' && env[k] !== ''
  const api = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']
  const id = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
  if (api.every(has)) {
    return { kind: 'api-key', key: env.APPLE_API_KEY, keyId: env.APPLE_API_KEY_ID, issuer: env.APPLE_API_ISSUER }
  }
  if (id.every(has)) {
    return { kind: 'apple-id', appleId: env.APPLE_ID, teamId: env.APPLE_TEAM_ID }
  }
  const anyApi = api.some(has)
  const anyId = id.some(has)
  if (!anyApi && !anyId) return { kind: 'none' }
  const missing = {}
  if (anyApi) missing.apiKey = api.filter((k) => !has(k))
  if (anyId) missing.appleId = id.filter((k) => !has(k))
  return { kind: 'incomplete', missing }
}

/** Texto en español de lo que falta cuando `kind === 'incomplete'`. */
function describeIncomplete(creds) {
  const parts = []
  if (creds.missing.apiKey) parts.push(`clave API: faltan ${creds.missing.apiKey.join(', ')}`)
  if (creds.missing.appleId) parts.push(`Apple ID: faltan ${creds.missing.appleId.join(', ')}`)
  return `credenciales de notarización incompletas (${parts.join('; ')}). Define el conjunto completo de una forma (preferida: APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER).`
}

/** Argumentos de autenticación de `notarytool` (sin secretos en claro: la contraseña va como `@env:`, la clave como ruta). */
function notarytoolAuthArgs(creds) {
  if (creds.kind === 'api-key') return ['--key', creds.key, '--key-id', creds.keyId, '--issuer', creds.issuer]
  if (creds.kind === 'apple-id') {
    return ['--apple-id', creds.appleId, '--password', '@env:APPLE_APP_SPECIFIC_PASSWORD', '--team-id', creds.teamId]
  }
  throw new Error('notarytoolAuthArgs: faltan credenciales completas')
}

/** Opciones de `@electron/notarize` (tool notarytool) para un `.app`. */
function notarizeOptions(creds, appPath) {
  if (creds.kind === 'api-key') {
    return { tool: 'notarytool', appPath, appleApiKey: creds.key, appleApiKeyId: creds.keyId, appleApiIssuer: creds.issuer }
  }
  if (creds.kind === 'apple-id') {
    return {
      tool: 'notarytool',
      appPath,
      appleId: creds.appleId,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: creds.teamId
    }
  }
  throw new Error('notarizeOptions: faltan credenciales completas')
}

/**
 * Vuelve a firmar helpers (con su identificador) y luego el .app.
 * mode 'self'  : certificado autofirmado, sin hardened runtime (como siempre).
 * mode 'devid' : Developer ID con `--options runtime --timestamp --entitlements`; el .app NO usa --deep (lo anidado ya está
 *                firmado por electron-builder con la misma identidad). Hay que ejecutarlo ANTES de notarizar.
 * `identity` = nombre del certificado (o «-» en pruebas); `keychain` opcional (CI con llavero temporal).
 */
function resignBundle({ appPath, identity, ids, mode, entitlements, keychain, run = defaultRun }) {
  if (mode !== 'self' && mode !== 'devid') throw new Error(`resignBundle: modo desconocido «${mode}»`)
  if (mode === 'devid' && !entitlements) throw new Error('resignBundle: el modo devid necesita la ruta de los entitlements')
  const res = join(appPath, 'Contents', 'Resources')
  const sign = (file, identifier) => {
    const args = ['--force', '--sign', identity, '--identifier', identifier]
    if (mode === 'devid') args.push('--options', 'runtime', '--timestamp', '--entitlements', entitlements)
    if (keychain) args.push('--keychain', keychain)
    args.push(file)
    run('/usr/bin/codesign', args)
  }
  sign(join(res, 'computer-use', 'bin', 'cu-helper'), ids.helperId)
  // `cu-keys` (teclado por teclas físicas para escritorio remoto) viaja junto a `cu-helper`: mismo trato y su propio identificador.
  const keysBin = join(res, 'computer-use', 'bin', 'cu-keys')
  if (existsSync(keysBin)) sign(keysBin, ids.keysId ?? ids.helperId.replace(/cu-helper$/, 'cu-keys'))
  sign(join(res, 'launcher', 'lazunox-disclaim'), ids.disclaimId)
  // Auxiliar del Llavero: identificador FIJO (su `cdhash` es la identidad que el Llavero recuerda entre versiones; resources/keybox/build.sh).
  const keyboxBin = join(res, 'keybox', 'lazunox-keybox')
  if (existsSync(keyboxBin)) sign(keyboxBin, ids.keyboxId ?? `${ids.appId}.keybox`)
  sign(appPath, ids.appId)
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath])
}

module.exports = {
  defaultRun,
  idsFromBrandSource,
  readIds,
  resolveNotarizeCreds,
  describeIncomplete,
  notarytoolAuthArgs,
  notarizeOptions,
  resignBundle
}
