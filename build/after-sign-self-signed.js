'use strict'

/**
 * Hook `afterSign` SOLO para `ONYXCODE_SELF_SIGNED=1` (certificado de firma de código AUTOFIRMADO del propio
 * usuario; docs/DISTRIBUCION.md §10). No notariza.
 *
 * Por qué existe: electron-builder vuelve a firmar cada Mach-O del paquete SIN `--identifier`, así que
 * `cu-helper` y `onyxcode-disclaim` acaban con un identificador derivado del nombre del archivo
 * (p.ej. `cu-helper-5555…`) en vez de HELPER_ID / DISCLAIM_ID. Con firma ad-hoc da igual (macOS identifica por
 * cdhash), pero con certificado macOS recuerda los permisos por «identificador + certificado»: hay que conservar
 * los identificadores. Este hook los vuelve a firmar con el MISMO certificado y su identificador, y después
 * resella el .app (cambiaron recursos sellados).
 */
const { execFileSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

/** Identificadores derivados de src/shared/brand.ts (no se duplican literales; lo comprueba src/test/brand-consistency.test.ts). */
function idsFromBrandSource(src) {
  const alias = /export const AUTHOR_ALIAS = '([^']*)'/.exec(src)?.[1]
  if (!alias) throw new Error('No se encontró AUTHOR_ALIAS en src/shared/brand.ts')
  const appId = `cl.${alias}.onyxcode`
  return { appId, helperId: `cl.${alias}.opendesk.cu-helper`, disclaimId: `${appId}.disclaim` }
}

const defaultRun = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })

/** Vuelve a firmar helpers (con su identificador) y luego el .app. `identity` = nombre del certificado (o «-» en pruebas). */
function resign({ appPath, identity, ids, run = defaultRun }) {
  const res = join(appPath, 'Contents', 'Resources')
  const sign = (file, identifier) => run('/usr/bin/codesign', ['--force', '--sign', identity, '--identifier', identifier, file])
  sign(join(res, 'computer-use', 'bin', 'cu-helper'), ids.helperId)
  sign(join(res, 'launcher', 'onyxcode-disclaim'), ids.disclaimId)
  // Resellado del paquete (sin --deep: lo anidado ya está firmado por electron-builder con la misma identidad).
  sign(appPath, ids.appId)
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath])
}

module.exports = async function afterSignSelfSigned(context) {
  const { electronPlatformName, appOutDir, packager } = context
  if (electronPlatformName !== 'darwin') return
  const identity = process.env.CSC_NAME
  if (!identity) throw new Error('ONYXCODE_SELF_SIGNED=1 requiere CSC_NAME con el nombre del certificado.')
  const ids = idsFromBrandSource(readFileSync(join(__dirname, '..', 'src', 'shared', 'brand.ts'), 'utf8'))
  const appPath = `${appOutDir}/${packager.appInfo.productFilename}.app`
  console.log(`[self-signed] volviendo a firmar cu-helper y onyxcode-disclaim con «${identity}» y sus identificadores; sin notarizar`)
  resign({ appPath, identity, ids })
}
module.exports.resign = resign
module.exports.idsFromBrandSource = idsFromBrandSource
