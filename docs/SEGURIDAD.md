# Seguridad de Lapis — modelo actual

Resumen de las defensas del proceso principal, las ventanas y los procesos hijos. Detalle de los
hallazgos y su estado en `AUDIT.md`; motivación en `docs/analisis-claude/03-motor-interno.md`
(«Lecciones para Lapis», bloques A y B).

## 1. Renderer y ventanas

| Control | Dónde |
|---|---|
| Renderer de producción servido por `lapis://app/…` (esquema privilegiado `standard`+`secure`), nunca `file://`. Solo host `app`, solo archivos de `out/renderer` (sin `..` ni enlaces fuera), `nosniff`, COOP/CORP | `src/main/security/app-protocol.ts` |
| CSP por **cabecera** en cada HTML: `script-src 'self'`, `connect-src 'self' http://127.0.0.1:*`, sin frames/workers/objetos, `base-uri`/`form-action 'none'` (la `<meta>` se mantiene para el dev server) | `RENDERER_CSP` |
| Navegación: `will-navigate`/`will-redirect`/`will-frame-navigate` solo al origen propio (o el dev server); http(s) → navegador del sistema (solo desde ventanas de la app, nunca desde un artifact); `window.open` denegado; `<webview>` bloqueado y `webviewTag:false` | `src/main/security/web-security.ts` |
| Permisos de la sesión por defecto: denegados salvo `notifications` y `clipboard-sanitized-write` para páginas propias; sin dispositivos, sin captura de pantalla desde el renderer, sin descargas | idem |
| Menú propio en producción (sin Recargar/DevTools) y `devTools:false` en la ventana principal empaquetada | idem, `src/main/index.ts` |
| Preload por ventana: principal = API completa; Quick Entry = `extras:quickSubmit/quickHide` + evento `quick-shown`; overlay = solo evento `computer:overlay`; píldora = overlay + `computer:stop`. Artifacts: sin preload, partición propia | `src/preload/{index,quick,overlay,pill}.ts` |
| OpenCode (`--cors`) solo acepta `lapis://app` (y el dev server sin empaquetar); ya no `null` | `src/main/index.ts` → servidores |

## 2. IPC (renderer → main)

Cada `ipcMain.handle` pasa por `guardInvoke` (`src/main/ipc/guard.ts`):

1. **Emisor**: frame principal (`senderFrame.parent === null`), URL con origen propio y ventana con
   rol registrado por main (`main`, `quick`, `overlay`, `pill`). Iframes, artifacts, páginas que
   hayan navegado fuera o ventanas desconocidas → `FORBIDDEN`.
2. **Rol**: la ventana principal puede todo; las demás solo su lista (`CHANNEL_ROLES`).
3. **Payload**: esquema por canal (`src/main/ipc/schemas.ts`, validadores propios sin dependencias
   en `validate.ts`): tipos, objetos estrictos (clave inesperada → `INVALID`), rutas absolutas,
   longitudes máximas, `__proto__` prohibido. El handler recibe el payload **saneado**.

Las tablas de esquemas están tipadas contra los contratos `shared/ipc*.ts`: un canal nuevo sin
esquema no compila, y en desarrollo `missingSchemas()` muestra un error al arrancar.
**Al añadir un canal: contrato + handler + esquema (+ rol si lo usa una ventana secundaria).**

## 3. Procesos hijos y permisos de macOS (TCC)

- **`lapis-disclaim`** (`resources/launcher/disclaim.c`, `npm run build:launcher`, va en
  `Contents/Resources/launcher/`): `posix_spawn` con `POSIX_SPAWN_SETEXEC` + atributo *disclaim*
  (`responsibility_spawnattrs_setdisclaim`, vía `dlsym`; sin él, falla cerrado). El programa
  reemplaza al lanzador (mismo PID/grupo) y pasa a ser **responsable de sí mismo**: no hereda
  Accesibilidad ni Grabación de pantalla de Lapis. Se usa para **todos** los `opencode serve`
  (sidecar de Chat/Code, Cowork con sandbox y Cowork de acceso total).
- Lo que sí necesita esos permisos — el **MCP de computer use** y su `cu-helper`/`screencapture` —
  corre en un **`utilityProcess`** de main (`src/main/computer/mcp-host.ts`), que expone MCP
  *Streamable HTTP* en `127.0.0.1:<puerto>/mcp` con `Authorization: Bearer <token>` (32 bytes
  aleatorios, comparación en tiempo constante; rechaza `Origin` y `Host` ajenos). OpenCode lo usa
  como MCP `remote` (`oauth:false`). Puerto y token fijos durante la sesión; si muere se relanza
  con enfriamiento. El kill-switch (estado en memoria de main) no cambia.
- **Entorno mínimo** para servidores y MCP (`src/main/process/child-env.ts`): `PATH` ampliado,
  `HOME`, `USER`, `LOGNAME`, `SHELL`, `TMPDIR`, `LANG`/`LC_*`, `TZ`, `TERM`, proxy/CA y `XDG_*`,
  más las variables explícitas de la app. No pasan `ELECTRON_*`, `NODE_OPTIONS`, `DYLD_*` ni tokens
  exportados en la shell del usuario.
- **Terminal integrada** (`src/main/pty/service.ts`): la shell del usuario también se lanza con el
  mismo `lapis-disclaim` (`withDisclaim`, `process/disclaim.ts`), así que tampoco hereda
  Accesibilidad/Grabación de pantalla de Lapis — antes sí lo hacía (ver «Riesgos conocidos» más
  abajo, ya corregido). A diferencia de los servidores OpenCode, aquí **no** se usa `minimalEnv`:
  la terminal es una acción explícita del usuario (login shell, `TERM`, `LANG`, `PATH`…), así que se
  conserva casi todo `process.env` y solo se quitan `ELECTRON_RUN_AS_NODE`, `ELECTRON_RENDERER_URL`,
  `NODE_OPTIONS` y `DYLD_*` (inyectadas por Electron, no por el usuario). Verificado con
  `node-pty.spawn(launcher, [shell, '-l'], …)`: el PID del pty es el de la propia shell (mismo PID
  que tendría sin el lanzador, por `POSIX_SPAWN_SETEXEC`) y `echo ok` funciona con normalidad.

**Flujo Plan → Aprobar → Ejecutar y concesión por app** (`src/main/computer/{service,grants,mcp-server}.ts`):
antes de tocar la pantalla, el agente debe llamar `request_access` con su plan y la lista completa
de apps; `main` (`ComputerService.planApproved`, consultado por el MCP vía `GET .../plan-status`
antes de CADA herramienta de acción) lo hace cumplir del lado del servidor, no solo por prompt. La
tarjeta espera la respuesta del usuario SIN LÍMITE DE TIEMPO (ya no hay "sin respuesta en 5 min ⇒
denegado": eso mataba tareas por un simple retraso); la única forma de que quede sin responder es
que el proceso principal muera, y el único cierre forzado es `stop()` (kill-switch), que deniega lo
pendiente como respaldo. Lapis misma, el Dock, Spotlight, Centro de Control, `WindowServer` y
`loginwindow` (`grants.SYSTEM_EXEMPT_BUNDLE_IDS`) están exentos de la concesión por app: nunca se
bloquean a sí mismos ni piden acceso. Mientras una tarea de acceso total está trabajando, la
ventana principal se minimiza (píldora + overlay siguen visibles, `cowork-handlers.ts`) para que
nunca quede en primer plano robándole el foco a la app que el agente está usando.

Consecuencia práctica: si el agente de Code o de acceso total ejecuta `screencapture` o intenta
controlar el Mac por su cuenta, macOS lo trata como el binario `opencode` (sin permisos: la captura
falla y el sistema puede **pedir** permiso a nombre de «opencode» — no conviene concederlo). En
Cowork con sandbox, además, Seatbelt impide ejecutar `screencapture`.

## 4. Paquete (`electron-builder.js`)

Config en JS (no YAML) para poder decidir firma real vs. ad-hoc según variables de entorno —
ver `electron-builder.js` y `docs/DISTRIBUCION.md` (guía paso a paso para el usuario).

Fuses: `RunAsNode` **off**, `EnableNodeOptionsEnvironmentVariable` **off**,
`EnableNodeCliInspectArguments` **off**, `EnableEmbeddedAsarIntegrityValidation` **on**
(hash del asar en `Info.plist`), `OnlyLoadAppFromAsar` **on**, `EnableCookieEncryption` **on**,
`GrantFileProtocolExtraPrivileges` **off**.

- **Sin `CSC_NAME`/`CSC_LINK` (por defecto, `npm run package` local):** firma ad-hoc
  (`identity: '-'`), `hardenedRuntime: false`, sin entitlements ni notarización. Sin volver a firmar
  después de que electron-builder toque los fuses, macOS mataría el binario al abrir; el ad-hoc
  evita eso pero Gatekeeper rechaza el `.app` fuera de esta máquina (`spctl -a -vvv` → `rejected`,
  esperado).
- **Con Developer ID (`CSC_NAME` o `CSC_LINK`):** se omite `identity` (electron-builder usa las
  variables `CSC_*` automáticamente), se activa `hardenedRuntime` y se firma con
  `build/entitlements.mac.plist` (`entitlements`/`entitlementsInherit`) — JIT de V8, red
  cliente/servidor y `disable-library-validation` (necesario para que el addon nativo precompilado
  de `node-pty` cargue bajo hardened runtime). Los binarios embebidos `cu-helper` y `lapis-disclaim`
  se listan en `mac.binaries` para que quede explícito que también se firman.
- **Notarización:** hook `afterSign` propio (`build/notarize.js`, usa `@electron/notarize`
  directamente) en vez de la opción `mac.notarize` de electron-builder, para loguear con claridad
  cuándo se omite. Solo notariza si `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` y `APPLE_TEAM_ID` están
  en el entorno; si no, lo salta con un mensaje y el build ad-hoc sigue funcionando igual que antes.

## 5. Riesgos conocidos / pendiente

- El token del MCP viaja en `OPENCODE_CONFIG_CONTENT` del servidor de acceso total (oculto a su
  bash por el plugin `lapis-env`). Otro proceso del mismo usuario **sin sandbox** (p. ej. el bash
  del modo Code) podría leer ese entorno (`ps eww`) y llamar al MCP. Mitigación futura: verificar el
  PID del cliente TCP (que sea descendiente del servidor de acceso total) o un canal por socket Unix.
- El `cu-helper` no es un bundle con identidad propia (lección 7): los permisos siguen siendo de
  Lapis.app.
- ✅ **Corregido** — El PTY de la terminal integrada ya no hereda los permisos de Lapis: se lanza
  con `lapis-disclaim` igual que los `opencode serve` (`src/main/pty/service.ts`, §3 arriba).
- Sin Developer ID + hardened runtime + notarización configurados (ver `docs/DISTRIBUCION.md`): cada
  build ad-hoc cambia la identidad y macOS olvida los permisos concedidos. La config ya soporta
  ambos casos (`electron-builder.js` + `build/notarize.js`); falta que el usuario aporte su propio
  Developer ID Application.
