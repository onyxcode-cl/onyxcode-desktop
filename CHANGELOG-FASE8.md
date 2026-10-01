# Fase 8 — Onboarding y distribución

## F8-B1 — Detección y validación del binario de OpenCode; ajustes `onboarded` y `opencodeBin`

Canales IPC nuevos (solo ventana principal; esquema en `main/ipc/schemas.ts`, allowlist del preload por `IPC_INVOKE_CHANNELS`):
`app:opencodeInfo` (`{found, path, version, sdkVersion: '1.18.32', compatible}`; ejecuta `opencode --version` con `execFile`
sin shell, `minimalEnv`, cwd del tmp, timeout de 5 s, `compatible` = misma versión mayor y menor), `app:opencodeAction`
(lista blanca `copyInstall | openDocs | openGo | openAuth`: el renderer solo elige la clave; las URL viven en
`shared/opencode-links.ts` y se abren desde main) y `app:pickOpencodeBin` (diálogo de abrir archivo en main; valida ruta
absoluta, archivo regular, `X_OK` y que `--version` termine bien e imprima algo; guarda `settings.opencodeBin`).

Ajustes nuevos: `onboarded: boolean` y `opencodeBin: string` (`''` = detección automática; se normaliza a ruta absoluta sin
bytes nulos). `settings:set` acepta `onboarded` pero NO `opencodeBin`: solo main lo escribe, tras validar el binario.
`findOpencodeBinary` ahora sigue el orden `OPENCODE_BIN` → `settings.opencodeBin` → PATH y carpetas habituales.

Comando de instalación (solo se copia, la app nunca ejecuta un instalador): `curl -fsSL https://opencode.ai/install | bash`.
Salió del propio binario de OpenCode (su rutina de actualización descarga `https://opencode.ai/install` y lo ejecuta con
bash) y del mensaje de error que ya tenía la app; el binario instalado vive en `~/.opencode/bin`, coherente con ese script.

Test: `src/main/opencode/binary.test.ts` (archivos temporales reales: ejecutable válido, symlink, sin permiso, directorio,
inexistente, relativa, `--version` mudo/fallido/colgado con timeout, ruta con metacaracteres, orden de `findOpencodeBinary`),
`src/shared/opencode-links.test.ts` (SDK = `package.json`, URL solo `https://opencode.ai`).

## F8-B2 — `ProviderKeyForm` compartido

Se extrae de `ModelsSection` el formulario «Conectar proveedor con API key» (`features/settings/impl/ProviderKeyForm.tsx`,
más `saveProviderKey`: `auth.set` + `global.dispose`). Sin cambio visual. Cambio menor: si el servidor rechaza la clave, el
campo ya no se vacía. Test: typecheck/lint y `e2e/specs/onboarding.e2e.ts` (c) (la ruta `PUT /auth/…` es la misma).

## F8-B3 — Asistente de primer uso

`features/onboarding/` (`steps.ts` puro + `Wizard.tsx`, montado en `App`). Se muestra SOLO si `onboarded !== true` y (falta el
binario o ningún proveedor está configurado); si todo ya funciona se marca `onboarded: true` en silencio. Una vez mostrado
no se oculta solo. Pasos: 1 OpenCode (copiar comando, abrir instrucciones, elegir binario, reintentar), 2 OpenCode Go (enlaces
y `ProviderKeyForm` fijo a `opencode-go`), 3 modelo (`ModelPicker` → `defaultModel`), 4 los cuatro modos (`MODE_LABELS`),
5 permisos de macOS (solo explicación). «Saltar» y «Empezar» guardan `onboarded: true`.

Hallazgo: un OpenCode recién instalado y sin claves ya «conecta» el proveedor gratuito `opencode` (origen `custom`); si contara
como proveedor, el asistente no aparecería nunca a un usuario nuevo. `isConfiguredProvider` lo excluye.

Test: `features/onboarding/steps.test.ts` (usuario existente no lo ve, sin binario → paso 1, sin proveedor → paso 2, esperas,
navegación). E2E `e2e/specs/onboarding.e2e.ts`: (a) `OPENCODE_BIN` inexistente → paso 1 con el error y «Reintentar»;
(b) «Elegir binario…» con `stubDialog` → avanza y persiste `opencodeBin`; (c) clave → `PUT /auth/opencode-go`;
(d) `onboarded` persiste y no reaparece tras reiniciar con el mismo userData. Los harness (`e2e/lib/launch.ts`,
`e2e/smoke.mjs`) siembran `onboarded: true`; `startApp` gana `userData`, `keepUserData`, `noServer` y `connectFake()`.

## F8-B4 — `scripts/fetch-opencode.mjs`: descarga verificada del OpenCode oficial fijado

`resources/opencode-bin/pin.json` fija `version`, `url` (release oficial de GitHub), `sha256` y `size` del ZIP. El script
descarga con `https` (siguiendo redirects), verifica tamaño y SHA-256 ANTES de descomprimir (si no coinciden borra todo y no
extrae), usa `ditto -x -k`, `chmod 755` y comprueba que `--version` (HOME/XDG temporales, entorno mínimo) sea `pin.version`.
`--if-missing` no descarga si ya hay un binario correcto. Solo se engancha en `npm run package`; `dev`, `build` y `verify`
no lo ejecutan ni necesitan red.

## F8-B5 — El OpenCode fijado viaja dentro del .app

`electron-builder.js`: `extraResources` copia `resources/opencode-bin/bin/opencode` a `Contents/Resources/opencode/opencode` y
`resources/opencode-bin/**` queda fuera del `.asar`. Con Developer ID el binario se añade también a `mac.binaries` (hardened
runtime + `entitlements.mac.plist`, que ya trae JIT/memoria ejecutable que necesita el motor de JavaScript del binario).

## F8-B6 — Resolución del binario con el OpenCode embebido y `source` en `app:opencodeInfo`

`OpencodeInfo` gana `source: 'env' | 'settings' | 'cli' | 'bundled' | null`. Orden nuevo: `OPENCODE_BIN` → `settings.opencodeBin` →
CLI del usuario SI es compatible (misma mayor.menor que el SDK) → embebido (`<Resources>/opencode/opencode`, solo con
`app.isPackaged`) → CLI incompatible como último recurso. La versión del CLI se mide con `execFile` asíncrono (timeout 5 s) y se
cachea por (ruta, mtime); solo se mide si hay embebido: en desarrollo (sin embebido) el comportamiento es idéntico al anterior
(mismo CLI, sin ejecutar `--version` extra). `startTasksServer`, el sidecar y `app:opencodeInfo` usan `resolveOpencodeAsync`;
`findOpencodeBinary` sigue siendo síncrona (usa solo la caché). `ONYXCODE_TEST_BUNDLED_DIR` (solo tests, ignorada empaquetado)
simula el directorio embebido. El paso 1 del asistente no cambia todavía.

## F8-B10 — Asistente: paso 1 informativo con el motor incluido

Con `source === 'bundled'` el paso 1 («Motor incluido») muestra «Incluido: OpenCode <versión>» sin pedir instalar nada, permite
«Continuar» aunque el servidor aún arranque y ofrece «Usar mi CLI…» (`app:pickOpencodeBin`). Con CLI propio o sin binario (desarrollo)
todo sigue como antes. `decideOnboarding` no cambia de criterio (solo `onboarded !== true` y falta binario o ningún proveedor); con el
embebido `missing` no ocurre empaquetado, así que en la práctica abre en el paso 2. Lógica pura nueva en `steps.ts`
(`opencodeStepMode`, `stepTitle`, `canAdvance` con `source`) y casos en `steps.test.ts`. E2E (e) con `ONYXCODE_TEST_BUNDLED_DIR`; el OpenCode
falso lee `connected.json` junto a él para arrancar sin proveedores (el sidecar no hereda variables ajenas).

## F8-B7 — Test de contrato con la API de OpenCode (`npm run check:opencode`)

`scripts/check-opencode.mjs` arranca un binario (por defecto el fijado; `--bin <ruta>`; `--latest` descarga la última release oficial a un
temporal verificando el `digest` de GitHub) con `HOME`/`XDG_*` temporales en un puerto libre, lee `/doc` y lo mata siempre. Comprueba que
existen todas las rutas que la app usa, compara el conjunto de rutas y la forma (hash de request/response con `$ref` resueltos) de las usadas
con `resources/opencode-bin/api-routes.json` (188 rutas a 1.18.33). Salida 0 (rutas nuevas informativas), 1 falta una ruta usada, 2 cambió un
esquema usado, 3 error de infraestructura; `--update-snapshot` reescribe la instantánea (solo a mano al subir el pin). La lógica pura está en
`scripts/opencode-contract-lib.mjs` (+ `.d.mts`).

## F8-B8 — Rutas usadas derivadas del código y test unitario

`usedRoutes()` recorre `src/**/*.ts(x)` (sin `*.test.*`) y resuelve `<cliente>.<ns>(.<ns>)*.<método>(` contra el árbol de namespaces de
`sdk.gen.js` (cubre `client`, `run.client`, `getClient()`, cadenas multilínea y `?.`; ignora `api.pty` del preload) y los `fetch`/peticiones
directas al sidecar (`/global/health`, `/global/dispose`, `/session/status`, `/session/{id}`, `/permission`…). Hoy: 42 rutas. `src/test/opencode-contract.test.ts`
(sin binario ni red): rutas usadas existen en el SDK, la instantánea coincide con el SDK (188) y contiene las usadas, y el comparador da 1/0/2.

## F8-B9 — `docs/ACTUALIZAR-OPENCODE.md`

Política de versión fijada (subida mensual, no por release; `info.version` fijo `1.0.0`) y procedimiento: `--latest` → revisar diff → `pin.json`
→ SDK → `--update-snapshot` → `npm run verify` → probar el `.dmg`.

## F8-B11 — Aviso de motor no probado y fila «Motor» en Acerca de

`lib/engine-notice.ts` (puro, con tests): `engineNoticeText` devuelve «Estás usando OpenCode X; OnyxCode se probó con Y. Si algo falla, usa el
motor incluido.» solo si el motor no es el incluido, la versión se conoce y `compatible === false` (otra mayor.menor que el SDK); un aviso
cerrado no vuelve para esa versión (`localStorage`, con try/catch). `app/EngineNotice.tsx` lo muestra bajo el banner del servidor (no bloquea) y
Ajustes › Acerca de añade «Motor: OpenCode <versión> (incluido | tu CLI | ruta elegida)».

## F8-B12 — `THIRD_PARTY_NOTICES.md`

Avisos de OpenCode (MIT, 1.18.33), Bun/JavaScriptCore (LGPL-2: aviso y enlaces a las fuentes, binario oficial sin modificar; no se afirma
cumplimiento) y Electron/Chromium, más el marcador «LICENCIA PROPIA DE ONYXCODE: PENDIENTE». `electron-builder.js` (`extraResources`) lo copia a
`Contents/Resources/THIRD_PARTY_NOTICES.md` y copia también `LICENSE` y `LICENSES.chromium.html` de Electron a `Contents/Resources/licenses/electron/`
(electron-builder no los deja dentro del `.app`; comprobado con un empaquetado `--dir` en un directorio temporal).

## F8-B13 — README y DISTRIBUCION

README: OpenCode ya viene incluido, el CLI es opcional (`opencode auth login` ya no hace falta), sección «Motor» y corrección de la frase sobre
credenciales (las Tareas leen el `auth.json` de OpenCode y solo pasan un valor centinela al sandbox, con la clave real en un proxy local).
`docs/DISTRIBUCION.md` §9 «Motor embebido»: origen, pin y SHA-256, descarga, firma, avisos, política de actualización, tamaño (~170 MB) y comprobación.

## F8-B14 — `share: "disabled"` en la config inline de OpenCode

`buildInlineConfig` (sidecar principal, `opencode/config.ts`) y el de Tareas (`tasks/inline-config.ts`) fijan `share: 'disabled'` junto a
`autoupdate: false`: `/share` es lo único que sube conversaciones a opencode.ai. El orden de fusión de OpenCode (leído en el binario incluido) es
global < `OPENCODE_CONFIG` < proyecto < `.opencode/` < `OPENCODE_CONFIG_CONTENT` (inline) < config de organización < política gestionada, así que un
`share` del usuario o del proyecto no lo pisa (`autoshare:true` solo actúa si no hay `share`). Los snapshots cambian solo por la línea `share`.

## F8-B15 — Aviso de Rutinas y los términos de OpenCode

Ajuste `routinesTermsAcknowledged` (falso por defecto; tipo, normalización, esquema de `settings:set`). Lógica pura en `shared/routines-terms.ts`
(`shouldRunUnattended`, `needsRoutinesNotice`, `needsRoutinesConsent`, textos). Crear/activar/guardar activada una rutina sin reconocimiento abre un
`ConfirmDialog` (nuevo `focusCancel`: foco y Enter en «Cancelar»); la vista de Rutinas muestra un aviso no bloqueante con «Ver aviso y activar». El
planificador no ejecuta rutinas por horario sin el reconocimiento (log único); «Ejecutar ahora» sigue funcionando. Las rutinas existentes no se
tocan. Tests: lógica pura, planificador con reloj falso y E2E `routines-terms`. Verificado por grep que no existe rotación de cuentas ni exportación
de datos para entrenar modelos.

## F8-B16 — Tareas con sandbox: fallar cerrado con las credenciales de proveedor

`placeholderAuthContent` (`main/tasks/provider-egress.ts`) reescribía solo `opencode-go` y pasaba TAL CUAL (clave real, `access`/`refresh` OAuth) cualquier
otra entrada al `OPENCODE_AUTH_CONTENT` del servidor sandboxeado. Ahora es una lista blanca: solo los proveedores de `PROVIDER_TARGETS` con `key` de texto
no vacío salen, con una entrada nueva `{type:'api', key:<centinela aleatorio>}`; todo lo demás se omite y sin ninguno el contenido es `{}` (comprobado con
el binario real, HOME/XDG temporales: arranca y solo conecta el proveedor gratuito). Cambio visible: en Tareas con sandbox solo está disponible OpenCode
Go; (más los modelos gratuitos `opencode`, sin clave); con un modelo cuyo proveedor el servidor sandboxeado no tiene, nota junto al selector y error legible al enviar, según la lista del propio servidor (`shared/sandbox-providers.ts`, borrador conservado); Control total, Chat y Code no
cambian. README, SEGURIDAD y el comentario de cabecera describen ahora exactamente esto (sin aislamiento de credenciales fuera del sandbox). Tests:
`provider-egress.test.ts` (solo Go con centinela, OAuth/otros omitidos, prueba de propiedad con claves aleatorias, centinela distinto por llamada,
entradas malformadas, comprobación estática de `sandbox.ts`), `sandbox-providers.test.ts`.

## F8-B17 — Conexión propia: auth y datos de la app aislados del CLI

OnyxCode ya no comparte `~/.local/share/opencode` con el CLI. El sidecar principal y el servidor de Control total reciben `XDG_DATA_HOME=userData/opencode-data`
(`getOpencodeEnv`, `opencode/data-dir.ts`); el motor escribe ahí `opencode/auth.json` (0600) y su base de sesiones. Las Tareas con sandbox mantienen sus XDG privados
(`sandboxEnv` va después en el spread y pisa el valor). No se usa `OPENCODE_AUTH_CONTENT` en el sidecar principal: en 1.18.33 sustituye al `auth.json` y `PUT /auth` y el
callback OAuth escriben en disco (`Path.data/auth.json`). `readProviderAuth` (sandbox) lee ahora `appAuthFile(userData)` y no el fichero del CLI; sigue fallando cerrado (sin fichero,
sin `OPENCODE_AUTH_CONTENT` ni proxy). Al arrancar, tras las migraciones, se crea el almacén; si es nuevo en una instalación que ya tenía chat-workspace y asistente hecho, se pone
`onboarded:false` (vía `settingsStore.set`) para reabrir el asistente una sola vez. No se migran sesiones ni credenciales del CLI (las sesiones anteriores dejan de verse; decisión del
usuario). Textos de Ajustes › Modelos actualizados. El OpenCode falso de E2E imita al real (`OPENCODE_AUTH_CONTENT`, `auth.json` en `XDG_DATA_HOME`, `GET /__e2e/env` sin valores) y la
spec `own-auth.e2e.ts` cubre: el CLI no cuenta como conectado, el almacén propio sí, reapertura única y Tareas con sandbox. Riesgo residual documentado: `provider.*.options.apiKey` en
`~/.config/opencode/opencode.json` (config compartida) seguiría apareciendo conectado. README, SEGURIDAD y AUDIT ajustados.

## F8-B18 — Aviso de versión nueva (sin autoinstalación)

Aviso no bloqueante en la app instalada: «Hay una versión nueva de OnyxCode (X.Y.Z).» con «Descargar» (abre la página de la release) y «Más tarde». Consulta
`GET https://api.github.com/repos/{owner}/{repo}/releases/latest` sin autenticar, como mucho una vez cada 24 h, y compara con `app.getVersion()`. `RELEASES_REPO` (`shared/brand.ts`) está
vacío: sin red y aviso apagado hasta que exista el repositorio; `verify:release` exige definirlo. Lógica pura en `shared/update-check.ts` (semver con prerelease, validación de repo y de la
URL de la release, plazos y `Retry-After`); servicio `main/update/` (`config.ts` con las variables de test solo sin empaquetar, `checker.ts` con estado atómico en `userData/update-check.json`);
canales `app:updateState` (invoke + evento), `app:checkUpdates`, `app:dismissUpdate`; ajuste `checkUpdates` (activado por defecto) y sección «Actualizaciones» en Ajustes › Acerca de
(interruptor, «Buscar ahora», última comprobación). E2E con un servidor local de releases (`e2e/lib/releases-server.ts`, `update-check.e2e.ts`; en E2E `app.getVersion()` es la de Electron,
por eso las «versiones nuevas» de las pruebas son 99.x). README (Privacidad), SEGURIDAD (3 quinquies) y DISTRIBUCION (§10, migración a `electron-updater`). Riesgos documentados: `redirect: 'error'`
(un repositorio renombrado nunca avisa), `/releases/latest` no devuelve prereleases, el `fetch` de Node no usa el proxy del sistema, sin `retryAfter` persistido un fallo se reintenta en el
siguiente arranque pasada 1 h, y el aviso solo vive en memoria (tras reiniciar dentro de las 24 h no vuelve a mostrarse hasta la siguiente comprobación).

## F8-B19 — Cuentas, Fase 1: cliente + servidor de autenticación falso (APAGADO)

Cuenta obligatoria con servidor propio, **apagada por defecto**: `ACCOUNT_API = null` (`shared/brand.ts`) y la app no exige login, no habla con ningún servidor de cuentas y no muestra la
sección «Cuenta». Entradas: Google por loopback (RFC 8252) con PKCE S256 (no por `onyxcode://`) y correo con **código de 6 dígitos** (sin contraseñas; la pantalla dice «Crear una cuenta»).
Lógica pura en `shared/account.ts` (`decideAccess`: sesión válida abre; servidor caído → entra mientras la última validación correcta tenga < 30 días; 401 bloquea al instante; 404/410 = cuenta
borrada; reductor de estado; validación de correo/código). Main: `main/account/` (`pkce`, `store` con `safeStorage` → `userData/account.bin` y solo memoria si no hay cifrado, `loopback` de un solo GET
con `state`, `client` con `net.fetch` sin cookies/redirecciones/`Origin`, `service` con validación al arrancar y cada 24 h, `config`, `access`). Canales `account:*` + evento `account:changed` (solo ventana
principal). Renderer: `<AccountGate><App/></AccountGate>` (la app y el asistente «Conecta tu IA» no se montan hasta pasar), pantalla de acceso con casilla de términos **desmarcada**, enlaces a
política/términos (constantes vacías → borrador local) y Ajustes › Cuenta (cerrar sesión, descargar mis datos, borrar mi cuenta sin tocar las claves de IA). Quick Entry, atajo global y bandeja solo actúan con
la cuenta al día. Servidor falso `e2e/fake-auth/` (PKCE verificado, códigos de un solo uso, modos `down|401|410`) y `e2e/specs/account.e2e.ts`; `launch.ts` admite `account: { fake, signedIn }` y por
defecto los E2E existentes no usan cuenta. Docs: SEGURIDAD §3 sexies («pendiente de activación»), `PRIVACIDAD-BORRADOR.md`, `TERMINOS-BORRADOR.md` (borradores sin revisión legal),
`CUENTAS-SERVIDOR.md` (contrato para la Fase 2) y `CUENTAS-ACTIVACION.md` (textos a cambiar al activar). No probado: Google real, servidor real, Llavero real.

## F8-B20 — Puntos de restauración en Tareas

Instantánea propia de la app (no git: el revert de OpenCode solo toma instantáneas en repos git y en carpetas sin git ocultaba mensajes sin restaurar archivos, aunque el diálogo de «Editar y
reintentar» prometía lo contrario). `main/tasks/restore-points.ts` (puro, `trash`/`now`/`root` inyectables): almacén `userData/restore-points/<hash16>/` direccionado por hash con clon COW, incremental,
límites (20 000 archivos, 50 MB por archivo, 2 GB; `.git`, `node_modules`, `.onyxcode` excluidos; symlinks registrados, nunca seguidos), retención de 20 puntos por tarea y 30 días con recolección de huérfanos,
restauración atómica con punto «Antes de deshacer», Papelera para lo creado después y validación de rutas contra symlinks. Contrato y esquemas `tasks:restore:{create,list,changes,apply,forget}` (solo ventana
principal; `apply` devuelve el nuevo código `BUSY` si el monitor ve trabajo en la carpeta; `IpcErrorCode` gana `'BUSY'`). `ONYXCODE_E2E_TRASH_DIR` (Papelera de pruebas) solo sin empaquetar, con guardia
estática. Renderer: `sendToTask` guarda el punto antes de `promptAsync` («Guardando punto de restauración…»; si falla o se omite se envía igual y avisa), `DiffView` pasa a `components/`, sección «Cambios en
archivos» (`ChangesPanel.tsx`: Nuevo/Modificado/Eliminado, +N −M, diff, «Deshacer los cambios de esta tarea»), «Deshacer desde aquí» y «Rehacer», «Editar y reintentar» restaura el punto del turno, y la tarjeta de
permisos muestra el diff y ofrece «Rechazar con indicaciones» (`replyPermission(id,'reject',mensaje)`). Se crean puntos también en Control total (decisión del usuario: ahí el agente podría manipular el
almacén; la interfaz lo avisa). Servidor falso: paso de guion `fs` (escribe/borra archivos reales confinados al directorio de la sesión). E2E `restore.e2e.ts` con capturas (`RESTORE_SHOTS_DIR`). SEGURIDAD §3 octies.
Limitaciones: no cubre carpetas vinculadas con escritura; el panel lateral no aparece por debajo de 1024 px (ya ocurría con el panel de progreso; «Deshacer desde aquí» sigue disponible).

## F8-B21 — Robustez de los puntos de restauración (pérdida de datos)

Corrige un fallo real de F8-B20: si `copyFileSync` fallaba al crear el punto (permisos, E/S, iCloud) el catch **omitía** la entrada del manifiesto; `diffState` veía ese archivo como `added` y «Deshacer»
lo mandaba a la Papelera aunque existía antes (H1). Igual con un subdirectorio ilegible (H2). Ahora: H1 el archivo se registra con `hash:null` y `skip:'unreadable'|'cloud'|'nospace'`; H2
`manifest.unreadableDirs` (ni diff ni apply tratan como nuevo lo de debajo); H3 copia (`fs.promises.copyFile` con `COPYFILE_FICLONE`) y hash por flujo asíncronos, también en el diff (40 MB: retraso del bucle
< 200 ms, con test); H4 `createdAt` en el manifiesto y hash recalculado si `mtimeMs >= createdAt - 2000` (FAT/exFAT/HFS+); H5 presupuesto `maxCreateMs` 30 s: pasado, punto `skipped` («tardaba
demasiado») y temporales limpiados (y el renderer limita la espera a 35 s); H6 espacio libre con `statfsSync` inyectable (`freeBytes`): bytes a copiar + 512 MB, o ENOSPC → `skipped` «no queda espacio en el
disco»; H7 iCloud «solo en la nube» (`size>0 && blocks===0`, predicado inyectable): no se lee, `hash:null`, `meta.notCopied`, stubs `.<nombre>.icloud` en `cloudStubs` y un `added` que sea un stub no va a la
Papelera; H8 `.DS_Store` y `._*` ignorados en recorrido y diff; H9 `applyDiffs` manda primero todo lo nuevo a la Papelera y luego restaura (volúmenes sin distinción de mayúsculas); H10 `chmod` de mejor esfuerzo;
H11 `forget()`/`clearAll()` (ahora asíncronos) esperan los locks en curso; H12 mensaje «La carpeta no está disponible (¿disco desconectado?)». Contrato: `TasksRestorePoint.notCopied?`,
`TasksRestoreChange.reason?: 'large'|'cloud'|'unreadable'`; el panel «Cambios en archivos» explica «No restaurable (solo en la nube)…» y la conversación avisa si un punto no incluye archivos. Sin IPC nuevo.
Tests: `restore-points.test.ts` (H1, H2, H4-H9, H11, H12 y retraso del bucle), `restore-points.fs.test.ts` (`npm run test:fs`, ExFAT/FAT32/HFS+ mayúsculas), `restore-points.stress.test.ts`
(`npm run test:stress`), E2E `restore.e2e.ts` ampliado con archivos dispersos; `shot()` pasa a `e2e/lib/shots.ts`. Limitaciones: el aviso de espacio es conservador (cuenta el tamaño completo aunque APFS clone);
un archivo que desaparece a mitad de la copia se omite (como antes); iCloud real no probado (solo imitado con archivos dispersos).
