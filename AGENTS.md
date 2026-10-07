# AGENTS.md — guía para agentes de IA y contribuidores de Lazunox

Lazunox es un cliente de escritorio (Electron + React + TypeScript) para macOS arm64 que usa el servidor de agentes de OpenCode.
Modos: Chat, Code, Tareas (trabajo autónomo con sandbox) y Rutinas. Hay un control remoto desde el celular (solo macOS, red local)
y un port parcial a Windows. Esta guía resume las invariantes reales; el detalle está en `README.md`, `docs/SEGURIDAD.md`,
`docs/VERIFICACION.md`, `docs/PLAN-MAESTRO.md`, `docs/DISTRIBUCION.md` y los `CHANGELOG-FASE*.md`. Si algo de aquí contradice el código,
manda el código: corrige esta guía.

## 1. Estructura del repositorio

| Ruta | Qué hay |
|---|---|
| `src/main/` | Proceso principal: `opencode/` (sidecar), `ipc/` (handlers, `schemas.ts`, `guard.ts`), `tasks/` (sandbox Seatbelt, proxies, políticas), `scheduler/` (rutinas), `computer/` (control del Mac), `embedded-browser/`, `remote/` (control remoto), `update/` (actualizador), `security/` (protocolo `lazunox://app`, endurecimiento web), `git/`, `pty/`, `files/`, `extras/`, `util/`. |
| `src/preload/` | `index.ts` expone `window.api` tipado (+ `code-api`, `tasks-api`, `extras-api`, `browser-api`, `remote-api`). `quick`, `overlay`, `pill`, `assist` y `browser-host` son preloads con sandbox, autocontenidos a propósito. |
| `src/renderer/` | `src/` (app: `app/`, `lib/`, `stores/`, `components/`, `features/{chat,code,tasks,routines,settings,browser,…}`), más `quick/`, `overlay/`, `browser/` (ventanas secundarias) e `index.html`. |
| `src/shared/` | Código compartido main/renderer/PWA: `brand.ts`, `ipc*.ts` (contratos IPC), `i18n/{es,en}`, `platform-caps.ts`, `remote/` (protocolo del celular), tipos. |
| `src/test/` | Guardias transversales (`identity-freeze`, `no-legacy-name`, `visible-terms`, `legacy-terms`, `i18n-coverage`, `brand-consistency`, `update-scripts`, `win-skip`…). |
| `pwa/` | PWA del celular (Vite propia, `pwa/src`); se compila a `pwa/dist` y viaja en `Contents/Resources/pwa`. |
| `e2e/` | Harness E2E con Electron real + OpenCode falso (`e2e/lib`, `e2e/specs/*.e2e.ts`, `e2e/fake-opencode`), `smoke.mjs`, `transform.mjs`, `perf/`, `win-skip.json`. |
| `scripts/` | `build-native.mjs`, `build-pwa.mjs`, `fetch-opencode.mjs`, `publish-update.mjs` / `sign-update.mjs` / `verify-update.mjs` (con `--platform win32-x64` para Windows), `verify-*.mjs`, `check-*.mjs`, `with-env.mjs`, `win/` (PC Windows de pruebas por SSH). |
| `resources/` | `opencode-bin` (versión fijada en `pin.json`; `api-routes.json`), `opencode` (prompts/agentes), `updater/swap.sh` (Mac) y `updater/swap.ps1` (Windows), `launcher`, `computer-use`. |
| `build/` | Firma y notarización (`notarize.js`, entitlements, iconos). `electron-builder.js` está en la raíz. |
| `docs/` | Plan, seguridad, verificación, distribución, política de la organización, diseño de la fase 2 del remoto; `docs/archive/` es histórico. |

El nombre de la app vive solo en `src/shared/brand.ts`, `package.json` y `electron-builder.js`.
**Identidad única Lazunox**: `DISPLAY_NAME` e `INTERNAL_NAME` son el mismo nombre, y `INTERNAL_NAME`, `APP_ID`, `APP_SLUG`, `Lazunox.app`, `productName` y `app.setName(INTERNAL_NAME)` no se cambian sin un plan de migración (userData, Llavero, actualizador, permisos TCC y vínculos del celular dependen de ellos; los vigila `src/test/identity-freeze.test.ts`). El nombre anterior no puede reaparecer en el repo: `src/test/no-legacy-name.test.ts` lo exige y las excepciones (historial, migraciones, dominio externo pendiente, PC Windows de pruebas) viven en `src/test/legacy-name-allowlist.ts`. En el código el modo Tareas se llama `tasks`.

## 2. Comandos (Node 22: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH`)

| Comando | Para qué |
|---|---|
| `npm run typecheck` | `tsc` de main/preload, renderer y PWA (`typecheck:node`, `:web`, `:pwa`). |
| `npm test` | Vitest unitario (`vitest run`); no recoge `e2e/`. Un archivo: `npx vitest run ruta/al.test.ts`. |
| `npm run lint` / `npm run format:check` | ESLint y Prettier sobre `src` y `pwa` (arreglar formato: `npx prettier --write <rutas>`). |
| `npm run build` | `build-native` + `build:pwa` + `electron-vite build` (a `out/` y `pwa/dist`). |
| `npm run verify` | typecheck, test, lint, format:check, build, `test:transform`, `test:smoke` y `test:e2e`, en ese orden. |
| `npm run test:e2e` / `test:e2e:prod` | E2E con Electron real (modo dev con ganchos `__lazunoxE2E` / modo prod con CSP real, solo humo). |
| `npm run package` / `package:win` | Descarga el OpenCode fijado, compila y empaqueta (DMG arm64 / NSIS x64). Firma ad-hoc salvo Developer ID. |
| `npm run perf:startup` | Manual: arranque en frío y memoria con la app construida (~5,5 min). |
| `npm run test:fs`, `npm run test:stress` | Opcionales, fuera de `verify`: puntos de restauración sobre volúmenes reales (solo macOS) y estrés (~15 s). |
| `npm run verify:release`, `verify:bundled`, `verify:update-manifest` | Solo para publicar: identidad/licencia/clave; contenido del `.app`; manifiesto del actualizador (sin red). |
| `npm run check:opencode`, `check:mcp-catalog`, `check:win-bundle` | Manuales (algunos con red). |

## 3. Reglas de verificación

- **Cada commit**: `typecheck` → `npm test` → `lint` → `format:check` → `build`. Si falla un control, `git revert`; no se arregla encima (`docs/PLAN-MAESTRO.md`).
- **Cambios acotados**: corre antes las pruebas dirigidas (`npx vitest run <archivo>`); la suite completa al cerrar la tanda.
- **Tocar `src/main/ipc`, preloads, ventanas, CSP o renderer visible**: además `npm run build`, `test:transform` y el spec E2E afectado.
- **E2E y build compartido**: `out/` y el puerto del servidor de renderer se comparten entre agentes. Antes de construir o correr E2E adquiere el cerrojo de build (`docs/REVIEW-FASE7.md`, «Cerrojo de build/E2E»: un `mkdir` de un directorio de cerrojo en un bucle `until`, liberado con `rmdir`). Sin cerrojo, dos E2E a la vez se pisan.
- **E2E solo con userData temporal**: `startApp()` crea `lazunox-e2e-*` y siembra `settings.json` (si no, `migrateLegacyUserData` movería datos reales de `Lapis`/`OpenDesk`). Nunca apuntes un E2E a tu userData real ni a `/Applications`.
- **Pruebas de plataforma**: en Windows se saltan con `macOnly`/`posixOnly`/`winOnly` (`src/test/platform.ts`) y `e2e/win-skip.json` (vigilado por `win-skip.test.ts`).
- Si `resources/opencode-bin/api-routes.json` aparece modificado y falla un test: `git checkout -- resources/opencode-bin/api-routes.json`.
- Tiempos documentados: `perf:startup` ~5,5 min; E2E completo en Windows ~8 min (límites de `scripts/win/run.ps1`); `test:stress` ~15 s. Pon siempre límite de tiempo a los comandos largos (sección 8).
- Al terminar: comprueba que no quedan procesos sobrantes (`pgrep -fl "electron|opencode|vitest"`); el harness E2E ya mata los suyos, pero un fallo manual puede dejarlos.

## 4. Convenciones

- **Ramas**: `feat/<tema>` y `fix/<tema>`; un worktree por agente cuando hay trabajo en paralelo. El repo principal no se toca desde un worktree ajeno.
- **Commits**: en español, un commit por paso, y cuando los hace una IA terminan con la línea `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. **`git add` por rutas** (nunca `git add -A` ni `.`): hay otros agentes editando el mismo árbol.
- **Changelog**: todo cambio de comportamiento lleva un ID `F8-B<n>` en `CHANGELOG-FASE8.md` (las fases anteriores: `CHANGELOG-FASE6.md`, `-FASE7.md`) con su prueba. Si toca seguridad, actualiza también `docs/SEGURIDAD.md`.
- **Texto de UI en español** (con inglés beta, ver sección 6). Flujo del dueño: planifica con Opus 5.5, ejecuta con Sonnet 5.5.
- No publicar, no hacer `git push` sin que se pida, no tocar servidores (Proxmox, Cloudflare), no crear tags ni releases.

## 5. IPC

- Un canal nuevo exige TODO esto: contrato tipado en el `ipc*.ts` de su área (`src/shared/ipc.ts`, `ipc-code.ts`, `ipc-tasks.ts`, `ipc-extras.ts`, `ipc-browser.ts`, `ipc-remote.ts`) y su lista de canales; **esquema estricto en `src/main/ipc/schemas.ts`** (la tabla está tipada contra el contrato: un canal sin esquema no compila; claves inesperadas → `INVALID`); handler con `handle(ipcMain, 'canal', fn)` (`makeInvokeHandler`); builder en el preload; y, si lo usa una ventana secundaria, su entrada en `CHANNEL_ROLES` (por defecto solo la ventana principal invoca).
- `guardInvoke` (`src/main/ipc/guard.ts`) comprueba emisor (frame principal, origen propio, ventana con rol), rol y payload. No lo esquives.
- Capacidades por plataforma: `src/shared/platform-caps.ts` (`capsFor`), nunca `process.platform` suelto en la UI; los canales no soportados se registran en `unsupported-handlers.ts`.
- Cada canal `remote:*` y cada canal nuevo necesita además clase en `src/main/remote/policy.ts` (los tests lo exigen).

## 6. i18n

- Diccionarios `src/shared/i18n/es/*.ts` (fuente de verdad) y `en/*.ts` (mismas claves; el tipo `Messages` lo fuerza). Texto visible solo vía `t('clave')`; en main, `src/main/i18n.ts`.
- Variantes por plataforma: una clave `x.win` sustituye a `x` en Windows (`src/shared/i18n/index.ts`; `platform.test.ts` exige que exista también la base y en ambos idiomas).
- Guardias: `src/test/visible-terms.test.ts` (el texto visible y los prompts no nombran productos de terceros), `src/test/legacy-terms.test.ts` (el nombre antiguo del modo Tareas no reaparece en el árbol publicable), `src/test/i18n-coverage.test.ts` (los archivos de `MIGRATED` no llevan texto escrito a mano; excepción puntual con un comentario `i18n-ignore: motivo`). Al migrar un archivo, añádelo a `MIGRATED`.

## 7. ZONAS INTOCABLES y por qué

No se modifican sin una decisión explícita del dueño (son los controles de seguridad; un cambio «inocente» los rompe en silencio):

| Zona | Dónde | Por qué |
|---|---|---|
| Sandbox Seatbelt | `src/main/tasks/sandbox-profile.ts`, `sandbox.ts` | Es el aislamiento del modo Tareas; el perfil es deny-by-default y está validado contra el sistema real. |
| Proxy de credenciales y de salida | `src/main/tasks/proxy.ts` (`CredentialProxy`, `EgressProxy`) | La clave real del proveedor vive solo fuera del sandbox; el servidor sandboxeado recibe un valor centinela. |
| `provider-egress` y mapa de proveedores | `src/main/tasks/provider-egress.ts` | Define qué proveedor puede usar el sandbox y a qué destino real; falla cerrado. |
| `proxy-policy` | `src/main/tasks/proxy-policy.ts` | Lista blanca de red de Tareas (deny-by-default, persistida). |
| Puerta del plan (`lazunox-plan-gate`) | `src/main/tasks/opencode-config.ts` y su uso en `manager.ts` | Ninguna herramienta de acción corre sin un plan aprobado por sesión. |
| `folder-policy` | `src/main/tasks/folder-policy.ts` | Qué carpetas no se pueden autorizar (home, Library, userData, montajes…). |
| Tareas en Windows (apagado) | `src/main/tasks/folder-policy-win.ts`, `ui-path.ts`, `win-context.ts`, `backends/wsl*.ts`, `resources/wsl/*`, `src/shared/wsl-paths.ts`, `src/shared/feature-flags.ts` | Aislamiento con WSL2, política de carpetas de Windows y puerta de compilación `TASKS_WIN_BUILD`: lista cerrada que falla cerrado. No se tocan sin decisión del dueño; `TASKS_WIN_BUILD` solo pasa a `true` en un commit aparte, con los informes del PC en verde. |
| CSP de la ventana principal y del esquema `lazunox://app` | `RENDERER_CSP` / `src/main/security/app-protocol.ts`, `src/renderer/index.html` | Sin ella un XSS llega a `window.api`; no se afloja ni se añaden orígenes. |
| Hashes de los preloads secundarios | `src/preload/{quick,overlay,pill,assist,browser-host}.ts` | Son autocontenidos con sandbox a propósito; tras `build` sus hashes (`shasum out/preload/<x>.js`) deben ser idénticos (control de `docs/PLAN-MAESTRO.md`). |
| Otros que el plan maestro protege | `helper.swift` (cu-helper), regla `webRequest` de loopback | Permisos TCC y red del navegador integrado. |

## 8. Control remoto desde el celular (seguridad)

- **Rol «celular»**: no es una ventana ni existe en `CHANNEL_ROLES`; el celular llama por `invokeAs` (`src/main/ipc/handle.ts`) con un `authorize` que ejecuta `decide` (`src/main/remote/policy.ts`). Ninguna ventana gana canales por esto.
- **Denegar por defecto**: canal o ruta del motor sin entrada = rechazo. Clases R (lectura), M (mutación acotada al ámbito de carpetas), D (peligrosa: confirmación en el Mac, ligada al hash de la llamada exacta) y X (prohibida, incluidos todos los `remote:*`). Rutas con `realpath` antes de ejecutar (`path-guard.ts`).
- **Acceso**: red local (IP privada), WebRTC/DTLS; QR de un solo uso (120 s; su secreto `q` no viaja, 5 fallos lo anulan) con confirmación del código de 6 dígitos en el Mac; autenticación mutua por HMAC ligado a las huellas DTLS (protocolo v3, `src/shared/remote/handshake.ts`: ninguna credencial viaja); máx. 3 celulares y uno conectado a la vez; la confirmación de cada conexión en el Mac es opcional (ajuste apagado por defecto o política `requireConnectionConfirm`; sin PIN siempre confirma; «Recordar 12 h» opcional); PIN por dispositivo (scrypt, 5 fallos revocan); caducidad por dispositivo (30/90/365 días, «nunca» solo desde el Mac); auditoría sin secretos (`remote-audit.jsonl`); política de la organización fail closed (`docs/POLITICA-ORGANIZACION.md`). Se apaga solo a los 30 min sin conexión.
- **Qué nunca se expone al celular**: la contraseña del motor (la reescribe y limpia `engine-registry.ts`), claves y credenciales (`auth.json`, `scrub`), archivos sensibles, rutas fuera del ámbito, el secreto de dispositivo (solo su sha256 en `remote.bin`, cifrado con `safeStorage`), ni PIN ni su hash.
- **Aprobar comandos desde el celular** (`bash`/`edit` «una vez»): D salvo el ajuste por dispositivo `canApproveCommands` (apagado por defecto; se enciende solo en el Mac con diálogo propio) y la lista de denegación de `command-denylist.ts` (heurística, no un límite), con tope de 20 por hora y `approve-command` en la auditoría (`docs/SEGURIDAD.md` §3 tricies quinquies).
- **Fuera de casa** (F8-B77, opcional, apagado por defecto): selector «Solo esta red» / «También fuera de casa» (`remote.connection`); señalización por un servicio de conexión sin estado (`cloud/remoto-worker`, núcleo `src/shared/remote/room-core.ts`), protocolo v4 (el Mac acepta v3 y v4), sitio HTTPS firmado por el dueño y vigilado por el Mac (`site-watch.ts`), política `allowOutsideNetwork/allowRelay/allowPush/requirePasskey` (ausente con archivo = cerrado). Nada se publica desde CI ni por agentes: `docs/SEGURIDAD.md` §3 tricies septies y `cloud/remoto-worker/README.md`.
- **Modo viaje** (F8-B85/B86, experimental, opcional): `connection: 'travel'`, túnel rápido de Cloudflare **sin cuenta** (`cloudflared` 2026.9.3 fijado en `resources/cloudflared/pin.json`, descargado bajo demanda con consentimiento y verificado por dos hashes y firma antes de cada arranque; `src/main/remote/tunnel/`, `signaling/tunnel-*.ts`). Invariantes: servidor ligado a 127.0.0.1, puerta `/k/<T>` + galleta `__Host-lazunoxk`, `Host`/`Origin` exactos, 404 idéntico a todo lo demás, vínculo efímero `kind: travel` (PIN obligatorio, se borra al cerrar el túnel), `bye{travel-ended}`. Los canales `remote:travelInstall` y `remote:setTravelKeep` son X. **`cloudflared` es un proceso hijo propio**: vigía `/bin/sh` de `stdin`, `pids.json` (`kind: cloudflared`), `killStaleServers` solo limpia el nuestro (`isOurCloudflared`), `killNow()` al salir; en pruebas automáticas se usa SIEMPRE el falso (`e2e/fake-cloudflared/`); el camino real (descarga y túnel de verdad, dentro de Electron, con userData temporal) lo recorre a mano `scripts/travel-smoke.cjs`, nunca `npm test`. La interfaz no ofrece un servidor propio como intermediario. Al cambiar de versión de `cloudflared`: regenerar `pin.json` con `scripts/cloudflared/pin.mjs` (persona con red) y `THIRD_PARTY_NOTICES.md`. `docs/SEGURIDAD.md` §3 tricies novies y quadragies.
- **Control remoto en Windows (APAGADO, bandera `remoteWin`)**. `REMOTE_WIN_BUILD = false` (literal en `src/main/remote/remote-win-flag.ts`, no en `feature-flags.ts`: zona intocable); sin la bandera `capsFor('win32').remote` es `false`. Con la plataforma inyectada ya cubre IP de LAN, `cloudflared` (sin asset en el pin: no disponible), lista de denegación de cmd/PowerShell, bandeja y reintentos de archivo; **nada probado en un Windows real**. Las listas de denegación de Windows solo añaden negativas: no se relaja ninguna de macOS. Estado, huecos y preguntas: `docs/REMOTO-WINDOWS.md`.
- Una función remota nueva se diseña así: clase en `policy.ts` + prueba + sección en `docs/SEGURIDAD.md`. Ante la duda, la clase más estricta.
- **Tareas en Windows (APAGADO, F8-B105/B106)**. Estado real: `TASKS_WIN_BUILD = false` (literal, no se cambia sin informes); `selectBackend` y `startTasksServer` fallan cerrado en win32 (nunca sin aislamiento, nunca «Control total»); política de carpetas restrictiva (`folder-policy-win.ts`, solo discos fijos, sin `AppData` ni enlaces, falla cerrado); una guardia exige dos informes del PC (elevada y normal) con hashes al día antes de encender. **Lo verificado** es lo de macOS con la plataforma inyectada (rutas, política, A18, renderer, almacenamiento). **Lo que falta**: la imagen Debian fijada y empaquetada, y correr la batería A1–A20 en el PC (11 de las 22 filas solo se pueden probar allí; el guion `tasks-attack.ps1` aún no está en el repo). Reglas: traducir una ruta (`C:\…` ⇄ `/win/c/…`) **no autoriza**; la autorización vive solo en `main` (`resolveUiPath` + `assertInsideApproved`), el renderer traduce solo para hablar con OpenCode (`conn.directory`) y para mostrar `C:\…`; en macOS todo es identidad. En pruebas de Windows no toques `wsl --shutdown` ni otras distros. Detalle: `docs/SEGURIDAD.md` §3 quadragies quater y `docs/WINDOWS-TAREAS.md`.
- **Control del PC en Windows (APAGADO, banderas `computerWin` + `tasksWin`, plan win-C)**. Helper Rust `resources/computer-use/win` (`cu-helper.exe`), agente `computer.win.md` (elegido por `src/main/tasks/computer-agent.ts`; macOS no cambia), políticas puras en `src/main/computer/policy/`, paquete solo con la función activa (`electron-builder.js`, `scripts/check-win-bundle.mjs`) y spec `e2e/specs/computer-win.e2e.ts` (solo win32 con `LAZUNOX_CU_E2E=1`). **Verificado en el PC real: solo que compila y responde `version`, `screens`, `cursor`, `permissions` (`session` salió 12 por escritorio seguro: falla cerrado). NO verificado:** SendInput, UI Automation, capturas con máscara, STOP/EOF, Defender/SmartScreen; firma Authenticode pendiente. `scripts/win/run-cu.ps1` y `clickjack.ps1` solo a pedido del dueño y siempre con ventanas propias de prueba. Preguntas abiertas: `docs/SEGURIDAD.md` §3 quadragies quinquies.

## 9. Reglas operativas

- **Sin carga artificial de CPU**: nada de bucles de estrés ni pruebas que saturen la máquina (un script de estrés huérfano ya quemó un equipo ~1 h).
- **Límite de tiempo en todo comando largo**. macOS no tiene `timeout`: `perl -e 'alarm shift; exec @ARGV' SEG comando args…` (como en `scripts/win/sync.sh`).
- **No dejar procesos huérfanos** (Electron, `opencode serve`, Vite, vitest): verifícalo al terminar y mata solo los que lanzaste tú.
- **No tocar datos reales ni la app instalada**: ni `~/Library/Application Support/Lazunox`, ni `/Applications`, ni `~/.local/share/opencode`. Pruebas con `os.tmpdir()`/userData temporal y claves de prueba.
- No ejecutar el control remoto, la actualización ni el empaquetado «de verdad» contra el equipo del dueño sin que lo pida; no instalar nada global.

## 10. Lecciones aprendidas

- macOS no trae `timeout`; usa `perl -e 'alarm shift; exec @ARGV'`.
- En zsh una variable sin comillas no se parte en palabras: `set -- $lista` deja UN argumento. Usa arrays (`set -- "${arr[@]}"`), `${=var}` o ejecuta el script con `sh`/bash.
- Empaquetar o comprimir con `COPYFILE_DISABLE=1` (tar, como en `scripts/win/sync.sh`); el ZIP de la actualización lo hace `ditto -c -k --sequesterRsrc --keepParent`, no electron-builder (rompería los symlinks de `Electron Framework.framework`); el de Windows (raíz `Lazunox/`, de `dist\win-unpacked`) lo arma `scripts/update-lib.mjs` en JS puro y reproducible, sin `tar.exe`, y el manifiesto es `update-win32-x64.json` (`docs/DISTRIBUCION.md` §12.1; pruebas: `src/test/update-scripts-win.test.ts`); si el ZIP lleva metadatos AppleDouble, `xattr -cr` sobre la `.app` y regenerar.
- Firma ad-hoc cambia la identidad en cada build y macOS olvida los permisos concedidos; sin Developer ID los permisos se vuelven a pedir.
- El OpenCode oficial va fijado en `resources/opencode-bin/pin.json` (versión, URL, sha256); el SDK está fijado a la misma versión. No se actualiza sin pasar `docs/ACTUALIZAR-OPENCODE.md`.
- El sidecar corre desvinculado de TCC (`disclaim`): no puede leer scripts bajo `~/Documents`; el OpenCode falso de los E2E se copia a un tmp. El sandbox de Tareas deniega leer userData y exige carpetas bajo `~`.
- `_electron.launch` de Playwright se cuelga de forma intermitente: el harness reintenta; no es un fallo del test.
- El `openssl` de `/usr/bin` (LibreSSL) no sabe Ed25519: para la clave del actualizador usa OpenSSL 3 (Homebrew). La clave privada nunca va en el repo.
- Las pruebas con reloj falso (`vi.useFakeTimers`) deben avanzar el reloj del sistema (`vi.setSystemTime`) si el código usa `Date.now()`.
- Un cambio que parece solo de texto puede romper una guardia (`visible-terms`, `i18n-coverage`): corre los tests de `src/test` antes de dar por bueno un cambio de copy.
- Varios agentes en el mismo árbol: `git add` por rutas, no reformatees archivos ajenos y no uses `git stash`/`reset --hard` sobre trabajo que no es tuyo.
