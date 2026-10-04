'use strict'

/**
 * Hook `afterSign` de electron-builder para el camino Developer ID (el autofirmado usa after-sign-self-signed.js).
 *
 * 1. Sin identidad de firma (ni CSC_NAME ni CSC_LINK): build ad-hoc local, no hace nada.
 * 2. Con identidad: vuelve a firmar `cu-helper` y `onyxcode-disclaim` con su identificador (HELPER_ID / DISCLAIM_ID) y con
 *    hardened runtime + timestamp + entitlements, y resella el .app. electron-builder los firma con un identificador derivado
 *    del nombre de archivo (`cu-helper-<hash>`) y macOS recordaría mal los permisos de Control del Mac. Requiere CSC_NAME
 *    (opcional CSC_KEYCHAIN). Esto ocurre ANTES de notarizar: el ticket cubre el resultado final.
 * 3. Si hay credenciales de notarización, notariza el .app con `notarytool`. Prioridad: clave API de App Store Connect
 *    (`APPLE_API_KEY` = ruta del .p8, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`); si no, Apple ID (`APPLE_ID`,
 *    `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). Credenciales a medias = error con lo que falta. Sin ninguna: se omite con un log.
 *
 * El `.dmg` lo notariza y graba `notarize-dmg.js` (afterAllArtifactBuild). Ver docs/DISTRIBUCION.md y docs/RELEASE.md.
 */
const { join } = require('node:path')
const common = require('./sign-common.js')

async function runAfterSign(context, deps = {}) {
  const { electronPlatformName, appOutDir, packager } = context
  if (electronPlatformName !== 'darwin') return
  const env = deps.env ?? process.env
  const log = deps.log ?? console.log
  const run = deps.run ?? common.defaultRun
  const notarize = deps.notarize ?? require('@electron/notarize').notarize
  const root = deps.root ?? join(__dirname, '..')

  const appPath = `${appOutDir}/${packager.appInfo.productFilename}.app`
  const hasIdentity = Boolean(env.CSC_NAME || env.CSC_LINK)
  const creds = common.resolveNotarizeCreds(env)

  if (!hasIdentity) {
    log('[notarize] sin CSC_NAME/CSC_LINK: build ad-hoc local, no se vuelven a firmar helpers ni se notariza (docs/DISTRIBUCION.md).')
    return
  }
  if (!env.CSC_NAME) {
    throw new Error(
      '[notarize] con CSC_LINK hace falta además CSC_NAME (nombre del certificado «Developer ID Application: …» ya importado en un llavero; ' +
        'en CI, CSC_KEYCHAIN con el llavero temporal) para volver a firmar cu-helper y onyxcode-disclaim con su identificador.'
    )
  }
  if (creds.kind === 'incomplete') throw new Error(`[notarize] ${common.describeIncomplete(creds)}`)

  log(`[notarize] volviendo a firmar cu-helper y onyxcode-disclaim con «${env.CSC_NAME}» (hardened runtime, timestamp, entitlements)`)
  common.resignBundle({
    appPath,
    identity: env.CSC_NAME,
    ids: common.readIds(root),
    mode: 'devid',
    entitlements: join(root, 'build', 'entitlements.mac.plist'),
    keychain: env.CSC_KEYCHAIN || undefined,
    run
  })

  if (creds.kind === 'none') {
    log(
      '[notarize] sin credenciales de notarización (APPLE_API_KEY* o APPLE_ID*): se omite la notarización. ' +
        'El build queda firmado pero Gatekeeper lo bloqueará en otro Mac (docs/DISTRIBUCION.md).'
    )
    return
  }
  log(`[notarize] enviando ${appPath} a Apple (${creds.kind === 'api-key' ? 'clave API' : `Apple ID, equipo ${creds.teamId}`})…`)
  await notarize(common.notarizeOptions(creds, appPath))
  log('[notarize] notarización completa.')
}

module.exports = async function afterSign(context) {
  return runAfterSign(context)
}
module.exports.runAfterSign = runAfterSign
