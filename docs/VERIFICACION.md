# Verificación

## Cómo correr la verificación

Requiere Node 22 (`export PATH=/opt/homebrew/opt/node@22/bin:$PATH`). Ningún comando toca el userData real de la app
ni los servidores OpenCode del usuario.

| Comando | Qué cubre |
|---|---|
| `npm run typecheck` | `tsc` de main/preload y del renderer. |
| `npm test` | Vitest unitario (`src/**`). No recoge `e2e/`. |
| `npm run lint` | ESLint sobre `src`. |
| `npm run build` | `electron-vite build` (main, preload, renderer). |
| `npm run test:transform` | Cada archivo del renderer pasa por la cadena de Vite dev (Babel/Tailwind/alias), sin Electron. |
| `npm run test:smoke` | Humo con Electron (script propio `e2e/smoke.mjs`). |
| `npm run test:e2e` | E2E con Electron real + OpenCode falso (ver abajo), modo dev-renderer con ganchos `__onyxE2E`. |
| `npm run test:e2e:prod` | Igual pero cargando por `onyxcode://app` con la CSP real; solo aserciones de humo (no hay ganchos). |
| `npm run test:fs` | **Opcional, solo macOS, fuera de `verify`.** Puntos de restauración sobre volúmenes reales: monta imágenes `hdiutil` ExFAT, FAT32 y HFS+ con mayúsculas (`-nobrowse`, `detach -force` al terminar) y repite crear → modificar/crear/borrar → cambios → deshacer → rehacer. Activa `ONYXCODE_FS_IT=1`. |
| `npm run test:stress` | **Opcional, fuera de `verify`.** Estrés de los puntos de restauración (`ONYXCODE_STRESS=1`): 19 990 archivos entran y 20 010 dejan el punto omitido, incremental de 5 000 archivos rápido, p99 del retraso del bucle de eventos < 100 ms y RSS < +200 MB con dos archivos de 45 MB. Tarda ~15 s. |
| `npm run check:mcp-catalog` | **Manual, con red, fuera de `verify`.** Cada ficha del catálogo MCP (`src/shared/mcp-catalog.ts`) debe responder como servidor MCP a un `initialize` (200, 401 o 405) y su documentación debe responder 200. Salida 1 si alguna falla, 3 sin red. Ejecutar al tocar el catálogo y de vez en cuando (las URL de los proveedores cambian). |
| `npm run verify:update-manifest` | **Sin red ni `.app`, rápido.** Genera una clave Ed25519 efímera y un ZIP falso, firma un manifiesto como `publish-update.mjs` y exige que se acepte el legítimo y se rechace cada manipulación (firma, byte, otra clave, downgrade, appId/keyId/tag, SHA-256/tamaño del ZIP, manifiesto enorme…); además valida `UPDATE_PUBLIC_KEY`/`UPDATE_KEY_ID` de `brand.ts`. También corre en `npm test` (`src/main/update/manifest-script.test.ts`, que añade la paridad con el cliente real). |
| `npm run perf:startup` | **Manual, fuera de `verify`.** Arranque en frío y memoria con la app construida (`npm run build` antes; usa `out/` en modo prod). Ver «Medición de arranque y memoria». |
| `npm run verify` | typecheck, tests, lint, build, transform, smoke y e2e, en ese orden. |

## Windows (PC de pruebas, `scripts/win/`)

`STEPS=ci,typecheck,unit,build scripts/win/sync.sh` (desde la Mac) sube el árbol a `C:\onyx\wt` y ejecuta `C:\onyx\run.ps1` (Node 22 portátil en `C:\onyx\node22`; límites ci 900 s, typecheck 300, unit 600, build 300, e2e 2400, package 1500; limpia huérfanos al empezar y al acabar). Pasos extra: `fetch` (descarga y verifica `opencode.exe`) y `bundle` (`check:win-bundle`). `scripts/win/smoke.ps1` arranca la app sin pantalla con `OPENCODE_BIN`, comprueba «listo» < 30 s, cierre limpio (`WM_CLOSE`), huérfano simulado eliminado y ningún proceso sobrante; `procs.ps1` lista lo que cuelga de `C:\onyx`.

Saltos de `vitest` en Windows (`src/test/platform.ts`; ninguno es de la v1 salvo los de fixtures POSIX, que se sustituyen en la tanda 3):
- `macOnly` (Tareas/actualizador): `sandbox-profile.test.ts` (Seatbelt), `restore-points.test.ts` (puntos de restauración del modo Tareas), `swap.test.ts` (`validateSwapArgs`, `startSwap`), `swap.integration.test.ts`, y en `main-errors.i18n.test.ts` las comprobaciones de `forbiddenFolderReason` (folder-policy).
- `posixOnly` (fixtures `#!/bin/sh`, permisos, `mkfifo`): `binary.test.ts` solo en 4 casos (enlace simbólico y bit de ejecución, que Windows no tiene; y «resolución completa con CLI y embebido reales», que necesita un `opencode.exe` real con versión controlada: la decisión se cubre en `pickOpencode` y `bundledOpencodePath` con rutas win32). El resto corre en Windows con un `.mjs` falso lanzado con `node` (`opencode/test-launcher.ts`), `m001-tasks-rename.test.ts` (un caso con `chmod`), `installer.test.ts` (FIFO) y las aserciones de modo `0600`/`0700` en `account/store`, `mcp-catalog-install`, `installer` y `data-dir`.
- `service.win.test.ts` (terminal real con ConPTY y `asarUnpack` de node-pty) solo corre en Windows (`winOnly`; en macOS la shell depende del `.zshrc`); la elección de shell (`shell.test.ts`) corre en todas.
- Los repos temporales de `git/*.test.ts` fijan `core.autocrlf=false` (el sistema de Windows trae `true`).

### E2E en Windows (tanda 3)

**Cómo se corre:** `STEPS=ci,typecheck,unit,build,e2e scripts/win/sync.sh` desde la Mac (host `ONYX_WIN_HOST`, por defecto `win-onyx`: entrada de `~/.ssh/config` por túnel de Cloudflare; `SPEC=<filtro>` con `STEPS=e2e` corre una sola spec; el ssh lleva `ServerAliveInterval`). Entera tarda ~8 min con los límites de `run.ps1` (e2e 2400 s).

**Dónde se abren las ventanas (decisión):** Electron SÍ abre ventanas y Playwright las controla desde una sesión SSH sin escritorio (sesión 0 con pantalla virtual de 1024x768), con el modo sin pantalla existente (`src/main/e2e-headless.ts`: opacidad 0, sin ratón, `showInactive`). Se eligió ese modo porque no toca nada del usuario ni la configuración global, no hace falta una tarea programada y los resultados son los mismos: se probó una tarea de `schtasks /IT` bajo `C:\onyx` en la sesión interactiva del dueño (con y sin `E2E_VISIBLE=1`, avisando de que mostraba ventanas) y fallaron exactamente las mismas 2 pruebas (ver abajo), así que no aporta; la tarea se borró. Único ajuste: la pantalla virtual recorta la ventana de 1280x820 a ~1008x703 y el panel de Code tapaba los botones de la barra, así que `launch.ts` la devuelve a 1264x760 en win32 (solo pruebas).

- **Lanzador falso (solo pruebas):** el OpenCode falso es un script. En `!app.isPackaged`, win32 y ruta `.mjs`, `server.ts` y `binary.ts` ejecutan `node <mjs> …` (`src/main/opencode/test-launcher.ts`; nunca empaquetado ni con un `.exe`). `ONYXCODE_TEST_BUNDLED_DIR` acepta `opencode.mjs` si falta `opencode.exe` (también solo sin empaquetar).
- **Procesos:** `e2e/lib/proc.ts` (pgrep/pkill en POSIX; `taskkill /T /F` y CIM en Windows, con tiempo límite) lo usan `launch.ts` y `lotes.ts`. `global-setup.ts` lanza `electron-vite` con node. `E2E_MODE=prod` y `perf:startup` no se han adaptado.
- **Saltos de specs enteras** (`e2e/win-skip.json`, solo win32; cada entrada con motivo y ninguna de la v1, vigilado por `src/test/win-skip.test.ts`): `restore`, `tasks-stall`, `update-check`, `update-install`, `legacy-data`.
- **Saltos dentro de specs** (`describe/it.skipIf(IS_WIN)`, solo bloques de Tareas): `lotes` (Lote B: Tareas y política gestionada), `lru` («Tareas real»), `fase6` («Tareas y Code en la misma carpeta»), `own-auth` (Tareas con sandbox), `calidad-rc` (6 casos «Tareas…»), `calidad-r3a` («Tareas: arriba vuelve»), `calidad-t1/t2/t4/t5` (el caso de Tareas), `calidad-t3` (Tareas interrumpida y Cmd+Q con tarea ocupada), `perf` (bloque de Tareas), `i18n` (5) y `i18n-main` (1, `tasks:folders:check`).
- **Saltos que NO son de alcance:** solo queda uno, por dependencia de zsh: `calidad-r3a` «terminal sin caracteres sueltos» (`ZDOTDIR`); la terminal de Windows se cubre en `pty/service.win.test.ts` y, con la app empaquetada, en `scripts/win/pack-check.ps1`.
- **Ratón por CDP en el navegador integrado (resuelto, tanda 4).** Los dos casos de `lotes` Lote D («Pagar ahora» y «un enlace normal navega») y el clic con escala de `navegador-escritorio` estaban saltados porque `Input.dispatchMouseEvent`/`sendInputEvent` «no llegaban» en Windows. **Causa raíz (medida):** en el código de entonces (`layoutView` anterior a F8-B46) la vista de una pestaña nueva del agente NO se colgaba de la ventana si ya había otra vista del mismo owner colgada (solo se colgaba al cambiar de ventana): la pestaña `wc 4` (la tienda) estaba viva, «visible» y con foco para su renderer, pero `win.contentView.children` solo contenía la vista del `wc 3` (`about:blank`). Una `WebContentsView` que no está en la ventana no recibe entrada en Windows (Chromium/Aura no la enruta; en macOS la `NSView` suelta sí la procesa, por eso allí pasaba). Evidencia: en el árbol de la tanda 3 (14e675a, probado con una sonda temporal) `sendInputEvent` y CDP dejaban 0 eventos DOM en la página y `attachedViews = [3]`; con el árbol actual, la misma sonda recibe `mousemove/pointerdown/mousedown/mouseup/click` incluso con la ventana en modo sin pantalla (opacidad 0, `setIgnoreMouseEvents(true)`), sin tocar foco ni `setBounds`. Descartados con la sonda: foco de ventana/vista, opacidad/ignorar ratón, tamaño de pantalla virtual, escala/DPI y emulación de dispositivo (activarla con escala 1 no cambia nada). **No era un defecto del entorno ni de CDP:** lo arregló F8-B46 (`discardTab`/`attachedTabId`: una sola vista colgada por owner, la de la pestaña activa) sin saberlo; los tres casos están reactivados y pasan en Windows. El especificador `Meta+…` de `lotes` pasó a `ControlOrMeta+…` (en Windows el atajo es Ctrl, desde los atajos configurables).
- **`perf` «2000 deltas» en Windows (calibrado, tanda 4).** Cuatro corridas en el PC de pruebas (sin GPU, render por software, CPU x4): **206–219 tareas largas, suma 17,0–17,6 s, máximo 343–345 ms** (variación < 6 %). Presupuesto propio de Windows con ≈ 40 % de margen: **300 tareas, 25 s en total, máximo 800 ms** (en macOS siguen 40 / 3 s / 800 ms; todo sobrescribible con `E2E_PERF_MAX_LONGTASKS`/`_MAX_TOTAL_MS`/`_MAX_MS`). Sigue detectando la regresión vigilada (sin los cambios: 3–4 tareas de 75–91 s, suma > 225 s). La diferencia con macOS es del renderizado por software de ese PC, no de la app; si se vuelve a medir en un equipo con GPU, bajar el presupuesto.
- **Adaptaciones de las specs:** `ControlOrMeta` en los atajos, textos «PC»/«Mac» (`DEVICE`), asistente de 4 pasos («Los tres modos», sin permisos de macOS), ajustes de 8 secciones, sin bits de permiso POSIX, `core.autocrlf=false` en los repos de prueba, `instance`: con la ventana cerrada en Windows se comprueba que la app sale (decisión de la v1) en vez de reabrir.
- Pruebas unitarias saltadas en Windows tras la tanda 3 (todas fuera de la v1): `manager.fullaccess.test.ts` (Control total sin carpeta, modo Tareas) y `installer.test.ts › cancelar a mitad` (actualizador, solo macOS).
- `e2e/smoke.mjs` (`test:smoke`) usa grupos POSIX: en Windows lo sustituye `scripts/win/smoke.ps1`.
- Resultado de la última corrida completa en Windows: 29 archivos de 34 (los 5 de `win-skip.json` se excluyen), 162 pruebas pasan, 49 saltadas; 2 pasaron en el reintento (Quick Entry de `instance` y la tarjeta de permiso de `calidad-r3a`).

### Paquete de Windows (tanda 4)

**Construir (en el PC Windows, árbol `C:\onyx\wt`):** `STEPS=package scripts/win/sync.sh` (corre `npm run package:win`; ≈ 40 s; deja `dist\OnyxCode-Setup-<versión>-x64.exe` y `dist\win-unpacked`). **Comprobar sin firma:** `powershell -NoProfile -ExecutionPolicy Bypass -File C:\onyx\wt\scripts\win\pack-check.ps1 -Branch <rama> -Install` (log `C:\onyx\logs\<rama>\pack-check.txt`; solo toca `C:\onyx\`, el instalador de prueba va a `C:\onyx\inst` y se desinstala). Comprueba: artefacto y tamaño; `app.asar` sin `helper.swift`/`launcher`/`updater`/`cu-helper`/`swap.sh`; node-pty desempaquetado (`conpty.node`, `conpty.dll`, `OpenConsole.exe`); fuses (RunAsNode, NodeOptions y inspect desactivados; integridad del asar y solo-asar activados); `resources\opencode\opencode.exe --version` = 1.18.33; metadatos PE; humo de la app empaquetada (proceso vivo, `opencode.exe` hijo en ≈ 2 s, terminal PowerShell que responde por la API real del preload con el fuse `runAsNode` desactivado —`scripts/win/pty-probe.mjs`, por `--remote-debugging-port`—, la app sale al cerrar la ventana y no queda ningún proceso); instalación silenciosa `/S /D=C:\onyx\inst`, el mismo humo sobre lo instalado, desinstalación silenciosa y limpieza (carpeta, clave `HKCU\…\Uninstall`, accesos directos).

**Resultado (rama `feat/win-t4-instalador-y-paridad-v1`, Windows 11, sin firma):** instalador 151,6 MB (158 935 425 bytes), 0 fallos de 32 comprobaciones. `ProductName=OnyxCode`, `FileVersion=0.3.0`, Authenticode `NotSigned`.

**Defecto del script encontrado y corregido:** `package:win` llamaba a `electron-builder` a secas; en `cmd`, el directorio actual va antes del PATH y `PATHEXT` incluye `.JS`, así que se ejecutaba `electron-builder.js` (la configuración) con Windows Script Host y el proceso se quedaba colgado sin hijos ni mensaje (con la ventana oculta, un diálogo invisible). Ahora llama a `node node_modules/electron-builder/cli.js`.

**NO verificable sin firma:** SmartScreen («Windows protegió su PC» en la primera ejecución del instalador descargado: hay que pulsar «Más información › Ejecutar de todas formas»; la reputación se gana con un certificado de firma de código y descargas), la reputación ante Defender y el comportamiento de un instalador descargado con la marca de la Web (`Zone.Identifier`); tampoco la actualización automática (no existe en Windows en la v1: se reinstala encima; no se probó qué ocurre con datos reales de usuario al desinstalar, solo con un `--user-data-dir` de pruebas).

## Medición de arranque y memoria (`npm run perf:startup`)

`e2e/perf/startup.perf.ts` (config `vitest.perf.config.ts`, `E2E_MODE=prod`, con OpenCode falso y userData temporal; nunca toca datos reales). No forma parte de `verify`: tarda ~5,5 min y depende de la máquina. Hace dos cosas:

1. **Arranque en frío** (`PERF_STARTS`, 5 lanzamientos): milisegundos desde el inicio del proceso principal hasta el primer pintado del renderer (`first-contentful-paint`) y hasta que la app está **interactiva** (barra de modos visible y servidor falso conectado; es el tiempo de pared desde el lanzamiento, con la ventana oculta del modo E2E).
2. **Memoria** (`PERF_MINUTES`, 5): crea 3 conversaciones de Chat largas (`PERF_TURNS`=6 turnos de 1 500 deltas cada una, ~25 KB por respuesta), las alterna cada 30 s con la app abierta y mide el RSS de **todo el árbol** de procesos (Electron, helpers y el servidor falso; `ps -o rss`) cada 30 s.

Variables: `PERF_STARTS`, `PERF_MINUTES`, `PERF_TURNS`, `PERF_JSON=/ruta` (guarda `.startup.json` y `.memory.json`), `PERF_STRICT=1` (superar un umbral falla en vez de avisar). Hace falta el cerrojo de E2E si otra tarea usa Electron a la vez.

| Métrica | Umbral sugerido | Medido (R3-B, M-series, macOS, prod) |
|---|---|---|
| Primer pintado (mediana / máx.) | ≤ 1 500 ms | 398 / 466 ms |
| Interactiva (mediana / máx.) | ≤ 2 500 ms | 600 / 645 ms |
| RSS del árbol sin conversaciones | (referencia) | 585 MB |
| RSS pico tras cargar 3 conversaciones largas | ≤ 1 200 MB | 871 MB |
| RSS asentado a los 1–3,5 min | ≤ pico | 711–726 MB |
| RSS a los 5 min | sin crecimiento > 10 % desde el minuto 1 | 586 MB (−19 %: el sistema recupera memoria; no hay fuga) |

Si un umbral se supera: repetir (la primera medición tras compilar suele ser peor), mirar `PERF_JSON` y comparar con `E2E_MODE=dev` solo para descartar Vite; un arranque lento real suele ser una carga síncrona nueva en `main/index.ts` o en el primer render, y un crecimiento sostenido de RSS un almacén (`stores/`) que acumula mensajes sin liberar al cambiar de conversación.

## Harness E2E (`e2e/lib, `e2e/specs`, `vitest.e2e.config.ts`)

Runner: Vitest con `pool: forks`, sin paralelismo entre archivos (una app Electron por archivo de spec),
`testTimeout`/`hookTimeout` de 120 s. Los specs son `e2e/specs/**/*.e2e.ts`.

Flujo de cada corrida:

1. `e2e/lib/global-setup.ts`: `electron-vite build` (main/preload/renderer en `out/`) y, en modo dev, un servidor Vite
   solo-renderer (API de Vite con la config `renderer` de `electron.vite.config.ts`, puerto libre) → `E2E_RENDERER_URL`.
   Con `import.meta.env.DEV=true` existen los ganchos `window.__onyxE2E`.
2. `startApp()` (`e2e/lib/launch.ts`): crea un userData temporal `onyx-e2e-*` (con `realpath`), escribe `settings.json`
   mínimo con `defaultModel = fake/fake-model` (sin él, `migrateLegacyUserData` movería datos reales de Lapis/OpenDesk),
   copia el OpenCode falso al tmp y lanza `_electron.launch` con `--user-data-dir=<tmp>`, `ELECTRON_RENDERER_URL`
   (solo dev), `OPENCODE_BIN`, `XDG_*` al tmp, `OPENCODE_SIDECAR_LOG=1` y `ONYXCODE_E2E_HEADLESS=1`.
3. La app gestiona el falso como sidecar. El cliente `FakeClient` (`e2e/lib/fake.ts`, API `/__e2e/*`) obtiene puerto y
   credenciales del IPC `opencode:connection` (funciona también en prod).
4. Al terminar (aunque falle): cierra la app, mata descendientes y todo proceso cuyo argv mencione el tmp, y borra el tmp.

Colectores (fallan el test en `afterEach` vía `useApp()` de `e2e/lib/harness.ts`): `console.error`, `pageerror` y líneas
de stdout/stderr de main que casen `\[ipc\] canales sin esquema`, `Pre-transform error`, `Internal server error`,
`Uncaught`, `UnhandledPromiseRejection`. Lista blanca en `e2e/allowlist.json`: arreglo de `{ "pattern": "<regex>",
"reason": "<por qué>" }` (ambos obligatorios). Al fallar se guardan captura y `unknown-routes` del falso en
`e2e/.artifacts/` (ignorado por git).

Utilidades: `dialogs.ts` (`stubDialog`, `dialogCalls`), `notifications.ts` (`spyNotifications`: `shown()`, `badge()`,
`clear()`), `stores.ts` (`storeState`, `storeCall`, `storeSet`, `hook`, `setMode`, `waitForHooks`), `wait.ts`
(`expectVisible`, `expectCount`, `expectAttr`: aserciones con reintento, playwright-core no trae `expect`),
`withLru(app, n)` en `launch.ts` (fija `localStorage['onyx.lru.max']` y recarga; solo dev).

Variables de entorno:

| Variable | Efecto |
|---|---|
| `E2E_MODE=prod` | Carga por `onyxcode://app`, sin ganchos (lo fija `test:e2e:prod`). |
| `E2E_SKIP_BUILD=1` | Reutiliza `./out` en vez de recompilar (`out/` debe estar al día). |
| `E2E_DEBUG=1` | Vuelca stdout/stderr de main. |
| `E2E_VISIBLE=1` | No define `ONYXCODE_E2E_HEADLESS` (ventana visible). |
| `E2E_KEEP=1` | No borra el userData temporal (para inspeccionarlo). |
| `E2E_LAUNCH_ATTEMPTS` / `E2E_LAUNCH_TIMEOUT_MS` | Reintentos (6) y timeout por intento (8000 ms) de `electron.launch`. |
14. **Asistente de primer uso con un OpenCode real (3 min; F8-B1 a F8-B4).** Con un userData nuevo
    (`--user-data-dir=/tmp/onyx-nuevo`, sin `onboarded`) y `PATH`/`~/.opencode` sin OpenCode: aparece el paso 1; «Copiar comando
    de instalación» deja `curl -fsSL https://opencode.ai/install | bash` en el portapapeles (la app no lo ejecuta), «Abrir
    instrucciones» abre https://opencode.ai/docs. Instala OpenCode en una terminal, «Reintentar» → «OpenCode encontrado». En
    el paso 2, «Obtener mi clave» abre la página de OpenCode y una clave real de OpenCode Go la deja «conectada»; el paso 3
    lista sus modelos. Con tu userData real (todo ya funciona) el asistente NO aparece y `settings.json` queda con
    `"onboarded": true`. Un OpenCode recién instalado y sin claves también debe mostrar el paso 2 (el proveedor gratuito
    preinstalado no cuenta como conectado).

Notas conocidas:

- `_electron.launch` de Playwright se cuelga de forma intermitente con esta app (sobre todo en prod: ~60 % de los
  intentos; en dev casi nunca). Un intento sano tarda menos de 3 s, por eso el harness reintenta con timeout corto; los
  reintentos se anuncian como `[e2e] electron.launch intento n/6 falló` y no son un fallo del test.
- El sidecar corre desvinculado de TCC (`disclaim`): no puede leer scripts dentro de `~/Documents`. Por eso el falso
  se copia al tmp antes de usarlo como `OPENCODE_BIN`.
- `startApp` admite `userData` (reutilizar el estado al reiniciar) con `keepUserData`, y `noServer` (arrancar sin esperar
  al servidor; `app.connectFake()` lo conecta después). Lo usa `onboarding.e2e.ts` (sin OpenCode → elegir binario →
  clave → reinicio). Los harness siembran `onboarded: true`; un spec del asistente lo pone en `false` vía `settings`.
- Un spec que provoque errores a propósito debe vaciar `app.errors` al terminar (ver `harness.e2e.ts`).

## Specs de los lotes B y D (`e2e/specs/lotes.e2e.ts`)

Automatiza lo posible de las guías manuales del lote B §4 y del lote D §4 (documentación interna de proceso) contra la app real.
Ayudantes propios en `e2e/lib/lotes.ts`; página de prueba `e2e/pages/tienda.html`. Solo modo dev (`describe.skipIf` en prod).

- **Las tareas sí corren en el harness**: el sandbox Seatbelt de las tareas deniega leer el userData de la app, y el falso que
  copia `startApp` vive dentro de él (`code=126`). `fakeOutsideUserData()` lo copia a otro tmp y se pasa como
  `OPENCODE_BIN` en `startApp({ env })`. La carpeta de trabajo tiene que estar bajo `~` (`makeTasksDir()` crea
  `~/onyx-e2e-cw-*`): la política de carpetas rechaza `/private/var/...`. La conexión del servidor de la carpeta se obtiene
  con `tasksFake(page)` (un `FakeClient` sobre `useTasks.conn`).
- **MCP del navegador**: `mcp.browser` (URL + Bearer) sale de `fake.config().content.mcp.browser`; `BrowserMcp` habla JSON-RPC
  con `onyxcode_session` = id de una sesión real del falso (main la resuelve con `GET /session/:id`). Antes de `new_page`
  hay que tener una pestaña humana y el panel abierto (`prepareCodeBrowser`), y esperar a que el usuario esté inactivo
  (`waitUserIdle`: un Escape o clic reciente cuenta como humano, las acciones de entrada del agente se rechazan y la
  navegación se atribuye al usuario, sin tarjeta). `neutralizeNativeApprovalDialog` anula el diálogo nativo de respaldo.
- El describe `mailto:`/`tel:` ya corre siempre (F7-B1 arregló el crash del proceso principal; antes exigía `E2E_REPRO_CRASH=1`).

### Bugs reales que destapó (arreglados en la Fase 7; ver `docs/HALLAZGOS-E2E.md`)

| Caso | Qué pasa | Dónde |
|---|---|---|
| Carpeta prohibida en Tareas (`~`, `~/Library`) | `approvePending` guarda el motivo en `useTasks.error` pero solo se pinta con `phase === 'error' && folder`: el usuario no ve el mensaje. | `tasks/impl/actions.ts` + `TasksWorkspace.tsx` (`phaseBanners`) |
| Foco por defecto en «Cancelar» de la tarjeta de aprobación | `denyRef.current?.focus()` corre al montar con el botón `disabled` (aún sin armar): no recibe foco y nada lo enfoca al armarse. Enter no deniega. | `browser/Cards.tsx` (`ApprovalCard`) |
| Navegar el navegador integrado a `mailto:` / `tel:` | Mata el proceso principal (SIGTRAP en `CrBrowserMain`, informes `~/Library/Logs/DiagnosticReports/Electron-*.ips`); la guía esperaba «no abre Mail». Arreglado en F7-B1. | `embedded-browser/surface.ts` / `service.ts` (guardas de navegación) |

Observaciones (con test que documenta el comportamiento actual): un origen local aprobado con «Permitir siempre» puede
hacer `fetch` a cualquier otro puerto de loopback (`session.ts` mira el origen de la página, no el destino); «en esta
tarea» no cuenta para esa regla. Los mensajes de denegación llaman «0.1» al sitio de una IP (`siteOf('127.0.0.1')`).

## Checklist humana (≈15 min)

Solo lo que un test no puede ver o tocar. Requiere `npm run dev` (o el `.app` empaquetado), tu userData real y una cuenta/
modelo reales. Marca cada punto; entre paréntesis, el tiempo aproximado.

1. **Permisos TCC y computer use (3 min; Lote C 0–2, 8).** Ajustes → Control del Mac: «Accesibilidad» y «Grabación de
   pantalla» siguen concedidos tras cualquier recompilación del helper. Pide «abre Calculadora y suma 2+2» en Control total:
   aparece el plan, lo apruebas, el cursor se mueve y el resultado se ve. ⌘⇧Esc detiene todo (Modo guía, takeover, grabación).
   Esperado: nunca se pide de nuevo un permiso ya concedido.
2. **Modo guía y grabar skill con micrófono (2 min; Lote C 3–4).** «Enséñame a abrir Ajustes del Sistema»: globo junto al
   elemento con «Siguiente»/«Salir de la guía», sin clics del agente. «Grabar skill»: macOS pide Micrófono y Reconocimiento
   de voz; narra 3 pasos y «Terminar»; la tarjeta muestra pasos y transcripción; solo «Guardar» escribe `SKILL.md`.
3. **Notificaciones nativas (2 min).** Lanza una tarea larga en Tareas, cambia de carpeta y espera: llega la notificación
   con el aspecto y sonido correctos en el Centro de notificaciones, el clic enfoca la ventana y abre esa tarea, y el badge
   del Dock suma/resta con las pendientes. Con «Sonido» apagado no suena.
4. **Atajo global de Quick Entry (1 min).** Con la app en segundo plano, pulsa el atajo físico: aparece el cuadro, escribes
   y Enter abre Chat con la respuesta. Esperado: funciona aunque otra app tenga el foco.
5. **Foco real en instancia única (1 min).** Con la app minimizada, abre una segunda con `open -n -a OnyxCode` (o el
   binario): la primera se restaura y toma el foco, la segunda no queda en el Dock.
6. **Login de Google en el navegador embebido (1 min; Lote D 6, 12).** Abre accounts.google.com en el panel Navegador:
   puede rechazar el navegador embebido (esperado); el agente nunca teclea la contraseña. `ps aux | grep remote-debugging`
   sin resultados. Una página de prueba con `getDisplayMedia` y geolocalización se deniega.
7. **Calidad con LLM real y búsqueda web real (2 min; Lote B 3–7, 15).** En Tareas (sandbox): «Primero revisa esta carpeta y
   resume…»: respuesta coherente; «busca en la web X y cita fuentes»: devuelve fuentes reales. En una carpeta de prueba:
   pide mover archivos (aparece «Permitir borrar, mover y renombrar»; sin permiso ofrece copia ordenada), crea un docx/xlsx/pdf
   y prueba Vista rápida, Descargar todo (zip) y Guardar como PDF. Pide leer otra carpeta, permite en Solo lectura: el
   servidor sandbox se reinicia, la tarea sigue sola y lee; escribir allí falla y lo explica.
8. **OAuth real de un conector (1 min).** Ajustes → MCP: conecta un MCP remoto con OAuth (p. ej. el de tu cuenta); se abre
   el navegador del sistema, vuelves, aparece «conectado» y sus herramientas se listan.
9. **Navegador integrado con entrada humana (1 min; Lote D 1, 3–5, 8).** ⌘4 → example.com: clic, scroll, teclear, copiar y
   pegar, menú contextual; al abrir un menú del proyecto encima la página se congela y vuelve. Pide al agente «abre
   wikipedia.org»: tarjeta de sitio; «Pausar/Reanudar/Detener» y tomar el control con un clic; «Seleccionar elemento» →
   «Añadir al chat»; una descarga muestra su tarjeta y cae en `~/Downloads/OnyxCode/`.
10. **`.dmg` empaquetado abre (2 min).** `npm run package`, monta el `.dmg`, arrastra a Aplicaciones y ábrela (primer
    arranque: Gatekeeper según `docs/DISTRIBUCION.md`): carga la ventana, conecta, un chat responde.
11. **`prefers-reduced-motion` (30 s).** Ajustes del Sistema → Accesibilidad → Pantalla → «Reducir movimiento»: en la app no
    hay animaciones de entrada/spinners con desplazamiento (el resto sigue usable).
12. **Arranque normal con datos reales (1 min).** Sin `--user-data-dir`: si existe `~/Library/Application Support/Lapis` u
    `OpenDesk`, se migran a la carpeta actual sin perder sesiones; no queda ningún `opencode serve` huérfano de una sesión
    anterior (`ps aux | grep "opencode serve"` solo muestra los de esta instancia) y tus servidores reales siguen vivos.
13. **No refrescar lo oculto (1 min; F7-B42).** Abre un proyecto de Code con el panel Cambios (⌘1) y, en otra terminal,
    ten un repo con cambios. Minimiza la ventana (o cámbiate a otro Space) y modifica archivos del repo unos segundos:
    con `GIT_TRACE=1` en el arranque de la app no debe aparecer ningún `git status` mientras esté oculta; al restaurarla,
    Cambios, Archivos y la rama de la barra se actualizan una vez. (El E2E `fase6` 6b lo cubre con visibilidad simulada:
    `hide`/`minimize` no cambian `document.visibilityState` en headless, por eso el caso 6c es `it.skip`.)
14. **Probar clave con claves reales (2 min; F8-B22).** Ajustes › Modelos: con una clave real de OpenAI, Anthropic y OpenRouter (las que tengas), «Probar» muestra «Funciona · N ms»; pega a propósito
    una clave mal copiada: «Clave no válida» con «Cambiar clave». Con el Wi-Fi apagado: «Sin conexión a internet». Los E2E solo usan un servidor local (`key-test.e2e.ts`).
15. **Diagnóstico con el motor real (2 min; F8-B23).** Ajustes › Diagnóstico: el estado dice «Funcionando»; «Motor (archivo)» muestra el `.log` real; «Copiar» y pega en un editor: no hay claves ni
    la contraseña del motor, y tu carpeta personal aparece como `~`. «Exportar…» crea un `.txt` con permisos 0600 (`ls -l`).

## Mapa: guías antiguas → spec o humano

`lotes` = `e2e/specs/lotes.e2e.ts`; `fase6` = `fase6.e2e.ts`; `lru` = `lru.e2e.ts`; `instance` = `instance.e2e.ts`;
«H n» = punto n de la checklist humana de arriba.

**Guía del lote B §4 (22 pasos)**

| Paso | Cobertura |
|---|---|
| 1 Onboarding | `lotes` (se descarta y no vuelve tras recargar) |
| 2 Carpetas prohibidas | `lotes`: `~` y `~/Library` (estado del store) y su versión visible con el banner «Cerrar» (F7-B4, arreglado); volumen SMB, Papelera e iCloud solo en pruebas de `folder-policy` fuera del repo → H 7 (rechazos a mano) |
| 3 Otra carpeta en Sandbox | `lotes`: tarjeta «El agente quiere trabajar en otra carpeta» con ruta y motivo; reinicio del servidor y lectura real → H 7 |
| 4 Carpeta de confianza | H 7 |
| 5 Mover y renombrar | H 7 (Seatbelt + modelo reales) |
| 6 Documentos · 7 Entregables | H 7 |
| 8 Segundo plano | notificación «terminó» en `fase6` (caso 4); clic en la notificación y «mantener despierto» → H 3 |
| 9 Inactividad | manual, opcional (bajar el tiempo a 1 min en Ajustes → Tareas → Servidores) |
| 10 Búsqueda | `lru` (búsqueda en tarea desalojada) |
| 11 Lista | `lotes`: fijar, archivar, restaurar; agrupar → manual |
| 12 Modelo y esfuerzo | H 7 |
| 13 Editar/reintentar/continuar/exportar | `lotes`: exportar a Markdown; editar y reintentar (`session.revert` con git real) → manual |
| 14 Consulta lateral · 15 Proyecto · 16 MCP · 17 Crear skill | H 7 / H 8 (requieren modelo y MCP reales) |
| 18–19 Rutinas | manual con modelo real |
| 20 Subagentes en Control total · 21 Limpieza | H 1 |
| 22 Política gestionada | `lotes`: banner, `disableRoutines`, `disableBrowser`, `allowedFolderRoots`, JSON inválido = todo restringido |

**Guía del lote C §4 (archivada)**

| Punto | Cobertura |
|---|---|
| 0 Permisos tras recompilar · 1 Segundo plano · 2 Ocultar apps | H 1 |
| 3 Modo guía · 4 Grabar skill | H 2 |
| 5 Modo auto | manual con modelo real (chip del compositor y registro) |
| 6 Navegador (Control total) · 7 Sandbox sin navegador | H 9 / manual |
| 8 ⌘⇧Esc | H 1 |
| 9 Pendientes del Lote B | H 7 |

**`docs/LOTE-D.md` §4**

| Punto | Cobertura |
|---|---|
| 1 Uso humano en Code | `lotes`: pestaña, barra de URL y `file:///` rechazado; entrada humana real y congelado con menú → H 9 |
| 2 Dev server detectado | manual (necesita una terminal con `npm run dev`) |
| 3 Agente en Code | `lotes`: interruptor OFF por defecto, tarjeta de origen local y `new_page` por el MCP real; sitio remoto real → H 9 |
| 4 Tomar el control · 5 Seleccionar elemento | H 9 |
| 6 Login | `lotes`: `fill` sobre contraseña rechazado; login de Google → H 6 |
| 7 Pago | `lotes`: tarjeta «acción sensible», «Permitir» hace el clic, «Cancelar» da error y no toca la página |
| 8 Descarga | H 9 |
| 9–10 Tareas (sandbox) / Control total con el navegador | manual (H 9) |
| 12 Seguridad | `lotes`: `file:///etc/hosts`, `fetch` a otro puerto de loopback bloqueado en una página no aprobada; `mailto:`/`tel:` bloqueados sin crash (F7-B1, arreglado); resto → H 6 |
| 13 `mcp.browser` en la config | `lotes` (sidecar de Code); servidores de Tareas → manual |

**`docs/FASE6-PLAN.md` y `docs/LRU-PLAN.md` (verificación manual)**

| Punto | Cobertura |
|---|---|
| Fase 6: 10 casos automatizados (aislamiento de eventos, busy pegado, ErrorBoundary, toggle de Rutinas, notificación, panel Cambios, Tareas/Code en la misma carpeta) | `fase6` |
| Fase 6: `kill -STOP` real, `npm install` real, IME real, portapapeles, aspecto del knob, clic en la notificación | H 3 y `it.skip` con motivo en `fase6` (checklist humana del propio spec) |
| LRU: 4 chats y volver · streaming largo · claves ≤ N + fijadas | `lru` |
| LRU: Tareas con permiso pendiente y búsqueda de tarea desalojada | `lru` |
| LRU: `FolderRequestCard` de una subtarea | manual (`lotes` cubre la tarjeta en una tarea raíz) |
| LRU: Code encolado, revert y fork | `lru` |
| Instancia única, second-instance, Quick Entry (lógica) | `instance`; atajo físico → H 4, foco real → H 5, migración de userData → H 12 |
