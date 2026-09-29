'use strict'

// Config de electron-builder como JS (no YAML) para poder decidir firma real vs. ad-hoc según el
// entorno: sin Developer ID (CSC_NAME/CSC_LINK) no hay forma de firmar de verdad en esta máquina,
// así que el build ad-hoc (`identity: '-'`, `hardenedRuntime: false`) sigue siendo el default de
// `npm run package`. Ver docs/DISTRIBUCION.md para publicar una build firmada y notarizada.
const hasSigningIdentity = Boolean(process.env.CSC_NAME || process.env.CSC_LINK)
const hasNotarizeCreds = Boolean(
  process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID
)

if (hasSigningIdentity && !hasNotarizeCreds) {
  console.warn(
    '[electron-builder.config] Hay identidad de firma (CSC_NAME/CSC_LINK) pero faltan ' +
      'APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID: el build quedará firmado pero SIN notarizar ' +
      '(macOS lo bloqueará con Gatekeeper al distribuirlo). Ver docs/DISTRIBUCION.md.'
  )
}

/** @type {import('electron-builder').Configuration} */
module.exports = {
  // Nombre e ID de la app: mantener sincronizado con src/shared/brand.ts
  appId: 'cl.bentec.onyxcode',
  productName: 'OnyxCode',
  directories: {
    buildResources: 'build',
    output: 'dist'
  },
  files: [
    '!**/.vscode/*',
    '!src/*',
    '!e2e/**',
    '!scripts/**',
    '!vitest*.config.ts',
    // Higiene del paquete (F7-B34): config de lint/formato, changelogs y documentación no van en el .asar.
    '!{eslint.config.mjs,.prettierrc,.prettierignore,CHANGELOG-FASE*.md}',
    '!docs/**',
    '!electron.vite.config.{js,ts,mjs,cjs}',
    '!{.eslintignore,.eslintrc.cjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md,PLAN.md,DESIGN.md,AUDIT.md}',
    '!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}',
    '!build/*',
    // Nada generado por OpenCode ni fuentes del helper dentro del paquete (AUDIT.md P1).
    '!resources/opencode/{node_modules,node_modules/**,package.json,package-lock.json,bun.lock,.gitignore}',
    '!resources/computer-use/{helper.swift,build.sh,bin,bin/**}',
    '!resources/launcher/**'
  ],
  // Los agentes y las skills de oficina (se copian a userData/opencode-config al arrancar; OpenCode
  // NUNCA escribe en el bundle). El helper `cu-helper` va por extraResources (Contents/Resources/computer-use/bin).
  asarUnpack: ['resources/opencode/agents/**', 'resources/opencode/skills/**'],
  extraResources: [
    // Helper nativo de computer use (compilado con `npm run build:helper`) → Contents/Resources/computer-use/bin
    {
      from: 'resources/computer-use/bin',
      to: 'computer-use/bin',
      filter: ['cu-helper']
    },
    // Lanzador que desvincula de TCC a los `opencode serve` y a la terminal integrada
    // (AUDIT.md S6, docs/SEGURIDAD.md §3) → Contents/Resources/launcher
    {
      from: 'resources/launcher/bin',
      to: 'launcher',
      filter: ['onyxcode-disclaim']
    }
  ],
  // Fuses de Electron (docs/SEGURIDAD.md). RunAsNode off es posible porque el MCP de computer use
  // corre como utilityProcess (ya no con ELECTRON_RUN_AS_NODE).
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false
  },
  mac: {
    // Icono generado desde build/icon.svg (node build/render-icon.mjs vía electron)
    icon: 'build/icon.icns',
    category: 'public.app-category.developer-tools',
    target: [{ target: 'dmg', arch: ['arm64'] }],
    // Sin Developer ID (CSC_NAME/CSC_LINK ausentes): firma AD-HOC (los fuses modifican el binario
    // de Electron y sin volver a firmar macOS lo mata al abrir). `identity: '-'` fuerza el ad-hoc e
    // ignora cualquier CSC_NAME/CSC_LINK, así que solo lo fijamos cuando NO hay identidad real —
    // si la hay, se omite y electron-builder usa CSC_NAME/CSC_LINK automáticamente.
    ...(hasSigningIdentity ? {} : { identity: '-' }),
    // Hardened runtime + entitlements solo tienen sentido (y solo funcionan) con firma real: un
    // binario ad-hoc con hardened runtime activado no arranca. Con Developer ID sí lo activamos y
    // firmamos los helpers embebidos explícitamente (electron-builder los detecta como Mach-O igual,
    // pero se listan para que quede explícito qué se firma — AUDIT.md 5 / docs/SEGURIDAD.md §4).
    hardenedRuntime: hasSigningIdentity,
    ...(hasSigningIdentity
      ? {
          entitlements: 'build/entitlements.mac.plist',
          entitlementsInherit: 'build/entitlements.mac.plist',
          binaries: [
            'Contents/Resources/computer-use/bin/cu-helper',
            'Contents/Resources/launcher/onyxcode-disclaim'
          ]
        }
      : {}),
    // La notarización se maneja a mano en build/notarize.js (afterSign) para loguear con claridad
    // cuándo se omite; se deja explícitamente desactivada aquí para que electron-builder no intente
    // notarizar por su cuenta con `mac.notarize`.
    notarize: false,
    // Grabar una skill con micro (Lote C, B.1/B.8): macOS exige el texto en Info.plist antes de
    // poder pedir estos permisos, o el proceso aborta al intentarlo.
    extendInfo: {
      NSMicrophoneUsageDescription: 'OnyxCode necesita el micrófono para grabar tu voz al grabar una skill (opcional).',
      NSSpeechRecognitionUsageDescription: 'OnyxCode necesita reconocimiento de voz para transcribir en el dispositivo lo grabado al crear una skill.'
    }
  },
  afterSign: 'build/notarize.js',
  dmg: {
    artifactName: '${name}-${version}-${arch}.${ext}'
  },
  npmRebuild: false
}
