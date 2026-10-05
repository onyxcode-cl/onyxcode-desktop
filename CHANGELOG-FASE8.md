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

## F8-B22 — «Probar clave» de un proveedor

Ajustes › Modelos gana el botón «Probar» por proveedor conectado, y guardar una clave la prueba sola (formulario de Modelos y asistente de primer uso). Todo ocurre en main
(`main/providers/key-probe.ts`): lee la clave ya guardada en `auth.json` (`appAuthFile`) y hace un GET **gratuito** (listado de modelos o información de la clave) con `net.fetch` inyectable,
`redirect: 'manual'`, 10 s de tope, y del cuerpo solo se usa el código HTTP. La clave **no cruza el IPC ni vuelve al renderer**; no se tocó el proxy de credenciales. Canal `app:testProviderKey`
(`{providerID}` → `KeyTestResult {providerID,status,httpStatus,latencyMs,checkedAt}`; solo ventana principal; `BUSY` si hay otra prueba del mismo proveedor en curso o hace < 5 s). Estados:
`ok, invalid, forbidden, rate-limited, no-credit, offline, unreachable, provider-down, timeout, unexpected, not-stored, oauth, unsupported`, con textos en `shared/key-test.ts` (`keyTestText`).
Tabla `PROBES` (anthropic, openai, google, openrouter, groq, mistral, deepseek, xai) **verificada con curl y una clave inválida** (401, o 400 en Google y xAI, que lo declaran en `invalidStatuses`);
`/api/v1/models` de OpenRouter es público y por eso se usa `/api/v1/key`. `opencode` y `opencode-go` **no** están: su `/models` responde 200 sin clave (daría un falso «funciona») → `unsupported`.
Alternativa genérica: proveedores `@ai-sdk/openai-compatible` con `api` https (`models.*.api` de `GET /provider` del motor, consultado desde main) → `GET {api}/models` con Bearer.
La clave de Google va **solo** en la cabecera `x-goog-api-key`. Errores de red de las dos familias (Node y `net::ERR_*`): `net.isOnline()` falso → `offline`, si no `unreachable`; los errores se construyen a
mano (nunca se reenvía un `Error` ajeno). `ONYXCODE_E2E_KEY_PROBE_BASE` (solo `!app.isPackaged` y solo `http://127.0.0.1:<puerto>`, con guardia estática en `key-probe.test.ts`) permite apuntar a un servidor local.
Renderer: `useKeyTest.ts` (store con el estado de cada prueba), `KeyTestNotice.tsx` y `ModelsSection` («Probar», «Cambiar clave» tras una clave inválida o sin permiso). Tests: `key-probe.test.ts` (matriz de
estados y errores, `redirect:'manual'`, `not-stored`/`oauth`/`unsupported` sin petición, propiedad con claves aleatorias: ni el resultado ni `console.*` la contienen; Google nunca en la URL),
`key-test.test.ts`, `KeyTestNotice.test.tsx`, `schemas.test.ts`; E2E `key-test.e2e.ts` con `e2e/lib/probe-server.ts` (capturas `DIAG_SHOTS_DIR`). No probado: claves reales de ningún proveedor.

## F8-B23 — Ajustes › Diagnóstico (registros del motor redactados)

Sección nueva «Diagnóstico» (antes de «Acerca de»): tarjeta «Estado» (estado, reinicios, versión, último error, «Reiniciar OpenCode») y tarjeta «Registros» (fuente, filtro, «Actualizar», «Cada 2 s»,
«Copiar», «Exportar…»). Main: `diagnostics/log-ring.ts` (`LineRing`, 2000 líneas / 512 KB con última línea parcial; `OpencodeServer.log()` lo usa y el arranque sigue mostrando `tail(5)`; único cambio en
`opencode/server.ts` además del getter `secrets()` y `recentLog()`), `diagnostics/redact.ts` (`makeRedactor`: primero secretos **exactos** —contraseña y credencial Basic del sidecar, todos los valores
de `auth.json`, `headers`/`environment` de los MCP— del más largo al más corto; luego patrones lineales de `shared/redact-patterns.ts`: Bearer/Basic, `sk-`, `sk-ant-`, `AIza`, `gh*_`, `github_pat_`, `xox*`,
`glpat-`, `AKIA`, JWT, `clave=valor`, `?key=`, `usuario:clave@`, rachas largas con cifras; la carpeta del usuario pasa a `~`; líneas a 4000 caracteres; se redacta **antes** de recortar) y
`diagnostics/service.ts` (fuentes `engine`, `engine-file` —últimos 256 KB del `.log` más reciente por desplazamiento— y `report`). `redactSecrets` de `shared/ai-errors.ts` usa los mismos patrones. No hay
registros del sandbox de Tareas. Canales `diag:logs`, `diag:copy` (portapapeles desde main) y `diag:export` (diálogo «Guardar como», archivo `OnyxCode-diagnostico-AAAAMMDD-HHmm.txt` con 0600), solo ventana
principal. Tests: `redact.test.ts` (patrones, exactos, propiedad con secretos incrustados, líneas adversarias de 1 MB < 200 ms), `log-ring.test.ts`, `service.test.ts` (incluye la guardia estática: los
handlers `diag:*` solo devuelven lo que sale de `DiagnosticsService` y solo `service.ts` lee el anillo crudo), `schemas.test.ts`; E2E `diagnostics.e2e.ts` (ruta nueva `POST /__e2e/log` del servidor falso;
pantalla, IPC, portapapeles y exportación sin secretos, 0600). Limitación: un secreto sin forma conocida y que no esté guardado en `auth.json`/MCP puede pasar (la nota de la pantalla pide revisar antes de compartir).

## F8-B24 — Catálogo MCP curado

Ajustes › MCP gana un bloque «Catálogo» con conectores verificados, incluidos en la app (nada se descarga): Context7 y Cloudflare Docs (sin cuenta), GitHub (token personal) y Linear, Notion, Sentry y Atlassian
(inicio de sesión OAuth). v1 solo ofrece servidores **remotos** (URL https): añadir uno no ejecuta ningún programa en el Mac, y nada se escribe ni se conecta sin confirmar en un diálogo que enseña qué podrá hacer, el host
(en negrita) y la URL completa, qué datos salen, el JSON exacto que se guardará (secreto como «••••»), «Verificado el …» con enlace a la documentación oficial, «Preguntar antes de cada uso» (activado) y «Disponible en
Tareas» (desactivado, sin efecto en esta versión); «Cancelar» tiene el foco inicial. Contrato: `src/shared/mcp-catalog.ts` (`McpCatalogItem`, `MCP_CATALOG_VERSION`); IPC `mcp:catalog` y `mcp:installCatalog` (solo ventana
principal; el renderer manda id, nombre y valores, y **main construye la entrada desde su copia**: valida patrones anclados, rechaza CR/LF y tamaño, token/sin credencial → `oauth:false`). Procedencia en
`userData/mcp-catalog-installs.json` (0600; no se añaden claves a `opencode.json`) con detección de desvío («Modificado» si cambian la URL, las cabeceras o el tipo; mover/renombrar la arrastra). «Preguntar antes de cada
uso» escribe `permission["<nombre>_*"] = "ask"` (formato **verificado con el binario real**: la config lo acepta y `opencode debug agent` lo lista como regla `ask`); renombrar mueve la regla y eliminar limpia entrada, regla
`ask` y procedencia (una regla propia distinta se respeta). `opencode.json` pasa a escribirse con permisos 0600 (puede contener un token). Nombre repetido → error y la interfaz propone `-2`.
`npm run check:mcp-catalog` (manual, con red, fuera de `verify`) comprueba que cada URL responde como MCP (200/401/405) y que su documentación responde 200.
Tests: `shared/mcp-catalog.test.ts` (ids/nombres únicos y NAME_RE, solo https/remote, host del proveedor, patrones anclados con una `{value}`, sin secretos, `verifiedAt`, sin términos prohibidos),
`main/extras/mcp-catalog-install.test.ts` (CRLF, id desconocido, colisión, 0600, desvío, limpieza, rollback), `schemas.test.ts`, `McpCatalogDialog.test.tsx` y E2E `mcp-catalog.e2e.ts` (con capturas `MCP_SHOTS_DIR`).
Descartado/ajustado respecto al plan: Atlassian usa `https://mcp.atlassian.com/v2/mcp` (su documentación ya publica v2 y anuncia que v1 pasará a v2 el 1-mar-2027). Los cuatro servicios OAuth (Linear, Notion, Sentry, Atlassian)
registran cliente dinámicamente con el binario real (devuelven URL de autorización; el inicio de sesión completo con cuenta real no se probó). Limitaciones: en Tareas no están disponibles (sandbox sin OAuth y sin
host añadido); el token queda en texto plano en el archivo de la app como en el flujo manual; las fichas no se actualizan solas (cambian con la app; `MCP_CATALOG_VERSION`).

## F8-B25 — Idioma: inglés (beta) con selector

Ajustes › General › Idioma (Sistema / Español / English (beta)). Con «Sistema», un sistema con idioma preferido `en-*` da inglés y cualquier otro español; una instalación que ya existía (con el asistente terminado) y no
tiene `language` se queda en español, las nuevas siguen al sistema. El cambio es en vivo (sin reiniciar): `<html lang>`, fechas con el idioma activo, bandeja y menú de la app reconstruidos. Infraestructura sin dependencias
en `src/shared/i18n` (`Lang`, `LangPref`, `resolveLang`, `migrateLanguage`, `format` con `{nombre}`, plurales `{one,other}` con `Intl.PluralRules`; `es/*.ts` es la base `as const` y `en/*.ts` usa
`satisfies Messages<typeof es.x>`: el compilador exige las mismas claves). Renderer: `lib/i18n.ts` (`useLang`, `useT()`, `useLocale()`, caché en localStorage para no parpadear) y `LangRoot`, que vuelve a pintar el árbol al cambiar
sin remontarlo. Main: `src/main/i18n.ts`. `labels.ts` pasa a getters (`MODE_LABELS`, `UI_LABELS`) que leen el idioma activo; con `es` el producto queda igual (snapshots y tests sin cambios).
Alcance migrado: barra lateral, modos, paleta, avisos (`ServerBanner`, `UpdateNotice`, `EngineNotice`, `NoAiBanner`), Ajustes completo (General, Modelos y «Probar clave», MCP y catálogo, Tareas, Red, Control del Mac, Modo auto,
Navegador, Uso, Atajos, Diagnóstico, Acerca de, Cuenta), asistente, pantalla de acceso, Chat, componentes comunes y `ConfirmDialog`, `shared/ai-errors.ts`, `lib/update-notice.ts`, `lib/engine-notice.ts`, bandeja y menú.
Guardias: `visible-terms` ya escanea `src/shared` (en inglés prohíbe Artifact, computer use, Teach mode, Dispatch y Claude; usar Preview, Mac control, Guide mode) con la excepción de Acerca de ampliada a «not affiliated with
OpenCode or Anthropic»; `i18n.test.ts` (mismas claves, sin vacíos, mismos marcadores, sin claves repetidas entre áreas, `resolveLang`, migración, plurales); `i18n-coverage.test.ts` (lista MIGRATED sin JSX ni literales en español
fuera de los diccionarios; crece por tanda); `tray.i18n.test.ts`; esquema `settings:set`; E2E `i18n.e2e.ts` (arranque en inglés, cambio en vivo a Español y de vuelta, asistente, capturas con `I18N_SHOTS_DIR`).
Fuera de alcance (T4b/T4c): Code, Tareas, Rutinas, navegador integrado, overlay/píldora/Quick Entry y los errores que construye main (siguen en español, incluso con la interfaz en inglés); los prompts de agente
(`resources/opencode/*.md`); los borradores legales (`PRIVACY_DRAFT`/`TERMS_DRAFT`, pendientes de revisión legal); los roles estándar del menú de macOS (los traduce Electron según la configuración regional).

## F8-B27 — Idioma (T4c): lo que construye main y las ventanas con preload propio

Con la interfaz en inglés, los textos que nacen en main y llegan al usuario salen en inglés; con `es` todo queda idéntico (snapshots y tests existentes sin cambios). Main usa el idioma de `src/main/i18n.ts` (`Settings.language`, o los
idiomas del sistema con «Sistema») y `t()` de `@shared/i18n`; los textos viven en un área nueva `merr.*`/`ovl.*` (`src/shared/i18n/{es,en}/mainErrors.ts`).
Alcance migrado: «No se encontró el binario `opencode`…» del asistente (y el estado del motor: «se cerró inesperadamente», «falló N veces», reintento), validación del binario elegido, errores de la pantalla de acceso (`account/service.ts`) y
las dos páginas del navegador del inicio de sesión con Google (también `<html lang>`), motivos de carpetas de confianza (`check.reason`: raíz/home, Papelera, iCloud, Library, sistema, volúmenes de red, credenciales, política de la organización),
errores de Tareas por política de la organización (red del sandbox, Control total, «Siempre permitir»), reglas recordadas, apertura segura, AGENTS.md, errores y avisos de Rutinas (validación, tiempos, plan de Control total, rechazos sin
supervisión, `scheduleLabel`), notificaciones nativas (rutinas, tareas en segundo plano, solicitud de acceso a apps, aprobaciones del navegador), cuadros de diálogo nativos (aprobación del navegador, Elegir carpeta, Adjuntar, Descargar mis
datos, Exportar diagnóstico, Guardar zip/Markdown, Elegir binario), motivos de Control del Mac no disponible, error del atajo de Quick Entry, errores de conectores MCP y menú contextual de la vista previa.
`NetworkSection.networkErrorMessage` ya no filtra con una regex en español: clasifica por causa (la política gestionada `disableCustomHosts` que el renderer ya conoce) y, si no, muestra el texto de main, que ya está en el idioma activo.
Ventanas con preload propio (Quick Entry, overlay, píldora, globo de guía y píldora de grabación): **los preloads no se tocan** (hashes de `out/preload/{quick,overlay,pill,assist,browser-host}.js` idénticos a antes). Main carga cada página
con `?lang=es|en` (`extras/windows.ts › loadLocalizedPage`) y la página lo lee de su propia URL (`renderer/src/lib/page-lang.ts`). Si el idioma cambia, la ventana oculta se recrea la próxima vez que se usa; una ventana visible
se queda en el idioma con que nació hasta que se oculta.
Residuos conscientes (siguen en español): prompts de agente y borradores legales; descripciones de herramientas y resultados del MCP de Control del Mac y del navegador (los lee el modelo); motivos del modo auto (`auto-mode.ts`,
registro de decisiones); texto de los puntos de restauración (omitidos y errores internos), zip/PDF/vista rápida y errores de grabación de skills; límites de pestañas del navegador integrado; informe de diagnóstico exportado; errores de
instalación de la actualización (códigos técnicos); validación de parámetros IPC (`ipc/validate.ts`, `git/service.ts`); `console.*`; y los datos de demostración de la píldora (`#demo-*`, solo desarrollo). Los avisos ya guardados en
`routines.json` (historial) quedan en el idioma que había al producirse.
Guardias: `i18n-coverage.test.ts` ahora incluye los archivos de main y de las ventanas migradas (el detector ignora los argumentos de `console.*`); `main-errors.i18n.test.ts` (es idéntico, en inglés, plural, `withLang`, código
`FULL_ACCESS_NOT_GRANTED` estable); `NetworkSection.test.ts`; E2E `i18n-main.e2e.ts` (error del asistente y del código de acceso en inglés, `check.reason` en los dos idiomas y cambio en vivo, píldora/toma de control/plan, globo y
grabación, Quick Entry recreado en español; capturas con `I18N_T4C_SHOTS_DIR`).

## F8-B26 — Inglés (beta), segunda tanda: Code, Tareas, Rutinas y navegador integrado

Con la interfaz en inglés (Ajustes › General › Idioma) ahora también están en inglés: Code (sesiones, selector de proyecto, compositor, mensajes, herramientas, permisos, panel de cambios, archivos y terminal), Tareas
(inicio, lista, conversación, compositor, consulta lateral, panel de progreso y de proyecto, entregables, cambios, permisos, preguntas, carpetas, red, modo auto, grabación de skills, guía de inicio y la lista de Control del Mac,
incluida `ComputerGrantsList` en Ajustes › Tareas), Rutinas (vista, editor, plantillas, horarios y fechas relativas) y el navegador integrado. Texto visible, `aria-label`/`title`/`placeholder`, plurales (`{one,other}`) y fechas/números
con el idioma activo (`dateLocale()` de `lib/i18n.ts`: `es-CL` con español, así el producto no cambia, y `en-US` con inglés).

- Diccionarios nuevos por área (`es|en/{code,tasks,tasksComputer,routines,browser}.ts`) enchufados con una línea cada uno en `index.ts` (para mezclar sin conflictos con T4c). Prefijos `code.`, `tasks.`, `tasksComputer.`, `routines.`, `browser.`.
- `FOLDER_MODE_LABEL_ES` sale de `shared/ipc-tasks.ts` y pasa a `folderModeLabel(mode)` (renderer, `features/tasks/impl/folder-mode.ts`, claves `tasksSettings.folderMode.*`): `shared/ipc-tasks.ts` no importa i18n y los preloads no cambian.
  `SANDBOX_PROVIDER_NOTICE` (shared/sandbox-providers.ts) pasa a la función `sandboxProviderNotice()`; los textos de `routines-terms.ts` viven ahora en el diccionario.
- Las constantes con texto (`TIER_INFO`, `MODES`, `PERMISSION_MODES`, `MODE_META`, `SCHEDULE_PRESETS`, `ROUTINE_TEMPLATES`, `TASK_STATUS_LABEL`…) son getters o funciones que reciben `t`, de modo que se recalculan al cambiar de idioma sin reiniciar.
- `ModelSelect` (Ajustes) recalculaba el orden de modelos con el idioma global dentro de un `useMemo`: ahora usa `useLocale()` y lo incluye en las dependencias (`ModelSelect.i18n.test.ts` lo vigila).
- Con `es` el producto queda igual (snapshots sin cambios) salvo un detalle: «1 archivo con cambios» en singular (antes «1 archivos…»). Con `en`, los comandos del compositor de Code `/revertir` y `/nueva` se escriben `/undo` y `/new`.
- Se quedan en español a propósito (contratos con el agente o datos persistidos): prompts enviados al modelo (reintentos tras permitir un sitio, «Ya tienes acceso a…», continuación, crear skill, «Sin respuesta»), el marcador de «necesita control total del mac»,
  los rótulos Usuario/Agente de la exportación a Markdown, la marca de adjuntos, `UNDO_POINT_LABEL` (se guarda en el manifiesto de los puntos de restauración), el prefijo de rama `sesion/` y los textos que construye main
  (`disabledReason` y avisos del navegador, `chk.reason`, vista previa de Rutinas): son de T4c.
- Guardias: los archivos de las cuatro áreas entran en `MIGRATED` (`i18n-coverage.test.ts`); E2E `i18n.e2e.ts` ampliado (Tareas, Rutinas, Code y navegador en inglés sin texto en español, y cambio en vivo a Español) con capturas `I18N_SHOTS_DIR/en/` (`tareas-guia`, `tareas-inicio`, `rutinas`, `rutinas-editor`, `code`, `navegador`; claro/oscuro, 820 y 1280 px).

## F8-B30 — Tareas: inglés y supervisión (T6 del plan de calidad: H7, M9, B3)

- **Escalada a Control total en inglés (H7).** `needsFullAccess` (EscalateCard.tsx) reconoce, sin tildes ni mayúsculas, «necesita control total del mac», «needs full mac control», «needs full control of the mac» y el
  marcador neutro `[[ONYX:NEEDS_FULL_CONTROL]]`; `escalationReason` extrae el motivo de cualquiera de las tres formas. El prompt de continuación (`buildContinuationPrompt`) sale en el idioma de la interfaz.
  El marcador se ve en el texto del último mensaje (la conversación no lo oculta): se pide en su propia línea al final.
- **Idioma de la interfaz en el contexto.** `buildTasksSystemPrompt` acepta `lang`; con `en` añade al final una sección «Interface language: English» que traduce los nombres de botones que los prompts citan en español
  (se leen de los diccionarios, así no se desfasan: «Permitir borrar, mover y renombrar», «Usar memoria», «Guardar como PDF», «Crear skill de esta tarea», «Cambiar a Control total y continuar», «Aprobar y empezar», etc.) y
  pide fechas y números en formato inglés. Con `es` el texto es idéntico al de antes (los snapshots no cambian). Lo usan las tareas interactivas y las rutinas.
- **Aviso «Sin actividad» (M9).** El monitor de main calcula, solo para tareas raíz en curso, una huella del último mensaje de sus sesiones en curso (id, nº de partes y tamaño de la última parte) en el mismo sondeo de 3 s;
  si no cambia durante `stallWarnMinutes` (preferencia nueva, 5 por defecto, 0 = no avisar, máximo 240; Ajustes › Tareas › Servidores) marca `quietSince` en la instantánea de actividad. La conversación muestra
  «Sin actividad desde hace N min» (`StallNotice`, `role="status"`). **Solo avisa**: no detiene ni cancela nada y el aviso desaparece al haber avance o al terminar. Una herramienta larga y legítima (p. ej. una compilación
  de 10 min) también lo dispara: el texto lo dice. El aviso de coste por tarea (opcional del plan) no se hizo: no hay datos de coste por tarea en el renderer.
- **Prompts del agente (B3), sin cambiar su semántica de seguridad ni tocar el plan-gate:**
  - `tasks.md`: una sola regla de archivos auxiliares (`./.onyxcode/trabajo/`, `/tmp` solo si una herramienta lo exige; antes había cuatro menciones y «Reglas» decía «usa /tmp»); una sola regla «Pregunta antes de borrar»
    (la sección Mover/renombrar/borrar remite a ella); línea de marcador neutro tras «**Necesita Control total del Mac**: …» para detectar la petición en cualquier idioma; responde en inglés si el contexto indica interfaz en inglés.
  - `computer.md`: «Cómo trabajas» ya no repite el flujo Plan → Aprobar (remite al flujo; pasa de 7 a 6 puntos) y «Acceso por app» no repite el paso 5; añade la misma nota de idioma. El archivo sigue en ~3800 palabras:
    el flujo real y las secciones de herramientas son contenido necesario, así que no se recortó más para no arriesgar comportamiento.
  - `chat.md`: pide citar las URL cuando use `websearch`/`webfetch`.
  - Los prompts son archivos de `resources/opencode/agents/` que main copia a `userData/opencode-config/` al arrancar (no van en el binario de OpenCode). `agent-prompts.test.ts` comprueba cabecera, marcador, flujo de 10 pasos y
    las reglas deduplicadas. Pendiente con modelo real: que `tasks` escriba de verdad el marcador y respete las reglas de temporales tras la deduplicación.
- Pruebas: `EscalateCard.test.ts` (ES, EN, marcador, motivo, continuación), `tasks-prompt.test.ts`, `monitor.stall.test.ts` (umbral, reinicio por avance, 0 = nunca, sin `stop`), `agent-prompts.test.ts`; E2E
  `tasks-stall.e2e.ts` (guion del falso atascado: aviso al minuto, la tarea sigue en curso, desaparece al terminar). Sin cambios en preloads ni en SEGURIDAD.md (no hay semántica de seguridad nueva).

## F8-B28 — Calidad T1: no perder lo que escribe el usuario

- **Code, adjunto sin texto (H1):** pegar o adjuntar una imagen y enviar sin escribir ya produce un mensaje de usuario (solo partes `file`, sin bloque de texto vacío; el motor no lo exige). Afecta a `send`, `enqueue`, `sendNow` y `doSend`. El mensaje de usuario muestra la imagen en miniatura en vez de un recuadro vacío.
- **Borrador (H3):** Chat y Code siguen vaciando el compositor al enviar (respuesta inmediata), pero lo restauran (texto, menciones y adjuntos, solo si no se escribió algo nuevo mientras tanto) si el motor no acepta el envío. `send`/`sendNow` de Code devuelven `boolean`;
  `sendChatMessage` devuelve `true`/`false` y `ChatComposer.onSend` acepta `false`/rechazo como «no se envió». En Chat el compositor se remonta al crearse la conversación, así que el texto vuelve por `insert`. Tareas ya lo hacía.
- **Chat ocupado para siempre (H4):** `sendChatMessage` devuelve la sesión a `idle` si `promptAsync` lanza (red caída) además de si responde con error.
- **Esc en Chat (M5):** detiene la respuesta en curso, como en Code y Tareas (ignora la composición IME).
- **Restos sin traducir (M11):** «Reintento N:» de Tareas, «Texto» de los bloques de código sin lenguaje, los rótulos de los `ErrorBoundary` de `App.tsx` y «Mostrar barra lateral», «Quitar {nombre}» del adjunto de Code y los mensajes de git «no está instalado», «falló» y «archivos sin seguimiento omitidos».
  `App.tsx` entra en `MIGRATED`. `git/service.ts` NO entra: conserva ~13 mensajes de validación en español (ver «Residuos conscientes» de F8-B27).
- Guardias: `store.calidad-t1.test.ts` (Code), `actions.calidad-t1.test.ts` (Chat), el falso gana `POST /__e2e/set { failPrompt: N|-1|0 }` (corta la conexión de `prompt_async`; Chromium reintenta una vez sobre un socket reutilizado, por eso se usa `-1`)
  con su prueba en `server.test.mjs`, y E2E `calidad-t1.e2e.ts` con una prueba por modo (Chat, Code con imagen sin texto, Tareas) más Esc en Chat; capturas con `CALIDAD_SHOTS_DIR`.

## F8-B29 — Calidad T4: rendimiento percibido y transcripciones

- **Diff enorme (M1).** `DiffView` ya no parsea ni resalta sin tope: por encima de 2000 líneas o 300 KB muestra las primeras líneas con un aviso fijo arriba («Se muestran las primeras N líneas de M» + «Mostrar todo»); `clipPatch` corta
  en límite de línea sin recorrer el texto entero con regex. El resaltado va por trozos de 150 líneas con `setTimeout` (primero se pinta texto plano y se colorea después) y no se aplica sobre el umbral (ni siquiera con «Mostrar todo»).
  Medido con `e2e/specs/calidad-t4.e2e.ts` (diff de 50 000 líneas por una herramienta `edit` en Code, PerformanceObserver `longtask`, igual que `perf.e2e.ts`): sin CPU limitada, antes 3289 ms para abrir (4 tareas largas, máx 1692 ms,
  50 001 filas) y ahora 143 ms (1 tarea de 96 ms, 1998 filas); con CPU x4, antes 13 092 ms (máx 6820 ms) y ahora 562 ms (máx 410 ms).
- **«Ir al final» (M6).** Hook común `useStickToBottom` (`lib/conversation/`) y componente `ScrollToEnd` usados por Chat, Code y Tareas: el botón aparece al subir 80 px o más. «Trabajando…» de Code lleva `role="status"`. Los scrollers de Code
  y Tareas quedan dentro de un contenedor `relative` (cambian los snapshots de `MessageStream` y `TaskConversation`: un `div` más y `h-full`).
- **Listas de sesiones (M12).** La lista ya no se corta en 200: el store de sesiones (Chat y Tareas) y el de Code recuerdan el límite por carpeta, avisan si pudo haber más (`moreSessions`) y «Cargar más» sube de 200 en 200. El filtro de Chat,
  la búsqueda de Tareas y la de ⌘K en Code piden todas las sesiones (hasta 10 000) en cuanto se escribe algo.
- Pruebas: unitarias (`DiffView.test.tsx`, `use-stick-to-bottom.test.ts`, `session-paging.test.ts`, `sessions.paging.test.ts` con 250 sesiones falsas) y E2E `calidad-t4.e2e.ts` (diff, «Ir al final» en Code y Tareas, 250 sesiones en Chat; capturas con `T4_SHOTS_DIR`).

## F8-B31 — Calidad T2: errores con salida

- **`friendlyError` con acción (H2, M10).** `action` pasa a `'connect' | 'retry' | 'compact' | null`: `retry` para fallos que pueden ser pasajeros (cuota/429, red, desconocido), `compact` para `ContextOverflowError`, `connect` como antes. `ErrorNotice` y `AssistantError`
  aceptan `onRetry`/`onCompact` y muestran el botón solo si la vista entrega el manejador (se deshabilita mientras corre). El texto del error de contexto menciona ahora «Compáctala o empieza una conversación nueva».
- **Chat: «Reintentar» sin duplicar.** Antes solo salía si la respuesta tenía texto y reenviaba como mensaje nuevo (duplicaba el turno y perdía adjuntos). Ahora `resendFromMessage` detiene la conversación si hace falta, hace `session.revert` hasta el mensaje de usuario,
  quita de pantalla lo posterior y reenvía sus partes (texto y archivos) con `promptAsync`: queda UN solo mensaje de usuario. Si el motor rechaza o no recibe el envío, deshace el `revert` (`session.unrevert`) y recarga para no dejar la conversación recortada.
  El 429/401/red sin texto ya ofrece «Reintentar» tanto en el aviso de la respuesta como en el de la sesión.
- **«Editar y reintentar» (M2).** Chat (lápiz en cada mensaje con texto, editor en línea con nota de que se descartan los posteriores) y Code (lápiz junto a «Revertir», con confirmación porque también deshace los cambios de archivos desde ese mensaje,
  como «Revertir») reutilizan la misma mecánica; en Code `editAndRetry` y `retryLast` viven en el store, reenvían los adjuntos como partes `file` y quitan la marca de `revert` al aceptarse el prompt. Tareas ya tenía el suyo.
- **«Compactar» (M10).** `compactChat` y `compactTask` llaman a `session.summarize` (con el modelo efectivo) y dejan la sesión ocupada hasta el evento de fin; Code ya tenía `compactSession` y ahora también lo ofrece el aviso de error.
- Guardias: `ai-errors.test.ts` (acciones), `actions.calidad-t2.test.ts` (Chat: revert + reenvío sin duplicar ni perder adjuntos, undo si falla, edición, compactar), `store.calidad-t2.test.ts` (Code), snapshots de `ChatMessageList` (botón «Reintentar» en el aviso)
  y `MessageStream` (lápiz). E2E `calidad-t2.e2e.ts` con el falso (guion `error {statusCode:429}` y `ContextOverflowError`): 429 con un solo mensaje de usuario tras reintentar, edición de un mensaje antiguo en Chat y en Code, «Compactar» en Chat y Tareas (`POST summarize`).
  Capturas con `CALIDAD_SHOTS_DIR`. Sin cambios en preloads ni en SEGURIDAD.md.

## F8-B32 — Calidad T3: continuidad del trabajo

- **Terminal de Code que sobrevive (H5).** Decisión de diseño: en vez de mantener montadas (ocultas con `hidden`/`inert`) todas las vistas visitadas, el pty sube a un **registro** (`panels/terminalRegistry.ts`). Se descartó mantener las vistas
  montadas porque Code y Tareas registran atajos globales (`keydown` en `window`/`document`, `focus`), reportan `tasks:viewing` a main (que suprime notificaciones de una tarea «vista») y Code mueve el visor nativo del navegador integrado: tenerlas
  vivas pero ocultas habría hecho que ⌘1…⌘4 o Esc actuaran sobre una vista invisible, que no llegaran avisos de tareas, y habría duplicado el coste de renderizar cada delta de streaming en vistas que nadie mira. El registro guarda por
  proyecto el `Terminal` de xterm (con su scrollback de 5000 líneas) y el id del pty; `TerminalPanel` solo reengancha el elemento DOM al montarse. El shell se mata al cambiar o cerrar el proyecto (`useCode.subscribe`), con «Reiniciar» o al salir
  de la app (main ya mata los ptys al cerrar la ventana/navegar). Efectos: el foco y el scroll de Chat, Code y Tareas siguen comportándose como antes (no hay vistas ocultas); el scroll de la terminal se conserva porque xterm no se recrea.
- **Borradores (H5).** `stores/drafts.ts` guarda el texto del compositor de Chat (por conversación, `chat:<id>`) y de Code (texto y menciones por proyecto y sesión) fuera de los componentes; sobrevive a cambiar de modo y de sesión, no se persiste
  a disco y solo guarda valores no vacíos. Los compositores cambian una línea (`useState` → `useDraft`). Los adjuntos de Code (imágenes) NO se conservan al cambiar de modo. Antes el texto de Code también pasaba de una sesión a otra al cambiar; ahora cada
  sesión tiene el suyo.
- **Salir con tareas en curso (H6).** `before-quit` pregunta «Hay N tareas en curso» con «Salir igualmente» / «Cancelar» (por defecto Cancelar) si el monitor de Tareas tiene trabajo (`busyRootCount`, mismo sondeo de 3 s). Es `dialog.showMessageBox`,
  sustituible en E2E igual que el de guardar (`stubDialog({ messageBoxResponse })`). **No pregunta** cuando la salida no la pide el usuario: el actualizador (`isUpdating()`, que se activa antes de `quit()` en `startSwap`) y el apagado/cierre de sesión
  del sistema (`powerMonitor 'shutdown'`); la decisión es la función pura `needsQuitConfirmation`. En Windows/Linux, «Cancelar» tras haber cerrado la última ventana la recrea. Solo cuenta tareas de Tareas/Rutinas (monitor); las sesiones de Code
  y Chat en curso no disparan el diálogo.
- **«Interrumpida» + «Continuar» (H6).** Al conectar con un servidor de Tareas (una vez por servidor y por carga de la ventana) se revisan, como máximo, las 12 tareas raíz más recientes (≤ 3 días, no archivadas) que NO están ocupadas ni esperan
  permiso/pregunta: si el último mensaje del asistente no tiene `time.completed` ni error (un aborto del usuario sí lo cierra) se marcan en `useTasks.interrupted`. Estado nuevo `interrupted` (icono, etiqueta «Interrumpida» en lista y cabecera, aviso
  «Esta tarea se interrumpió» con «Continuar» que envía un seguimiento en el idioma de la interfaz). La marca se quita al continuar o en cuanto la sesión vuelve a estar ocupada. Una tarea ocupada nunca se marca (ni se consulta). Límite conocido:
  las tareas más antiguas que 3 días o fuera de las 12 más recientes no se revisan; y una tarea cuyo motor sigue «ocupada» en servidor pero sin avance no es «interrumpida» (eso lo cubre el aviso de inactividad de F8-B30).
- Pruebas: unitarias `drafts.test.ts`, `quit-guard.test.ts` (actualizador y apagado nunca preguntan), `interrupted.test.ts` (detección, ocupadas no se marcan, una vez por servidor, marca se quita al volver a trabajar); E2E `calidad-t3.e2e.ts`: pid de la terminal
  y su `sleep 1000` iguales tras Chat → Ajustes → ⌃Tab → Code (con el scrollback), borradores de Chat y Code, tarea interrumpida tras recargar la ventana con el motor «reiniciado» (el falso gana `set { sessionStatus }`) y Cmd+Q con una tarea ocupada
  (Cancelar mantiene la app, Salir igualmente sale). Capturas con `T3_SHOTS_DIR`. Sin cambios en preloads (no hay canales IPC nuevos) ni en SEGURIDAD.md.

## F8-B33 — Calidad T5: accesibilidad y contraste

- **Región `role="log"` acotada (M7).** Antes ninguna vista anunciaba nada. `ConversationAnnouncer` (en Chat, Code y Tareas) es una región solo para lectores de pantalla (`sr-only`, `role="log"`, `aria-live="polite"`) que dice
  «Respuesta terminada» cuando la conversación deja de estar ocupada y «Error: …» (texto amable de `friendlyError`) cuando aparece uno nuevo. **Nunca** anuncia deltas: la transcripción no es una región viva. Al cambiar de conversación no anuncia nada.
- **Compositor de Code como combobox (M7).** El textarea lleva `role="combobox"`, `aria-haspopup="listbox"`, `aria-expanded`, `aria-controls` y `aria-activedescendant` (opciones con `id`), más `aria-label`. Nota: axe marca `aria-allowed-role` (nivel _minor_)
  porque ARIA en HTML solo prevé `combobox` en `input`; se mantiene a propósito (patrón de autocompletado de ARIA 1.2) y requiere comprobar con VoiceOver.
- **`aria-label` en botones solo-icono (M7).** Copiar y Bifurcar de cada mensaje de Code, Bifurcar y Compactar de la barra de Code y Quitar adjunto (que ahora también se ve con el foco del teclado). El punto de estado del pie de la barra lateral era un `span`
  con `aria-label` sin rol (violación _serious_): pasa a `aria-hidden` (el estado ya se lee como texto al lado).
- **Contraste (M8).** Misma paleta, solo más contraste: `--fg-subtle` `#8a91a3`→`#61697c` (claro, 2,97→5,18:1 sobre `--bg`) y `#6c7386`→`#858b9c` (oscuro, 3,92→5,45:1); `--success` `#15803d`→`#14793a` y `--warning` `#b45309`→`#aa4f09` (claro)
  para llegar a 4,5:1 también sobre barra lateral/código/hover; token nuevo `--gold-text` (`#876217` claro, igual al oro en oscuro) para el texto de las insignias doradas (`--gold` queda para iconos). Sobre la fila seleccionada (`bg-active`) el
  texto `text-subtle` usa `--fg-muted`. Capturas antes/después en claro y oscuro (820 y 1280 px) en `scratchpad/shots-c5/{before,after}`.
- **Landmarks (B2).** Tareas tenía un `<main>` dentro del `<main>` de la app (se vuelve `div`); las barras laterales llevan nombre (`aria-label`) para que no choquen como landmarks.
- **Cómo se mide el contraste.** `app/contrast.test.ts` lee `globals.css` y calcula la razón WCAG 2.x de cada token de texto (`fg`, `fg-muted`, `fg-subtle`, `accent`, `success`, `warning`, `danger`, `gold-text`) contra todas las superficies reales
  de cada tema (`bg`, `bg-sidebar`, `bg-elevated`, `bg-hover`, `bg-code`, `bg-inset`, `user-bubble`), `accent`/`gold-text` sobre sus fondos suaves, `accent-fg` sobre `accent`, y que se conserve la jerarquía fg > muted > subtle. Sin navegador: falla en `npm test`.
- **axe-core.** Nueva devDependency `axe-core` (hay que hacer `npm install` al integrar). `e2e/lib/axe.ts` lo inyecta por CDP en claro y oscuro; `calidad-t5.e2e.ts` ejecuta axe (etiquetas wcag2a/aa, wcag21a/aa y best-practice) en Chat, Chat con error 429, Code y Tareas
  con el OpenCode falso, y falla con violaciones _serious_, _critical_ o _moderate_. Antes de la tanda: aria-prohibited-attr y color-contrast (todas las vistas), button-name _critical_ en Code, tres de landmarks en Tareas. Ahora: solo queda
  `aria-allowed-role` _minor_ (compositor de Code). Informes con `T5_AXE_REPORT`; capturas con `T5_SHOTS_DIR`.
- Pendiente de revisión manual con VoiceOver: que «Respuesta terminada»/errores se lean una vez y sin interrumpir, el comportamiento del combobox (anuncio de la opción activa al usar ↑↓) y el orden de foco; axe no sustituye esa prueba. Cambian los snapshots de
  `ChatMessageList`, `MessageStream` y `TaskConversation` (la región `log`) y `MessageStream` (`aria-label`). Sin cambios en preloads ni en SEGURIDAD.md.

## F8-B35 — Ronda 2 · R2-B: adjuntos en Chat y cobertura E2E

- **Adjuntos en Chat (M4).** El clip del compositor de Chat deja de estar «próximamente»: imágenes (PNG, JPG, GIF, WebP), PDF y archivos de texto, por botón, pegado o arrastrando. Miniaturas (o ficha con el nombre para PDF/texto), «Quitar», aviso accesible
  (`role="alert"`) cuando se rechaza un archivo, y límites: 5 MB por imagen, 10 MB por PDF, 1 MB por texto, 5 adjuntos y 15 MB en total (`lib/attachments.ts`). Se permite enviar solo adjuntos, sin texto. Los adjuntos pendientes viven en el almacén de
  borradores (sobreviven a cambiar de modo, como el texto) y, si el envío falla, vuelven al compositor junto con el texto (también cuando la conversación nueva remonta el compositor). El mensaje de usuario pinta la imagen; «Reintentar» y «Editar y reintentar»
  conservan los adjuntos (ya lo hacían las acciones de T2). Textos nuevos `chat.attach.*` en es/en.
- **Seguridad (ver `docs/SEGURIDAD.md` §3 duodecies).** Verificado con el binario embebido y un proveedor falso que el agente `chat` (`"*": deny`) solo expone `webfetch` al modelo y que un adjunto `data:` viaja como parte del mensaje (imagen y PDF en
  base64, texto en línea) sin acceso al disco. Hallazgo: una parte `file://` se lee del disco saltándose los permisos del agente; por eso `sendChatMessage` solo admite URLs `data:` (error si no). Sin canales IPC nuevos; los hashes de los preloads no cambian.
- **Quick Entry.** `sendChatMessage` desde la entrada rápida (`App.tsx`) ya no deja una promesa rechazada sin atender: el texto vuelve al compositor y el error queda en la conversación si existe.
- **Huecos de prueba de T4.** E2E nuevos (`calidad-r2b.e2e.ts`): «Cargar más» con 250 sesiones en Code y en Tareas, y la búsqueda ⌘K de Code que carga todas las sesiones. Sin cambios de código en esas listas (ya funcionaban).
- Pruebas: unitarias `attachments.test.ts` (clasificación, límites, URL segura) y `actions.r2b.test.ts` (imagen sin texto = una parte `file`, `file://` rechazado sin llamar al motor, red caída → idle); E2E del flujo completo (imagen sin texto, quitar,
  tipo/tamaño rechazado, red caída con restauración de texto y adjunto y un solo mensaje de usuario). Capturas con `R2B_SHOTS_DIR`. Bug cazado por el E2E durante el desarrollo: el adjunto salía sin `filename` (el compositor usa `name`).
- No probado: modelos reales (si un modelo concreto no admite imágenes o PDF el proveedor devolverá su error, que se muestra como cualquier otro); arrastrar archivos desde el Finder en la app empaquetada (el E2E usa el selector); VoiceOver con la lista de adjuntos.

## F8-B34 — Calidad R2-A: descartar cambios, copiar respuesta, MIME de menciones, i18n de git

- **Descartar cambios por archivo (M3).** El panel Cambios de Code tiene «Descartar» (icono al pasar el ratón por la fila o en la cabecera del diff). Diálogo de confirmación con lo que se pierde y la lista de rutas; los archivos nuevos van a la Papelera
  (nunca borrado definitivo) y lo demás vuelve a su última versión de HEAD (índice y árbol). Tras descartar sale un aviso con «Deshacer» (copia previa en `userData/code-discard`, no pisa ediciones posteriores). Operación y validación en main
  (`src/main/git/service.ts`: `discardChanges`/`undoDiscard`); canales nuevos `git:discard` y `git:discardUndo` (contrato, esquema, preload `code.git.discard/discardUndo`, solo ventana principal). Detalle de seguridad en `docs/SEGURIDAD.md` §3 duodecies.
  **No se hizo** descartar por bloque (hunk) ni reutilizar el almacén de puntos de restauración de Tareas (viven en carpetas aprobadas de Tareas; aquí se usa copia propia + Papelera): queda como mejora.
- **Copiar respuesta en Code (B2).** Botón «Copiar respuesta» bajo la respuesta del asistente (texto de sus bloques de texto; en el último turno siempre visible, en los demás al pasar el ratón; no aparece mientras responde). Cambia el snapshot de `MessageStream`.
- **MIME de las menciones `@archivo` (B1).** Imágenes (`png/jpg/jpeg/gif/webp/bmp/avif/heic`) y PDF se envían con su MIME; el resto sigue como `text/plain` (`mention-mime.ts`).
- **i18n de `git/service.ts`.** Los 13 mensajes de validación pasan a `common.git.*` (es/en) y el archivo entra en `MIGRATED`; con `es` el texto es idéntico.
- Pruebas: `git/discard.test.ts` (18 casos con repos temporales reales y Papelera de pruebas: restaurar modificado/borrado/staged, nuevo y añadido a la Papelera, renombre, enlaces, rutas fuera del repo/`..`/`.git`/raíz, todo o nada, ignorados, conflicto, repo sin
  commits, fallo de Papelera, deshacer y su rechazo), `schemas.test.ts` (canales solo de la principal, esquemas), `discard-logic.test.ts`, `mention-mime.test.ts`; E2E `calidad-ra.e2e.ts` (repo real: cancelar no toca nada, confirmar restaura, «Deshacer»,
  archivo nuevo a la Papelera de pruebas, rutas hostiles rechazadas por el canal). Capturas con `RA_SHOTS_DIR`.

## F8-B36 — Calidad R2-C: accesibilidad en las vistas que faltaban

- **Cobertura.** `e2e/specs/calidad-rc.e2e.ts` ejecuta axe-core (claro y oscuro; wcag2a/aa, wcag21a/aa y best-practice) y falla con violaciones _serious_, _critical_ o _moderate_ en: las 12 secciones de Ajustes visibles sin cuenta, Rutinas (lista, detalle y editor en sus pestañas de
  programación y modos Tareas/Code), diálogo de confirmación y de prompt, catálogo MCP, paleta de comandos, asistente de primer uso (5 pasos), Tareas (primer uso, confirmar carpeta, permiso, pregunta, escalada, Control total, tarjetas de plan y toma de control, panel del proyecto, grabar una skill),
  Code (confianza de carpeta, paneles Cambios/Terminal/Archivos, selector de sesión, worktree, permiso) y las ventanas propias (píldora de plan/toma de control/estado, guía y grabación). Informe con `RC_AXE_REPORT`, `RC_AUDIT=1` solo cuenta, capturas con `RC_SHOTS_DIR`.
- **Violaciones halladas y arregladas.** Tarjeta de rutina: `role="button"` con un interruptor dentro (_serious_ nested-interactive) → la tarjeta se sigue pudiendo pulsar entera con el ratón, pero el control de teclado/lector es un botón con el nombre y el interruptor queda al lado. Botón de cerrar del selector de sesión de Code sin nombre
  (_critical_, ahora `code.sessions.close`). Campo del diálogo de prompt (renombrar/mover tarea) sin etiqueta (_critical_) y campo de rama del diálogo de worktree sin etiqueta ni nombre del diálogo. Esqueleto de la lista de Chat con `aria-label` en un `div` (_serious_, ahora `role="status"`).
  Vista previa de configuración del catálogo MCP con scroll sin acceso por teclado (_serious_, `tabIndex=0`). Contraste: `--warning` claro `#aa4f09`→`#954308` (aviso de Rutinas, 4,45→5,5:1), `--danger` claro `#c0352b`→`#b52f26` (estado «Error» sobre la fila activa, 4,28→4,76:1),
  `amber-600`→`amber-700` (botón «Permitir» de Control total, insignias de acceso, 3,2→5,0:1), archivos ignorados del panel Archivos `opacity-50`→`opacity-70`, y en las ventanas de píldora/guía/grabación los botones Detener/Terminar (`#dc2626`), Siguiente (`#7c3aed`) y Permitir de la toma de control (`#2563eb`), que con blanco no llegaban a 4,5:1.
  La tarjeta de petición de la píldora es una región con nombre (landmark).
- **Foco de los diálogos.** `lib/modal-focus.ts` (instalado en `main.tsx`) vigila `[aria-modal="true"]`: al abrirse mete el foco si el diálogo no lo hizo, Tab/Mayús+Tab no salen del diálogo de más arriba (sin pisar a los que ya lo hacen) y al cerrarse devuelve el foco al control previo
  si sigue en pantalla y el foco se perdió. Antes ni la confirmación, ni el editor de Rutinas, ni el catálogo MCP devolvían el foco, y varios asistentes/tarjetas no tenían trampa. El selector de sesión de Code y el de worktree pasan a `aria-modal`; el selector cierra con Esc desde cualquier control.
  Unitaria de la función pura `tabTarget`; E2E de contrato (entra, 25 Tab y 25 Mayús+Tab sin salir, Esc cierra y devuelve el foco) en cada diálogo.
- **No es violación / se deja.** Compositor de Code: `aria-allowed-role` _minor_ (combobox en textarea), igual que en F8-B33. El ejemplo de «Quick Entry» no se audita con axe (ventana con preload propio, sin cambios). Menú contextual de tareas y popovers de confirmación en línea de Code (`alertdialog` sin `aria-modal`): son
  inline, no modales, y no devuelven el foco al cerrar. Tras renombrar/mover una tarea el foco no vuelve (el control que lo abrió desaparece).
- Requiere VoiceOver manual: anuncio de los diálogos (nombre y descripción al abrir), orden de foco del asistente y del editor de Rutinas, la región de la píldora, y el combobox de Code. Sin cambios en preloads (hashes idénticos) ni en SEGURIDAD.md; sin IPC nuevo. Capturas en `scratchpad/shots-rc/`.

## F8-B37 — Calidad R3-A: rendimiento y continuidad en el renderer

- **Cifras de diff sin parsear (1).** Todos los consumidores de `parseUnifiedDiff`/`diffStats` revisados con grep: `DiffView` ya recortaba (T4); `diffStats` (chip de edición y tarjeta de permiso de Code, panel Cambios) pasa a contar `+N −M` recorriendo el texto sin trocearlo ni crear un objeto por línea (misma semántica que el parser, probada contra él en 8 casos), y la tarjeta de permiso de Tareas
  usa `hasDiffChanges` (se detiene en la primera línea cambiada). Microbenchmark (node, CPU real): 50 000 líneas 7,3 ms → 0,4 ms; 1 000 000 líneas / 43 MB 113 ms → 11 ms y sin 1 M de objetos. **Medición honesta:** en el E2E con CPU ×4 (`calidad-r3a.e2e.ts`, diff de 50 000 líneas) la tarea larga máxima antes/después es la misma dentro del ruido
  (chip 189–217 ms, permiso de Code ~515 ms ×4 = ~130 ms reales; con un diff de 200 líneas la base ya es ~200 ms ×4): lo que quedaba era el render del propio tope de 2000 filas, no el recuento. El cambio protege a diffs de decenas de MB, no mueve la cifra de 50 000 líneas. Umbral de la prueba: 200 ms reales (800 ms ×4).
- **Adjuntos de Code (2).** Viven en `stores/drafts.ts` (`code:<proyecto>:<sesión>:att`), en memoria: sobreviven al cambio de modo y de sesión, con tope de 20 MB por borrador y 60 MB entre todos (al pasarse se libera el borrador con adjuntos más antiguo de OTRA conversación; el actual nunca). Se liberan al enviar (el compositor vuelve a `[]`) y al borrar la sesión
  (`removeSession` → `clearSessionDrafts`, que también libera texto y menciones). Si el envío falla desde una sesión nueva, el adjunto vuelve también al borrador de la sesión creada. El tope también cubre los adjuntos de Chat (R2-B), que ya usaban el almacén sin límite global.
- **Scroll por conversación (3).** `useStickToBottom` guarda `{scrollTop, pegado}` por conversación (clave = id del primer mensaje) en una memoria de módulo acotada a 200 entradas (descarta la más antigua). Al volver (las vistas siguen desmontándose al cambiar de modo, como decidió T3) se restaura antes de pintar: pegada al final → final; si no, su posición y «Ir al final» visible. Chat, Code y Tareas comparten el hook.
- **Quick Entry (4).** Si el envío falla sin conversación activa, además de dejar el texto en el compositor de Chat (ya ocurría), se muestra un aviso cerrable bajo las cabeceras de la ventana principal (`QuickEntryNotice`, `role="alert"`, es/en `notices.quick.*`) con el motivo (`friendlyError`) y «Conectar una IA» si procede. Se cierra solo al salir de Chat.
- **«e» suelta en la terminal (5).** Reproducida con un `.zshrc` lento y determinista (`ZDOTDIR` de prueba, 2 s): no era del reenganche. Lo tecleado mientras el shell carga lo hace eco el núcleo (modo cocinado) y se queda en la primera línea antes del prompt («e%» de la captura de T3: la «e» de `echo` más la marca `%` de zsh); el reenganche deja las filas idénticas.
  `panels/inputGate.ts` retiene el teclado hasta la primera salida del shell (+60 ms) o 3 s como máximo y lo entrega junto; después, directo. La prueba E2E falla sin el cambio (primera fila = eco) y pasa con él; el reenganche repetido deja las filas iguales.
- Pruebas: unitarias (`DiffView.test.tsx` equivalencia con el parser y 50 000 líneas, `drafts.test.ts` topes/evicción/`clearSessionDrafts`, `use-stick-to-bottom.test.ts` memoria acotada, `inputGate.test.ts`); E2E `calidad-r3a.e2e.ts` (8 pruebas; las de scroll y adjuntos se comprobaron FALLANDO con el código anterior: scrollTop 3441 → 4041 sin la memoria). Capturas en `scratchpad/shots-r3a/`.
- No probado: arrastrar/pegar una imagen real del portapapeles (se usa el `input[type=file]`, que comparte ruta); memoria con cientos de adjuntos grandes reales; la «e» con el `.zshrc` real del usuario (solo se reproduce con shell lento). Sin cambios en preloads (hashes idénticos), sin IPC nuevo ni cambios en SEGURIDAD.md.

## F8-B38 — Calidad R3-B: accesibilidad de Cuenta y Quick Entry, prueba inestable, medición y descartar por bloque

- **Accesibilidad (axe, claro y oscuro).** `e2e/specs/calidad-r3b.e2e.ts` audita con el servidor de cuentas falso (`e2e/fake-auth`, sin red real) la pantalla de acceso (inicio, correo, código, código erróneo), Ajustes › Cuenta, su diálogo «Borrar mi cuenta» y la ventana Quick Entry (vacía y con texto). Hallazgos y arreglos:
  botones de peligro (`bg-danger text-white`): en oscuro el blanco sobre el salmón daba ~2,3:1 (_serious_, «Borrar mi cuenta», confirmaciones, conflicto) → token `--danger-fg` (blanco en claro, `#2a0805` en oscuro; `Button`, `ConfirmDialog`, `ui.tsx` de Code, lista de Chat, insignia de conflicto);
  Quick Entry: la pista «esc cerrar» (`--q-muted`) no llegaba a 4,5:1 en claro ni en oscuro (_serious_) y la ventana no tenía landmark (_moderate_ `region`) → `--q-muted` más contrastado y el contenedor pasa a `<main>`. La pantalla de acceso y la Cuenta en claro no tenían violaciones.
  No auditado: el aviso de error de Quick Entry (lo cambia R3-A en paralelo).
- **`no-ai.e2e.ts` (d) inestable: causa raíz y arreglo.** Bucle de 30 ejecuciones aisladas (`-t "(d)"`, sin reintentos), sobre el código anterior: sin carga 29/30 (1 fallo, el de «Ocultar detalle») y con carga de CPU (10 `yes`, un núcleo cada uno) 30/30. Causa: `ErrorNotice` ponía el rótulo de «Ver detalle» desde el evento `toggle` de
  `<details>`, que se despacha en una tarea posterior a que el contenido ya esté visible; la prueba esperaba el contenido (`statusCode: 401`) y leía el texto de la página antes de que llegara `toggle`, con el rótulo viejo. No era la animación ni el estado inicial. Arreglo en el producto: `<details>` controlado
  (`open` desde React, el clic de `<summary>` alterna el estado), de modo que rótulo y contenido cambian en el mismo render; la prueba además espera «Ocultar detalle» con reintento. Tras el arreglo: 30/30 sin carga y 30/30 con carga. Honestidad: el fallo sin arreglo es raro (1/30, y 0/30 con carga), así que la evidencia de causa es el
  mecanismo y la firma idéntica del único fallo capturado, no una diferencia estadística grande.
- **`npm run perf:startup` (manual, fuera de `verify`).** `e2e/perf/startup.perf.ts` + `vitest.perf.config.ts`: arranque en frío (5 lanzamientos: primer pintado e interactiva) y RSS de todo el árbol de procesos con 3 conversaciones largas falsas durante 5 min. Umbrales sugeridos y cifras actuales en `docs/VERIFICACION.md`:
  primer pintado 398 ms (máx. 466), interactiva 600 ms (máx. 645), RSS 585 MB sin conversaciones, pico 871 MB al cargar las tres, ~725 MB asentado y 586 MB a los 5 min (sin fuga). Nada superó un umbral razonable: sin cambios de producto por este punto.
- **Descartar cambios en Code (M3 completo).** (1) _Se conserva lo preparado:_ `git:discard` acepta `scope: 'unstaged'` y el panel lo usa desde la fila de «No preparados» (solo el árbol de trabajo vuelve a lo preparado; el diálogo lo dice); desde «Preparados» sigue yendo todo a HEAD. «Deshacer» ahora también vuelve a preparar lo que estaba preparado
  (blob del índice con `git update-index --cacheinfo`, o `git rm --cached` si el borrado estaba preparado) y se apoya en el hash del archivo tras el descarte en vez de en `git status`. (2) _Por bloque:_ canal nuevo `git:discardHunk` (solo ventana principal, esquema estricto, sin rol secundario; preload `code.git.discardHunk`), botón «Descartar este bloque» en cada `@@` del diff de «No preparados»
  de un archivo modificado, con confirmación que muestra el bloque. Se implementó porque se puede garantizar todo o nada: main recalcula el diff y exige que el bloque coincida exactamente con el visto (si el archivo cambió, se rechaza), guarda copia completa antes, hace `git apply -R --check` y luego `git apply -R` solo sobre el árbol (atómico, no toca lo preparado) y «Deshacer»
  restaura la copia solo si el archivo sigue idéntico al que dejó el descarte. Detalle de seguridad en `docs/SEGURIDAD.md` §3 terdecies/quaterdecies. Textos nuevos `code.changes.discardHunk*`/`discardKeepsStaged` y `common.git.discard.hunk*` en es/en; `shared/diff-hunks.ts` trocea el diff (lo usan main y renderer).
- Pruebas: `git/discard.test.ts` (28 casos con repos temporales reales: conservar lo preparado y deshacer, borrado preparado, añadido con cambios, bloque que se quita sin tocar el otro ni lo preparado, bloque obsoleto/inexistente/de otro archivo, rutas fuera del repo/`.git`/archivos nuevos, deshacer que no pisa ediciones posteriores, CRLF y sin salto final),
  `diff-hunks.test.ts`, `discard-logic.test.ts`; E2E `calidad-r3b-discard.e2e.ts` (repo real: confirmar/cancelar, bloque descartado, lo preparado intacto, «Deshacer», canal con bloque falso y rutas hostiles) y `calidad-r3b.e2e.ts` (axe). Capturas en `scratchpad/shots-r3b/`.
- No probado: VoiceOver en Cuenta, Quick Entry y el botón por bloque; descartar bloques en repos muy grandes o con filtros `clean/smudge`/`autocrlf` exóticos (se probó CRLF y archivo sin salto final); que `git apply` falle de forma limpia en discos llenos (la copia previa queda y se borra al fallar).

## F8-B39 — Windows T1: arranque (rama `feat/win-t1-arranque`)

Primera tanda para que OnyxCode arranque en Windows (alcance v1: Chat, Code, Rutinas en modo Code, Ajustes, cuentas, idioma, Diagnóstico, MCP, Git/restauración). Modo Tareas (Seatbelt), Control del PC y actualizador quedan solo en macOS.

- **Herramientas** (`scripts/win/`): `sync.sh` (Mac: empaqueta el árbol, lo sube por scp y ejecuta `C:\onyx\run.ps1`, devuelve el código de `summary.txt`), `run.ps1` (en `C:\onyx\`: mata huérfanos al empezar y al acabar, `robocopy /MIR` a `C:\onyx\wt`, `npm ci` solo si cambia `package-lock.json`, cada paso con límite de tiempo y `taskkill /T /F`), `smoke.ps1` (arranque real sin pantalla, cierre por `WM_CLOSE`, huérfano simulado) y `procs.ps1`.
- **package.json**: `scripts/build-native.mjs` (no hace nada fuera de darwin) en `dev`/`build`, `scripts/with-env.mjs` (variables de entorno sin sintaxis POSIX) en `test:fs|stress|e2e:prod`/`perf:startup`, `package:win`, `check:win-bundle`. `.gitattributes` (`* text=auto eol=lf`, binarios).
- **`child-env.ts`**: en win32 la variable es `Path` (la lista blanca sensible a mayúsculas la descartaba); lista blanca de Windows (SystemRoot, USERPROFILE, APPDATA, LOCALAPPDATA, TEMP/TMP, PATHEXT, ComSpec, ProgramData…), claves sin distinguir mayúsculas, carpetas extra (`.opencode\bin`, `%LOCALAPPDATA%\Programs`, Git `cmd`). El comportamiento en macOS no cambia.
- **`pids.ts`**: en Windows `taskkill /PID n /T /F` y `Get-CimInstance Win32_Process` (PowerShell, 5 s, solo si hay `pids.json`); `isOpencodeServe` reconoce `"…\opencode.exe" serve`. `server.ts`/`dialog/service.ts`/`tasks-files-handlers.ts`: `detached` solo fuera de win32 y `windowsHide: true`.
- **`platform-caps.ts`** (`capsFor`): `src/main/index.ts` carga con `import()` dinámico `update/boot`, `update/swap`, `ipc/update` y `ipc/tasks-handlers` solo en darwin; fuera de darwin `registerRoutinesHandlers` (planificador sin Tareas: `RoutineTasksPort` + `noTasksPort`, `merr.routine.platformUnsupported` es/en) y `registerUnsupportedHandlers` (canales `tasks:*`/`computer:*`/`app:update*` responden `PLATFORM_UNSUPPORTED`; lecturas neutras `[]`/`null`/prefs por defecto/«sin actualización»). `out/main/index.js` queda sin código de macOS (`npm run check:win-bundle`; las cadenas de i18n con «sandbox-exec»/«cu-helper» se ignoran: el `grep` literal del plan da 4 por eso). Hashes de `out/preload/*.js` idénticos a main.
- **`tasks/policy.ts`**: política gestionada en `%ProgramData%\OnyxCode\managed.json` y raíces `C:\…`/UNC/`~\` en win32.
- **OpenCode embebido**: `pin.json` por plataforma (`assets["darwin-arm64"|"win32-x64"]`), `fetch-opencode.mjs` extrae con `tar.exe` de System32 y deja `opencode.exe`; `bundledOpencodePath` usa `.exe` en win32.
- **Pruebas**: `src/test/platform.ts` (`macOnly`/`posixOnly`/`winOnly`); casos win32 de `child-env`, `pids` (procesos reales: árbol muerto con `taskkill /T`), `fetch-opencode` (descarga/SHA/extracción reales con `tar.exe`), `policy`, `isInside`, `unsupported-handlers`, rutinas sin Tareas. Los saltos en Windows están listados en `docs/VERIFICACION.md` (Windows).
- **Medido**: `OPENCODE_BIN` → listo en ~1,3–1,6 s; al arrancar el renderer (modo Chat) solo invoca `app:updateState` y `app:bootConfirm` de los canales simulados; OpenCode respeta `XDG_DATA_HOME/CONFIG/CACHE/STATE` en Windows (data en `%XDG_DATA_HOME%\opencode`; `home` sigue siendo `%USERPROFILE%` y su `tmp` es `%TEMP%\opencode`); el ZIP `opencode-windows-x64.zip` trae solo `opencode.exe` (180 320 648 bytes) en la raíz.

## F8-B40 — Windows T2: Code y interfaz (rama `feat/win-t2-code-ui`)

Segunda tanda de Windows: terminal, Diagnóstico sin datos personales, interfaz sin las funciones solo de macOS y textos propios.

- **Terminal** (`pty/shell.ts`, puro): en win32 la shell por defecto es `pwsh.exe` (Program Files o `Path`) y, si no existe, Windows PowerShell 5.1 con `-NoLogo` (antes `COMSPEC`/cmd); `$SHELL` se ignora en Windows. `electron-builder.js`: en Windows `asarUnpack` incluye `node_modules/node-pty/**` (conpty.node, `conpty/conpty.dll`, `conpty/OpenConsole.exe` y el worker no pueden vivir dentro del .asar); en macOS no cambia nada. Prueba real en Windows (`service.win.test.ts`): carga de los prebuilds, shell por defecto, un comando y salida.
- **VS Code** (`dialog/code-candidates.ts`): `Code.exe` de `%LOCALAPPDATA%\Programs\Microsoft VS Code` y de `%ProgramFiles%`; sin él, `shell.openPath` (ya no se intenta `code.cmd`, que no arranca sin shell).
- **Diagnóstico** (`diagnostics/redact.ts`, privacidad): la carpeta del usuario se sustituye por `~` en todas sus variantes de Windows (`C:\Users\x`, `C:/Users/x`, `C:\\Users\\x` de JSON, otra capitalización de ruta y unidad, `file:///C:/…`, `%5C`/`%3A` codificados, `/c/Users/x` de Git Bash, `/mnt/c/Users/x` de WSL, UNC, nombres con espacios) y, además, cualquier `<unidad>:\Users\<nombre>` aunque no sea el usuario actual. Patrones lineales (prueba con 100 000 caracteres). Sin cambios en macOS.
- **Rutas**: `util/paths.ts` (`samePath`, `normalizeDrive`) y `git/service.ts` (comparación de worktrees sin distinguir mayúsculas en win32); renderer `lib/paths.ts` (`tildify`, `shortenPath`, `baseName`, `splitPath` con `\` y unidad) usado en Code, Uso y Rutinas.
- **Ventana y sistema**: icono de bandeja a color en Windows (`tray-style.ts`; en macOS sigue la plantilla negra), Quick Entry `Alt+Shift+Space` por defecto en win32 (`defaultQuickEntryShortcut`), `flashFrame` al notificar con la ventana en segundo plano, marco nativo de Windows y sin hueco de semáforos (`lib/platform.ts` lee `window.api.platform`; el preload no cambia).
- **Sin Tareas/Control/actualizador** (`platform-caps`, `modeAvailable`/`usableMode`): Tareas sale del selector, la paleta y los atajos; un modo guardado cae a Chat; Ajustes oculta Tareas, Red, Modo auto, Control del PC, «Mantener despierto» y Actualizaciones, con un aviso `platform.win.unavailable.*` (es/en); el asistente omite «Permisos de macOS»; Rutinas no ofrece el modo Tareas y las ya guardadas muestran aviso y no se pueden lanzar desde la interfaz.
- **Textos**: `shared/i18n` admite variantes `clave.win` (se aplican solo en win32; en macOS y en las pruebas no cambia ningún texto): Finder → Explorador, Llavero → almacén de credenciales, «tu Mac» → «tu PC», atajos con Ctrl, bandeja, Dock → barra de tareas. Los textos de Tareas/Control (`tasksComputer`…) no se tocan.
- **Medido en Windows**: unit 1475 pruebas verdes (119 saltadas por la tanda 1), build en 14 s, humo de arranque OK (listo en 1,8 s, sin consola, sin huérfanos).
- **No probado**: ventana visible (axe, aspecto de la bandeja y del marco, parpadeo de la barra de tareas, atajo global real), `Code.exe` real, descartar bloques con `shell.trashItem` y revert de sesión de OpenCode en un repo bajo `C:\onyx\tmp`, «Ejecutar ahora» de una rutina Code. `node-pty` empaquetado (`app.asar`) y su `fork` de `conpty_console_list_agent` con `runAsNode` desactivado quedan para la tanda 4 (instalador).

## F8-B42 — El modelo elegido en Chat ya no se cambia en silencio (rama `fix/modelo-elegido-se-pierde`)

Bug: en Chat el usuario elegía un modelo (p. ej. OpenCode Go · GPT 5.6 luna), salía y al volver «estaba puesta otra IA».
Causa confirmada: la elección SÍ se guarda (`settings.defaultModel`, store y `settings.json` correctos al cambiar de modo, abrir Ajustes
y reiniciar; pruebas (a)-(c)), pero `resolveModel` sustituía en silencio cualquier modelo ausente de la lista de proveedores cargada
por el predeterminado de la primera IA conectada, y el selector y el envío usaban ese sustituto. Basta con que la lista no traiga el
modelo (lista vieja, proveedor sin clave, modelo retirado) para que se vea y se use otro. No se pudo reproducir con el OpenCode real
por qué la lista pierde el modelo (no probado), pero el efecto visible queda cubierto.

Cambios:

- `shared/ai-availability.ts`: `isChoiceUnavailable` (elección explícita ausente de la lista cargada; no aplica sin IA configurada, con
  la lista sin cargar ni al predeterminado de fábrica nunca tocado) y `sendGate(..., unavailable)` con motivo `model-unavailable`.
- `lib/ai-gate.ts`: opción `strict` (solo Chat). Con la elección no disponible no hay modelo efectivo, el envío se bloquea y la lista de
  proveedores se recarga una vez por modelo. Code y Tareas conservan el comportamiento anterior. Nada se persiste jamás.
- Chat: el selector muestra el modelo elegido marcado «no disponible», aviso encima del compositor, compositor bloqueado con texto
  propio y `sendChatMessage` lanza un mensaje claro en vez de enviar con otro modelo (es/en).
- Pruebas: unitarias (`ai-availability.test.ts`, `main/store.model.test.ts`) y E2E `model-choice.e2e.ts` (disco + store + DOM; cambiar de
  modo, Ajustes, reinicio con el mismo userData, lista sin cargar, modelo ausente, proveedor sin clave y reconexión).
- Pendiente de decidir: Ajustes › Modelos ofrece un modelo «Chat» por modo (`modelsByMode.chat`) que Chat ignora (usa `defaultModel`).

## F8-B41 — Navegador integrado: páginas locales sin estilos y pestañas que no se cierran (rama `fix/navegador-css-pestanas`)

- **Causa raíz 1 (confirmada con E2E real, `e2e/specs/navegador.e2e.ts`)**: la regla de red (`session.ts`, `installNetworkGuard`) solo dejaba pasar los subrecursos locales si el origen de la página estaba en «Permitir siempre» (`isLocalOriginApproved`). Una página local que escribe el usuario (que no se aprueba en ningún sitio) o que el agente abre con «Permitir en esta tarea» (aprobación solo en memoria) cargaba el HTML, pero su CSS e imágenes se cancelaban (`ERR_BLOCKED_BY_CLIENT`, `destino local bloqueado ... tipo=stylesheet`). Arreglo: se deja pasar lo que tiene el mismo origen exacto `host:puerto` que la página (`sites.ts`: `hostPortOf`, `localSubresourceAllowed`). Un recurso a OTRO puerto local sigue bloqueado salvo «Permitir siempre» en el origen de la página (sin cambios; SEGURIDAD.md actualizado). Sin página (service worker, webContents destruido) sigue bloqueado.
- **Causa raíz 2**: `destroyTab` nunca cerraba el `webContents` (el comentario suponía recolección de basura) y `layoutView` solo quitaba la vista nativa al cambiar de ventana: al cerrar una pestaña su vista seguía colgada y visible, y el webContents vivo (JS, audio, red). Arreglo: `destroyTab` llama `wc.close()`; `layoutView` mantiene UNA vista por owner (`attachedTabId`) y quita la anterior al cambiar de pestaña, al cerrarla o al quedarse sin ninguna; `discardTab` unifica cerrar desde la UI, desde el agente, tras un `new_page` fallido y al salir; tras cerrar se reelige la pestaña activa y se vuelve a emitir el estado (antes la UI ignoraba el resultado de `closeTab` y quedaba con la pestaña activa ya cerrada); el aviso `destroyed` no se emite dos veces.
- **Pruebas**: `session.test.ts` (guard con peticiones simuladas: mismo origen, otro puerto, `localhost` vs `127.0.0.1`, siempre, sin webContents, remoto), `sites.test.ts`, y E2E con Electron real y servidor estático (HTML+CSS+PNG) en puerto efímero: página tecleada por el usuario y página aprobada «en esta tarea» con `getComputedStyle`/`naturalWidth`; una imagen de otro puerto local no aprobado no llega al servidor; cerrar una pestaña la quita de la lista, del DOM, de las vistas nativas y destruye su webContents; cerrar la última deja el panel vacío.
- **Efecto colateral corregido**: al mostrarse de verdad la vista de la pestaña del agente (antes quedaba oculta tras la del usuario), el `mouseMove`/`mouseLeave` que Chromium sintetiza cuando la vista aparece o cambia de sitio bajo un puntero quieto (p. ej. al cerrarse la tarjeta de aprobación) contaba como «usuario activo» y rechazaba la acción del agente recién aprobada. `layoutView` suprime 400 ms la entrada humana tras aparecer/mover la vista (`LAYOUT_SYNTH_INPUT_MS`).
- **Verificado**: `npm run verify` completo en la Mac (1586 unit, 238 E2E verdes) y capturas antes/después en `scratchpad/shots-nav/`. **No probado**: ventana «Navegador» aparte (popout) con varias pestañas, audio/vídeo en una pestaña al cerrarla, service workers locales (siguen bloqueados hacia destinos locales: sin `webContents` no hay página de referencia).

## F8-B43 — Cada modo recuerda su propio modelo (rama `fix/modelo-por-modo`)

Bug: el dueño elegía GPT en un modo, salía y volvía (o reiniciaba) y estaba otra vez el predeterminado. Causas: Code guardaba
el modelo solo en memoria (`useCode.model`, `null` al arrancar); Chat escribía `settings.defaultModel` (pisaba el predeterminado
global sin querer) y su fila de Ajustes › Modelos (`modelsByMode.chat`) no se leía.

Diseño: `settings.defaultModel` es el predeterminado global y solo vale para los modos sin elección propia; Chat, Code y Tareas
recuerdan su modelo en `modelsByMode` (`extras.json`, vía `extras:setPrefs`). Elegir un modelo en un modo NO toca el predeterminado.

- `settings/impl/extras.ts`: resolvedor puro `pickModeModel`, `withModeModel`, `setModeModel(mode, ref|null)` y `whenExtrasLoaded`.
- Chat: selector, envío y «compactar» usan `modelsByMode.chat`; «Probar un modelo gratuito» lo fija como modelo de Chat. Se mantiene
  el comportamiento de B42 (modelo ausente: «<id> · no disponible», envío bloqueado, sin sustituto persistido).
- Code: el modelo elegido se persiste como `modelsByMode.code`; sin elección vale el del modo. `setModel(m, remember=false)` es
  la sincronización interna de `Composer` (sustituto por IA conectada) y no persiste. Cambiar de modelo descarta el esfuerzo.
- Tareas: sin cambios de comportamiento (el `taskModel` de la tarea sigue mandando); además, un cambio desde Ajustes sin tarea
  abierta lo toma la siguiente.
- Ajustes › Modelos: la fila de cada modo edita lo mismo que el selector del modo; «Usar el predeterminado (<modelo>)» borra el
  override; textos es/en explican la relación.
- Rutinas: una rutina nueva parte del modelo de su modo (y lo guarda en la propia rutina). Quick Entry envía con el modelo de Chat
  (espera a que las preferencias estén cargadas).
- Compatibilidad: usuarios con solo `defaultModel` y sin overrides, igual que antes; sin migración.
- Pruebas: `extras.test.ts` (resolvedor) y E2E `model-por-modo.e2e.ts` (fallan en main); `model-choice.e2e.ts` adaptado.

## F8-B41 — Windows T3: pruebas (rama `feat/win-t3-pruebas`)

Tercera tanda de Windows: las unitarias y las E2E corren en el PC de pruebas.

- **Lanzador falso solo para pruebas** (`opencode/test-launcher.ts`): sin empaquetar, en win32 y con `OPENCODE_BIN` terminado en `.mjs`, `server.ts` y `binary.ts` ejecutan `node <mjs>`; `ONYXCODE_TEST_BUNDLED_DIR` acepta `opencode.mjs`. Nunca aplica a la app empaquetada ni a un `.exe`.
- **Terminal**: `pty/service.ts` devuelve el pid vivo en `list()` (en Windows/ConPTY `pty.pid` era 0 al crear la terminal). **Asistente**: variantes `.win` del título y la guía del paso «modos» («Los tres modos»).
- **Pruebas**: `e2e/lib/proc.ts` (procesos multiplataforma), `e2e/win-skip.json` (5 specs de Tareas/actualizador, con motivo y guardia `win-skip.test.ts`), saltos solo de bloques de Tareas, unitarias de `binary` con falso `.mjs`, specs adaptadas (atajos, textos PC/Mac, asistente de 4 pasos, 8 secciones de Ajustes, `core.autocrlf=false`). Detalle y pendientes en `docs/VERIFICACION.md`.
- **Medido**: Windows, E2E completas 29 archivos / 162 pruebas verdes (49 saltadas, 2 pasaron en el reintento), ~8 min; Mac `npm run verify` verde.
- **Pendiente (defecto, no excluido por alcance)**: en el navegador integrado el clic del agente no llega a la vista en Windows (2 pruebas del Lote D saltadas).

## F8-B44 — Control total sin carpeta (rama `feat/control-total-sin-carpeta`)

Petición del dueño: al elegir «Control total del Mac» no se pide carpeta; el agente puede operar en todo el equipo.

- **Antes**: Control total era una concesión POR CARPETA (`tasks:grantFullAccess`), exigía una carpeta autorizada (`approveFolder`, que rechaza el home) y la pantalla de inicio pedía «Elegir carpeta» y «Permitir».
- **Ahora**: el consentimiento es UNO por equipo (`tasks-folders.json › fullAccessConsentAt`, con fecha), pedido en el diálogo de siempre (texto actualizado: sin carpeta, acceso a todos los archivos y programas, se pregunta una vez). La carpeta de trabajo es la actual si ya hay una elegida; si no, la última usada en Control total o la carpeta personal (`fullAccessDir`). «Cambiar carpeta» (opcional) en el aviso del inicio. Sin consentimiento, `tasks:start {fullAccess}` falla con `FULL_ACCESS_NOT_GRANTED`.
- **IPC nuevos**: `tasks:fullAccess:state`, `tasks:fullAccess:consent`, `tasks:fullAccess:revokeAll`. `grantFullAccess`/`revokeFullAccess` por carpeta se conservan (compatibilidad: una carpeta con concesión antigua sigue funcionando sin consentimiento nuevo; sin migración destructiva).
- **Retirar**: Ajustes › Tareas › «Control total del Mac» (fecha del consentimiento y «Retirar consentimiento»): borra consentimiento y concesiones por carpeta y detiene los servidores sin sandbox; vuelve a pedirse el diálogo.
- **Sin cambios**: plan-gate, aprobaciones por app, ⌘⇧Esc, comprobaciones TCC, Sandbox (sigue pidiendo carpeta y rechazando el home), perfil Seatbelt, credential proxy, provider-egress, proxy-policy y folder-policy (no se tocaron).
- **Efectos de no tener carpeta autorizada**: la carpeta personal no se recorre para «entregables» ni se crean puntos de restauración (se avisa); las funciones de la interfaz (vista previa, ZIP…) ven el espacio de Control total pero nunca `~/.ssh` ni los demás secretos que el sandbox niega; no se migra la carpeta de trabajo antigua en el home. Con `allowedFolderRoots` (política) Control total sigue exigiendo carpeta autorizada.
- **Rutinas** en modo Tareas con Control total: el interruptor aparece con el consentimiento del equipo y la carpeta ya no tiene que estar autorizada para Sandbox; el consentimiento propio de cada rutina y la aprobación humana del plan se mantienen.
- **Interfaz**: aviso «Sin sandbox · acceso a todo tu equipo · carpeta de trabajo: ~» en el inicio y «Control total no está confinado» en la barra roja mientras una tarea corre; la carpeta personal se llama «Carpeta personal».
- **Pruebas**: `manager.fullaccess.test.ts` (11) y E2E `control-total.e2e.ts` (4: sin carpeta ni selector, cwd = home falso, consentimiento con fecha, indicador, revocar, Sandbox sigue pidiendo carpeta). Windows: modo no disponible, sin cambios.

## F8-B45 — Archivos del proyecto: vigilante, gestor y «Abrir en…» (rama `feat/archivos-vigilante-gestor-editor`)

Petición del equipo: el panel de Archivos (modo Code) se actualiza solo, permite crear/renombrar/eliminar y abre el proyecto con un editor.

- **Actualización automática (sin polling).** `files:watch`/`files:unwatch`/`files:setDirs` + evento `files:changed`: `fs.watch` recursivo en main (macOS/Windows; en Linux solo carpetas abiertas), coalescido ≈200 ms, ignorando `.git`, `node_modules`, `dist`, `out`, `build`, `.next`, `target`, `__pycache__`, `.venv`… Solo mientras el panel está visible; se libera al cerrar/cambiar de proyecto/ocultar la ventana. Topes y errores (EMFILE/ENOSPC/carpeta desconectada) sin tumbar la app: aviso «ya no se vigilan los cambios» y el botón Actualizar sigue (y reintenta la suscripción). El panel Cambios también se refresca con el mismo evento (`fsVersion`).
- **Gestor de archivos.** `files:create`/`files:rename`/`files:trash`: botones Nuevo archivo/carpeta, menú contextual, F2 / Supr, botones por fila accesibles con Tab, edición en línea. Validación en main (raíz con realpath, sin `..`, sin `.git` ni la raíz, enlaces simbólicos como enlaces, nombres válidos y reservados de Windows, nunca sobrescribe); eliminar va a la Papelera (Papelera de reciclaje en Windows) con confirmación.
- **«Abrir en…».** `editors:list`/`editors:open`: VS Code, Cursor, Zed, Sublime Text, WebStorm, IntelliJ IDEA y «Predeterminado del sistema»; el renderer solo envía un id del catálogo fijo; detección por rutas conocidas, `spawn` sin shell; recuerda el último en `extras.json › lastEditor`. `dialog:openInEditor` (menú del proyecto) no cambia.
- **Pruebas**: `fs-ops.test.ts` (34), `watcher.test.ts` (22), `editors/catalog.test.ts` (13), `files-logic.test.ts` (6), esquemas IPC (+5) y E2E `archivos-mx.e2e.ts` (7: aparece solo un archivo creado fuera, Cambios se actualiza, crear/renombrar/eliminar por la UI, rutas hostiles, «Abrir en…» con editor simulado). Variables de prueba: `ONYXCODE_E2E_EDITOR_LOG`, `ONYXCODE_E2E_EDITORS` (solo sin empaquetar).
- **Sin probar**: editores reales y Windows (rutas de instalación y `fs.watch` recursivo en Windows solo verificados con detección simulada); Linux no tiene vigilancia recursiva (modo carpetas abiertas, probado con vigilantes simulados).

## F8-B46 — Navegador en versión de escritorio y atajos configurables (rama `feat/navegador-escritorio-atajos`)

Dos peticiones del equipo.

### Navegador integrado: versión de escritorio por defecto

- **Causa**: el panel del navegador es estrecho (≈ 500–700 px), así que el viewport real de la página activaba sus `@media (max-width: …)` y salía la versión móvil (el user agent ya era de escritorio).
- **Ahora**: cada pestaña emula un viewport de **1280 px** (`webContents.enableDeviceEmulation`, `viewSize` + `scale` para que quepa en el panel; sin CDP `Emulation.*`, que sigue fuera de `ALLOWED_CDP`) y user agent de escritorio (el de la sesión, sin `Electron/…`). Con el panel ≥ 1280 px no hay emulación. Se reaplica al cambiar el tamaño del panel y tras cada navegación (la emulación se pierde si cambia el proceso de render).
- **Escritorio / Móvil**: control visible y accesible en la barra del navegador (grupo con dos botones `aria-pressed`, también en la ventana aparte). Es **global y persistente** (`embedded-browser.json › prefs.viewMode`, por defecto `desktop`). «Móvil» emula 390 px, `screenPosition: mobile` y user agent Android/Chrome; al cambiar se recargan las pestañas http(s). Canal nuevo `browser:setViewMode`.
- **Coherencia con el agente**: con escala ≠ 1, `DOM.getContentQuads`/`getNodeForLocation`/capturas hablan en píxeles CSS pero `Input.dispatchMouseEvent` en píxeles de la vista; `cdp.ts` multiplica x/y de `Input.*` por la escala de la pestaña (`viewport.ts › scaleInputParams`), así `click`/`hover`/`scroll`/`fill` caen donde toca y las capturas miden 1280 px de ancho.
- **Pruebas**: `viewport.test.ts` (8) y E2E `navegador-escritorio.e2e.ts` (5: estilo de escritorio con panel estrecho, UA, clic del agente en dos botones con escala ≈ 0,5, «Móvil» con `@media` y UA móvil, persistencia). El clic por CDP está saltado en Windows (pendiente ya conocido de B41).

### Atajos de teclado configurables

- **Registro central** (`shared/keybindings.ts`): acciones con id estable, categoría, nombre i18n, atajo por defecto y reglas de foco; ejecución en `renderer/src/keybindings/` y **un único manejador** (`dispatch.ts`) que resuelve el atajo efectivo. Migrados sin cambiar los valores por defecto: ⌘K/⌘⇧P paleta, ⌘N nuevo, ⌘\ barra lateral, ⌘, Ajustes, ⌃Tab/⌃⇧Tab modo siguiente/anterior, ⌘1–4 paneles de Code, Esc detener, Shift+Tab Plan/Build, ⌘K buscador de sesiones de Code. Nuevas (sin atajo hasta que se asigne): ir a Chat/Code/Tareas/Rutinas, Plan, Build, enfocar el compositor. Quick Entry (atajo global de Electron) sigue aparte.
- **Guardado**: `extras.json › keybindings: { [idAcción]: atajo | null }` (solo lo que el usuario cambia; `null` = desactivado), normalizado y portable (`Mod` = ⌘ en macOS, Ctrl en Windows/Linux; `Ctrl` literal solo en macOS). Pensado para ir luego por perfil.
- **Teclados y entrada**: letras por carácter (con la tecla física si es un carácter no ASCII), dígitos y teclas con nombre por `event.code`, signos por carácter o por la tecla física (`ç`/`ñ`); AltGr (Ctrl+Alt) no dispara nada en Windows/Linux; sin disparo durante la composición de un IME ni con teclas muertas; los atajos «desnudos» (Esc, Shift+Tab) solo en el compositor o con el foco fuera de campos de texto; los que llevan modificador funcionan también escribiendo (como antes).
- **Ajustes › Atajos › En la aplicación**: lista agrupada con buscador, grabación («pulsa las teclas»), conflictos con otras acciones (reasignar o cancelar), aviso de combinaciones reservadas (⌘Q/⌘H/⌘M/⌘Tab/⌘Espacio, Alt+F4/Alt+Tab, copiar/pegar… se rechazan; las del menú se avisan) y de coincidencia con Quick Entry, restablecer uno o todos y desactivar. Las pistas de la interfaz (barra lateral, paleta, paneles) muestran el atajo vigente.
- **Compatibilidad**: en macOS los atajos con ⌘ siguen respondiendo también a Ctrl+tecla (p. ej. Ctrl+K) si el Ctrl literal no coincide con ninguna acción; ⌃Tab sigue siendo Control literal.
- **Pruebas**: `keybindings.test.ts` (36: normalización, eventos AltGr/IME/ES, registro, conflictos, reservadas, foco, overrides) y E2E `atajos.e2e.ts` (9: lista y buscador, cambiar y usar, los de siempre, Plan/Build propio, conflicto, reservadas, desactivar, persistir tras reiniciar, restablecer).

## F8-B47 — Windows v1: instalador NSIS y paridad (rama `feat/win-t4-instalador-y-paridad-v1`)

- **Instalador.** `electron-builder.js`: `win` (NSIS x64, icono `build/icon.ico` de 16–256 px), `nsis` (asistido, por usuario, carpeta elegible, `OnyxCode-Setup-<versión>-<arch>.exe`), `win.extraResources` con `opencode.exe` y `mac.extraResources` con lo de macOS (helper, lanzador, actualizador, OpenCode darwin); el `.dmg` de macOS sale igual (comprobado con `npm run package`). `scripts/win/pack-check.ps1` + `pty-probe.mjs` verifican el paquete sin firma (32 comprobaciones; ver `docs/VERIFICACION.md`). Instalador de prueba: 151,6 MB.
- **Defecto de `package:win`.** Llamaba a `electron-builder` a secas y `cmd` ejecutaba `electron-builder.js` con Windows Script Host (colgado sin mensaje); ahora `node node_modules/electron-builder/cli.js`.
- **Ratón por CDP en Windows: causa raíz hallada** (la vista de la pestaña del agente no estaba colgada de la ventana antes de F8-B46; Windows no enruta entrada a una `WebContentsView` suelta). Ya corregido por B46; reactivadas las pruebas «Pagar ahora», «enlace normal» y el clic con escala.
- **`perf` «2000 deltas»:** presupuesto propio de Windows medido (300 tareas / 25 s / 800 ms; 206–219 / 17,0–17,6 s / 345 ms medidos).
- **Pruebas en Windows** de lo nuevo de la tanda 3: `archivos-mx` (el texto de «Papelera de reciclaje» y los atajos `Ctrl`; el producto ya estaba bien, se ajustó la spec), `atajos`, `navegador-escritorio`, `model-por-modo`, `model-choice` en verde; unitarias: `manager.fullaccess` (Control total, modo Tareas) y `installer › cancelar` (actualizador) saltadas fuera de macOS por estar fuera de la v1.

## F8-B48 — Control remoto desde el celular, prototipo por red local (rama `feat/remoto-nucleo-y-app`, tanda T-A)

Petición del equipo: ver y responder las conversaciones desde el celular, sin nube. Prototipo DELGADO (solo red local, solo macOS); la PWA es la tanda T-B (`feat/remoto-pwa`). Modelo de amenazas en `docs/SEGURIDAD.md` §3 vicies.

- **Contrato compartido** (`src/shared/remote/protocol.ts`, `code.ts`): `PROTOCOL_VERSION = 1`, tramas de señalización (`hello`/`offer`/`ice`/`answer`) y del DataChannel (`auth`, `req` de la lista blanca, `res`, `evt`, `bye`), `LIMITS` y validadores estrictos que usan el escritorio y la PWA; código de confirmación de 6 dígitos desde las huellas DTLS (`@noble/hashes`, sin `crypto.subtle`).
- **Núcleo** (`src/main/remote/`, cargado con `import()` solo al pulsar «Activar»): `service.ts` (apagado → vinculando → activo), `signaling/{types,lan-server}.ts` (interfaz `SignalingTransport` intercambiable + servidor HTTP/WebSocket ligado solo a la IPv4 privada), `rtc.ts` (`node-datachannel`), `peer-session.ts` (auth, límites, violaciones), `whitelist.ts` (cinco operaciones, ámbito Chat + Code, Tareas nunca), `events.ts` (recorte y puente del SSE del motor solo con un celular conectado), `pairing.ts` (secreto de un solo uso), `devices-store.ts` (`remote.bin` con `safeStorage`), `rate-limit.ts`, `lan-ip.ts`, `qr.ts`.
- **IPC**: `remote:getState|start|newPairing|stop|confirmPair|revoke` + eventos `remote:changed|pairRequest` (solo ventana principal, esquemas estrictos; `window.api.remote`). `PlatformCaps.remote` (solo darwin).
- **UI**: Ajustes › Celular («Conectar mi celular»: QR en SVG, estado, dispositivos con «Quitar», «Cortar todo»), diálogo global «¿Vincular este dispositivo?» con el código, entrada «Cortar acceso del celular» en la bandeja (solo con el modo activo) y acción de atajos `remote.stopAll` (sin atajo por defecto). Textos es/en (`remote.*`).
- **Empaquetado**: dependencias `node-datachannel` 0.33.4, `ws`, `qrcode`, `@noble/hashes` fijadas; `node_modules/@node-datachannel/**` en `asarUnpack`; `pwa/dist` → `Contents/Resources/pwa` si existe; `build:pwa` encadenado en `build` (no hace nada si aún no hay `pwa/`). Avisos en `THIRD_PARTY_NOTICES.md`. Instantánea `api-routes.json`: +1 ruta (`GET /session/{sessionID}/message/{messageID}`).
- **Pruebas** (unitarias; el dueño prueba a mano con un celular): `protocol.test.ts` (13), `pairing.test.ts`, `devices-store.test.ts`, `peer-session.test.ts`, `whitelist.test.ts`, `service.test.ts`, `signaling/lan-server.test.ts`. Comprobación puntual (no incluida): vinculación + reconexión reales con `node-datachannel` en bucle local, código idéntico en ambos lados.
- **Sin probar**: conexión con un celular real (iOS/Android), Wi-Fi con aislamiento de clientes, la PWA en sí, y el comportamiento de `node-datachannel` dentro del `.app` ya instalado y notarizado.

## F8-B49 — PWA del control remoto (rama `feat/remoto-pwa`, tanda T-B)

La página que abre el celular al escanear el QR de F8-B48. TypeScript vanilla en `pwa/` (sin frameworks), compilada con Vite a `pwa/dist` (`npm run build:pwa`, encadenado en `build`): un JS + un CSS, ≈ 17,7 KB gzip en total. Se sirve por HTTP en la IP local, así que no usa `crypto.subtle`, service worker, instalación ni push; tampoco lleva `manifest` en el prototipo.

- **Código**: `pwa/src/rtc.ts` (señalización por WebSocket + RTCDataChannel `onyx`, creado después de `ready`; plazos para «no se encuentra el equipo»), `client.ts` (máquina de estados, vinculación, `resume`+`auth` por el canal, reintentos acotados 1/2/4/8/15 s, latido, peticiones de la lista blanca con tiempo límite y límite de 6 mensajes/min en el cliente), `ui.ts` (DOM por nodos y `textContent`, nunca `innerHTML`; Markdown mínimo escapado), `i18n.ts` (es/en según `navigator.language`), `main.ts`.
- **Pantallas**: vincular (extrae `s` del fragmento y lo borra de la barra; muestra el código de 6 dígitos con «compáralo con el que aparece en tu Mac»), lista de sesiones con permisos pendientes, chat en vivo (`message.updated`, `session.updated`, permisos), enviar, detener, «Permitir una vez»/«Rechazar» (nunca `always`) y «Apruébalo en el Mac» para los de solo lectura.
- **Estados**: conectando, no se encuentra el equipo, QR caducado o ya usado, desvinculado/revocado, rechazada/caducada/límite, acceso cortado, otro dispositivo, demasiadas peticiones, reconectando n/N, sin conexión con botón «Reintentar»; reconexión al volver de segundo plano (`visibilitychange`, `online`, `pageshow`) con sondeo y un QR nuevo con la página abierta (`hashchange`).
- **Seguridad**: el secreto del QR solo vive en memoria; `deviceId`/`deviceSecret` en `localStorage`; ninguna trama sin validar (`parseHostFrame`/`parseSignalHostFrame`); se respetan `LIMITS`; nada se registra en consola.
- **Diseño**: claro/oscuro por `prefers-color-scheme`, áreas táctiles ≥ 44 px, contraste ≥ 4,5:1 (medido), roles/`aria-live`/foco visible, `safe-area`.
- **Herramientas**: `typecheck:pwa` (dentro de `typecheck`), `lint` y `format:check` cubren `pwa/`; `eslint` ignora `pwa/dist`.
- **Comprobado** con una prueba desechable (no incluida): Chromium (`playwright-core`) contra el `RemoteService` + `LanSignalingServer` reales con `node-datachannel`, en loopback: vinculación con el mismo código en ambos lados, lista, chat, evento en vivo, detener, enviar, permiso, corte y reconexión sola, recarga con `resume`+`auth`, revocación, QR usado y «no se encuentra el equipo»; sin errores de consola ni de CSP.
- **Sin probar**: celular real, iOS Safari (candidatos ICE mDNS `.local` en vez de IP), Wi-Fi con aislamiento de clientes real, rendimiento con conversaciones largas.

## F8-B50 — Estética de la PWA del control remoto (rama `feat/remoto-pwa`)

Solo capa visual (`pwa/index.html`, `style.css`, `ui.ts`, textos nuevos en `i18n.ts`); no cambia protocolo, seguridad ni conexión. ≈ 22,3 KB gzip en total.

- **Identidad «Lapislázuli»**: tokens claro/oscuro copiados de la app (`--bg`, `--fg-muted`, `--accent`, `--danger`, `--warning`…), pilas de fuentes del sistema equivalentes (sans, display redondeada, mono), radios y sombras de la app; sin fuentes ni recursos externos. Gema «Faceta» en la cabecera, en la vinculación y como favicon (SVG en `data:`).
- **Pantallas**: barra superior con estado de conexión (punto), lista de sesiones como la barra lateral, burbuja del usuario y respuesta sin burbuja como en la app, bloques de código con cabecera de lenguaje, herramientas como filas con punto de estado, compositor elevado con envío redondo y botón «ir al final», tarjeta de permiso fija sobre el compositor (siempre visible), estados vacíos/errores con ilustración SVG mínima.
- **Móvil**: `theme-color` por esquema, `safe-area-inset-*`, `100dvh`, ajuste con `visualViewport` cuando aparece el teclado (sin exigir contexto seguro), `prefers-reduced-motion`.
- **Comprobado**: contraste ≥ 4,5:1 calculado en ambos temas; capturas con una prueba desechable (iPhone 390x844 @3x y Android 360x800, claro/oscuro) sobre la UI real con un cliente simulado.
- **Sin probar**: iPhone/Android reales, `safe-area` y teclado en dispositivo real.

## F8-B51 — Invocador remoto y bus de eventos (rama `feat/remoto-invocador`, tanda T2)

Cimientos del puente del celular en `main`; sin cambio visible para las ventanas ni canal nuevo.

- **`invokeAs`** (`ipc/handle.ts`): despacha un canal ya registrado con `makeInvokeHandler` como lo haría el renderer, con el MISMO `IPC_SCHEMAS` (`validatePayload`, extraído de `guardInvoke`) y el mismo manejo de errores, con `event.sender` = un remitente virtual. Gancho `authorize(canal, payload validado)` para la política «celular» (T3); sin él, o si devuelve false, FORBIDDEN (denegar por defecto). El rol «celular» no existe en `CHANNEL_ROLES`.
- **`RemoteSender`** (`remote/sender.ts`): `id` negativo y único, `send` por un canal inyectable, `isDestroyed`, `once('destroyed')` y `destroy()`. pty (`isOwner`) y `files:*` (hub por `sender.id`) funcionan sin cambios y la propiedad queda limitada a lo creado por ese remitente. `BrowserWindow.fromWebContents(event.sender)` pasa por `windowOfSender` (null para el virtual → respaldo `getWindow()`); los eventos de pty/archivos van por `publishToSender` (ventana real o virtual).
- **Bus** (`ipc/event-bus.ts`): `publish` (todas las ventanas + suscriptores remotos), `publishTo` (ventanas concretas, nunca al celular), `subscribeRemote` (lista blanca por canal, vacía = nada, y recorte). Migrados `broadcast`/`sendTo`, tasks, tasks-lifecycle, routines, code, notify, embedded-browser, extras y remote-handlers: mismos canales, cargas y orden. Un suscriptor remoto recibe aunque no haya ventanas.
- **Pruebas**: `invoke-as.test.ts`, `event-bus.test.ts`, `sender.test.ts`.
- **Sin probar**: nada con el celular real (llega con T3–T5).

## F8-B52 — Política «celular» y cola de confirmación (rama `feat/remoto-politica`, tanda T3)

Primera pieza de seguridad del control remoto con paridad; todavía no está conectada al puente (la usarán T2/T4/T6). Sin cambios visibles.

- **`src/main/remote/policy.ts`**: `CELULAR_POLICY` (≈ 210 canales IPC), `CELULAR_HTTP_POLICY` (las 188 rutas del motor fijado) y `CELULAR_EVENTS`, con clases R/M/D/X, filtros por campo (`settings:set`, `extras:setPrefs`, `tasks:prefs:set`, `computer:prefs:set`) y por ámbito (rutas absolutas y `directory`, `file://` solo bajo el directorio de la sesión y nunca en Chat, `model` en `provider.list`, `permission.reply` solo `once`/`reject`, ≤ 20 archivos en `git:discard`). `decide(request, ctx)` es pura y devuelve permitir / rechazar con motivo / confirmar con resumen es/en. `sanitizeResult` quita `userDataPath` de `app:info`.
- **`src/main/remote/confirm-queue.ts`**: cola FIFO (máx. 2 pendientes, 10/min, dedupe por sha256, aprobación solo para esa llamada, rechazo a los 90 s) con interfaz de UI inyectable.
- **IPC**: `remote:confirmAction` (invoke, solo ventana principal, esquema estricto) y evento `remote:confirmRequest` en `shared/ipc-remote.ts` / `main/ipc/schemas.ts`. Sin handler todavía (T6).
- **Pruebas**: cobertura del 100 % de canales, eventos y rutas (falla si aparece uno sin clasificar), una por cada X y cada D, `remote:*`, `settings:set{opencodeBin}`, `permission.reply always`, `file://` y `directory` fuera del ámbito, y la cola con reloj falso.
- **Docs**: `docs/SEGURIDAD.md` §3 unvicies con la tabla final y los casos límite (decisiones estrictas anotadas).
- **Sin verificar**: nada de esto se ha probado con un celular ni con el despachador real; la política no resuelve enlaces simbólicos (lo hará el despachador).

## F8-B53 — Protocolo v2 del control remoto: multiplexor con chunks, crédito y prioridad (rama `feat/remoto-protocolo-v2`)

Base de la paridad del celular (opción B). Solo transporte: no expone nada del motor todavía (el despacho a IPC/HTTP lo inyectan otras tandas).

- **`src/shared/remote/protocol.ts`**: `PROTOCOL_VERSION` pasa a 2 (un celular con la PWA v1 recibe `error{code:'version'}` por señalización y no abre canal). Tramas nuevas con validadores estrictos compartidos: `call{id,ch,p}`, `http{id,eng,method,path,query,headers⊂{content-type,accept},body}`, `res{id,ok,data|error}`, `chunk{id,n,last,d}`, `sub{id,eng,since}`, `ev{s,seq,ch|oc,p}`, `reset{s,seq}`, `cancel{id}`, `credit{id,bytes}`; `ck` anuncia el total (bytes UTF-8) cuando el cuerpo viaja en trozos. Las tramas v1 (`req`/`res` con `m`/`evt`) siguen sirviendo a la lista blanca del prototipo. Rutas HTTP sin `..`, `//` ni `%2e/%2f/%5c`. Nuevos `LIMITS` (trozo 56 KiB, 16 MiB subida / 8 MiB bajada, ventana 256 KiB, 32 llamadas, 6 streams, búfer de eventos 30 s / 2 MiB, 40 lecturas/s ráfaga 120).
- **`src/shared/remote/mux.ts`** (nuevo, TypeScript puro; lo usan Mac y PWA): `Mux` (host/cliente), `Outbox` (planificador control > eventos > respuestas > bulk con turnos entre transferencias y respeto de `bufferedAmount`: marcas 128/32/512 KiB), `EventLog` (seq por motor, búfer circular, lápidas para eventos que no caben, `reset` en huecos), `splitText` (trozos cuyo JSON escapado cabe en 56 KiB, sin partir pares sustitutos). Ids estrictamente crecientes (anti-repetición), cancelación (`AbortSignal` → `cancel`; el Mac aborta o descarta), cierre = `disconnected`, jamás se reintenta nada solo. Despachador inyectable `MuxDispatch` (`call`/`http`/`allowSub`); sin él todo responde `unavailable`.
- **Integración**: `peer-session.ts` (toda la salida pasa por el `Outbox`; cubos propios `allowCall`/`allowFlood` en `rate-limit.ts`; `deps.dispatch`/`events`/`urgent`), `rtc.ts` del Mac (`bufferedAmount`, `setBufferedAmountLowThreshold`, `onBufferedAmountLow` de node-datachannel), `pwa/src/rtc.ts` (`bufferedAmountLowThreshold`, `onbufferedamountlow`) y `pwa/src/client.ts` (`muxCall`/`muxHttp`/`muxSubscribe`, ids compartidos con el protocolo anterior).
- **Pruebas** (`mux.test.ts`, `peer-session.test.ts`, `lan-server.test.ts`, 48 nuevas): trozos, crédito (ventana de 256 KiB y violación por crédito inventado), cancelación, límites (32/6/16 MiB/8 MiB), tramas inválidas/huérfanas/repetidas/fuera de orden, reanudación por `seq` (otro `Mux`, mismo búfer; antigüedad, tamaño, futuro y evento enorme dan `reset`), prioridad (un evento adelanta a una descarga de ~8 MB en 16 ms simulados con reloj falso a ~10 MB/s), 10 MB de subida más 2 x 5 MB de bajada y un eco de 7,9 MB sin pasar de 64 KiB por trama.
- **Sin probar**: WebRTC real (Chromium/iPhone/Android) con volumen grande; los ritmos reales del `bufferedAmount` de libdatachannel y de Safari.

## F8-B55 — Confirmación en el Mac, PIN, bloqueo y auditoría del control remoto (rama `feat/remoto-confirmacion-mac`, tanda T6)

- **Confirmaciones**: `confirm-host.ts` conecta la cola de T3 con la interfaz real (`RemoteConfirmHost.tsx`, handler `remote:confirmAction` solo ventana principal, evento `remote:confirmRequest`/`remote:confirmDismiss`); sin ventana, diálogo nativo sin padre + rebote del Dock; el respaldo rechaza ante cualquier fallo. Cada conexión nueva se confirma en el Mac (D3) con «Recordar 12 h» por dispositivo.
- **PIN (D4)**: tramas `pin-set`/`pin-verify` (celular) y `locked`/`unlocked` (Mac) como extensión mínima de v2 (`protocol.ts`, validadores estrictos); hash `scrypt` con sal en `devices-store.ts` (`pin.ts`), 5 fallos revocan, retardo creciente, bloqueo a los 5 min (`access-gate.ts`). Sin PIN o sin confirmación no hay acceso a nada.
- **Auditoría** `remote-audit.jsonl` rotada, sin secretos (`audit.ts`) y Ajustes › Celular › Actividad; Ajustes también muestra PIN configurado/pendiente, «Recordar 12 h», estado (esperando/PIN/bloqueado/con acceso) y «Restablecer PIN».
- **PWA ligera**: pantalla de PIN/confirmación (`pwa/src/client.ts`, `ui.ts`, `i18n.ts`) para que el prototipo siga funcionando con el nuevo control de acceso.
- **Pruebas** (nuevas, ~60): PIN y hash, 5 fallos, retardo, bloqueo con reloj falso, «12 h», confirmación de conexión, auditoría (rotación, sin secretos), respaldo que rechaza, `remote:*` no invocable desde el despachador, tramas inválidas, integración con `PeerSession`.
- **Sin verificar**: nada con celular ni Electron real (diálogo nativo, rebote del Dock, notificación).

## F8-B54 — Proxy del motor y concentrador de eventos del celular (rama `feat/remoto-proxy-motor`, tanda T4)

Primer despachador real del protocolo v2: el celular ya puede llamar al IPC y al sidecar (aún sin PWA que lo use).

- **`engine-proxy.ts`** (`MuxDispatch`): `call` → canoniza rutas (`realpath`) → `decide` → `invokeAs` (R/M), confirmación en el Mac (D, aprobación ligada al hash de la llamada; cancelada = no se ejecuta; sin UI se rechaza) o `forbidden` (X/desconocido/`remote:*`); `http` → `directory`/`path`/`file://` con `realpath`, `GET /file/content` sin archivos sensibles, listados y sesiones filtrados por ámbito, tamaños acotados, cancelación; la contraseña Basic la pone el Mac.
- **`engine-registry.ts`**: reescritura de `authorization`/`baseUrl` (`onyx://engine/main`, `onyx://engine/task/<token>`) y `scrub` de credenciales conocidas en toda salida. **`engine-scope.ts`**: ámbito con `realpath` y lo que `policy.ts` necesita (sesión → directorio, permiso → tipo, modelos). **`path-guard.ts`**: `realpath` tolerante y lista de archivos sensibles.
- **`event-trim.ts` + `sse-hub.ts`**: UN stream de subida por motor bajo demanda (SDK v2), lista blanca de tipos, ámbito, recorte, `EventLog` con `seq`/`since`/`reset` (nuevo `EventLog.markGap` en `mux.ts`), cierre sin dispositivos; suscripción al bus de T2 con `CELULAR_EVENTS`. **`engine-host.ts`** lo ensambla; `service.ts`/`peer-session.ts`/`index.ts` lo cablean (`makeDispatch` recibe el `deviceId` verificado).
- **Puerto estable (D1)**: `DevicesStore.getPort/setPort` (en `remote.bin`) y `LanSignalingServer` con puerto preferido y respaldo.
- **Pruebas** (`engine-proxy`, `sse-hub`, `path-guard`, `lan-port`, `service`; ~60 nuevas): denegar por defecto, reescritura de `authorization`, `always` rechazado, `directory` fuera del ámbito y por enlace → forbidden, `file://`/`path` por enlace, archivos sensibles, recorte de eventos, reanudación por `seq`, cierre del hub y propiedad con contraseñas aleatorias (nada en respuestas, errores ni eventos).
- **Sin probar**: nada con un celular ni con un sidecar OpenCode real (todo con motor y `fetch` simulados); el diálogo de confirmación y el PIN son de T6 (hasta entonces toda acción D se rechaza).

## F8-B56 — PWA completa del celular: la misma interfaz React sobre el puente (rama `feat/remoto-pwa-completa`, tanda T5)

El celular carga la interfaz de escritorio (`src/renderer/src`) y la usa a través del DataChannel: Chat con streaming en vivo, Code (proyectos, sesiones, archivos), Tareas, Rutinas y Ajustes.

- **Shims** (`src/renderer/remote/`): `ipc-shim.ts` (`window.api` armado con `src/preload/window-api.ts`, extraído de `preload/index.ts` sin cambiar su comportamiento: cada `invoke` → `call`, cada evento → bus remoto), `engine-fetch.ts` (`fetch` del SDK v2: `onyx://engine/…` → `http`; SSE de `/global/event` y `/event` con `sub`/`ev` como `Response` con `ReadableStream`, `server.connected` inicial para disparar el `onOpen` que resincroniza, cierre limpio en `reset`), `events-hub.ts` (UNA suscripción por motor compartida, reanudación con `since`, `reset`), `insecure-shims.ts` (`crypto.randomUUID`/portapapeles sin contexto seguro), `install.ts`. Errores tipados (`src/shared/remote/link.ts`), cancelación con `AbortSignal` → `cancel`, mutaciones nunca reintentadas.
- **Arranque en dos partes** (`pwa/src/main.ts`, `full.ts`, `ui.ts`): la capa ligera (vinculación, PIN, confirmación) vive en un shadow root, carga `app/entry.json` tras `unlocked`, tapa la interfaz en los estados sin acceso (conectando, bloqueado/PIN, sin conexión), muestra una franja al reconectar y «Esperando a tu Mac…» cuando una llamada tarda (acciones «D»). Bloqueo a los 5 min: lo decide el Mac y la capa vuelve a pedir el PIN.
- **Capacidad `remote`** (`platform-caps.ts`, `lib/platform.ts`): superficie `window.api.platform = 'remote'` sin terminal (`terminal`), diálogos nativos (`nativeDialogs`), `openExternal`, vista nativa del navegador (`nativeBrowser`), actualizador, Control del PC ni ajustes del puente; Tareas sí. Mac y Windows: las cuatro capacidades nuevas son siempre `true`, sin cambios visibles. Se oculta con ellas: paneles Terminal/Navegador de Code y su atajo, «Abrir carpeta», «Mostrar en Finder/Abrir en editor», «Elegir carpeta»/adjuntar de Tareas, pestaña Navegador de Tareas, secciones MCP/Navegador/Atajos/Diagnóstico de Ajustes, asistente de primer arranque, avisos nativos y badge. `nativeCode('dialogs'|'pty')` devuelve `null` donde no aplica (git y archivos siguen por el puente). Enlaces: `lib/open-external.ts` (pestaña del propio celular).
- **Bundle** (`pwa/vite.full.config.ts` + `src/renderer/remote/main.tsx`/`boot.tsx` → `pwa/dist/app/`, `scripts/build-pwa.mjs` en dos pasos y `.gz` de cada texto, encadenado en `build`; `electron-builder.js` ya copia `pwa/dist`): sin xterm (alias a un sustituto), `highlight.js` y `lowlight` con 15 lenguajes, Tareas/Rutinas/Ajustes con `import()` y el diccionario inglés en un trozo aparte (se baja solo si el idioma es inglés).
- **Servidor** (`lan-server.ts`): `.gz` con `Content-Encoding`, `immutable` solo para archivos con huella, `index.html`/`entry.json` `no-store`, CSP con `blob:` en `img-src` y `font-src 'self'`, MIME de `.woff .map`, sin service worker.
- **Pruebas** (nuevas, ~100): shims (mapeo de TODOS los canales, errores tipados, cancelación, SSE sobre `sub`, reanudación, base64, chunks de 600 KB/3 MB sobre el multiplexor real, sin reintentos), concentrador de eventos, `.gz`/caché/CSP/MIME del servidor, capacidades, atajos de contexto no seguro y errores tipados. Además una prueba desechable (no incluida) con Chromium contra `RemoteService` + `LanSignalingServer` + `node-datachannel` reales sobre la IP de la LAN: vinculación, PIN, lista de sesiones, sesión nueva en vivo, streaming, enviar mensaje, acción «D» con espera/aprobar/rechazar, Code con archivos, bloqueo e inactividad y desbloqueo, inglés.
- **Sin verificar**: nada con un celular real (iPhone/Android, Safari/WebKit); la interfaz sigue siendo la de escritorio (la adaptación a pantalla de celular es T7/T8).

## F8-B57 — Caducidad de vínculos, política de la organización, AGENTS.md y diseño de la fase 2 (rama `feat/remoto-tokens-politica-agents`)

- **Tokens por dispositivo con caducidad** (`devices-store.ts`, `peer-session.ts`, `service.ts`, `protocol.ts`, `RemoteSection.tsx`): del secreto ya se guardaba solo el sha256 (secreto de 256 bits, sin cambio). Nuevo: `ttlDays` (30/90/365/nunca; 90 por defecto; «nunca» solo desde el Mac), `renewedAt`, `lastUsedAt` (antes `lastSeenAt`) y caducidad visible en Ajustes; renovación al usar; `authed` con `expiresAt`/`expiring` y `auth-failed {why:'expired'}` (extensión opcional de v2); canales `remote:setDeviceTtl` y `remote:revokeAll` («Quitar todos» con confirmación); auditoría `expired`/`revoked-all`/`policy-blocked`. `remote.bin` anterior se migra solo.
- **Política de la organización «fail closed»** (`org-policy.ts`, `tasks/policy.ts` exporta `policyFile`): bloque `remote` de `managed.json` (`enabled`, `allowRemember`, `requirePin`, `maxDevices`, `deviceTtlDays`, `allowConfirmRemember12h`), releído en caliente (al activar, en cada conexión y cada 5 s); `enabled:false` o archivo inválido corta y bloquea; Ajustes lo explica. Documentado en `docs/POLITICA-ORGANIZACION.md` y `docs/SEGURIDAD.md` §3 vicies quater.
- **Pruebas** (~45 nuevas): caducidad/renovación/migración/«revocar todos»/secreto fuera de estado y auditoría con reloj falso, política (rota, ausente, rangos, precedencia, ruta empaquetada, caliente), servicio (bloqueo en caliente, tope de plazo, `expired`), `PeerSession` (aviso `expiring`), protocolo y esquemas IPC.
- **Verificación del manifiesto de actualización**: ya se verificaban firma Ed25519, forma, versión/anti-downgrade, appId/keyId/tag, tamaño y SHA-256, entradas del ZIP, symlinks, `codesign` y rollback del reemplazo (cliente, `publish-update`/`verify-update` y sus pruebas). Faltaba una comprobación automática sin `.app` ni `ditto`: nuevo `npm run verify:update-manifest` (`scripts/verify-update-manifest.mjs`, 19 casos con clave efímera; `verify-update.mjs` exporta `verifyManifestAndZip`) y `src/main/update/manifest-script.test.ts` (paridad con el cliente real). Documentado en `docs/DISTRIBUCION.md` y `docs/VERIFICACION.md`.
- **Guía y diseño**: `AGENTS.md` (+ `CLAUDE.md` que remite) con las invariantes del proyecto; `docs/REMOTO-FASE2.md` (passkeys, Worker de señalización, TURN, push, PWA instalable; solo diseño).
- **Sin verificar**: nada con un celular real ni con Jamf/Intune; la PWA todavía no pinta el aviso `expiring` ni el `expired` (la rama de la PWA completa lo recogerá).

## F8-B58 — Interfaz de celular: `MobileShell`, `Sheet` y navegación en pila (rama `feat/remoto-movil-shell`, tanda T7)

En la superficie `remote` la interfaz deja de ser la de escritorio: una columna a pantalla completa con navegación inferior. En Mac y Windows no cambia nada (`App` elige `DesktopApp` o `MobileApp`; los efectos comunes pasaron a `useAppRuntime`).

- **`app/mobile/`**: `MobileShell` (Chat · Code · Tareas · Más; lista → conversación con botón atrás y botón/gesto «atrás» del navegador mediante `history`), `nav.ts` (`useMobileNav`/`useMobileNavStore`, una pila por pestaña, API estable para T8), `viewport.ts` (`visualViewport` → `--vv-height`/`--vv-top`/`--kb-inset`, el teclado no tapa el compositor), `MoreScreens.tsx` (Rutinas, Ajustes, «Este celular»: estado de la conexión, Bloquear ahora, Desvincular), `adapters.ts` (qué es «conversación abierta» en cada modo).
- **`components/mobile/Sheet.tsx`** (`Sheet({open,onClose,title,size?,children})`): hoja inferior modal (`role="dialog" aria-modal`, foco por `modal-focus.ts`, Esc, fondo, asa arrastrable, `prefers-reduced-motion`). **`components/PopoverPanel.tsx`**: punto de montaje común de menús (escritorio: el mismo `div`; celular: `Sheet`), aplicado al menú de las conversaciones de Chat. Los demás menús que aún no lo usan caen en un respaldo CSS (hoja anclada abajo).
- **CSS móvil** (`globals.css`, solo bajo `[data-surface='mobile']`): zona segura, objetivos ≥44 px (área ampliada con pseudoelemento), acciones de hover siempre visibles, campos a 16 px, texto más grande, sin tooltips/`kbd`/zonas de arrastre. Enter en el compositor inserta salto de línea (se envía con el botón).
- **Ajustes** básicos (`SettingsView` con `mobile`): solo General (tema, idioma) y Modelos (sin proveedores ni claves, sin bandeja/avisos/servidor).
- **Bloqueo manual** (protocolo, extensión mínima): trama de cliente `lock` (sin datos) → `AccessGate.lockNow()` (pide el PIN y no atiende ni lecturas hasta verificarlo); `RemoteLink.lock/forget` opcionales; «Desvincular» olvida el secreto local y recarga (no avisa al Mac).
- **Pruebas**: Sheet (aria, tamaños, pila de Esc, gesto), navegación, viewport, bloqueo manual (gate y protocolo) y «fuera de remoto no cambia nada». Verificación visual desechable con Chromium (390×844 y 360×800, claro/oscuro) y datos simulados; no se deja en el repo.
- **Sin verificar**: nada en iPhone/Android reales (teclado virtual de iOS, gesto atrás, zona segura, `capture` de cámara). Code (cambios, archivos, pickers) es T8.

## F8-B59 — Code en pantalla de celular (rama `feat/remoto-movil-code`, tanda T8)

Code deja de ser la interfaz de escritorio comprimida: en la superficie `remote` (PWA) tiene su propia estructura de una columna. Mac y Windows no cambian (los snapshots existentes siguen igual).

- **Estructura** (`MobileCode.tsx`, `mobile-store.ts`): lista de sesiones (proyecto abreviado con `~`, «Nueva sesión», menú «⋯» por sesión en una hoja: renombrar/fijar/archivar/eliminar) → conversación (MessageStream + Composer) con barra superior (volver, título, detener, Cambios, Archivos, más). `CodeWorkspace` solo entra aquí con `isRemoteSurface()`.
- **Hojas** (`components/mobile/Sheet.tsx`, **provisional**: stub mínimo hasta que se integre el de T7; al integrar se toma SIEMPRE la versión de T7): Cambios y Archivos a pantalla completa; ModelPicker, EffortPicker, modo de permisos, adjuntar y las confirmaciones en línea (`ConfirmButton`) como hoja.
- **Cambios**: lista a pantalla completa con ruta abreviada con `~` → diff unificado con ajuste de línea (nuevo `wrap` en `DiffView`, botón para apagarlo), «Descartar este bloque» de 44 px con la confirmación de siempre, commit con mensaje. Los encabezados de bloque ya no ensanchan la tabla.
- **Archivos**: árbol táctil (filas de 48 px, menú «⋯» por fila), visor de solo lectura con resaltado ligero y la ruta abreviada, crear/renombrar/borrar de UN archivo; carpetas = «se confirma en el Mac» (con aviso y «Esperando tu confirmación en el Mac…»). «Abrir en…» ya no se ofrece en el celular (`editors:open` es X).
- **Composer**: barra de 44 px (adjuntar, @, detener, enviar) y una fila de modelo/esfuerzo/permisos que se oculta con el teclado; Enter = salto de línea; tocar un botón no quita el foco del campo (si no, la barra se movía y se perdía el toque); adjuntos con `<input type=file accept="image/*,application/pdf,text/*">` y otro con `capture` para la cámara → partes `data:` con los límites de `lib/attachments.ts` (nunca `file://`: `doSend` filtra por si acaso); cola de mensajes con botones de 44 px.
- **Permisos**: solo «una vez»/«rechazar» (nunca «siempre»); los tipos que el Mac confirma (`external_directory`, `doom_loop`, desconocidos) muestran «Apruébalo en el Mac» y solo permiten rechazar. La regla vive en `src/shared/remote/mac-confirm.ts`; `mac-confirm-parity.test.ts` la compara con `decide()` de la política real.
- **Navegador del agente**: `BrowserSnapshotView` (solo vista: `browser:state` + `browser:capture`, ambos R en la política); sin barra de URL ni toque.
- **CSS** (`mobile.css`, colgado de `[data-surface='mobile']`): lo que solo aparece con hover se ve siempre, botones de acción de mensaje de 44 px, letra de 16 px en campos (iOS no amplía la página), diálogo de confirmación con botones de 44 px. «Ir al final» sube a 44 px.
- **Pruebas** (nuevas): ruta abreviada, qué acciones piden el Mac (y paridad con la política), límites de adjuntos y `file://`, ajuste de línea del diff, tarjeta de permisos en ambas superficies, escritorio sin cambios.
- **Sin verificar**: nada con un iPhone/Android real (teclado virtual, `capture`, HEIC/fotos > 5 MB que se rechazan sin reducir, gestos); verificación visual solo con Chromium (390×844 y 360×800, claro/oscuro) y un arnés desechable (núcleo real + motor falso, WebSocket en vez de WebRTC).

## F8-B60 — Celular integrado: una sola navegación y una sola cabecera (rama `feat/remoto-movil-reconciliar`)

Reconcilia el armazón (F8-B58) con Code para celular (F8-B59), que se habían hecho por separado y duplicaban cabeceras y listas. Mac y Windows no cambian (snapshots y pruebas existentes intactos).

- **Reparto**: el armazón (`MobileShell`) es dueño de la pila de navegación y de la ÚNICA barra superior. En Code, la lista de sesiones es la del armazón (`CodeSidebar`); el detalle monta solo la conversación (`ChatColumn` + compositor), sin lista ni barra propias. Se eliminan `mobile-store.ts`, `MobileToolbar`, `MobileCodeLayout` y la pantalla de sesiones de T8.
- **Barra única de Code**: título de la sesión, rama + ruta como subtítulo y acciones Cambios, Archivos y «⋯» (44 px). En la lista: «proyectos recientes» y «+». Detener sigue en el compositor (ya tenía su botón de 44 px).
- **Cambios, Archivos y navegador del agente** son pantallas de la pila (`code:changes|files|browser`) a pantalla completa con su título en la barra única; el menú «⋯» es una hoja que también es una entrada de la pila (`code:actions`). La conversación queda montada debajo (conserva scroll y borrador). El gesto/botón «atrás» las cierra antes de volver a la lista.
- **Historial** (`nav-history.ts`): siempre hay `profundidad − 1` entradas propias de la pestaña activa; al cambiar de pestaña con la pila apilada se retiran con `history.go(-n)` (su `popstate` se ignora) y se reponen al volver. Antes el primer «atrás» desde la raíz podía no hacer nada.
- **Cabeceras duplicadas** de Rutinas y de Proyectos (selector de carpeta) eliminadas en el celular; Rutinas conserva el resumen y «Nueva» en una fila fina. Cerrar o cambiar de proyecto devuelve Code a su lista.
- **Zona segura**: el armazón es el único que añade el margen inferior (`--sab`, que se anula con el teclado) y el superior; se quitaron los de `Composer` y `ChangesPanel` que se sumaban.
- **Hallazgos de F8-B58/59**: (1) con la cola abierta la altura de la lista cambia sin que se vuelva a pegar al final → ahora, en el celular, un `ResizeObserver` mantiene el final visible si ya estaba pegado; (2) un permiso/pregunta nuevo lleva siempre la lista al final aunque hayas subido. Solo en superficie remota. Pendiente: las hojas modales sueltas (menú «⋯» de una sesión, selector de modelo) no tienen entrada en el historial: «atrás» con una abierta desapila la pantalla de debajo.
- **Peso de la PWA** (`scripts/build-pwa.mjs`, ahora cuenta también el CSS `boot-*.css` y muestra los perezosos): arranque 391,1 KB gzip (el recuento anterior omitía 16,6 KB de CSS: 374,5 KB con el método viejo); perezosos 150,1 KB (Ajustes 35, Tareas 34,8 + lista 9,8, inglés 50, Rutinas 10,6…). Cambios/Archivos no se pueden separar sin tocar el diseño de escritorio (lo importa de forma estática).
- **Pruebas**: `nav-history.test.ts`, `MobileShell.render.test.tsx` (una cabecera y una lista, Cambios/Archivos en la pila, atrás, cambio de pestaña, cerrar proyecto) y navegación (`replace`, `resetTab`). Verificación visual desechable con Chromium (390×844 y 360×800, claro/oscuro) sobre el núcleo real y un motor falso; no se deja en el repo.
- **Sin verificar**: nada en iPhone/Android reales (gesto atrás del sistema, teclado virtual, zona segura real); en Chromium el «atrás» se probó con `history.back()`.

## F8-B62 - Hojas, diálogos y avisos del celular (HOJAS)

- `Sheet.tsx`: salida animada 220 ms (`animate-sheet-down` + velo `animate-fade-out`), entrada 320 ms con `--ease-sheet` (`animate-m-sheet-up`), temporizador de cierre seguro de 300 ms que se cancela si se reabre, velo con `--m-backdrop` que baja al arrastrar, vuelta animada al soltar, asa 36x5, radio `--m-radius-sheet`, título centrado.
- `PopoverPanel` y `ModelPicker` (celular) pasan `open` a la hoja para animar la salida; el escritorio no cambia. Selector de modelo: filas y cabeceras con atributos `data-model-*` (CSS móvil).
- `ConfirmDialog`: atributos `data-confirm-*` solo en el celular; CSS en `features/code/impl/mobile.css` (scrim `--m-backdrop` también en oscuro, botones apilados de 50 px). `RemoteConfirmHost`: detalle con tope y scroll, botones siempre visibles.
- `components/mobile/Toast.tsx` (`showToast`, `MobileToastHost`); el host lo aloja `ConfirmDialogHost` (no pinta nada en escritorio).
- Nota: `--animate-sheet-up` global no se cambia (lo vigila `desktop-unchanged.test.tsx`); la hoja usa `--animate-m-sheet-up`.

## F8-B63 — Capa ligera de la PWA (arranque, vinculación, PIN, carga)

- `pwa/src/ui.ts`, `style.css`: columna de estado común (88 px, pilas `.stack`), pasos numerados de vinculación, código en 6 casillas, teclado de PIN propio (teclas de 72/64 px, envío automático, dos pasos al crear con `lock.set.again`, sacudida en error, cuenta atrás, el PIN solo vive en memoria; lógica pura en `src/shared/remote/pin-pad.ts`), pastilla de reconexión flotante (única: oculta con la interfaz completa montada; la de «esperando al Mac» queda bajo la cabecera), esqueleto del armazón al cargar, lista de respaldo agrupada por fecha con aviso y «Reintentar», toast con salida suave.
- Rendimiento: P1-1 (`prefetchFullApp`: `modulepreload` durante WebRTC/PIN, `entry.json` v1/v2 con `preload` y `bootCss`, una sola lectura), P1-2 (`remote/main.tsx` no espera `settings:get` si hay `onyx.langPref`), P1-5 en `main.ts` (`hiddenAt`; pasa el tiempo oculto a `client.wake(away)`).
- Pruebas: `pin-pad.test.ts`, `pwa-i18n.test.ts`, `remote/full.test.ts`.

## F8-B61: armazón y listas del celular (SHELL)

- Barra inferior de 56 px con píldora activa (tocar de nuevo la pestaña activa sube al principio, oculta con el teclado abierto), cabecera de 52 px con título grande en las listas y filete solo al desplazar, transiciones de pila y pestañas con dirección (`fill-mode: backwards`, sin animación tras el gesto atrás del navegador), foco al `<h1>` tras apilar/desapilar, zona segura lateral y desplazamiento de cada lista recordado.
- Aviso de conexión único (reconectando / sin conexión / «Conectado de nuevo» 1,8 s) con región viva; `modeFor` de la capa ligera ya no deja la pantalla vacía mientras carga la interfaz.
- «Más», «Este celular» y Ajustes como listas agrupadas (`ListGroup`/`ListRow`), pie «Se aplica también en tu Mac» en tema e idioma.
- Lista de conversaciones: búsqueda visible, filas de 56 px, cabeceras fijas, estado vacío con «Nuevo», `SwipeRow` (nunca borra con el gesto: pide confirmación) y pulsación larga; mismo gesto en las sesiones de Code; menú de Tareas anclado abajo (no se sale a 360 px); esqueleto en lugar de `null` en las pantallas `lazy/`.
- Pruebas nuevas: `shell-logic`, `MobileShell.chrome`, `MoreScreens.render`, `SwipeRow`, `MobileSessionList.render`. El escritorio no cambia.

## F8-B64 — Conversación móvil (Chat y Code en la PWA)

- Scroll con intención táctil (`use-stick-to-bottom.ts`: `touchstart` suelta el pegado, `touchend`/`scrollend` reasientan, salto previo en distancias largas con `jumpTarget`); «Ir al final» de 40 px con punto de contenido nuevo.
- El Chat ya no abre el teclado al entrar; compositor en píldora de 24 px, botones de 36 px, altura máxima 38 % de lo visible (`mobileComposerMax`), pie de modelo en segunda fila sin foco; saludo vacío con sugerencias en fila. Code: píldora de 24 px y botones de 36 px.
- `app/mobile/conversation.css` (todo bajo `[data-surface='mobile']`): respuesta 16/1.6, metadatos 14, código 13 con scroll horizontal, tablas, burbuja del usuario; ganchos `m('user-bubble'|'meta'|'pending-card')`. Columna con gutter de 16 px.
- Herramientas: Chat reutiliza `ToolRow` (sin JSON crudo); filas de 44 px, sin sangría al expandir, salidas a `40dvh`.
- Mantener pulsado (`use-long-press.ts`, `MessageActionsSheet`) con Copiar / Seleccionar texto / Editar / Reintentar / Bifurcar / Revertir; acciones visibles solo bajo la última respuesta.
- Tarjeta de permiso: Rechazar a la izquierda y Permitir a la derecha; `PendingBar` «Aprobación pendiente»; indicador único de «pensando» (`ThinkingIndicator` movido a `components/conversation`); visor de imágenes; botones táctiles en `ErrorNotice`; `DeferredMarkdown` (`useDeferredValue` en streaming); las filas del historial ya no animan al cargarse.
- Escritorio sin cambios (snapshots intactos). Pruebas: `use-stick-to-bottom`, `viewport`, `use-long-press`, `conversation`, `ChatComposer.mobile`, `ChatMessageList.mobile`, `MessageStream.mobile`, `MobileCode.render` (ampliada). Pendiente: P1 `legacyCopy` (P2-B) y P2-C (medir en iPhone real).

## F8-B65: rendimiento de la PWA móvil (arranque 391 → 269 KB gzip)

- **Resaltado perezoso** (`components/highlight-plugins.ts`, `remote/shims/highlight-lazy.ts`, `hljs-deferred.ts`): `rehype-highlight` y highlight.js salen del arranque; se bajan en un rato ocioso tras pintar. El escritorio sigue con la versión estática.
- **Sin código de escritorio** vía `remote/swaps.ts` (Sidebar, CommandPalette, UpdateNotice, RemotePairHost, RemoteConfirmHost, `keybindings/dispatch`). Prueba `swaps.test.ts`: cada SWAP existe, el especificador está escrito tal cual en el importador y el shim exporta lo que ese importador usa (un SWAP mal escrito ya no falla en silencio).
- **Paneles Cambios/Archivos/Navegador y Markdown perezosos** (`remote/lazy/*`, con esqueleto o texto plano de respaldo).
- **Diccionario `es` partido** (`i18n-split.ts`, `i18n-core-keys.json`, `registerMessages`): `main` pasa de 60 a 21 KB gzip; el resto (~31 KB) lo bajan Ajustes/Tareas/Rutinas, y un `t()` sin clave en el núcleo baja el resto y repinta. Prueba obligatoria `i18n-core.test.ts` (recorre el grafo de la build y exige cobertura de claves; núcleo + resto == área original). Regenerar: `UPDATE_PWA_I18N=1 npx vitest run src/renderer/remote/i18n-core.test.ts`.
- **Markdown por bloques memoizados** mientras se escribe (`splitMarkdownBlocks`; plan B ante referencias, notas y HTML; análisis completo al terminar). Pruebas de equivalencia con prefijos (`Markdown.blocks.test.tsx`) y de coste (`Markdown.perf.test.tsx`, ~37x menos por delta).
- **Brillo «pensando»** en el celular con pulso de opacidad (compositor) en vez de `background-position`.
- `entry.json` v2 (`preload`, `bootCss`), marcas `onyx:*` y `__onyxPerf()`, presupuesto 300 KB (`pwa/budget.json`).

## F8-B66: protocolo v3 del control remoto, autenticación mutua ligada a las huellas DTLS (RECONEXION)

Cambio de seguridad. Plan: `scratchpad/plan-remoto-reconexion.md`; auditoría: hallazgos 3, 4, 6, 8 y 11 (el 2, aprobar `bash` «una vez» desde el celular, NO se toca: lo decide el dueño). Detalle y riesgo residual en `docs/SEGURIDAD.md` §3 tricies.

- **Paso previo verificado con la librería real**: libdatachannel (`node-datachannel` 0.33.4) comprueba la huella DTLS del SDP contra el certificado del par en los dos sentidos (`rtc-fingerprint.test.ts`: con una huella falsa en el offer o en el answer el canal no abre). Defensa en profundidad en `rtc.ts` (`remoteFingerprint()` contra el offer).
- **Handshake v3** (`src/shared/remote/handshake.ts`, TypeScript puro, HKDF/HMAC con `@noble/hashes`; vectores calculados aparte con Python): `hs1/hs2/hs3` en los dos modos, ninguna credencial viaja, el Mac prueba quién es (`proof` en `authed`/`pair-pending`/`auth-failed{expired}`) antes del PIN. Claves: `HKDF(sha256(secreto))` (los celulares ya vinculados siguen sirviendo) y `HKDF(q)` para el QR. Huellas estrictas (`sdpFingerprintStrict`: una sola `sha-256`, varias distintas = rechazo). Código de 6 dígitos con compromiso previo (commit-reveal).
- **H4**: intermediario, repetición, reflejo, compromiso roto, clave de relleno y huellas distintas o no `sha-256` probados en `handshake.test.ts`, `peer-session.test.ts` y `service.test.ts` (con el `ClientHandshake` real a través de tramas validadas en los dos sentidos).
- **H8** (`pairing.ts`): el `hello` lleva `qid`, un `qid` ajeno no consume el QR, 5 fallos lo anulan («El código QR se anuló tras varios intentos fallidos»), solo `hs3` correcto lo consume, un único intento en curso.
- **H11**: el plazo de validez se renueva al abrir el acceso (PIN o reconexión en caliente), no al presentar la clave.
- **H3**: el bloqueo (manual o por inactividad) cierra las suscripciones abiertas (`Mux.endSubs`, descarte de eventos en cola, `canEmit`); el cliente trata el `res` de error de una suscripción lista como cierre normal.
- **H6**: «Cortar todo» y «Quitar todos» borran «Recordar 12 h» y la actividad reciente.
- **Confirmación por conexión opcional**: ajuste «Pedir confirmación en el Mac en cada conexión» (apagado por defecto, `remote:setConfirmEach`) y política `requireConnectionConfirm` en `managed.json` (ausente `false`, valor raro o archivo inválido `true`). Un dispositivo sin PIN siempre confirma; vincular siempre se confirma. **Cambio de comportamiento a anotar en las notas de versión (es/en).**
- **PWA** (`client.ts`, `rtc.ts`): `q` no sale del celular, verifica la prueba del Mac antes de aceptar tramas o pedir el PIN, los fallos sin prueba no borran credenciales («No se pudo verificar tu Mac», «Tu Mac no reconoció este celular», «Vínculo caducado»), recarga automática una sola vez ante «versión incompatible» y `wake(awayMs)` (reconexión inmediata tras 15 s oculta; sondeo de 2 s).
- Protocolo `PROTOCOL_VERSION = 3`: `auth` desaparece, `hello` de vinculación con `qid`; una pestaña anterior recibe `version` (también con un `hello` de forma antigua). Auditoría `auth-bad-proof`.
- Docs: `docs/SEGURIDAD.md` (frase «solo viaja por DTLS» corregida; secciones B53–B60 reordenadas antes de §4 y renumeradas `vicies bis…novies` sin duplicados, B66 = `tricies`; las entradas anteriores de este changelog que citan «vicies ter/quater/quinquies» usan los nombres antiguos), `POLITICA-ORGANIZACION.md`, `REMOTO-FASE2.md`, `REMOTO-PRUEBA-MANUAL.md` (pasos 0–0f) y `AGENTS.md` §8.
- Pruebas: `handshake`, `protocol`, `pairing`, `peer-session`, `peer-session-access`, `service`, `service-access`, `devices-store`, `org-policy`, `audit`, `mux`, `events-hub`, `rtc-fingerprint`, `lan-server`. Pendiente: la prueba manual del dueño (iPhone ya vinculado, «Versión incompatible», vinculación nueva, «Bloquear ahora» con el chat abierto) y la comprobación de que el SDP real de Safari/Chrome cumple la huella estricta.

## F8-B67: arreglos de seguridad de la auditoría del control remoto

Corrige los hallazgos 1, 5, 7, 9, 10 y 12 de la auditoría del remoto v3 (el 2 —aprobar `bash`/`edit` «una vez» desde el celular— queda a decisión del dueño; 3, 6, 8 y 11 pendientes). Cada arreglo tiene una prueba que reproduce el ataque y fallaba antes (comprobado revirtiendo el código).
- **1**: el filtro de archivos sensibles cubre `tasks:previewFile`, `git:diff` (con `path` y filtrando la respuesta por bloques), `GET /vcs/diff`, `/vcs/diff/raw`, `/session/{id}/diff`, `/file/status`, `summary.diffs` y el evento `session.diff` (`diff-filter.ts`); lista ampliada con `.envrc`, `.env-*`, `.env_*`, `*.tfvars`, `.vault*`. Pruebas: `engine-proxy.test.ts`, `diff-filter.test.ts`, `path-guard.test.ts`.
- **5**: los diálogos muestran `patrones`, comando/rutas del permiso, reglas de sesión, prompt y horario de rutinas y contenido de AGENTS.md/memoria, con tope de 240 caracteres y 12 líneas, sin saltos ni secretos (`confirm-detail.ts`, también en `ConfirmQueue`). Pruebas: `policy.test.ts`, `confirm-queue.test.ts`, `engine-proxy.test.ts`.
- **9**: `settings:get`, `tasks:trusted:list` y `tasks:policy` salen sin `opencodeBin` ni rutas fuera del ámbito (`sanitizeResult` con predicado de ámbito).
- **10**: `git:createWorktree` pasa a X; `routines:delete/toggle(off)`, `tasks:tasks:forget` y `tasks:restore:forget` se acotan al ámbito; toda acción M ejecutada deja `action-run` (canal y clase) en `remote-audit.jsonl` (i18n es/en de la actividad).
- **7**: una llamada D idéntica a otra pendiente responde `busy` (una aprobación, una ejecución) y el digest se compara con el de lo que de verdad se ejecuta (IPC: payload validado en `authorize`, de un solo uso; HTTP: lo enviado al motor frente a una copia tomada al confirmar).
- **12**: `docs/SEGURIDAD.md` (§3 vicies marcada como histórica y corregida, nueva §3 tricies bis) y `docs/REMOTO-FASE2.md` (el secreto está en `localStorage`).
Pendiente: `src/test/opencode-contract.test.ts` falla en este árbol por la instantánea de `api-routes.json` (ajena a esta tanda); prueba manual de los diálogos nuevos en el Mac.

## F8-B68: seguridad del navegador integrado y de «Abrir en el editor»
- **SSRF local**: `isLoopbackOrPrivateHost` clasifica por la IP real (`ip-class.ts`: IPv6 mapeada/NAT64/6to4, ULA, link-local, 0.0.0.0/8, CGNAT, multicast, metadatos de nube, `*.localhost`) y `webRequest` bloquea nombres que resuelven a IP local (anti-rebinding, salvo origen «siempre»).
- **Puerta de aprobación**: `window.open`/`target=_blank` pasan por `resolveNavigationApproval`; el bypass pasa de «por pestaña, 2 s/toda la carga» a URL exacta y un solo uso (`nav-bypass.ts`), así que las redirecciones a otro destino vuelven a pasar por la puerta.
- **`clipboard-sanitized-write`** solo para el origen https (o http local) de la página de nivel superior.
- **`dialog:openInEditor`**: `realpath`, contención al proyecto activo/reciente y `assertSafeToOpen` en los respaldos `open`/`openPath`.
- Pruebas: `session.test.ts`, `nav-bypass.test.ts`, `dialog/service.test.ts`. Detalle y límites (TOCTOU de DNS) en `docs/SEGURIDAD.md` §3 tricies ter. Pendiente: prueba manual en la app (redirección y `window.open` con el agente).

## F8-B69: seguridad de Tareas, MCP y credenciales (6 hallazgos de la revisión externa)
- **5**: `mcp:getConfig` y las respuestas/eventos de cambios de MCP entregan `headers`/`environment` enmascarados; `mcp:save` restituye el secreto guardado si el valor llega enmascarado.
- **6**: el token del MCP del navegador se revoca al terminar el servidor de Tareas (y un relanzamiento invalida el anterior). Los tokens siguen en el entorno de `opencode serve`: pendiente denegar `process-info` en Seatbelt o un proxy MCP (no se tocó `sandbox*`).
- **7**: `tasks/host-rules.ts` valida `setHost(allow)` y `allowOnce` (sin TLD, sufijos públicos, comodines amplios ni IP privadas).
- **8**: `pty:create` con lista cerrada de shells (`ipc/pty-shell.ts`) y `cwd` absoluto sin `..`.
- **9**: `CredentialProxy` normaliza y rechaza `..`, `%2e%2e`, `//`, `\` y doble codificación antes de reenviar.
- **10**: revocación del token del navegador y patrón/secretos exactos en el redactor de Diagnóstico.
- Pruebas nuevas en cada ruta (ver `docs/SEGURIDAD.md` §3 tricies quater). Pendiente: prueba manual del formulario de MCP con valores enmascarados.

## F8-B70: preparación de publicación sin credenciales (columna A del plan)

Todo lo que se podía dejar listo sin certificados, claves ni repositorio; nada empaquetado, notarizado ni subido. Pruebas: `npm run test:release-scripts` (node:test con dobles) y vitest en `src/main/update`.
- **Firma** (`build/sign-common.js`, `notarize.js`, `notarize-dmg.js`, `electron-builder.js`): notarización con clave API (`APPLE_API_KEY` ruta del `.p8` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`, prioritaria) o Apple ID; credenciales a medias fallan nombrando lo que falta; el `.dmg` se notariza y graba con `notarytool` + `stapler` (hook `afterAllArtifactBuild`; la contraseña de app viaja como `@env:`); con Developer ID los helpers `cu-helper` y `onyxcode-disclaim` se vuelven a firmar con `HELPER_ID`/`DISCLAIM_ID` + hardened runtime antes de notarizar (el camino autofirmado conserva sus argumentos exactos). Con `CSC_LINK` hace falta además `CSC_NAME`. Pruebas: `scripts/release-build.test.mjs`.
- **`npm run verify:signed`** (`scripts/verify-signed.mjs`, `--expect adhoc|self|devid`, `--dry-run`): codesign, identificadores, runtime, `spctl` y `stapler`. Contra el `dist/` actual detecta que `cu-helper` y `onyxcode-disclaim` llevan identificador derivado (build anterior al gancho).
- **Actualizador** (`src/main/update`): `UPDATE_TEAM_ID` en `config.ts` (vacío = sin cambio; con valor, `codesign -R` del equipo y falla cerrado si está mal formado; en `src/shared/brand.ts` no se tocó), `updateKeys` extra en `resolveInstallConfig` (rotación), canal beta como lógica pura (`channel.ts`, `UpdateChecker({channel})`, sin interfaz) y publicación en dos pasos: `publish-update.mjs --manifest-only` + `scripts/sign-update.mjs` (comprueba tamaño/SHA-256/appId/keyId/clave y firma en el Mac del dueño). Pruebas: `manifest-two-step`, `installer-team`, `channel`, `checker`.
- **CI** (`.github/workflows`): `ci.yml` sin secretos ni E2E; `release.yml` solo crea un BORRADOR, con entorno `release` de aprobación manual, permisos mínimos y acciones fijadas por SHA; la clave Ed25519 no está. Guardias en `scripts/workflows.test.mjs`.
- **Docs y avisos**: `docs/RELEASE.md` (checklist, rollback siempre hacia delante, rotación de claves y de certificado), `docs/DISTRIBUCION.md` (clave API, `.dmg`, `verify:signed`, SmartScreen/Windows), `CHANGELOG.md` + `scripts/release-notes.mjs` (cuerpo de la release), `scripts/rename-app.mjs --dry-run` (solo simula) y `THIRD_PARTY_NOTICES.md` alineado con `LICENSE` (MIT) con la comprobación en `verify:release` (que además dejó de dar un falso positivo con `swap.sh`).
Pendiente: lista de claves en `brand.ts` y su cableado en `ipc/update.ts`, `validateManifest` con prereleases y la opción de Ajustes del canal beta (fuera del alcance de esta tanda: `src/shared`, `src/main/ipc`, interfaz); confirmación de licencia y nombre por el dueño; todos los pasos de la columna B.

## F8-B71: elegir un elemento del navegador y enviarlo al chat (lado main, `PickedElement` v2)

- **Contrato** (`src/shared/ipc-browser.ts`): `PickedElement` pasa a `v: 2` con `selector` único y robusto, `path` (migas de pan de hasta 4 ancestros), `html` saneado ≤ 4 KB, `styles` (lista cerrada `PICK_STYLE_PROPS`, ≤ 40, sin valores por defecto ni `url()`), `rect` + `viewport {width,height,dpr}`, `url` sin query ni fragmento, `title`, `image?` (JPEG recortado al elemento, lado largo ≤ 800 px y ≤ 300 KB), `diagnostics?` (últimos 10 errores de consola y 10 de red con `status >= 400` o `net::ERR_…`, ≤ 3 KB) y `flags {sensitive, truncated}` + `redactions`. Topes en `PICK_LIMITS`. `browser:picked` conserva nombre y carga `{owner, tabId, element}`: **ningún canal IPC nuevo**, ningún método CDP nuevo (`ALLOWED_CDP` idéntica, fijada por hash en `pick.test.ts`) y el preload `browser-host` queda con el mismo SHA-256 (`0bcc0e0b…daed73` antes y después de `electron-vite build`; no importa nada de `@shared`).
- **Saneado doble**: en la página (`pick-script.ts`, `pickInPage`, mundo aislado, serializa sin tocar el DOM) y en main (`pick.ts`, `sanitizePickedHtml`, puro e idempotente). Nunca salen: `value=`/`checked`/`selected`, el texto de un `<textarea>`, `input[type=password|hidden]` ni `autocomplete=cc-*|one-time-code|current-password|new-password` (se sustituyen por `<input type="…" data-onyx-redacted>`), `on*`, `srcdoc`, `nonce`, `integrity`, `style`, `srcset`, atributos con nombre de secreto (`token|secret|key|auth|pass|csrf|…`), query/fragmento de `href/src/action/…`, `data:`/`blob:`/`javascript:` reducidos, `<script>/<style>/<template>/<noscript>`, trazados de `<svg>` ni comentarios. Todo texto y valor de atributo pasa por `redactSecrets`. Un elemento que es o contiene un campo sensible, o un campo con texto escrito, marca `flags.sensitive` y no lleva captura. Profundidad 4 y 20 hijos por nodo (los aplica la página; main repite el tope de 4 KB, cortando en una etiqueta completa).
- **Captura** (`planElementClip`/`captureElementImage`): `Page.captureScreenshot` con `clip` (margen de 8 px, scroll sumado) tras apagar el resaltado; calidad 80 y, si pesa > 300 KB, 60; si aun así no cabe, sin imagen. Se omite con área 0, lado corto < 8 px o `sensitive`.
- **Diagnóstico** (`pick-diagnostics.ts`, nuevo, en vez de ampliar los búferes de `tools.ts`): se activa al entrar en el modo selección y solo escucha eventos (`Runtime.consoleAPICalled`, `Runtime.exceptionThrown`, `Log.entryAdded`, `Network.*`; `Runtime/Log/Network.enable` ya estaban permitidos). Se descarta lo anterior a la activación aunque `Runtime.enable` lo reenvíe.
- **Servicio** (`service.ts`): `setPicking` no arranca si `control === 'agent'` y la selección se cancela al navegar (primer nivel), cambiar o cerrar la pestaña, ocultar el panel, abrir una pestaña nueva o cuando el agente toma el control; Esc cancela (`before-input-event` en `surface.ts`, `isCancelKey` en `keys.ts`; se traga la tecla solo si hay selección). Un elemento dentro de un marco avisa con `merr.browser.pickIframe` (es/en). Antes de emitir, main valida el elemento con `PICKED_ELEMENT_SCHEMA` (`src/main/ipc/schemas.ts`, estricto; no es un canal invoke).
- **OpenCode 1.18.33 fijado** (lectura del paquete, sin ejecutar modelos): el esquema de `TextPart` guarda `synthetic`, `ignored` y `metadata: Record<string, any>`; el propio TUI envía partes de texto `synthetic:true` con `metadata` (`kind:"editor_context"`) para el modelo y no se vio ningún filtro de `synthetic` al construir los mensajes del modelo (solo la interfaz y el título de la sesión las ignoran). Conclusión: las partes sintéticas con `metadata` son viables; plan B documentado (marcador `[Elemento de la página]` en la primera línea) por si una prueba real lo desmiente.
- Pruebas: `embedded-browser/pick.test.ts` (saneado, idempotencia, topes, esquema, hash de `ALLOWED_CDP`), `pick-script.test.ts` (la función serializada, sobre un DOM de prueba), `pick-diagnostics.test.ts`. Sin E2E (no se abrió Electron).

## F8-B72: elegir un elemento del navegador y enviarlo al chat (lado interfaz)

- **Chip en el compositor** (Code y Tareas; `features/browser/ElementChip.tsx`, `ElementDetailPopover.tsx`): etiqueta `<tag> selector corto`, `host · ancho×alto`, insignia «N errores», botón quitar y detalle con selector, ruta (con «Copiar»), HTML saneado, estilos, captura y diagnóstico. Casillas «Incluir captura» e «Incluir errores de consola y red» (marcadas por defecto; con `flags.sensitive` la captura nunca se incluye y su casilla queda desactivada); avisos «Se omitieron N datos» y de campos sensibles. El texto del compositor ya no se rellena: el elemento es un adjunto (`Attachment` pasa a unión archivo | elemento; máx. 3 elementos por borrador). Región `aria-live` («Elemento añadido»), `role="dialog"`, foco al abrir y al cerrar, Esc cierra solo el detalle. En el celular el detalle es una hoja (`PopoverPanel`).
- **Envío** (`element-context.ts`, `doSend` de Code y `sendToTask`): una parte de texto `synthetic:true` con `metadata:{kind:'browser_element', v:2}` cuyo texto empieza EXACTAMENTE con `[Elemento de la página]` (plan B acordado: la burbuja también lo reconoce solo por el marcador) con url, selector, ruta, HTML, estilos y diagnóstico, ≤ 8000 caracteres (recorta HTML, luego estilos y diagnóstico); y la captura como parte `file` `data:image/jpeg` solo si la casilla está marcada y el elemento no es sensible (tope de `PICK_LIMITS.imageBytes`). Las etiquetas del bloque son fijas en español (es un prompt, no cambia con el idioma de la interfaz). Reintentar/editar un mensaje conserva el bloque. Desde el celular (política `{type,text}` del remoto) el bloque sale sin `synthetic`/`metadata`.
- **Burbuja del usuario** (Code, Chat y Tareas, escritorio y celular): chip compacto `<tag> selector · host` con el mismo detalle de solo lectura; el volcado nunca se pinta y una parte sintética sin el marcador sigue oculta.
- **Selección**: aviso bajo la barra («Haz clic en un elemento… · Esc para cancelar»), botón desactivado con el agente en control (`title` según el estado), Esc con el foco en la interfaz llama a `browser:pick {on:false}` (sin disparar «detener» del agente) y enviar un mensaje la apaga (`pick-state.ts`).
- Textos es/en `browser.pick.*`, `browser.element.*`, `browser.url.pickCancel` (más `i18n-core-keys.json` de la PWA); `ElementChip` y `ElementDetailPopover` en `MIGRATED`.
- Pruebas: `element-context.test.ts` (saneado que llega al texto, tamaños, `include`, `flags.sensitive`, lectura inversa), `ElementChip.render.test.tsx`, `pick-state.test.ts`, `MessageStream.element.render.test.tsx` (Code y Chat), `store.element.test.ts` (partes enviadas, celular), `tasks/impl/elements.test.ts`. Sin E2E ni Electron.
- Pendiente: Chat no tiene navegador (el dueño del evento es Code o Tareas), así que su compositor no recibe elementos; solo muestra el chip en la burbuja. Editar y reintentar en Tareas no reenvía el elemento. Prueba manual en la app (clic real, foco del popover, hoja del celular).

## F8-B73: distribución gratuita para macOS (instalador, tap de Homebrew y guía)

- `scripts/install/install.sh` (POSIX, sin sudo): comprueba macOS arm64, descarga `.dmg` + `SHA256SUMS`, verifica SHA-256, copia la app a un temporal, exige que `codesign -d -r-` contenga el hash fijado `c778a963…` y solo entonces instala en `/Applications` o `~/Applications`; quita la cuarentena, desmonta y limpia con `trap`. Opciones `--version`, `--dry-run`, `--no-open`, `--uninstall` (nunca toca `~/Library/Application Support/OnyxCode`), `--help`. Mientras `RELEASES_REPO_DEFAULT` sea `PENDIENTE` (y sin `ONYXCODE_RELEASES_REPO`) se niega a ejecutarse.
- `scripts/install/make-cask.mjs` genera `packaging/homebrew-tap/Casks/onyxcode.rb` (`postflight` con `xattr -dr com.apple.quarantine`, `depends_on arch: :arm64`, `zap` sin datos); la cask incluida lleva marcadores `PENDIENTE`. No se creó ningún repositorio ni release.
- `docs/INSTALAR.md` (tres vías, aviso de primera apertura, verificación, desinstalar sin perder datos).
- Pruebas: `install.test.mjs` (12, con dobles de curl/hdiutil/codesign/shasum/ditto/xattr/uname) y `make-cask.test.mjs` (5), incluidas en `npm run test:release-scripts`. Sin red, sin Electron.
- Pendiente (dueño): ver informe; prueba real del script en un Mac con el `.dmg` publicado.

## F8-B75: sandbox de Tareas sin `process-info*` ajeno y tarjeta de escalada con tokens del tema

- `tasks/sandbox-profile.ts`: `(deny process-info*)` + `(allow process-info* (target self))`; probado con `sandbox-exec` real (`sandbox-profile.procinfo.test.ts`) y con `opencode serve` real (sin modelos). Snapshot de `sandbox-profile.test.ts` editado a mano (solo +5 líneas por caso; sin `-u`).
- Hallazgo: `KERN_PROCARGS2` (`ps eww`) no es denegable con Seatbelt en esta macOS; el hallazgo 6 de F8-B69 sigue abierto en esa parte (ver `docs/SEGURIDAD.md`).
- `EscalateCard.tsx`: `amber-*` fijos sustituidos por `warning` (token del tema, contraste AA en claro/oscuro); sin prueba axe ni snapshot de ese componente, no hubo que actualizar ninguno.

## F8-B74: aprobar comandos desde el celular ya no es automático (hallazgo 2 de la auditoría del remoto)

- `permission.reply «once»` de `bash`, `edit`, `external_directory`, `webfetch`, `task` y Control del Mac pasa de M a **D** (confirmación en el Mac con el comando o ruta exactos); `reject` sigue M, `always` nunca. `ONCE_SAFE_PERMISSIONS` (política y espejo `shared/remote/mac-confirm.ts`) ya no incluye `edit`, `bash`, `webfetch` ni `task`.
- Ajuste por dispositivo `canApproveCommands` (`devices-store.ts`, apagado por defecto, migración sin tocar `remote.bin`): se enciende solo en el Mac con diálogo nativo propio (`remote:setApproveCommands`, X para el celular), se apaga en Ajustes › Celular o con «Cortar todo»; auditoría `approve-enabled`/`approve-disabled`.
- Con el ajuste encendido, `bash`/`edit` se aprueban desde el celular solo si pasan `command-denylist.ts` (evaluada sobre el texto del motor, con `realpath`; ofuscaciones, expansiones y duda → D), con tope de 20 por celular y hora (`approval-limit.ts`) y `approve-command` en la auditoría (sin el texto). La lista es heurística, no un límite: documentado en `docs/SEGURIDAD.md` §3 tricies quinquies.
- La tarjeta de permiso del celular muestra los `patterns` junto al comando completo. Interfaz: interruptor por dispositivo con estado accesible, insignia y aviso fijo (es/en).
- Pruebas: `engine-proxy.test.ts` (ataques, tope, texto del motor), `command-denylist.test.ts`, `policy.test.ts`, `devices-store.test.ts`, `service-access.test.ts`, `MobileCode.render.test.tsx`. Sin snapshots regenerados.
- Pendiente: en el celular no se explica que un «Permitir una vez» de `bash`/`edit` con el ajuste apagado espera la confirmación del Mac (hasta 90 s); prueba manual con un celular real y el diálogo nativo (no se abrió Electron). `src/test/opencode-contract.test.ts` falla por una ruta de `src/main/compare` (de otra tanda), no por este cambio.

## F8-B76: comparar modelos lado a lado (lado main, `src/main/compare/**`)

- Contrato en `shared/ipc-code.ts`: tipos `CompareManifest`/`CompareColumnManifest`/`CompareMetrics`/`CompareAdoptResult`…, canales `compare:list|preflight|start|cancel|retry|diff|adopt|discard|close|exportBench` y el evento `compare:changed` (manifiesto completo). Esquemas estrictos en `ipc/schemas.ts` (claves extra, índice > 3, `models` de 1 o 5 y rutas/ramas del renderer se rechazan: solo pasa `{ id, index }`). Todos son clase **X** para el celular (`remote/policy.ts`); el evento, `deny`. Nuevos textos `merr.compare.*` (es/en).
- `CompareService`: copias `onyx-compare/<id8>-<n>` en `.<repo>-worktrees/` desde `HEAD` (si falla una, se deshacen todas, ramas incluidas), hooks de git desactivados, solo `execFile` con arrays; sesión por modelo con el SDK v2 del motor principal (`build`; `bypass` se rebaja a `auto`); arranques escalonados 1,5 s y máximo 2 a la vez en `opencode-go` y `opencode` (`limits.ts`/`scheduler.ts`); cuota («token rate limit», 429, `friendlyError` → `quota`) con UN reintento a los 20 s ± 5 y, si falla otra vez o el motor reintenta más de 2 veces, la columna se aborta y el proveedor queda en pausa (`compare:retry` lo reanuda); métricas por columna (tokens, coste, duración, diff; `null` y nunca 0).
- Cancelar = `session.abort` y espera de inactividad de 10 s como máximo; si no se confirma, `stopUnconfirmed` y **no se borra la copia** (`discard` lo rechaza y `close` conserva el manifiesto). Adoptar = `snapshotPatch` + `git apply --check --binary` y después el parche ENTERO sin commit (sin `--3way` ni `--reject`; `dirty-overlap` salvo `force`; parches con enlaces simbólicos rechazados). Manifiesto en `userData/compare/<id>.json` (atómico, 0600, validado al leer); al arrancar solo marca lo interrumpido y hace `git worktree prune`. Exportación de un lote JSON redactado (`onyx-compare` v1, claves de `RunResultSchema` v1; `redactSecrets`, diff ≤ 200 KB) con el diálogo nativo de guardado.
- Pruebas: `compare/{scheduler,rate-limit,metrics,manifest,bench-export,ipc,service}.test.ts` (git real en carpetas temporales y un motor falso; sin Electron ni modelos). Sin snapshots regenerados.
- Pendiente: la interfaz (ola 2); `POST /instance/dispose` no se llama (no figura en las rutas usadas verificadas con el binario fijado: se añadiría a `api-routes.json` con `check:opencode`); sin adjuntos en v1 (solo texto); prueba manual con modelos reales y con los límites reales de Go.

## F8-B80: dictado de voz, Fase 0 (prototipo de medición, aislado)

- Nuevo `resources/dictation/onyx-dictate/main.swift`: helper mínimo (sin dependencias, no integrado en la app) que captura el micrófono con `AVAudioEngine` solo en memoria y reconoce en el dispositivo (`SpeechAnalyzer` en macOS 26+; `SFSpeechRecognizer` con `requiresOnDeviceRecognition = true` en versiones anteriores). Sin modelo local imprime `no-disponible` y sale; nunca usa el servidor. JSON por línea (`partial|final|state|error`), idiomas `es-CL|es-ES|en-US`, parada a 8 s de silencio y tope de 120 s, salida limpia con SIGINT/SIGTERM, sin texto en logs.
- `scripts/dictation/build.sh` (compila fuera del repo, firma ad-hoc, sin versionar binarios) y `measure.md` (guía corta de medición para el dueño). Prueba sin micrófono: `node --test scripts/dictation/protocol.test.mjs` (parseo de líneas, máquina de estados y, con `ONYX_DICTATE_BIN`, el `--self-test` del binario).
- Pendiente: la medición real (permisos, calidad en es-CL, latencia, CPU) la hace el dueño; no se ejecutó el micrófono. La integración (Fase 1) no se ha hecho.

## F8-B79: proxy local de MCP fuera del sandbox de Tareas (cierra el hallazgo 6)

- Nuevo `src/main/tasks/mcp-proxy.ts` (`McpProxy`): proxy en `127.0.0.1` (puerto aleatorio) en main, fuera de Seatbelt. El `opencode serve` sandboxeado recibe solo URL loopback + token de sesión (uno por servidor MCP, 32 bytes, caduca a las 12 h, revocable, comparado en tiempo constante); el proxy inyecta las cabeceras reales. Destinos en lista cerrada, rutas normalizadas (`safeUpstreamRest`), sin redirecciones, `Host`/`Origin` validados, cabeceras en lista cerrada, límites de cuerpo/concurrencia/tiempo, sin secretos en registros, apagado limpio.
- `manager.ts`: en sandbox el MCP del navegador y los MCP remotos con cabeceras van por el proxy; Seatbelt solo abre el puerto del proxy (ya no el del MCP del navegador); el proxy se apaga con el proceso. `mcp-tasks.ts`: los MCP locales con `environment` secreto NO entran en el sandbox (falla cerrado) y los remotos con cabeceras ya no suman su host a la red; `clientSecret` de OAuth no viaja. Aviso en Ajustes › MCP (`mcp.flags.envWarn`, es/en) vía `TasksMcpInfo.localSecrets`. `ipc/diagnostics.ts`: los tokens de sesión entran al redactor.
- Pruebas: `mcp-proxy.test.ts` (19), `mcp-tasks.sandbox.test.ts` (9, con `ps eww` real: el control sin proxy revela los secretos), `mcp-proxy.real.test.ts` (Seatbelt + opencode 1.18.33 reales sin modelos). No se tocó ningún snapshot ni `sandbox*`/`opencode-config`.
- Abierto (documentado en `docs/SEGURIDAD.md` §3 tricies sexies): MCP locales con secretos no disponibles en el sandbox; el agente puede usar el token de sesión con `curl` (salta «preguntar en cada uso»); secretos en `command`/`cwd`; SSE antiguo con `endpoint` absoluto; Control total sin cambios. Prueba manual del dueño pendiente (Tarea real con MCP real).

## F8-B78: comparar modelos lado a lado (interfaz, `features/compare/**` + integración en Code y Chat)

- Vista de columnas (`CompareView`/`CompareColumn`): una por modelo, mín. 300 px y desplazable en horizontal; píldora de estado (en cola, arrancando, trabajando, listo, error, límite de uso, cancelado, elegido, interrumpido, descartado) en `aria-live="polite"`, tokens ↑/↓, coste, duración, insignias (más barato, más rápido, menos cambios; solo con ≥2 columnas hechas y dato en ≥2), conversación en vivo (Markdown en streaming y herramientas en una línea), permisos pendientes de la columna con «Permitir una vez»/«Rechazar», cajón lateral de diff (Esc lo cierra y devuelve el foco), «Quedarme con este»/«Seguir con este» (confirmación; `dirty-overlap` se puede repetir con `force`; `conflict` ofrece «Abrir la copia» y «Copiar el parche»; `empty`/`symlink`/`not-ready` se explican), «Descartar», «Cancelar todo», «Guardar en el banco» (solo al terminar) y «Cerrar» (con confirmación; si main conserva copias por parada sin confirmar se avisa y la comparación sigue). Las métricas `null` se pintan «—» y NUNCA «$0» (`costLabel` trata también el 0 como no informado).
- Cuota: la columna `rateLimited` con `retryAt` pinta la cuenta atrás («Reintento en N s», `useNow` cada 1 s) y con `retryAt` null «En pausa por límite de uso» + «Reintentar» (también en las columnas en cola de un proveedor en pausa). Recuperación: las comparaciones del manifiesto sin vista abierta salen en una franja «Abrir · Descartar» y sus columnas `interrupted` se pintan como «Interrumpido».
- Lanzamiento: botón «Comparar» (icono `Columns3`, `aria-haspopup`) en el compositor de Code (`ModelControls`) y de Chat (pie), lanzador de 2–4 modelos (`role="listbox"`, ↑ ↓ Espacio Enter Esc, aviso «máx. 2 a la vez» para los proveedores con tope, 4 máximo, sin duplicados), chip «Comparar ×N» con ✕ y título del botón de enviar «Comparar en N modelos». Al enviar, diálogo previo (modal) con el ×N y el gasto de hoy (`loadGlobalUsage`, ahora exportado), el commit de partida si el árbol tiene cambios (`compare:preflight`), «sin dependencias instaladas» y «No volver a mostrar» (localStorage en try/catch; solo salta si el árbol está limpio); se bloquea con mensaje si no hay repositorio, hay adjuntos (v1 solo texto) o ya hay una comparación activa. Gancho acordado: `maybeInterceptSubmit(text, ctx)` (síncrono, Code: el borrador se limpia al arrancar) y `requestCompare(ctx)` (promesa, Chat: `false` restaura el borrador).
- Estado (`store.ts`): un solo flujo de eventos del motor filtrado por los `sessionID` del manifiesto (y, para permisos de subagentes, por la carpeta de la copia), reducido con `reduceEvent` y cola por frame; los permisos de estas sesiones NO pasan por `useCode`; al reconectar se vuelven a pedir los mensajes. En Chat las sesiones de una comparación sin elegir se ocultan de la lista (`metadata.compare`, `isHiddenCompareSession`); al elegir una se renombra con el mensaje, se abre y queda como conversación normal.
- Celular: `compareApi()` devuelve `null` en la superficie remota; botón, franja, diálogo y sincronización no existen allí y no se llama a ningún `compare:*`.
- Textos es/en (`compare.*`, sin nombrar productos de terceros), tokens del escritorio sin colores nuevos; los archivos nuevos entran en `MIGRATED`.
- Pruebas (sin Electron, sin snapshots regenerados): `compare/model.test.ts` (16), `store.test.ts` (30, cliente falso: reducción por sesión, ciclo de vida, lanzamiento, adopción, cierre con copias retenidas, celular) y `CompareView.render.test.tsx` (37: estados, métricas «—», cuenta atrás con reloj falso, ×N, accesibilidad, celular). E2E `e2e/specs/comparar.e2e.ts` (Code, cancelar, recuperación tras reiniciar y Chat) ESCRITO SIN EJECUTAR: necesita en el falso `forModel` por guion y el modelo `opencode-go/fake-go-model` (trabajo de Q).
- Pendiente: ejecutar el E2E; cambiar de proyecto con columnas en curso no pide confirmación (la comparación sigue viva y vuelve a verse al regresar); sin respuesta a preguntas (`question.asked`) dentro de una columna (solo permisos); capturas claro/oscuro a 900 px; prueba manual con modelos reales.

## F8-B77: control remoto fuera de casa, entrega 1 (protocolo v4, servicio de conexión, sitio HTTPS firmado)

- **Alcance**: opcional y apagado por defecto. Selector «Solo esta red» / «También fuera de casa» en Ajustes › Celular (textos neutros: «servicio de conexión»; Cloudflare solo en la documentación). Passkeys (N10) y avisos push (N11) NO entran: entregas aparte. TURN implementado pero APAGADO (`TURN_ENABLED=false`, sin secretos); solo STUN. Nada se publicó, no se tocó Cloudflare ni se hizo ninguna petición de red.
- **N1** `AsyncClientHandshake` con `AuthMac` inyectado (noble o `CryptoKey` HKDF→HMAC no exportable en `pwa/src/keys.ts`, almacén IndexedDB en `store.ts`); misma criptografía v3. **N2** protocolo v4 (el Mac acepta v3 y v4): `caps` en `authed`/`pair-pending`, `room` en `paired`, `b` en `hs1`, trama `turn`, códigos `host-offline`/`rate`; `cloud.ts` (salas, código Crockford de 16 caracteres, tramas Mac↔servicio).
- **N3** `cloud/remoto-worker/` (Worker + Durable Object que hiberna sin guardar nada, `wrangler.jsonc` sin secretos, README con los pasos del dueño) sobre `RoomCore` puro compartido (`src/shared/remote/room-core.ts`): sala por Mac `sha256(hostToken)`, ≤ 2 celulares, ≤ 30/min, ≤ 80 tramas y 60 s, host muerto a 150 s, `ready` en 5 s, TURN solo tras `grant` y antes de la siguiente trama (≤ 20/h), `routeEdge` (sala válida y `Origin` antes de despertar nada).
- **N4** `CloudSignalingTransport` (el Mac sale hacia fuera, sin puertos; reintento con espera exponencial, ping, `suspend`/`resume`/cambio de red), `SignalSession` compartida con la red local, `FakeCloud` (ws en 127.0.0.1 con el mismo `RoomCore`), `hostToken` en `remote.bin` (rota con «Quitar todos»), «Disponible fuera de casa», respondedor WebRTC creado al llegar la offer con STUN/TURN, gracia de 6 s en `disconnected`, `powerMonitor`, política `allowOutsideNetwork`/`allowRelay`/`allowPush`/`requirePasskey` (con archivo y clave ausente = cerrado).
- **N5** PWA en HTTPS: modo nube (`isSecureContext` + origen exacto), vinculación por código escribible además del QR, `entry` con SRI (el Mac manda los sha384 de SU interfaz), reintento con `v-1`, pantallas «Tu Mac no está disponible»/«No se pudo guardar el vínculo», guía de instalación, `sw.js` (61 líneas, nunca toca `/v1/*`), manifiesto, iconos, `scripts/build-site.mjs` → `pwa/dist-site` con `_headers` (CSP estricta). **N6** `remote:setConnection`/`remote:setAway` (esquema estricto, clase X), Ajustes con estado del servicio, vigilancia y «vía relé», código visible junto al QR, auditoría (`cloud-started`, `connection-changed`, `away-*`, `site-*`). **N7** `site-watch.ts` (firma Ed25519 sobre bytes exactos, `seq` sin retrocesos, hashes del arranque y CSP, cada 6 h; si no cuadra se pausa el modo nube) y `scripts/site-release.mjs` (firma en el Mac del dueño, sin CI ni despliegue, archivo de 10 versiones). **N8** docs: `SEGURIDAD.md` §3 tricies septies, `REMOTO-FASE2`, `PRIVACIDAD-BORRADOR`, `REMOTO-PRUEBA-MANUAL`, `DISTRIBUCION` (primero el sitio, después la app), `POLITICA-ORGANIZACION`, `AGENTS.md` §8.
- **Pruebas** (todas con dobles, sin red): `room-core.test.ts` (33), `cloud.test.ts`, `protocol-v4.test.ts`, `worker-client.test.ts` (23, también contra `FakeCloud`), `service-cloud.test.ts` (19: vinculación y reconexión por la nube, TURN solo tras `authorize`, política, pausa del sitio, `away`, auditoría), `site-watch.test.ts` (21, incluido de punta a punta con `site-release.mjs`), `pwa-keys.test.ts` (vector idéntico noble/WebCrypto, clave no exportable, IndexedDB falso), `pwa-site.test.ts`, `entry-info.test.ts`, `org-policy.test.ts`, `devices-store.test.ts`, `peer-session-caps.test.ts`, `rtc-ice.test.ts`, `ipc-cloud.test.ts`, `scripts/site-lib.test.mjs` (9). Verificado: `npm run typecheck`, `build:pwa`, vitest de `src/main/remote`, `src/shared/remote`, `src/renderer/remote`, `src/main/ipc`, `src/shared/i18n` y `src/test`, eslint y prettier de lo tocado.
- **Fuera de mi mano**: `src/renderer/remote/i18n-core.test.ts` falla solo por las 110 claves `compare.*` de la interfaz de comparar (lo regenera quien las añadió con `UPDATE_PWA_I18N=1`); no se tocó. `pwa/budget.json`: `index.js` sube de 40 a 44 KB gzip (código nuevo de la capa ligera: almacén, claves, código escribible); el arranque total y `boot.js` ya superaban su presupuesto antes.
- **Pendiente / lo hace el dueño** (`cloud/remoto-worker/README.md`): `wrangler login` con la cuenta Onyx, clave de firma Ed25519 y poner la pública en `SITE_PUBLIC_KEY`, publicar el sitio, dominio `remoto.onyxcode.cl`, HSTS, regla de límite por IP, alertas de facturación; la prueba manual (`REMOTO-PRUEBA-MANUAL.md` pasos 14–22: iPhone/Android reales, datos móviles, Mac dormido). Por verificar en el entorno real: binding de rate limiting y límite de archivos del plan gratuito, ping con respuesta automática facturable, `integrity` en `modulepreload` en iOS, «vía relé» con `getSelectedCandidatePair`. No se construyó Electron ni se corrió E2E; los preloads secundarios no se tocaron.

## F8-B82: motor falso para comparar modelos y elemento (e2e/fake-opencode, comparar.e2e.ts)

- `e2e/fake-opencode/server.mjs`: filtro `forModel: 'proveedor/modelo'` en los guiones (`POST /__e2e/script`; solo lo toma el `prompt_async` cuyo `body.model` coincide, con su respuesta, `startDelayMs`, `cost` y fallo propios); paso `{ type: 'error', preset: 'quota' }` (APIError 429, «token rate limit exceeded», que `friendlyError` clasifica como `quota`); `POST /instance/dispose` aceptado (devuelve `true`, contador `instanceDisposeCount` en `/__e2e/status`). Contra lo previsto, esa ruta SÍ figura en `resources/opencode-bin/api-routes.json`; el main de comparar no la llama y el spec no la exige.
- Ya existían y solo se cubren con prueba: `opencode-go/fake-go-model` en `/provider`, `/config/providers` y `connected` (catálogo de 5 proveedores) y las partes del usuario con `metadata`/`synthetic` devueltas tal cual (sirve al chip de elemento y a comparar).
- `comparar.e2e.ts`: cabecera al día, usa el preset de cuota y comprueba que cada modelo recibió su propio `prompt_async`. Sin entrada en `e2e/win-skip.json`: esa lista es de specs enteras y el bloque de Chat sí corre en Windows; los de Code ya van con `describe.skipIf(IS_WIN)`.
- Pruebas: `node --test e2e/fake-opencode/server.test.mjs` (19, una nueva). No se ejecutó Electron ni `test:e2e`; typecheck verde. eslint/prettier señalan solo líneas anteriores de `server.mjs`/`server.test.mjs` (no se reformateó).

## F8-B83: la PWA del celular vuelve al presupuesto (arranque 345 → 285 KB gzip, `boot.js` 262 → 201 KB)

- Causa: `features/compare/**` (interfaz de «Comparar modelos», ~110 claves `compare.*`) viajaba en `boot` aunque en el celular `compareApi()` es `null`; `CompareColumn` importaba `components/Markdown` de forma estática y arrastraba react-markdown/micromark (~50 KB gzip) de vuelta al arranque, deshaciendo el trozo perezoso de B65.
- Arreglo: `shims/no-compare.tsx` (misma forma pública que `features/compare/index.ts`, inerte) sustituye ese índice vía SWAPS en `ChatView`, `ChatSidebar`, `CodeWorkspace`, `Composer` y `ComposerControls`. No se tocó la interfaz de escritorio. La burbuja del chip de elemento (`ElementReadonlyChip`, B72) sigue en el arranque a propósito: se ve en los mensajes ya enviados; su coste es pequeño (`ElementChip` ~2 KB gzip) y no se hizo perezosa.
- Pruebas: `swaps.test.ts` exige ahora que el arranque (grafo estático de `main`+`boot`, con SWAPS) no contenga `features/compare`, `onboarding`, Sidebar/CommandPalette/UpdateNotice/RemotePairHost/RemoteConfirmHost ni `keybindings/dispatch`, y que `ElementChip` sí esté; `shims/no-compare.test.tsx` exige que el shim exporte todo lo del índice real y sea inerte.
- Diccionario de arranque regenerado al final con `UPDATE_PWA_I18N=1` (+ prettier, para no reescribir el formato): el diff solo suma `compare.send` (título del botón de enviar del compositor, que sí está en el arranque).
- Tamaños (gzip KB): arranque 345,1 → 284,6 (tope 300); `boot.js` 261,7 → 201,3 (tope 210); JS min de arranque ~ 910 → 756 KB (tope 780); `index.js` 41,4, `main.js` 22,1 y `boot.css` 18,9 sin cambios. No se subió ningún presupuesto. Margen justo: `boot.js` min 688,8 / 690.

## F8-B81: Tareas en Windows (WSL2), preparación sin activar y Seatbelt extraído a un backend (T-W1 a T-W3, parte de la Mac)
- Qué: `src/main/tasks/backends/` con la interfaz `SandboxBackend` (`types.ts`), Seatbelt extraído sin cambios (`seatbelt.ts`, `none.ts`, `spawn.ts`, `selectBackend`) y `startTasksServer` delegando en él; `platform-caps` con `tasksSandbox` (`seatbelt`/`wsl`/`none`) y la bandera de producto `tasksWin` (apagada: Windows sigue sin Tareas); módulos puros del backend WSL (`wsl-paths`, `wsl-spec`, `bridge-protocol`, `wsl-status`), `WslBridgeHost` y `WslBackend` con `wsl.exe` simulado (NO enlazado en producción); lanzador de Python con Landlock como recurso (`resources/wsl/`, excluido del `.asar`). Documentación: `docs/WINDOWS-TAREAS.md` y `docs/SEGURIDAD.md` §3 tricies octies.
- Autorización del dueño para tocar `sandbox*`, `proxy*` y `provider-egress` solo para la extracción: `sandbox-profile.ts`, `proxy.ts`, `proxy-policy.ts` y `provider-egress.ts` no cambian; `sandbox.ts` solo delega el lanzamiento.
- Prueba de equivalencia: `sandbox.equivalence.test.ts` contra `__fixtures__/seatbelt-before.json`, capturado con el código anterior en commits previos (`baeb0bd`, `c70fbdb`): 9 perfiles SBPL idénticos byte a byte y 4 lanzamientos completos con el mismo `command`, `args`, `env`, opciones de `spawn`, proxies, `trackPid`/`killTree` y limpieza. Los tests existentes de `src/main/tasks` y `src/main/ipc` pasan sin editar ni regenerar ningún snapshot. Ver nota: durante la captura se vio que el valor aleatorio del centinela dependía del ORDEN de las llamadas a `randomBytes`; el doble ahora es determinista por tamaño y el «antes» se recapturó con el `sandbox.ts` original.
- Seguridad: la clave real no cabe en la trama inicial (lista cerrada de entorno, `OPENCODE_AUTH_CONTENT` solo con centinelas, defensa extra `forbid`); `wsl.exe` solo con comandos de una lista cerrada y NUNCA `--shutdown`; el lanzador falla cerrado sin Landlock (ABI < 2), con interop o con unidades montadas; sin `REMOVE_*`/`REFER` en la carpeta si no hay `allowDelete`; el puente solo conecta a los puertos permitidos. `backends.static.test.ts` amplía a `backends/*` la guardia estática de credenciales.
- Pruebas: 165 en `src/main/tasks/backends` (rutas, spec, protocolo con fuzz de semilla fija < 2 s, puente con dobles, estado, backend, estáticas), `platform-caps.test.ts` (matriz plataforma × bandera) y 16 en Python (`resources/wsl/test_protocol.py`, vectores compartidos con TypeScript). Typecheck, ESLint y Prettier en verde; nada se ejecutó en Windows ni se instaló WSL.
- Pendiente (necesita el PC y decisiones del dueño): `docs/WINDOWS-TAREAS.md` (rootfs, `setup`, integración T-W4, ataques A1-A15 en sesión elevada y NO elevada por WSL#12443, y las decisiones abiertas).

## F8-B84 — Comparar modelos: prueba end-to-end en verde

- Causa raíz en el SPEC (`e2e/specs/comparar.e2e.ts`): el lanzador nace con el modelo actual ya marcado, así que hacer clic en «Fake Model» lo desmarcaba y el botón quedaba en «Comparar (1)» (deshabilitado por `min`); el diálogo de «Quedarme con este»/«Cerrar» es `alertdialog`, no `dialog`; en Chat no hay botón «Comparar en N modelos» (se envía con Enter); la rama `onyx-compare/*` se borra justo después de la copia y la apertura de la conversación elegida es asíncrona (ahora se esperan con `expect.poll`).
- Defecto real de la interfaz (`features/compare/store.ts`): un `compare:changed` rezagado tras cerrar resucitaba el manifiesto y volvía a pedir los mensajes de una sesión ya borrada (404 en consola). Ahora `applyManifest` ignora ids cerrados; prueba unitaria en `store.test.ts`.
- Motor falso y main de comparar: sin cambios (los modelos y nombres eran correctos). 4/4 pruebas e2e en verde (2 ejecuciones seguidas).

## F8-B85: Modo viaje (túnel rápido de Cloudflare sin cuenta), lado del Mac (T1–T5)

- **Binario** (`src/main/remote/tunnel/binary.ts`, `resources/cloudflared/pin.json`, `scripts/cloudflared/pin.mjs`): `cloudflared` 2026.9.3 darwin-arm64 descargado bajo demanda con consentimiento y verificado con DOS hashes (el del `.tgz` y el del binario extraído, valores medidos en T0), tamaños exactos y firma Developer ID Cloudflare Inc. (equipo `68WVV388M8`) comprobada con `codesign` antes de instalar y re-verificada (hash y firma) antes de cada arranque; descarga solo de hosts de GitHub, `tar` de un único archivo regular, `0700`. El generador del pin exige tres fuentes y solo se prueba con dobles (no se descargó nada real).
- **Proceso** (`tunnel/cloudflared.ts`, `backoff.ts`, `opencode/pids.ts`): grupo propio, `withDisclaim`, vigía `/bin/sh` de `stdin` (verificado en T0) que además delata la muerte por el cierre de `stderr`, entorno mínimo con `HOME` privado, siempre `--no-autoupdate` y nunca `--config`, URL con regex estricta solo tras el banner, `pids.json` + `isOurCloudflared` en `killStaleServers` (también limpia un `cloudflared` vivo cuyo vigía murió), `stop()`/`killNow()`, reintentos 2–60 s (máx. 6; `rate` 60 s). `cloudflared` falso en `e2e/fake-cloudflared/` con modos de fallo (sin URL, URL tardía, dos URL, URL mala, caída, 429, config, borde caído, ignora SIGTERM, nieto, salida basura, `inject`, 522, corte por inactividad).
- **Servidor** (`signaling/lan-server.ts`, `tunnel-gate.ts`, `tunnel-limits.ts`, `tunnel-selfcheck.ts`, `tunnel-transport.ts`): servidor ligado a 127.0.0.1, 503 hasta tener nombre, `Host`/`Origin` exactos, puerta `/k/<T>` con galleta `__Host-onyxk`, 404 idéntico para todo lo no listado (también `/cdn-cgi/` y `/ws` sin galleta), límites de ritmo, keepalive del WebSocket (ping 25 s, cierre a los 90 s), CSP con `wss://<host>`, autocomprobación del Mac contra su propia página antes del QR. El comportamiento LAN no cambia (sus pruebas siguen verdes sin tocarlas).
- **Servicio** (`service.ts`, `devices-store.ts`, `peer-session.ts`, `audit.ts`, `org-policy.ts`, `loader.ts`, `index.ts`): modo `travel` sin IP local con STUN públicos, QR `/k/<T>#s=<q>`, PIN obligatorio y vínculo efímero `kind: travel`, bloqueo por política/passkey/confirmar cada conexión, cierres (30 min, 4/12/24 h con tope `travelMaxHours`, «Cortar todo», salir, política en caliente, caída), `bye{travel-ended}`, `travel-url-changed` con revocación, auditoría `travel-*`, política `allowTravelMode`/`travelMaxHours`/`allowTravelRelay`/`allowTravelDownload` (fail closed) ya leída de `managed.json`.
- **Contratos para la interfaz** (`src/shared/remote/travel.ts`): tipos del estado (`TravelState`), constantes, esquemas estrictos de `remote:travelInstall` (`{ consent: true }`) y `remote:setTravelKeep`; cambios mínimos en `src/shared/ipc-remote.ts` (`RemoteConnection` + `travel`, `RemoteState.travel`, `RemotePolicyView`, `RemoteDeviceInfo.kind`) y `bye.reason` + `travel-ended` en `protocol.ts`. La interfaz de Ajustes, el consentimiento y la PWA quedan para la tanda siguiente.
- Docs: `docs/SEGURIDAD.md` (§3 tricies novies) y `docs/POLITICA-ORGANIZACION.md`. Pruebas: `cloudflared.test.ts`, `binary.test.ts`, `pin-lib.test.ts`, `lan-server-tunnel.test.ts`, `tunnel-transport.test.ts`, `service-travel.test.ts`, además de `org-policy`, `devices-store`, `audit` y `shared/remote/travel.test.ts`. Sin red real, sin Electron, sin túneles reales.

## F8-B86: Modo viaje, interfaz, PWA del celular, avisos y documentación (T6–T8)

- **Canales** (`src/shared/ipc-remote.ts`, `src/main/ipc/{schemas,remote-handlers}.ts`, `src/main/remote/policy.ts`): `remote:travelInstall` (`{ consent: true }` exacto) y `remote:setTravelKeep` registrados en `REMOTE_INVOKE_CHANNELS` (el preload remoto los toma de la lista), con `parseTravelInstallRequest`/`parseSetTravelKeepRequest` y clase **X** (el celular no puede usarlos); `remote:setConnection` acepta `travel`. No se tocó el servicio del Mac de B85.
- **Interfaz** (`features/settings/impl/TravelPanel.tsx` + `RemoteSection.tsx`, claves `remote.travel.*` es/en): selector «Solo esta red» / «Modo viaje (sin cuenta), experimental» (sin servicio fijo ni Workers: «También fuera de casa» solo se muestra si ya estaba elegido), explicación honesta, diálogo de consentimiento antes de descargar (botón «Descargar y activar», foco en Cancelar), duración `idle30`/4/12/24 h recortada por `travelMaxHours`, estados con `aria-live` y movimiento reducido, cuenta atrás solo con duración fija, errores por código, bloqueos por política/confirmar/passkey, QR «válido solo para este túnel», sin soporte (no macOS o `unsupported`) se explica y no se ofrece.
- **PWA** (`pwa/src/{mode,rtc,client,store,main,ui,i18n}.ts`): `isTravelMode` (HTTPS + origen exacto del túnel), vínculo en IndexedDB del origen sin sala (`idbLinkStore({ roomless })`), `TRAVEL_STUN_URLS`, ICE de 12 s → `ice-failed`, reintento del WebSocket ante el 522 (`TRAVEL_WS_RETRY`), estados «el enlace caducó» / «el Mac no responde» / «tu red bloquea la conexión directa», `bye travel-ended` (con prueba del Mac) borra el vínculo y lo explica, sin instalar (`beforeinstallprompt` bloqueado) ni service worker. Peso: arranque 286,1 KB gzip (tope 300), `boot.js` 201,3 (tope 210); `i18n-core-keys.json` no hizo falta regenerarlo.
- **Docs**: `docs/SEGURIDAD.md` §3 quadragies (modelo de amenazas final y tabla honesta por tipo de red, con lo NO verificado marcado), `docs/REMOTO-PRUEBA-MANUAL.md` (pasos 23–35 con datos móviles y otra Wi-Fi), `THIRD_PARTY_NOTICES.md` (cloudflared, Apache-2.0, 2026.9.3, no se redistribuye), `AGENTS.md`. `docs/POLITICA-ORGANIZACION.md` ya tenía las cuatro claves (B85).
- **Pruebas**: `ipc-travel.test.ts` (esquemas estrictos, clase X, solo ventana principal), `TravelPanel.test.tsx` (estados, errores, bloqueos, selector bajo política, sin soporte, consentimiento obligatorio y orden consentir→descargar→activar, es/en), `src/test/pwa-travel.test.ts` (patrón de origen, STUN, reintento 522, `ice-failed` a 12 s, `travel-ended`, errores, almacén sin sala). Sin Electron, sin descargar `cloudflared`, sin túneles; sin snapshots regenerados.
- Pendiente: la prueba manual del dueño con datos móviles (la tabla por red sigue marcada «esperado, no verificado»); la PWA no muestra «Copiar enlace» ni «Guarda en favoritos» tras vincular (solo el aviso de la pantalla inicial); respaldo cifrado por el WebSocket (entrega 2).

## F8-B87: Modo viaje con el binario REAL: descarga, DNS de la autocomprobación y plazo de arranque

- Síntoma: al activar el Modo viaje en la app instalada la descarga de `cloudflared` fallaba al instante (quedaba `userData/bin` vacío). Las pruebas anteriores solo usaban simulacros; esta tanda recorre el camino real con Electron y red real (`scripts/travel-smoke.cjs`, manual, fuera de `npm test`/`verify`; documentado en su cabecera).
- Fallo 1, descarga: `net.fetch(url, { redirect: 'manual' })` de Electron lanza «Redirect was cancelled» ante la redirección de GitHub a `release-assets.githubusercontent.com`. Arreglo: `src/main/remote/tunnel/manual-fetch.ts` (`createManualFetch`, `net.request` con evento `redirect`; devuelve cada salto como 3xx y aborta, sin seguir nada solo) cableado en `remote/index.ts`; `CloudflaredBinary.download` sigue validando cada salto (lista cerrada, https, sin puerto/credenciales, prefijo solo en el primero) y no cambian el pin, el tamaño exacto ni los dos SHA-256 y la firma. Prueba: `manual-fetch.test.ts` (doble de `net.request` que se comporta como el de Electron; 302 → 200 instala, host ajeno o http/puerto/credenciales no se piden, hash distinto = `bad-hash`).
- Fallo 2, autocomprobación: el nombre del túnel todavía no existe en el DNS cuando `cloudflared` registra la conexión; la primera consulta recibía NXDOMAIN y los resolvedores lo guardan 60 s (SOA de la zona), así que los reintentos de 1–30 s en 45 s daban `getaddrinfo ENOTFOUND` y no salía el QR (reproducido 2 de 2). Arreglo: `signaling/tunnel-dns.ts` (`makeTunnelLookup`: pregunta a los NS autoritativos, no toca al sistema mientras el nombre no exista, respaldo al sistema solo si no hay forma de preguntar al autoritativo) usado por `realHttpGet`. Prueba: `tunnel-dns.test.ts`. Con el arreglo la autocomprobación real pasó en 2 s (incluida una 530 transitoria del borde).
- Fallo 3, plazo: con el binario real el arranque tardó de 8 s a más de 30 s en la misma red; `TRAVEL_PROCESS.startTimeoutMs` pasa de 30 a 60 s (`travel.test.ts` fija el margen). Fallo 4 (menor): `cloudflared` heredaba la carpeta de trabajo de la app y el vigía sin TCC protestaba con «getcwd» bajo ~/Documents; ahora corre en su `HOME` privado (`cloudflared.test.ts`, el falso imprime `FAKE_CWD`).
- Verificado de verdad (Electron 44 real, macOS arm64, `cloudflared` 2026.9.3 oficial, red doméstica en Chile, userData temporal): descarga 19 784 166 B en ~2 s, `tar`, SHA-256 del `.tgz` y del binario, `codesign` con el requisito Developer ID (equipo 68WVV388M8), ejecución sin diálogo de Gatekeeper, vigía `/bin/sh` + `withDisclaim` con `--no-autoupdate` y sin `--config`, URL `https://<4 palabras>.trycloudflare.com` en ~5 s, autocomprobación, `/k/<T>` → 303 + `__Host-onyxk; Secure; HttpOnly; SameSite=Lax`, 404 idéntico sin galleta o con `T` malo, PWA con galleta idéntica byte a byte y CSP con `wss://<host>`, `/cdn-cgi/` lo sirve Cloudflare, WebSocket rechazado sin galleta o con `Origin` ajeno y abierto con ambos, cierre en 1,6 s sin procesos huérfanos ni `pids.json`, URL muerta tras parar. NO verificado con el binario real: pings del Mac por el túnel y `hello`→`ready` (se agotaron los 4 túneles autorizados por un error del propio script, ya corregido), redes móviles y celular real.
- Se usaron los 4 túneles autorizados (2 fallaron por el DNS, 1 sin URL por el plazo, 1 completo); binario y userData temporales borrados; sin procesos sobrantes; sin push.

## F8-B88 — Se retiran las cuentas (decisión del dueño)

Se elimina el sistema de cuentas de F8-B19: `main/account/` (cliente, servicio, almacén `account.bin`, loopback, PKCE,
config), `ipc/account.ts`, los 9 canales `account:*` y el evento `account:changed` (contrato, esquemas y política del
remoto), `shared/account*.ts`, `ACCOUNT_API`/`PRIVACY_URL`/`TERMS_URL`, `AccountGate`/pantalla de acceso/Ajustes › Cuenta,
las áreas i18n `account`, `merr.acct.*` y `settings.account.*`, el servidor falso `e2e/fake-auth` y las variables
`ONYXCODE_ACCOUNT_URL`/`ONYXCODE_ACCOUNT_DISABLED`/`ONYXCODE_TEST_PLAIN_STORE`. Comportamiento = el de `ACCOUNT_API = null`.
Nuevo `cleanLegacyAccountSession` (en cada arranque, idempotente): borra solo `account.bin(.tmp)` y `account.test.json(.tmp)`
de userData; no usa `safeStorage` ni toca el Llavero (`remote.bin` sigue descifrándose). Guardia `src/test/no-accounts.test.ts`.
E2E: `sin-cuenta.e2e.ts` sustituye a `account.e2e.ts`. La cobertura del remoto sigue al 100 %. Volver a una versión
antigua con la cuenta encendida obliga a entrar de nuevo. El servidor, el VPS, el DNS `api.onyxcode.cl` y el cliente
OAuth quedan fuera del repo (los gestiona el dueño).

## F8-B89 — Rediseño de escritorio: fundamentos (parte 1, sin cambio en el celular)

Capa visual SOLO de escritorio: `main.tsx` marca `<html data-shell="desktop" data-platform>` e importa `app/desktop/index.css` (un CSS por
dueño: `tokens`, `base`, `shell`, `conversation`, `modes`); la PWA no la carga. Variante Tailwind `desk:` (`@custom-variant` en
`globals.css`). Tokens nuevos solo bajo `:root[data-shell='desktop']` (tipografía `--text-*`/`--font-ui|title|code`, `--space-*`,
`--radius-2xs…modal`, `--shadow-raised|pop|modal|focus`, `--scrim`, `--dur-instant|enter|exit`, `--z-*`, `--icon-stroke`); ningún token ni
color existente cambia. Las utilidades (`text-ui`, `rounded-ctl`, `shadow-pop`…) se registran con `@theme reference inline` (el plan A
`@theme reference` a secas copia el valor de `shadow-*` y pierde `line-height`; con `inline` usan `var(--token)` y no se emite ningún valor
en `:root` ni en la PWA).
Arreglos globales sin tocar marcado (`desktop/base.css`): velo de modales con `--scrim` (en oscuro `bg-fg/30` aclaraba el fondo), foco
con teclado que ya no cambia el radio del control (`revert-layer`), fuente del sistema sin Inter y sin `cv11/ss01`, trazo de iconos 1,75,
casillas con el acento, `.select-field` con `padding-right`, spinner 0,8 s, `.kbd`, pulgar de scroll, `user-select` del cromo y sin
escalado al presionar con movimiento reducido. NO incluidos aquí: componentes base (Spinner/Badge/Chip/Input/DialogFrame/Tooltip),
kit de UI y `desk:` en componentes (tandas 0.6–0.9 del plan).
Guardias: `desktop-scope.test.ts` (selectores con alcance, importaciones, variante, tabla de tokens), `stripDesk()` (`src/test/strip-desk.ts`)
aplicado a los 6 literales de `desktop-unchanged` y a los 3 snapshots de render SIN editar literales ni `.snap` ni usar `-u`, y
`selectors()` movido a `src/test/css-selectors.ts`. PWA: plugin `onyx-strip-desktop-css` (`stripDesktopCss`) quita del CSS compilado toda
regla con `data-shell`; `boot.css` 18,9 KB gzip antes y después (108 097 B idénticos), arranque 286,0 KB, `boot.js` 201,3 KB.
Herramientas: `scripts/shot-diff.mjs` (comparador de píxeles), `shot-desktop`: ratón fuera de la ventana y `--reduced-motion`.
Celular: 29 de 32 capturas idénticas; las 3 restantes (`lista-*`) difieren solo en el texto de hora relativa («hace 23 h» → «ayer»), no en CSS.

## F8-B93 — Rediseño de escritorio: Tareas, Rutinas, Ajustes, primer uso y Comparar (defectos de lógica L1–L6; sin cambio en el celular)
**Lógica.** L1/L2: «Activas» pasa a **«En otras carpetas»** (`activeElsewhere`) y la carpeta abierta tiene su grupo **«En curso»** con el estado del
renderer (`splitInProgress`), excluido de los grupos por fecha: una tarea nunca sale dos veces y la que espera aprobación aparece al instante
(`sidebar-groups.test.ts`). L3: la barra de aprobación solo se pinta si la tarjeta grande no se ve ≥60 % (`IntersectionObserver`; cierre seguro con
`shouldShowBar`: sin tarjeta u observador, se ve) y la tarjeta usa el mismo orden de botones que la barra (Rechazar con indicaciones a la izquierda;
Rechazar · Siempre · Permitir una vez a la derecha) (`approval-bar.test.ts`). L4: «1 modelo». L5: hora de 24 h en Rutinas en español
(`schedule.hours.test.ts`). L7: «Más rápido» exige ≥10 % y ≥200 ms de ventaja y las duraciones <10 s llevan una décima (`model.test.ts`). Cronómetro
«0:00» fuera: solo en vivo, la duración va en el `title` de la píldora («Duró 0:42»). L6: el copy del asistente decía «Se guarda en OpenCode, no en
{app}»; el código (`data-dir.ts`, `sandbox.ts`, `docs/SEGURIDAD.md`) confirma que la clave vive en el almacén propio de la app, así que se corrigió en es y en.
Foco inicial y de cada paso del asistente al título (sin anillo en «Obtener mi clave»).
**Interfaz (todo tras `desk:`, el celular no cambia).** Ajustes: `Row layout="stack-narrow"` (se apila con la tarjeta <34 rem; activado solo en Modelos,
«Dónde se puede usar» y Archivado), descripción 13/18, navegación agrupada Aplicación/Agentes/Conexiones/Ayuda (etiquetas en frase) y la nota de cifrado del
Celular en un recuadro con escudo, sin acortar el texto. Rutinas: lista de 760 px con grupos Activas/En pausa, modo y carpeta en cada fila e «Ideas para
empezar» bajo la lista. Comparar: métricas en chips con icono y rótulo, «sin dato» en lugar de «—», «Quedarme con este» secundario, columna descartada sin
`opacity-60`. Primer uso sin tarjetas anidadas. Fila de tarea de una línea con la hora a la derecha.
**Prueba.** Cambian dos expectativas de `CompareView.render.test.tsx` («sin dato» en lugar de «—», no son snapshots). No incluidos: `ActionCard`, filtros
compactos de la lista, reorden del buscador y editor de Rutinas (siguientes tandas).

## F8-B90 — Rediseño de escritorio: componentes base y kit de UI (fundamentos, parte 2; sin cambio en el celular)

Nuevos en `components/`: `Spinner` (mismo marcado que el `Loader2` escrito a mano), `Badge`, `Chip`, `Input`/`Select` (error accesible),
`EmptyState`, `DialogFrame` (velo `--scrim`, `aria-modal`, Esc y clic fuera), `Tooltip` (500 ms, 0 ms entre seguidos, `role="tooltip"`,
sin nodos extra; en la PWA devuelve el hijo) y `ui/recipes.ts` (`POP`, `CARD`, `ROW`, `MENU_ITEM`, `INPUT`, `SEGMENT`, `TAB`, `EMPTY`).
`Button` gana `xs`/`lg`, variantes `subtle`/`link` y `loading` (compatibles hacia atrás); `IconButton` gana `xs`/`lg`, `tooltip` y `shortcut`
(opt-in: con tooltip se quita el `title`, y varios E2E usan `getByTitle`; carga el tooltip perezosamente para no pesar en la PWA);
`Toggle` gana `size="sm"` y anillo de contraste apagado. Todo lo visual de escritorio va con `desk:`; el marcado previo queda fijado por
`base-markup.test.tsx` (con `stripDesk`, sin `-u`). Kit: `app/dev/UiKit.tsx` (solo con `#ui-kit` y `localStorage onyx.uikit=1`, desde `main.tsx`)
y `shot-desktop --scenario kit` (capturas por sección, estados forzados por CDP). Docs: `DESIGN.md`, `docs/UI-REDESIGN.md`.
Peso PWA: estos componentes suman ~0,5 KB gzip a `boot.js` (688,9 → ~690,2 KB min; gz 201,3 → 201,7): supera por ~0,2 KB el límite `min` 690 de boot.js (no se cambia el presupuesto; lo resuelve la integración sacando del bundle del celular el código solo de escritorio).

## F8-B91 — Estructura general de escritorio (barra lateral, cabeceras, paleta, selector de modelo, listas)

`App.tsx` publica `--header-inset` en `<main>` (112 px en Mac, 44 px en Windows, 0 con la barra visible) y las cabeceras/franjas suman
`pl-[calc(var(--header-inset,0px)+16px)]`: el botón flotante ya no pisa el título (D3). `PageHeader` gana `leading` y `variant`
(`page`/`workspace`) con un solo borde en escritorio. Franjas de aviso (`ServerBanner`, `EngineNotice`, `QuickEntryNotice` solo con `desk:`;
`UpdateNotice` libre): arrastrables, mínimo 36 px, botones de 28 px (D17). `Sidebar.tsx`: una sola guía a 22 px, filas de 32 px, búsqueda sin
borde, «Nuevo» sin caja y con el atajo siempre visible, trazo único 1.75, el modo actual conserva la marca suave con Ajustes abierto y
`aria-current` pasa a Ajustes (D5, D10, D15, D18); pie de 48 px. `CommandPalette`: velo `--scrim` vía `DialogScrim` (nuevos `components/Dialog.tsx`,
`layers.ts`, `surfaces.ts`), atajos como `<kbd>`, «Actual» como insignia, estado vacío con icono, «Esc cerrar» (clave `app.palette.close`) (D12).
`ModelPicker` (solo `desk:`): filas de 32 px, etiquetas en frase, insignias de 11 px (D13). Listas: Chat, Code (`SessionList` en una línea con barra
de acento y tiempo a la derecha, acciones de sección al pasar el ratón) y Tareas alineadas a la guía; etiquetas de grupo en FRASE en todas (decisión del dueño);
carpeta de Tareas como fila (D6, D7, D8). Icono del modo Tareas: `ListChecks` (D16). Pruebas: `Sidebar.render.test.tsx`, par `accent/bg-active` en `contrast.test.ts`.
Sin rediseñar `ConfirmDialog` (el velo ya lo arregla F1): los literales congelados no se tocaron. Pendiente/traspaso: las cabeceras de Chat/Code/Tareas/Comparar/Ajustes deben
sumar `--header-inset`; la fila buscador+filtros de Tareas es del agente de Tareas.

## F8-B92 — Rediseño de escritorio: conversación y Code (T1–T6, sin cambio en el celular)

Todo bajo `desk:` / `app/desktop/conversation.css` (`:root[data-shell='desktop']`); ninguna clase compartida se quitó ni se sustituyó, ninguna regla `.markdown` de `globals.css` se editó y no hay colores nuevos.
- **T1 defectos**: `UsageMeter` ya no parece un cargador (sin turnos del asistente no se pinta; anillo de 16 px con pista `--border`, arco solo con ≥1 %, extremos `butt`, y el `N %` al lado; el celular conserva su anillo); Enviar/Detener de Code `desk:shrink-0` (ya no se aplasta con el panel abierto) y con `aria-label`; adjuntar/mencionar con `aria-label`; cabecera de Code que encoge por prioridad (título > rama > proyecto, sin los 192 px fijos); degradado de 24 px sobre el compositor con `desk:before:` (CSS, cero coste por token).
- **T2 Markdown**: 15/24, encabezados en `--font-title`, código en línea sin borde, cita gris, casillas propias sin viñeta, cabecera de bloque de código sin franja, 13/20 en el código, tabla 14/20.
- **T3**: columna de 720 px (mensajes, compositores y avisos), ritmo de 24 px, burbuja del usuario plana de 16 px, acciones por mensaje de 28 px que flotan en el hueco (no abren vacío), un solo «pensando» (sin tres puntos; Code usa `ThinkingIndicator`) y un solo razonamiento (Code de escritorio usa el aspecto de Chat; contenido con `max-h-80`), «Build» ya no se pinta bajo cada mensaje (solo la insignia `Plan`), el historial de Chat ya no anima al abrirse.
- **T4**: Chat usa `ToolRow` (commit T4a) y agrupa herramientas con `StepGroup` (commit T4b, reversible por separado); fila de herramienta con chevron visible al enfocar con teclado (T4c).
- **T5**: compositor de Code con la caja del de Chat (radio 20 + halo), campo 15/24 hasta 288 px, pistas del Chat solo con foco, chips a 13 px, pie de Code que envuelve en vez de cortar Enviar.
- **T6**: tarjeta de permiso de Code sin halo (botones de 32 px, `kbd` a 0,8), pestañas del panel de 28 px, terminal 13 px con aire, árbol con filas de 26 px y foco interior visible, diff a 20 px y números de línea sin alfa.
- **Snapshots** (nunca `-u`; empalmes exactos con script en el scratchpad, verificados con `--word-diff`): `ChatMessageList` — fila del usuario sin `animate-rise-in` (3), 6 bloques de herramienta por su render de `ToolRow` (T4a), 3 envoltorios `StepGroup` (T4b); `MessageStream` — 4 bloques de razonamiento con el aspecto de Chat (T3). Dos pruebas con expectativas del diseño antiguo se actualizaron (`MessageStream.mobile`: sin puntos que rebotan; `ChatMessageList.mobile`: fila humanizada). Pruebas nuevas: `UsageMeter.render`, `ChatMessageList.group`.
- No hecho / pendiente: disparadores de `ModelPicker`/`EffortPicker` a 28 px (archivos con cambios de otro dueño), pistas de teclado de Code solo con foco, `DESIGN.md`, cabecera de hunk del diff a 11,5 px, `scripts/shot-mobile.mjs`. `size:pwa`: `boot.js min` 693,3 KB frente a 690 ya excedía antes de estas tandas (693,1 en 8e6abc1; esta área suma 0,2 KB); gzip 202,8/210.

## F8-B94 — Integración del rediseño de escritorio (peso de la PWA, pruebas y revisión visual)

- **Peso de la PWA** (sin tocar `pwa/budget.json`): `boot.js` pasa de 693,3 a 682,7 KB min (gz 202,8 → 200,1; límite 690/210). Dos pasos: (1) `pwa/vite.full.config.ts` gana el plugin `stripDesktopJsPlugin` (`src/renderer/remote/strip-desktop-js.ts`, con prueba) que quita las fichas `desk:` del JS minificado (el celular nunca marca `data-shell` y el CSS ya las perdía): -5,1 KB; (2) el popover de detalle del elemento (`ElementDetailPopover`) se baja bajo demanda en la PWA vía `SWAPS` + `remote/lazy/ElementDetailPopover.tsx`: -5,5 KB. Arranque total 285,2/300 KB gz y 750,1/780 KB min.
- **Guardia de alcance** (`app/desktop/desktop-scope.test.ts`): los literales `desk:` de PageHeader/CodeWorkspace/ui.tsx ya estaban corregidos por los dueños; los dos fallos que quedaban eran el ayudante nuevo de compilación (nombra `desk:`/`data-shell` para quitarlos), ahora exento como `strip-desktop-css`. La guardia no se debilita: sigue vigilando todo lo demás.
- **Verificación**: vitest completo 3723 pasan/19 omitidas (305 archivos), typecheck, lint (0 errores), format:check, build y build:pwa + size:pwa en verde; sin snapshots tocados.
- **Capturas**: escritorio 50 capturas (claro y oscuro) y celular 32 contra la base de F1: 24 idénticas; las 8 que difieren son textos de hora relativa («ayer»/«hace 23 h») y el icono de la pestaña Tareas (ahora `ListChecks`, decisión D16 del dueño; afecta también a la barra inferior del celular).
- **Defectos**: cabeceras de Code, Tareas, Comparar y Ajustes sin `--header-inset` (el botón de la barra colapsada pisaba el título): arreglado con `desk:pl-[calc(var(--header-inset,0px)+N px)]`. Sin arreglar (menores): selector «Agrupar: por fecha» de Tareas recortado en la barra lateral; `UsageMeter` muestra «0 %» junto a Detener en Tareas (datos falsos sin tokens; con turnos reales y contexto nulo se vería igual); la cabecera de Chat centrada sigue sin inset (solo roza con ventanas muy estrechas).

## F8-B95 — Cierre del rediseño de escritorio
- **Selector «Agrupar: por fecha»** (Tareas): en escritorio la etiqueta «Agrupar:» pasa a `desk:sr-only` (sigue siendo la etiqueta accesible) y el selector gana `desk:pl-2.5`; «por fecha» se lee entera junto a «Archivadas».
- **UsageMeter**: en escritorio no se pinta sin turnos, sin contexto o con un uso que redondea a 0 % (ya no hay aro vacío con «0 %» en Chat/Tareas); el celular no cambia. Prueba actualizada.
- **Icono de Tareas en el celular**: `MobileShell` vuelve a `Users` (escritorio sigue con `ListChecks`).
- **Verificación**: vitest renderer+test 1191 pasan, typecheck, lint (0 errores), format:check, build:pwa + size:pwa en verde (arranque 285,4 KB gz; budget.json intacto); captura tareas-lista revisada.

## F8-B96 — Piloto del rediseño de Claude Design (escritorio): barra lateral, inicio del chat, conversación y compositor
- **Barra lateral** (`app/Sidebar.tsx`, `ChatSessionList`, `desktop/shell.css`): 256 px sin borde (separada por tono `bg-sidebar`), filas de 32 px con 8 px de relleno y texto 14/20, fila activa con relleno de hover + peso 500 + icono de acento (sin la barrita de acento del historial), etiquetas de grupo en frase 11/16 de 28 px.
- **Inicio del chat vacío** (`ChatView`, `ChatComposer`): saludo 32/40 en la fuente de títulos, compositor flotante de 720 px (radio 20, alto mínimo 128, sin borde, `shadow-md`) y cuatro tarjetas de sugerencia en rejilla de 4 columnas (radio 12, `shadow-sm`, sin borde, icono en tile de 32 px + título + descripción nueva `chat.suggest.*.desc`; la quinta sugerencia «Traducir» sigue en el celular, no en la rejilla de escritorio). Sin logo ni halo.
- **Conversación y compositor inferior**: columna de lectura de 720 px reales (`measure-prose` + 48 de relleno), turnos a 32 px, bloques de la respuesta a 16 px (también en Markdown), burbuja del usuario con `bg-hover` radio 16 (78 %), compositor inferior radio 16 con `shadow-md`, nota 12/16 debajo.
- **Colores**: ninguno nuevo; `fill-selected`/`fill-hover` -> `bg-hover`, `fill-strong` -> `bg-active`, `surface` -> `bg-elevated`, `bg-app` -> `bg-bg`. Los hex del diseño difieren un poco de los de la app (p. ej. fondo `#121318` vs `#11131a`); se mantienen los de la app.
- **No hecho**: barra lateral colapsada de 56 px con iconos (hoy colapsar la oculta del todo, `inert`, y todas las cabeceras reservan `--header-inset`; requiere un riel nuevo y tocar `App.tsx`).
- **Verificación**: vitest renderer+test+shared 1602 pasan (snapshots sin cambios), typecheck, lint y prettier de los archivos tocados, build:pwa + size:pwa en verde (arranque 285,5 KB gz; budget.json intacto); capturas antes/después de chat-vacio y chat-conversacion en oscuro y claro.
