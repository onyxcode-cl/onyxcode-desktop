/**
 * Excepciones de la guardia `no-legacy-name.test.ts`: lo ÚNICO que puede contener el nombre anterior de la app («onyx», sin
 * distinguir mayúsculas) en el repositorio, en contenido o en rutas. La identidad vigente es «Lazunox» (ver AGENTS.md).
 *
 * Cada entrada lleva `path` (glob con `*` y `**`, o RegExp sobre la ruta relativa con `/`), un `token` opcional (si falta, vale
 * cualquier coincidencia del archivo; si está, solo las líneas/rutas donde aparece ese token) y el `reason`. Una entrada que ya
 * no cubre nada hace fallar la guardia: bórrala. Para añadir una, justifica el motivo; si no, renombra.
 */
export interface LegacyException {
  path: string | RegExp
  token?: RegExp
  reason: string
}

export const LEGACY_NAME_ALLOWLIST: readonly LegacyException[] = [
  // --- Historial: no se reescribe ---
  { path: 'CHANGELOG.md', reason: 'Historial (secciones anteriores a 0.5.0 y la nota del renombre)' },
  { path: 'CHANGELOG-FASE*.md', reason: 'Historial de las fases 6, 7 y 8' },
  { path: 'docs/archive/**', reason: 'Documentos históricos' },
  { path: 'AUDIT.md', reason: 'Auditoría histórica' },

  // --- Herramientas internas que nombran la suite histórica ---
  {
    path: 'tools/agent-bench/**',
    reason: 'Banco de pruebas de agentes: describe sus casos «onyx» (suite de prompts de la versión anterior) y vive fuera de la app'
  },

  {
    path: 'tools/computer-bench/tasks.mjs',
    token: /canal onyxcode/i,
    reason: 'Prueba de control del Mac: «onyxcode» es el nombre real de un canal de Discord del dueño, no el de la app'
  },

  // --- Datos en disco de versiones antiguas (D7: las migraciones se conservan) ---
  {
    path: 'src/main/migrations/legacy-names.ts',
    token: /onyxcode-web-cowork/i,
    reason: 'Origen de la migración m001 (partición del navegador de la versión que aún se llamaba OnyxCode)'
  },
  {
    path: 'src/main/migrations/m001-tasks-rename.test.ts',
    token: /onyxcode-web-cowork/i,
    reason: 'La prueba de m001 usa el nombre de origen'
  },
  { path: 'e2e/specs/legacy-data.e2e.ts', token: /onyxcode-web-cowork/i, reason: 'El E2E de datos heredados siembra el nombre de origen' },
  { path: 'e2e/fixtures/legacy-userdata/**', reason: 'Fixture: userData de una versión anterior (rutas y contenido con el nombre viejo)' },

  // --- Canal de actualizaciones en GitHub: el repositorio se llama como la organización del dueño ---
  {
    path: 'src/shared/brand.ts',
    token: /onyxcode-cl\/onyxcode-desktop/i,
    reason: 'RELEASES_REPO: repositorio de GitHub donde se publican las releases'
  },
  {
    path: 'scripts/install/install.sh',
    token: /onyxcode-cl\/onyxcode-desktop/i,
    reason: 'repositorio de GitHub de las releases (RELEASES_REPO)'
  },
  {
    path: 'scripts/install/install.ps1',
    token: /onyxcode-cl\/onyxcode-desktop/i,
    reason: 'repositorio de GitHub de las releases (RELEASES_REPO)'
  },

  { path: 'README.md', token: /onyxcode-cl\/onyxcode-desktop/i, reason: 'repositorio de GitHub de las releases (RELEASES_REPO)' },
  { path: 'docs/INSTALAR.md', token: /onyxcode-cl\/onyxcode-desktop/i, reason: 'repositorio de GitHub de las releases (RELEASES_REPO)' },
  { path: 'docs/RELEASE.md', token: /onyxcode-cl\/onyxcode-desktop/i, reason: 'repositorio de GitHub de las releases (RELEASES_REPO)' },

  {
    path: 'src/shared/brand.ts',
    token: /MADE_BY = 'Onyx Code'/,
    reason: 'Crédito de la pantalla de bienvenida: «Hecho por Onyx Code» (la empresa del dueño)'
  },

  // --- Dominio externo pendiente (D3): se quita al registrar lazunox.cl ---
  { path: 'src/shared/brand.ts', token: /remoto\.onyxcode\.cl/i, reason: 'EXTERNO-PENDIENTE D3: CLOUD_DOMAIN' },
  {
    path: 'src/shared/brand.ts',
    token: /lazunox\.onyxcode\.cl/i,
    reason: 'RELEASES_ORIGIN: dominio de la empresa del dueño (onyxcode.cl) donde se publican las actualizaciones'
  },
  { path: 'scripts/publish-vps.mjs', token: /lazunox\.onyxcode\.cl/i, reason: 'servidor propio de releases (RELEASES_ORIGIN)' },
  { path: 'docs/VPS.md', token: /lazunox\.onyxcode\.cl/i, reason: 'servidor propio de releases (RELEASES_ORIGIN)' },
  { path: 'cloud/remoto-worker/wrangler.jsonc', token: /remoto\.onyxcode\.cl/i, reason: 'EXTERNO-PENDIENTE D3: ALLOWED_ORIGINS' },
  { path: 'scripts/site-lib.mjs', token: /remoto\.onyxcode\.cl/i, reason: 'EXTERNO-PENDIENTE D3: SITE_ORIGIN' },
  {
    path: 'cloud/remoto-worker/README.md',
    token: /onyxcode\.cl/i,
    reason: 'EXTERNO-PENDIENTE D3: instrucciones del dominio/zona de Cloudflare'
  },
  {
    path: 'docs/*.md',
    token: /onyxcode\.cl/i,
    reason: 'EXTERNO-PENDIENTE D3: dominio del remoto (y el viejo api.* de cuentas) citado en la documentación'
  },
  { path: 'src/test/no-accounts.test.ts', token: /onyxcode/i, reason: 'La guardia prohíbe el viejo dominio de cuentas' },

  // --- Titular de la licencia (D10 pendiente: no se toca LICENSE) ---
  { path: 'LICENSE', reason: 'D10 pendiente: titular de la licencia' },
  { path: 'THIRD_PARTY_NOTICES.md', token: /onyxcode-cl/i, reason: 'D10 pendiente: titular de la licencia (TODO documentado)' },
  { path: 'docs/RELEASE.md', token: /onyxcode-cl/i, reason: 'D10 pendiente: titular de la licencia (TODO documentado)' },
  // Organización de GitHub que alojará la release de la imagen de Linux (WSL). Pendiente D9: al renombrarla, cambiar las tres constantes juntas.
  { path: 'scripts/wsl-rootfs/pin-lib.mjs', token: /onyxcode-cl/i, reason: 'D9 pendiente: organización de GitHub de la imagen WSL' },
  { path: 'scripts/wsl-rootfs.test.mjs', token: /onyxcode-cl/i, reason: 'D9 pendiente: organización de GitHub de la imagen WSL' },
  {
    path: 'resources/opencode-bin/pin.json',
    token: /onyxcode-cl/i,
    reason:
      'D9 pendiente: la url de wsl-rootfs debe ser EXACTAMENTE wslRootfsUrl (organización de GitHub de la imagen WSL; no está publicada)'
  },
  { path: 'src/main/tasks/backends/wsl-pin.ts', token: /onyxcode-cl/i, reason: 'D9 pendiente: organización de GitHub de la imagen WSL' },
  {
    path: 'src/main/tasks/backends/wsl-pin.test.ts',
    token: /onyxcode-cl/i,
    reason: 'D9 pendiente: organización de GitHub de la imagen WSL'
  },

  // --- PC Windows de pruebas (infraestructura externa, D12) ---
  // `C:\onyx` es la carpeta REAL del PC de pruebas (y `win-onyx` su entrada de ~/.ssh/config); NO es una ruta de la app. Las rutas
  // que usa la app o sus pruebas con otros nombres (`C:\lazunox\tareas`, `/win/c/lazunox/…` en src/ y resources/wsl/) son datos de
  // prueba coherentes entre sí y no tocan el PC.
  { path: 'scripts/win/**', reason: 'Scripts del PC de pruebas real: carpeta C:\\onyx, host win-onyx y ONYX_WIN_HOST' },
  {
    path: /^src\/main\/tasks\/backends\/(wsl-setup\.win\.test|wsl-session\.win\.test|wsl-it-support)\.ts$/,
    token: /C:\\+onyx|\/win\/c\/onyx|\/c\/onyx/i,
    reason: 'Pruebas de integración (y su apoyo) que solo corren en el PC de pruebas real (C:\\onyx\\wsl, C:\\onyx\\tmp, LAZUNOX_WSL_IT=1)'
  },
  {
    path: /^(resources\/updater\/swap\.ps1|src\/main\/update\/(swap-win|config)\.test\.ts)$/,
    token: /C:\\+onyx/i,
    reason: 'Modo de prueba de swap.ps1: solo acepta destinos bajo C:\\onyx (carpeta REAL del PC de pruebas) o %TEMP%; sus pruebas lo citan'
  },
  {
    path: 'docs/*.md',
    token: /C:\\+onyx|win-onyx|ONYX_WIN_HOST|\/c\/onyx/i,
    reason: 'La documentación describe el PC de pruebas real (C:\\onyx, win-onyx, ONYX_WIN_HOST)'
  },

  // --- La propia guardia ---
  { path: 'src/test/legacy-name-allowlist.ts', reason: 'La propia lista de excepciones' },
  { path: 'src/test/no-legacy-name.test.ts', reason: 'La propia guardia' },
  { path: 'e2e/specs/clean-start.e2e.ts', token: /\/onyx\/i/i, reason: 'El E2E de arranque limpio busca el nombre viejo con /onyx/i' },
  { path: 'e2e/specs/identity.e2e.ts', token: /\/onyx\/i/i, reason: 'El E2E de identidad busca el nombre viejo con /onyx/i' }
]
