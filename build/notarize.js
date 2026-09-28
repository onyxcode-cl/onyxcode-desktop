'use strict'

/**
 * Hook `afterSign` de electron-builder: notariza el `.app` cuando hay credenciales de Apple en el
 * entorno (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`); si no, no hace nada (build
 * ad-hoc local, ver docs/DISTRIBUCION.md).
 *
 * Usa `@electron/notarize` directamente (ya viene instalado como dependencia de electron-builder)
 * en vez de la opción `mac.notarize` de electron-builder para controlar explícitamente qué build
 * se notariza y loguear un mensaje claro cuando se omite.
 */
const { notarize } = require('@electron/notarize')

module.exports = async function afterSign(context) {
  const { electronPlatformName, appOutDir, packager } = context
  if (electronPlatformName !== 'darwin') return

  const appleId = process.env.APPLE_ID
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD
  const teamId = process.env.APPLE_TEAM_ID

  if (!appleId || !appleIdPassword || !teamId) {
    console.log(
      '[notarize] APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID no configuradas: ' +
        'se omite la notarización (build ad-hoc local, ver docs/DISTRIBUCION.md).'
    )
    return
  }

  const appName = packager.appInfo.productFilename
  const appPath = `${appOutDir}/${appName}.app`

  console.log(`[notarize] enviando ${appPath} a Apple (equipo ${teamId})…`)
  await notarize({
    tool: 'notarytool',
    appPath,
    appleId,
    appleIdPassword,
    teamId
  })
  console.log('[notarize] notarización completa.')
}
