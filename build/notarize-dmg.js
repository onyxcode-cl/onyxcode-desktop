'use strict'

/**
 * Hook `afterAllArtifactBuild` de electron-builder: notariza y graba (`stapler staple`) el `.dmg` con `notarytool`.
 * El hook `afterSign` (notarize.js) solo cubre el .app; sin esto, el primer `.dmg` descargado no abre sin avisos sin conexión.
 *
 * Se omite (con un log claro) si: no es macOS, el build es autofirmado/ad-hoc, no hay credenciales o no hay `.dmg`.
 * Credenciales: clave API (preferida) o Apple ID; la contraseña de app va a `notarytool` como `@env:` (no aparece en argv).
 * Devuelve [] (no añade artefactos). Ver docs/RELEASE.md.
 */
const common = require('./sign-common.js')

async function notarizeDmgs(buildResult, deps = {}) {
  const env = deps.env ?? process.env
  const log = deps.log ?? console.log
  const run = deps.run ?? common.defaultRun
  const platform = deps.platform ?? process.platform
  const dmgs = (buildResult.artifactPaths ?? []).filter((p) => p.endsWith('.dmg'))

  if (platform !== 'darwin' || dmgs.length === 0) return []
  if (env.ONYXCODE_SELF_SIGNED === '1' || !(env.CSC_NAME || env.CSC_LINK)) {
    log('[notarize-dmg] build autofirmado o ad-hoc: no se notariza el .dmg.')
    return []
  }
  const creds = common.resolveNotarizeCreds(env)
  if (creds.kind === 'incomplete') throw new Error(`[notarize-dmg] ${common.describeIncomplete(creds)}`)
  if (creds.kind === 'none') {
    log('[notarize-dmg] sin credenciales de notarización: se omite el .dmg.')
    return []
  }
  for (const dmg of dmgs) {
    log(`[notarize-dmg] enviando ${dmg} a Apple…`)
    run('/usr/bin/xcrun', ['notarytool', 'submit', dmg, ...common.notarytoolAuthArgs(creds), '--wait'])
    run('/usr/bin/xcrun', ['stapler', 'staple', dmg])
    run('/usr/bin/xcrun', ['stapler', 'validate', dmg])
    log(`[notarize-dmg] ${dmg} notarizado y grapado.`)
  }
  return []
}

module.exports = async function afterAllArtifactBuild(buildResult) {
  return notarizeDmgs(buildResult)
}
module.exports.notarizeDmgs = notarizeDmgs
