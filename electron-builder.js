'use strict'

// Config de electron-builder como JS (no YAML) para poder decidir firma real vs. ad-hoc según el
// entorno: sin Developer ID (CSC_NAME/CSC_LINK) no hay forma de firmar de verdad en esta máquina,
// así que el build ad-hoc (`identity: '-'`, `hardenedRuntime: false`) sigue siendo el default de
// `npm run package`. Ver docs/DISTRIBUCION.md para publicar una build firmada y notarizada.
//
// `ONYXCODE_SELF_SIGNED=1` (opcional; por defecto NO cambia nada): firma con un certificado de firma de código
// AUTOFIRMADO que el usuario crea en Acceso a Llaveros y pasa en `CSC_NAME`, sin notarizar. Existe para que macOS
// conserve los permisos (TCC) entre actualizaciones: con firma ad-hoc los vuelve a pedir tras cada versión.
// Ver docs/DISTRIBUCION.md §10.
const selfSigned = process.env.ONYXCODE_SELF_SIGNED === '1'
if (selfSigned && !process.env.CSC_NAME) {
  throw new Error('ONYXCODE_SELF_SIGNED=1 requiere CSC_NAME con el nombre del certificado de firma de código (docs/DISTRIBUCION.md §10).')
}
const hasSigningIdentity = Boolean(process.env.CSC_NAME || process.env.CSC_LINK)
const hasNotarizeCreds = Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID)

if (selfSigned && hasNotarizeCreds) {
  console.warn('[electron-builder.config] ONYXCODE_SELF_SIGNED=1: se ignoran las credenciales de Apple; este build NO se notariza.')
}
if (hasSigningIdentity && !selfSigned && !hasNotarizeCreds) {
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
    '!tools/**',
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
    '!resources/launcher/**',
    // El script de reemplazo del actualizador va por extraResources (sellado), no dentro del .asar.
    '!resources/updater/**',
    // El OpenCode oficial fijado (scripts/fetch-opencode.mjs) va por extraResources, nunca dentro del .asar.
    '!resources/opencode-bin/**'
  ],
  // Los agentes y las skills de oficina (se copian a userData/opencode-config al arrancar; OpenCode
  // NUNCA escribe en el bundle). El helper `cu-helper` va por extraResources (Contents/Resources/computer-use/bin).
  // En Windows, node-pty se desempaqueta ENTERO (prebuilds win32 con conpty.node, conpty/conpty.dll y
  // conpty/OpenConsole.exe, más lib/worker): ConPTY lanza OpenConsole.exe y carga conpty.dll desde disco, no
  // pueden vivir dentro del .asar. En macOS no cambia nada (decide la plataforma que empaqueta).
  asarUnpack: [
    'resources/opencode/agents/**',
    'resources/opencode/skills/**',
    ...(process.platform === 'win32' ? ['node_modules/node-pty/**'] : [])
  ],
  // Recursos comunes. Los de macOS (helper, lanzador, actualizador, OpenCode darwin) van en mac.extraResources y
  // el OpenCode de Windows en win.extraResources: cada plataforma empaqueta solo lo suyo.
  extraResources: [
    // Avisos de terceros: los propios (MIT de OpenCode, Bun/JavaScriptCore, Electron) y los de Electron/Chromium,
    // que electron-builder no deja dentro del .app → Contents/Resources/THIRD_PARTY_NOTICES.md y licenses/electron/
    {
      from: 'THIRD_PARTY_NOTICES.md',
      to: 'THIRD_PARTY_NOTICES.md'
    },
    {
      from: 'node_modules/electron/dist',
      to: 'licenses/electron',
      filter: ['LICENSE', 'LICENSES.chromium.html']
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
      },
      // Script de reemplazo del actualizador propio → Contents/Resources/updater/swap.sh. Sellado por la
      // firma del .app; la app lo COPIA a userData antes de lanzarlo (src/main/update/swap.ts).
      {
        from: 'resources/updater',
        to: 'updater',
        filter: ['swap.sh']
      },
      // OpenCode oficial fijado en resources/opencode-bin/pin.json (lo descarga `npm run package` con
      // scripts/fetch-opencode.mjs) → Contents/Resources/opencode/opencode. Dentro del .app (no en
      // userData) para que el perfil Seatbelt de Tareas pueda ejecutarlo. electron-builder/osx-sign
      // recorre TODO el bundle y vuelve a firmar cada Mach-O que encuentra (aquí también este).
      {
        from: 'resources/opencode-bin/bin',
        to: 'opencode',
        filter: ['opencode']
      }
    ],
    // Icono generado desde build/icon.svg (node build/render-icon.mjs vía electron)
    icon: 'build/icon.icns',
    category: 'public.app-category.developer-tools',
    target: [{ target: 'dmg', arch: ['arm64'] }],
    // Sin Developer ID (CSC_NAME/CSC_LINK ausentes): firma AD-HOC (los fuses modifican el binario
    // de Electron y sin volver a firmar macOS lo mata al abrir). `identity: '-'` fuerza el ad-hoc e
    // ignora cualquier CSC_NAME/CSC_LINK, así que solo lo fijamos cuando NO hay identidad real —
    // si la hay, se omite y electron-builder usa CSC_NAME/CSC_LINK automáticamente.
    ...(selfSigned ? { identity: process.env.CSC_NAME } : hasSigningIdentity ? {} : { identity: '-' }),
    // Hardened runtime + entitlements solo tienen sentido (y solo funcionan) con firma real: un
    // binario ad-hoc con hardened runtime activado no arranca. Con Developer ID sí lo activamos y
    // firmamos los helpers embebidos explícitamente (electron-builder los detecta como Mach-O igual,
    // pero se listan para que quede explícito qué se firma — AUDIT.md 5 / docs/SEGURIDAD.md §4).
    // Autofirmado: SIN hardened runtime. No aporta nada sin notarización (Gatekeeper no lo exige y TCC identifica por
    // «identificador + certificado»), y un runtime endurecido con un certificado sin cadena de confianza de Apple
    // puede impedir cargar los Mach-O embebidos. (entitlements.plist ya lleva disable-library-validation, por si se activa.)
    hardenedRuntime: hasSigningIdentity && !selfSigned,
    ...(hasSigningIdentity && !selfSigned
      ? {
          entitlements: 'build/entitlements.mac.plist',
          entitlementsInherit: 'build/entitlements.mac.plist',
          binaries: [
            'Contents/Resources/computer-use/bin/cu-helper',
            'Contents/Resources/launcher/onyxcode-disclaim',
            'Contents/Resources/opencode/opencode'
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
      NSSpeechRecognitionUsageDescription:
        'OnyxCode necesita reconocimiento de voz para transcribir en el dispositivo lo grabado al crear una skill.'
    }
  },
  win: {
    icon: 'build/icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }],
    // OpenCode oficial para Windows (scripts/fetch-opencode.mjs) → resources\\opencode\\opencode.exe, fuera del asar.
    extraResources: [{ from: 'resources/opencode-bin/bin', to: 'opencode', filter: ['opencode.exe'] }]
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    artifactName: '${productName}-Setup-${version}-${arch}.${ext}'
  },
  afterSign: selfSigned ? 'build/after-sign-self-signed.js' : 'build/notarize.js',
  dmg: {
    artifactName: '${name}-${version}-${arch}.${ext}'
  },
  npmRebuild: false
}
