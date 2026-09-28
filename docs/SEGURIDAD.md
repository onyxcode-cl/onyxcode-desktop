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

Consecuencia práctica: si el agente de Code o de acceso total ejecuta `screencapture` o intenta
controlar el Mac por su cuenta, macOS lo trata como el binario `opencode` (sin permisos: la captura
falla y el sistema puede **pedir** permiso a nombre de «opencode» — no conviene concederlo). En
Cowork con sandbox, además, Seatbelt impide ejecutar `screencapture`.

## 4. Paquete (`electron-builder.yml`)

Fuses: `RunAsNode` **off**, `EnableNodeOptionsEnvironmentVariable` **off**,
`EnableNodeCliInspectArguments` **off**, `EnableEmbeddedAsarIntegrityValidation` **on**
(hash del asar en `Info.plist`), `OnlyLoadAppFromAsar` **on**, `EnableCookieEncryption` **on**,
`GrantFileProtocolExtraPrivileges` **off**. Firma ad-hoc (`identity: '-'`) mientras no haya
Developer ID: sin volver a firmar, macOS mata el binario con los fuses cambiados.

## 5. Riesgos conocidos / pendiente

- El token del MCP viaja en `OPENCODE_CONFIG_CONTENT` del servidor de acceso total (oculto a su
  bash por el plugin `lapis-env`). Otro proceso del mismo usuario **sin sandbox** (p. ej. el bash
  del modo Code) podría leer ese entorno (`ps eww`) y llamar al MCP. Mitigación futura: verificar el
  PID del cliente TCP (que sea descendiente del servidor de acceso total) o un canal por socket Unix.
- El `cu-helper` no es un bundle con identidad propia (lección 7): los permisos siguen siendo de
  Lapis.app.
- El PTY de la terminal integrada (acción del usuario) aún hereda los permisos de Lapis.
- Sin Developer ID + hardened runtime + notarización: cada build ad-hoc cambia la identidad y macOS
  olvida los permisos concedidos.
