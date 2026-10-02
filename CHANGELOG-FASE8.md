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
- **Compositor de Code como combobox (M7).** El textarea lleva `role="combobox"`, `aria-haspopup="listbox"`, `aria-expanded`, `aria-controls` y `aria-activedescendant` (opciones con `id`), más `aria-label`. Nota: axe marca `aria-allowed-role` (nivel *minor*)
  porque ARIA en HTML solo prevé `combobox` en `input`; se mantiene a propósito (patrón de autocompletado de ARIA 1.2) y requiere comprobar con VoiceOver.
- **`aria-label` en botones solo-icono (M7).** Copiar y Bifurcar de cada mensaje de Code, Bifurcar y Compactar de la barra de Code y Quitar adjunto (que ahora también se ve con el foco del teclado). El punto de estado del pie de la barra lateral era un `span`
  con `aria-label` sin rol (violación *serious*): pasa a `aria-hidden` (el estado ya se lee como texto al lado).
- **Contraste (M8).** Misma paleta, solo más contraste: `--fg-subtle` `#8a91a3`→`#61697c` (claro, 2,97→5,18:1 sobre `--bg`) y `#6c7386`→`#858b9c` (oscuro, 3,92→5,45:1); `--success` `#15803d`→`#14793a` y `--warning` `#b45309`→`#aa4f09` (claro)
  para llegar a 4,5:1 también sobre barra lateral/código/hover; token nuevo `--gold-text` (`#876217` claro, igual al oro en oscuro) para el texto de las insignias doradas (`--gold` queda para iconos). Sobre la fila seleccionada (`bg-active`) el
  texto `text-subtle` usa `--fg-muted`. Capturas antes/después en claro y oscuro (820 y 1280 px) en `scratchpad/shots-c5/{before,after}`.
- **Landmarks (B2).** Tareas tenía un `<main>` dentro del `<main>` de la app (se vuelve `div`); las barras laterales llevan nombre (`aria-label`) para que no choquen como landmarks.
- **Cómo se mide el contraste.** `app/contrast.test.ts` lee `globals.css` y calcula la razón WCAG 2.x de cada token de texto (`fg`, `fg-muted`, `fg-subtle`, `accent`, `success`, `warning`, `danger`, `gold-text`) contra todas las superficies reales
  de cada tema (`bg`, `bg-sidebar`, `bg-elevated`, `bg-hover`, `bg-code`, `bg-inset`, `user-bubble`), `accent`/`gold-text` sobre sus fondos suaves, `accent-fg` sobre `accent`, y que se conserve la jerarquía fg > muted > subtle. Sin navegador: falla en `npm test`.
- **axe-core.** Nueva devDependency `axe-core` (hay que hacer `npm install` al integrar). `e2e/lib/axe.ts` lo inyecta por CDP en claro y oscuro; `calidad-t5.e2e.ts` ejecuta axe (etiquetas wcag2a/aa, wcag21a/aa y best-practice) en Chat, Chat con error 429, Code y Tareas
  con el OpenCode falso, y falla con violaciones *serious*, *critical* o *moderate*. Antes de la tanda: aria-prohibited-attr y color-contrast (todas las vistas), button-name *critical* en Code, tres de landmarks en Tareas. Ahora: solo queda
  `aria-allowed-role` *minor* (compositor de Code). Informes con `T5_AXE_REPORT`; capturas con `T5_SHOTS_DIR`.
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

- **Cobertura.** `e2e/specs/calidad-rc.e2e.ts` ejecuta axe-core (claro y oscuro; wcag2a/aa, wcag21a/aa y best-practice) y falla con violaciones *serious*, *critical* o *moderate* en: las 12 secciones de Ajustes visibles sin cuenta, Rutinas (lista, detalle y editor en sus pestañas de
  programación y modos Tareas/Code), diálogo de confirmación y de prompt, catálogo MCP, paleta de comandos, asistente de primer uso (5 pasos), Tareas (primer uso, confirmar carpeta, permiso, pregunta, escalada, Control total, tarjetas de plan y toma de control, panel del proyecto, grabar una skill),
  Code (confianza de carpeta, paneles Cambios/Terminal/Archivos, selector de sesión, worktree, permiso) y las ventanas propias (píldora de plan/toma de control/estado, guía y grabación). Informe con `RC_AXE_REPORT`, `RC_AUDIT=1` solo cuenta, capturas con `RC_SHOTS_DIR`.
- **Violaciones halladas y arregladas.** Tarjeta de rutina: `role="button"` con un interruptor dentro (*serious* nested-interactive) → la tarjeta se sigue pudiendo pulsar entera con el ratón, pero el control de teclado/lector es un botón con el nombre y el interruptor queda al lado. Botón de cerrar del selector de sesión de Code sin nombre
  (*critical*, ahora `code.sessions.close`). Campo del diálogo de prompt (renombrar/mover tarea) sin etiqueta (*critical*) y campo de rama del diálogo de worktree sin etiqueta ni nombre del diálogo. Esqueleto de la lista de Chat con `aria-label` en un `div` (*serious*, ahora `role="status"`).
  Vista previa de configuración del catálogo MCP con scroll sin acceso por teclado (*serious*, `tabIndex=0`). Contraste: `--warning` claro `#aa4f09`→`#954308` (aviso de Rutinas, 4,45→5,5:1), `--danger` claro `#c0352b`→`#b52f26` (estado «Error» sobre la fila activa, 4,28→4,76:1),
  `amber-600`→`amber-700` (botón «Permitir» de Control total, insignias de acceso, 3,2→5,0:1), archivos ignorados del panel Archivos `opacity-50`→`opacity-70`, y en las ventanas de píldora/guía/grabación los botones Detener/Terminar (`#dc2626`), Siguiente (`#7c3aed`) y Permitir de la toma de control (`#2563eb`), que con blanco no llegaban a 4,5:1.
  La tarjeta de petición de la píldora es una región con nombre (landmark).
- **Foco de los diálogos.** `lib/modal-focus.ts` (instalado en `main.tsx`) vigila `[aria-modal="true"]`: al abrirse mete el foco si el diálogo no lo hizo, Tab/Mayús+Tab no salen del diálogo de más arriba (sin pisar a los que ya lo hacen) y al cerrarse devuelve el foco al control previo
  si sigue en pantalla y el foco se perdió. Antes ni la confirmación, ni el editor de Rutinas, ni el catálogo MCP devolvían el foco, y varios asistentes/tarjetas no tenían trampa. El selector de sesión de Code y el de worktree pasan a `aria-modal`; el selector cierra con Esc desde cualquier control.
  Unitaria de la función pura `tabTarget`; E2E de contrato (entra, 25 Tab y 25 Mayús+Tab sin salir, Esc cierra y devuelve el foco) en cada diálogo.
- **No es violación / se deja.** Compositor de Code: `aria-allowed-role` *minor* (combobox en textarea), igual que en F8-B33. El ejemplo de «Quick Entry» no se audita con axe (ventana con preload propio, sin cambios). Menú contextual de tareas y popovers de confirmación en línea de Code (`alertdialog` sin `aria-modal`): son
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
  botones de peligro (`bg-danger text-white`): en oscuro el blanco sobre el salmón daba ~2,3:1 (*serious*, «Borrar mi cuenta», confirmaciones, conflicto) → token `--danger-fg` (blanco en claro, `#2a0805` en oscuro; `Button`, `ConfirmDialog`, `ui.tsx` de Code, lista de Chat, insignia de conflicto);
  Quick Entry: la pista «esc cerrar» (`--q-muted`) no llegaba a 4,5:1 en claro ni en oscuro (*serious*) y la ventana no tenía landmark (*moderate* `region`) → `--q-muted` más contrastado y el contenedor pasa a `<main>`. La pantalla de acceso y la Cuenta en claro no tenían violaciones.
  No auditado: el aviso de error de Quick Entry (lo cambia R3-A en paralelo).
- **`no-ai.e2e.ts` (d) inestable: causa raíz y arreglo.** Bucle de 30 ejecuciones aisladas (`-t "(d)"`, sin reintentos), sobre el código anterior: sin carga 29/30 (1 fallo, el de «Ocultar detalle») y con carga de CPU (10 `yes`, un núcleo cada uno) 30/30. Causa: `ErrorNotice` ponía el rótulo de «Ver detalle» desde el evento `toggle` de
  `<details>`, que se despacha en una tarea posterior a que el contenido ya esté visible; la prueba esperaba el contenido (`statusCode: 401`) y leía el texto de la página antes de que llegara `toggle`, con el rótulo viejo. No era la animación ni el estado inicial. Arreglo en el producto: `<details>` controlado
  (`open` desde React, el clic de `<summary>` alterna el estado), de modo que rótulo y contenido cambian en el mismo render; la prueba además espera «Ocultar detalle» con reintento. Tras el arreglo: 30/30 sin carga y 30/30 con carga. Honestidad: el fallo sin arreglo es raro (1/30, y 0/30 con carga), así que la evidencia de causa es el
  mecanismo y la firma idéntica del único fallo capturado, no una diferencia estadística grande.
- **`npm run perf:startup` (manual, fuera de `verify`).** `e2e/perf/startup.perf.ts` + `vitest.perf.config.ts`: arranque en frío (5 lanzamientos: primer pintado e interactiva) y RSS de todo el árbol de procesos con 3 conversaciones largas falsas durante 5 min. Umbrales sugeridos y cifras actuales en `docs/VERIFICACION.md`:
  primer pintado 398 ms (máx. 466), interactiva 600 ms (máx. 645), RSS 585 MB sin conversaciones, pico 871 MB al cargar las tres, ~725 MB asentado y 586 MB a los 5 min (sin fuga). Nada superó un umbral razonable: sin cambios de producto por este punto.
- **Descartar cambios en Code (M3 completo).** (1) *Se conserva lo preparado:* `git:discard` acepta `scope: 'unstaged'` y el panel lo usa desde la fila de «No preparados» (solo el árbol de trabajo vuelve a lo preparado; el diálogo lo dice); desde «Preparados» sigue yendo todo a HEAD. «Deshacer» ahora también vuelve a preparar lo que estaba preparado
  (blob del índice con `git update-index --cacheinfo`, o `git rm --cached` si el borrado estaba preparado) y se apoya en el hash del archivo tras el descarte en vez de en `git status`. (2) *Por bloque:* canal nuevo `git:discardHunk` (solo ventana principal, esquema estricto, sin rol secundario; preload `code.git.discardHunk`), botón «Descartar este bloque» en cada `@@` del diff de «No preparados»
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
