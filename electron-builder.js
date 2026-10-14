'use strict'

// Config de electron-builder como JS (no YAML) para poder decidir firma real vs. ad-hoc según el
// entorno: sin Developer ID (CSC_NAME/CSC_LINK) no hay forma de firmar de verdad en esta máquina,
// así que el build ad-hoc (`identity: '-'`, `hardenedRuntime: false`) sigue siendo el default de
// `npm run package`. Ver docs/DISTRIBUCION.md para publicar una build firmada y notarizada.
//
// `LAZUNOX_SELF_SIGNED=1` (opcional; por defecto NO cambia nada): firma con un certificado de firma de código
// AUTOFIRMADO que el usuario crea en Acceso a Llaveros y pasa en `CSC_NAME`, sin notarizar. Existe para que macOS
// conserve los permisos (TCC) entre actualizaciones: con firma ad-hoc los vuelve a pedir tras cada versión.
// Ver docs/DISTRIBUCION.md §10.
const selfSigned = process.env.LAZUNOX_SELF_SIGNED === '1'
// Python propio de macOS: la arquitectura del paquete es arm64 (ver mac.target); LAZUNOX_PYTHON_ARCH=x64 elige el de Intel.
const pythonMacDir = `resources/python-bin/mac-${process.env.LAZUNOX_PYTHON_ARCH === 'x64' ? 'x64' : 'arm64'}/python`
if (selfSigned && !process.env.CSC_NAME) {
  throw new Error('LAZUNOX_SELF_SIGNED=1 requiere CSC_NAME con el nombre del certificado de firma de código (docs/DISTRIBUCION.md §10).')
}
const hasSigningIdentity = Boolean(process.env.CSC_NAME || process.env.CSC_LINK)
// Notarización con clave API de App Store Connect (APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, preferida) o con
// Apple ID (APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID). Ver build/sign-common.js.
const notarizeCreds = require('./build/sign-common.js').resolveNotarizeCreds(process.env)
const hasNotarizeCreds = notarizeCreds.kind === 'api-key' || notarizeCreds.kind === 'apple-id'

if (selfSigned && hasNotarizeCreds) {
  console.warn('[electron-builder.config] LAZUNOX_SELF_SIGNED=1: se ignoran las credenciales de Apple; este build NO se notariza.')
}
if (hasSigningIdentity && !selfSigned && !hasNotarizeCreds) {
  console.warn(
    '[electron-builder.config] Hay identidad de firma (CSC_NAME/CSC_LINK) pero faltan ' +
      'APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID: el build quedará firmado pero SIN notarizar ' +
      '(macOS lo bloqueará con Gatekeeper al distribuirlo). Ver docs/DISTRIBUCION.md.'
  )
}

// Control del PC en Windows (plan win-C, tanda C7): `cu-helper.exe` y el agente `computer.win.md` solo entran al paquete de
// Windows con la función ACTIVA. «Activa» = la puerta de compilación `TASKS_WIN_BUILD` (Control del PC es un modo de la beta de
// Tareas; se lee su literal de src/shared/feature-flags.ts, sin importarlo; decisión del dueño 2026-10-07). Ya NO hace falta
// `LAZUNOX_COMPUTER_WIN_PACK=1` (si se deja, no cambia nada: nunca quita y con la puerta apagada tampoco mete). Los fuentes de Rust
// y `target/` NO entran nunca (los excluye `files`, más abajo, junto con el resto de `resources/computer-use/win`).
const tasksWinBuildOn = /export const TASKS_WIN_BUILD\s*=\s*true\b/.test(
  require('node:fs').readFileSync(require('node:path').join(__dirname, 'src/shared/feature-flags.ts'), 'utf8')
)
const computerWinPack = tasksWinBuildOn
// Tareas en Windows, BETA OPCIONAL (decisión del dueño 2026-10-07): con `TASKS_WIN_BUILD` activo el instalador lleva el lanzador
// de WSL (solo los 5 archivos de la carga: nunca pruebas, vectores ni `rootfs/`), el `pin.json` y las DOS imágenes (la base de WSL y
// el opencode linux-x64; `npm run stage:wsl-bundle` las deja en `resources/wsl-images/`, fuera de git). Con la bandera apagada no
// entra nada. `scripts/check-win-bundle.mjs` (parte de `package:win`) exige que las imágenes existan y coincidan con el pin.
const wslBundlePack = tasksWinBuildOn
// Nombre de la imagen según la versión del pin (así subir `wsl-rootfs.version` no deja un filtro viejo). Solo se lee con la función activa.
const wslRootfsFile = wslBundlePack
  ? `lazunox-rootfs-${JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, 'resources/opencode-bin/pin.json'), 'utf8'))['wsl-rootfs'].version}-x64.tar.gz`
  : null

/** @type {import('electron-builder').Configuration} */
module.exports = {
  // Nombre e ID de la app: mantener sincronizado con src/shared/brand.ts
  appId: 'cl.bentec.lazunox',
  productName: 'Lazunox',
  directories: {
    buildResources: 'build',
    output: 'dist'
  },
  files: [
    '!**/.vscode/*',
    '!src/*',
    '!pwa/**',
    '!e2e/**',
    '!scripts/**',
    '!tools/**',
    // Copias de trabajo y ajustes locales de agentes/herramientas: NUNCA dentro del paquete (una vez entraron 17 600 archivos de .claude/worktrees).
    '!.claude/**',
    '!vitest*.config.ts',
    // Higiene del paquete (F7-B34): config de lint/formato, changelogs y documentación no van en el .asar.
    '!{eslint.config.mjs,.prettierrc,.prettierignore,CHANGELOG-FASE*.md}',
    '!docs/**',
    // Artefactos locales ignorados por git (notas de trabajo y cachés de tsc): nunca dentro del paquete.
    '!{.nd,.nd/**,*.tsbuildinfo}',
    '!electron.vite.config.{js,ts,mjs,cjs}',
    '!{.eslintignore,.eslintrc.cjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md,PLAN.md,DESIGN.md,AUDIT.md}',
    '!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}',
    '!build/*',
    // Nada generado por OpenCode ni fuentes del helper dentro del paquete (AUDIT.md P1).
    '!resources/opencode/{node_modules,node_modules/**,package.json,package-lock.json,bun.lock,.gitignore}',
    '!resources/computer-use/{helper.swift,keys.swift,build.sh,bin,bin/**,win,win/**}',
    // El agente de Windows vive FUERA de `agents/` (esa carpeta se copia entera a userData y su contenido está vigilado) y nunca va en el .asar ni en el paquete de macOS: con la función activa viaja por win.extraResources.
    '!resources/opencode/agents-win/**',
    '!resources/launcher/**',
    '!resources/keybox/**',
    // Recursos del backend WSL de Tareas (F8-B81): NUNCA dentro del .asar; con la bandera activa viajan por win.extraResources.
    '!resources/wsl/**',
    // Imágenes de staging (scripts/stage-wsl-bundle.mjs): idem, jamás en el .asar.
    '!resources/wsl-images/**',
    // El script de reemplazo del actualizador va por extraResources (sellado), no dentro del .asar.
    '!resources/updater/**',
    // El OpenCode oficial fijado (scripts/fetch-opencode.mjs) va por extraResources, nunca dentro del .asar.
    '!resources/opencode-bin/**',
    // El Python propio (scripts/fetch-python.mjs) va por extraResources (sellado y firmado), nunca dentro del .asar.
    '!resources/python-bin/**'
  ],
  // Los agentes y las skills de oficina (se copian a userData/opencode-config al arrancar; OpenCode
  // NUNCA escribe en el bundle). El helper `cu-helper` va por extraResources (Contents/Resources/computer-use/bin).
  // En Windows, node-pty se desempaqueta ENTERO (prebuilds win32 con conpty.node, conpty/conpty.dll y
  // conpty/OpenConsole.exe, más lib/worker): ConPTY lanza OpenConsole.exe y carga conpty.dll desde disco, no
  // pueden vivir dentro del .asar. En macOS no cambia nada (decide la plataforma que empaqueta).
  asarUnpack: [
    'resources/opencode/agents/**',
    'resources/opencode/skills/**',
    // Pin de ArtCraft (descarga bajo demanda): lo lee `main/office/craft/service.ts` desde app.asar.unpacked.
    'resources/craft/**',
    ...(process.platform === 'win32' ? ['node_modules/node-pty/**'] : []),
    // Control remoto (F8-B48): el addon nativo de WebRTC (`@node-datachannel/<plataforma>/node_datachannel.node`) no puede cargarse desde el .asar.
    'node_modules/@node-datachannel/**',
    // Transcripción de voz local (F8-B147): `sherpa-onnx-node` trae un addon nativo precompilado por
    // plataforma como paquete `optionalDependency` aparte (`sherpa-onnx-darwin-arm64` en Mac,
    // `sherpa-onnx-win-x64` en Windows — `npm install` solo instala el que corresponde al sistema que
    // lo corrió) — ninguno de los dos puede cargarse desde el .asar, mismo motivo que @node-datachannel.
    'node_modules/sherpa-onnx-node/**',
    'node_modules/sherpa-onnx-*/**'
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
    },
    // PWA del control remoto (F8-B48), compilada con `npm run build:pwa` → Contents/Resources/pwa (solo si existe al empaquetar).
    ...(require('node:fs').existsSync('pwa/dist') ? [{ from: 'pwa/dist', to: 'pwa' }] : [])
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
      // Nombre visible localizado (Finder, Dock, Spotlight): InfoPlist.strings con CFBundleDisplayName
      // → Contents/Resources/<idioma>.lproj. Se añaden antes de firmar, así que quedan sellados.
      { from: 'build/lproj/es.lproj', to: 'es.lproj' },
      { from: 'build/lproj/es_419.lproj', to: 'es_419.lproj' },
      { from: 'build/lproj/en.lproj', to: 'en.lproj' },
      // Helper nativo de computer use (compilado con `npm run build:helper`) → Contents/Resources/computer-use/bin
      {
        from: 'resources/computer-use/bin',
        to: 'computer-use/bin',
        filter: ['cu-helper', 'cu-keys']
      },
      // Lanzador que desvincula de TCC a los `opencode serve` y a la terminal integrada
      // (AUDIT.md S6, docs/SEGURIDAD.md §3) → Contents/Resources/launcher
      {
        from: 'resources/launcher/bin',
        to: 'launcher',
        filter: ['lazunox-disclaim']
      },
      // Auxiliar del Llavero (resources/keybox): su identidad no cambia entre versiones, así que el Llavero no vuelve a preguntar tras cada
      // actualización → Contents/Resources/keybox. El binario va en git a propósito (ver resources/keybox/build.sh).
      {
        from: 'resources/keybox',
        to: 'keybox',
        filter: ['lazunox-keybox']
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
      },
      // Python propio con las librerías de oficina (scripts/fetch-python.mjs, solo macOS) → Contents/Resources/python/bin/python3,
      // para que las skills de oficina no dependan del Python del Mac del usuario. Solo si se descargó (en desarrollo no existe).
      ...(require('node:fs').existsSync(pythonMacDir) ? [{ from: pythonMacDir, to: 'python' }] : [])
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
            'Contents/Resources/computer-use/bin/cu-keys',
            'Contents/Resources/launcher/lazunox-disclaim',
            'Contents/Resources/keybox/lazunox-keybox',
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
      // Renombre a «Lazunox» (Fase 1): SOLO el nombre visible. No se define el nombre del bundle ni el del
      // ejecutable (lo comprueba src/test/identity-freeze.test.ts): Electron busca sus helpers a partir de
      // ellos; el .app, userData y el Llavero siguen llamándose «Lazunox».
      CFBundleDisplayName: 'Lazunox',
      LSHasLocalizedDisplayName: true,
      NSMicrophoneUsageDescription: 'Lazunox necesita el micrófono para grabar tu voz al grabar una skill (opcional).',
      NSSpeechRecognitionUsageDescription:
        'Lazunox necesita reconocimiento de voz para transcribir en el dispositivo lo grabado al crear una skill.'
    }
  },
  win: {
    icon: 'build/icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }],
    // OpenCode oficial para Windows (scripts/fetch-opencode.mjs) → resources\\opencode\\opencode.exe, fuera del asar.
    extraResources: [
      { from: 'resources/opencode-bin/bin', to: 'opencode', filter: ['opencode.exe'] },
      // Script de reemplazo del actualizador propio → resources\updater\swap.ps1 (src/main/update/swap-win.ts lo COPIA a userData
      // antes de lanzarlo). Fuera del asar: no se puede ejecutar desde dentro.
      { from: 'resources/updater', to: 'updater', filter: ['swap.ps1'] },
      // Control del PC (solo con la función activa, ver `computerWinPack`): el helper compilado → resources\\computer-use\\bin\\cu-helper.exe
      // y el agente → resources\\opencode\\agents-win\\computer.win.md (src/main/tasks/computer-agent.ts lo busca ahí). Solo esos dos archivos
      // (`filter`): jamás los fuentes de Rust ni `target/`.
      ...(computerWinPack
        ? [
            { from: 'resources/computer-use/win/bin', to: 'computer-use/bin', filter: ['cu-helper.exe'] },
            { from: 'resources/opencode/agents-win', to: 'opencode/agents-win', filter: ['computer.win.md'] }
          ]
        : []),
      // Tareas en Windows (beta opcional, solo con `wslBundlePack`): lanzador y carga de WSL → resources\\wsl, el pin → resources\\wsl\\pin.json
      // y las dos imágenes → resources\\wsl\\images (de ahí `setup()` las COPIA a la caché y las verifica; nunca se usan en el sitio).
      ...(wslBundlePack
        ? [
            { from: 'resources/wsl', to: 'wsl', filter: ['launcher.py', 'landlock.py', 'mux.py', 'protocol.py', 'wsl.conf'] },
            { from: 'resources/opencode-bin', to: 'wsl', filter: ['pin.json'] },
            {
              from: 'resources/wsl-images',
              to: 'wsl/images',
              filter: [wslRootfsFile, 'opencode-linux-x64.tar.gz']
            }
          ]
        : [])
    ]
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    // El actualizador de Windows solo funciona en la carpeta por usuario (%LOCALAPPDATA%\Programs\Lazunox): se cierra la
    // página «Para todos los usuarios» (build/installer.nsh) y no se elige carpeta (plan win-D, decisión D-W1).
    allowToChangeInstallationDirectory: false,
    include: 'build/installer.nsh',
    installerLanguages: ['es_ES', 'en_US'],
    multiLanguageInstaller: true,
    artifactName: '${productName}-Setup-${version}-${arch}.${ext}'
  },
  afterSign: selfSigned ? 'build/after-sign-self-signed.js' : 'build/notarize.js',
  // Notariza y graba el .dmg (el afterSign solo cubre el .app). No hace nada sin Developer ID + credenciales.
  afterAllArtifactBuild: 'build/notarize-dmg.js',
  dmg: {
    // Solo el título del volumen montado: el nombre del archivo (artifactName) NO cambia (lo usa la cask).
    title: 'Lazunox ${version}',
    artifactName: '${name}-${version}-${arch}.${ext}'
  },
  npmRebuild: false
}
