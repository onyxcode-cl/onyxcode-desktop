# AGENTS.md — guía para agentes de IA y contribuidores de OnyxCode

OnyxCode es un cliente de escritorio (Electron + React + TypeScript) para macOS arm64 que usa el servidor de agentes de OpenCode.
Modos: Chat, Code, Tareas (trabajo autónomo con sandbox) y Rutinas. Hay un control remoto desde el celular (solo macOS, red local)
y un port parcial a Windows. Esta guía resume las invariantes reales; el detalle está en `README.md`, `docs/SEGURIDAD.md`,
`docs/VERIFICACION.md`, `docs/PLAN-MAESTRO.md`, `docs/DISTRIBUCION.md` y los `CHANGELOG-FASE*.md`. Si algo de aquí contradice el código,
manda el código: corrige esta guía.

## 1. Estructura del repositorio

| Ruta | Qué hay |
|---|---|
| `src/main/` | Proceso principal: `opencode/` (sidecar), `ipc/` (handlers, `schemas.ts`, `guard.ts`), `tasks/` (sandbox Seatbelt, proxies, políticas), `scheduler/` (rutinas), `computer/` (control del Mac), `embedded-browser/`, `remote/` (control remoto), `update/` (actualizador), `account/`, `security/` (protocolo `onyxcode://app`, endurecimiento web), `git/`, `pty/`, `files/`, `extras/`, `util/`. |
| `src/preload/` | `index.ts` expone `window.api` tipado (+ `code-api`, `tasks-api`, `extras-api`, `browser-api`, `remote-api`). `quick`, `overlay`, `pill`, `assist` y `browser-host` son preloads con sandbox, autocontenidos a propósito. |
| `src/renderer/` | `src/` (app: `app/`, `lib/`, `stores/`, `components/`, `features/{chat,code,tasks,routines,settings,browser,…}`), más `quick/`, `overlay/`, `browser/` (ventanas secundarias) e `index.html`. |
| `src/shared/` | Código compartido main/renderer/PWA: `brand.ts`, `ipc*.ts` (contratos IPC), `i18n/{es,en}`, `platform-caps.ts`, `remote/` (protocolo del celular), tipos. |
| `src/test/` | Guardias transversales (`visible-terms`, `legacy-terms`, `i18n-coverage`, `brand-consistency`, `update-scripts`, `win-skip`…). |
| `pwa/` | PWA del celular (Vite propia, `pwa/src`); se compila a `pwa/dist` y viaja en `Contents/Resources/pwa`. |
| `e2e/` | Harness E2E con Electron real + OpenCode falso (`e2e/lib`, `e2e/specs/*.e2e.ts`, `e2e/fake-opencode`), `smoke.mjs`, `transform.mjs`, `perf/`, `win-skip.json`. |
| `scripts/` | `build-native.mjs`, `build-pwa.mjs`, `fetch-opencode.mjs`, `publish-update.mjs`, `verify-*.mjs`, `check-*.mjs`, `with-env.mjs`, `win/` (PC Windows de pruebas por SSH). |
| `resources/` | `opencode-bin` (versión fijada en `pin.json`; `api-routes.json`), `opencode` (prompts/agentes), `updater/swap.sh`, `launcher`, `computer-use`. |
| `build/` | Firma y notarización (`notarize.js`, entitlements, iconos). `electron-builder.js` está en la raíz. |
| `docs/` | Plan, seguridad, verificación, distribución, política de la organización, diseño de la fase 2 del remoto; `docs/archive/` es histórico. |

El nombre de la app vive solo en `src/shared/brand.ts`, `package.json` y `electron-builder.js`. En el código el modo Tareas se llama `tasks`.

## 2. Comandos (Node 22: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH`)

| Comando | Para qué |
|---|---|
| `npm run typecheck` | `tsc` de main/preload, renderer y PWA (`typecheck:node`, `:web`, `:pwa`). |
| `npm test` | Vitest unitario (`vitest run`); no recoge `e2e/`. Un archivo: `npx vitest run ruta/al.test.ts`. |
| `npm run lint` / `npm run format:check` | ESLint y Prettier sobre `src` y `pwa` (arreglar formato: `npx prettier --write <rutas>`). |
| `npm run build` | `build-native` + `build:pwa` + `electron-vite build` (a `out/` y `pwa/dist`). |
| `npm run verify` | typecheck, test, lint, format:check, build, `test:transform`, `test:smoke` y `test:e2e`, en ese orden. |
| `npm run test:e2e` / `test:e2e:prod` | E2E con Electron real (modo dev con ganchos `__onyxE2E` / modo prod con CSP real, solo humo). |
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
- **E2E solo con userData temporal**: `startApp()` crea `onyx-e2e-*` y siembra `settings.json` (si no, `migrateLegacyUserData` movería datos reales de `Lapis`/`OpenDesk`). Nunca apuntes un E2E a tu userData real ni a `/Applications`.
- **Pruebas de plataforma**: en Windows se saltan con `macOnly`/`posixOnly`/`winOnly` (`src/test/platform.ts`) y `e2e/win-skip.json` (vigilado por `win-skip.test.ts`).
- Si `resources/opencode-bin/api-routes.json` aparece modificado y falla un test: `git checkout -- resources/opencode-bin/api-routes.json`.
- Tiempos documentados: `perf:startup` ~5,5 min; E2E completo en Windows ~8 min (límites de `scripts/win/run.ps1`); `test:stress` ~15 s. Pon siempre límite de tiempo a los comandos largos (sección 8).
- Al terminar: comprueba que no quedan procesos sobrantes (`pgrep -fl "electron|opencode|vitest"`); el harness E2E ya mata los suyos, pero un fallo manual puede dejarlos.

## 4. Convenciones

- **Ramas**: `feat/<tema>` y `fix/<tema>`; un worktree por agente cuando hay trabajo en paralelo. El repo principal no se toca desde un worktree ajeno.
- **Commits**: en español, un commit por paso, y cuando los hace una IA terminan con la línea `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. **`git add` por rutas** (nunca `git add -A` ni `.`): hay otros agentes editando el mismo árbol.
- **Changelog**: todo cambio de comportamiento lleva un ID `F8-B<n>` en `CHANGELOG-FASE8.md` (las fases anteriores: `CHANGELOG-FASE6.md`, `-FASE7.md`) con su prueba. Si toca seguridad, actualiza también `docs/SEGURIDAD.md`.
- **Texto de UI en español** (con inglés beta, ver sección 6). Flujo del dueño: planifica con Opus 5.5, ejecuta con Sonnet 5.5.
- No publicar, no hacer `git push` sin que se pida, no tocar cuentas ni servidores (`api.onyxcode.cl`, Proxmox, Cloudflare), no crear tags ni releases.

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
| Puerta del plan (`onyxcode-plan-gate`) | `src/main/tasks/opencode-config.ts` y su uso en `manager.ts` | Ninguna herramienta de acción corre sin un plan aprobado por sesión. |
| `folder-policy` | `src/main/tasks/folder-policy.ts` | Qué carpetas no se pueden autorizar (home, Library, userData, montajes…). |
| CSP de la ventana principal y del esquema `onyxcode://app` | `RENDERER_CSP` / `src/main/security/app-protocol.ts`, `src/renderer/index.html` | Sin ella un XSS llega a `window.api`; no se afloja ni se añaden orígenes. |
| Hashes de los preloads secundarios | `src/preload/{quick,overlay,pill,assist,browser-host}.ts` | Son autocontenidos con sandbox a propósito; tras `build` sus hashes (`shasum out/preload/<x>.js`) deben ser idénticos (control de `docs/PLAN-MAESTRO.md`). |
| Otros que el plan maestro protege | `helper.swift` (cu-helper), regla `webRequest` de loopback | Permisos TCC y red del navegador integrado. |

## 8. Control remoto desde el celular (seguridad)

- **Rol «celular»**: no es una ventana ni existe en `CHANNEL_ROLES`; el celular llama por `invokeAs` (`src/main/ipc/handle.ts`) con un `authorize` que ejecuta `decide` (`src/main/remote/policy.ts`). Ninguna ventana gana canales por esto.
- **Denegar por defecto**: canal o ruta del motor sin entrada = rechazo. Clases R (lectura), M (mutación acotada al ámbito de carpetas), D (peligrosa: confirmación en el Mac, ligada al hash de la llamada exacta) y X (prohibida, incluidos todos los `remote:*`). Rutas con `realpath` antes de ejecutar (`path-guard.ts`).
- **Acceso**: red local (IP privada), WebRTC/DTLS; QR de un solo uso (120 s) con confirmación del código de 6 dígitos en el Mac; máx. 3 celulares y uno conectado a la vez; cada conexión nueva se confirma en el Mac («Recordar 12 h» opcional); PIN por dispositivo (scrypt, 5 fallos revocan); caducidad por dispositivo (30/90/365 días, «nunca» solo desde el Mac); auditoría sin secretos (`remote-audit.jsonl`); política de la organización fail closed (`docs/POLITICA-ORGANIZACION.md`). Se apaga solo a los 30 min sin conexión.
- **Qué nunca se expone al celular**: la contraseña del motor (la reescribe y limpia `engine-registry.ts`), claves y credenciales (`auth.json`, `scrub`), archivos sensibles, rutas fuera del ámbito, el secreto de dispositivo (solo su sha256 en `remote.bin`, cifrado con `safeStorage`), ni PIN ni su hash.
- Una función remota nueva se diseña así: clase en `policy.ts` + prueba + sección en `docs/SEGURIDAD.md`. Ante la duda, la clase más estricta.

## 9. Reglas operativas

- **Sin carga artificial de CPU**: nada de bucles de estrés ni pruebas que saturen la máquina (un script de estrés huérfano ya quemó un equipo ~1 h).
- **Límite de tiempo en todo comando largo**. macOS no tiene `timeout`: `perl -e 'alarm shift; exec @ARGV' SEG comando args…` (como en `scripts/win/sync.sh`).
- **No dejar procesos huérfanos** (Electron, `opencode serve`, Vite, vitest): verifícalo al terminar y mata solo los que lanzaste tú.
- **No tocar datos reales ni la app instalada**: ni `~/Library/Application Support/OnyxCode`, ni `/Applications`, ni `~/.local/share/opencode`. Pruebas con `os.tmpdir()`/userData temporal y claves de prueba.
- No ejecutar el control remoto, la actualización ni el empaquetado «de verdad» contra el equipo del dueño sin que lo pida; no instalar nada global.

## 10. Lecciones aprendidas

- macOS no trae `timeout`; usa `perl -e 'alarm shift; exec @ARGV'`.
- En zsh una variable sin comillas no se parte en palabras: `set -- $lista` deja UN argumento. Usa arrays (`set -- "${arr[@]}"`), `${=var}` o ejecuta el script con `sh`/bash.
- Empaquetar o comprimir con `COPYFILE_DISABLE=1` (tar, como en `scripts/win/sync.sh`); el ZIP de la actualización lo hace `ditto -c -k --sequesterRsrc --keepParent`, no electron-builder (rompería los symlinks de `Electron Framework.framework`); si el ZIP lleva metadatos AppleDouble, `xattr -cr` sobre la `.app` y regenerar.
- Firma ad-hoc cambia la identidad en cada build y macOS olvida los permisos concedidos; sin Developer ID los permisos se vuelven a pedir.
- El OpenCode oficial va fijado en `resources/opencode-bin/pin.json` (versión, URL, sha256); el SDK está fijado a la misma versión. No se actualiza sin pasar `docs/ACTUALIZAR-OPENCODE.md`.
- El sidecar corre desvinculado de TCC (`disclaim`): no puede leer scripts bajo `~/Documents`; el OpenCode falso de los E2E se copia a un tmp. El sandbox de Tareas deniega leer userData y exige carpetas bajo `~`.
- `_electron.launch` de Playwright se cuelga de forma intermitente: el harness reintenta; no es un fallo del test.
- El `openssl` de `/usr/bin` (LibreSSL) no sabe Ed25519: para la clave del actualizador usa OpenSSL 3 (Homebrew). La clave privada nunca va en el repo.
- Las pruebas con reloj falso (`vi.useFakeTimers`) deben avanzar el reloj del sistema (`vi.setSystemTime`) si el código usa `Date.now()`.
- Un cambio que parece solo de texto puede romper una guardia (`visible-terms`, `i18n-coverage`): corre los tests de `src/test` antes de dar por bueno un cambio de copy.
- Varios agentes en el mismo árbol: `git add` por rutas, no reformatees archivos ajenos y no uses `git stash`/`reset --hard` sobre trabajo que no es tuyo.
