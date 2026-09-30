# Seguridad de OnyxCode — modelo actual

Resumen de las defensas del proceso principal, las ventanas y los procesos hijos. Detalle de los
hallazgos y su estado en `AUDIT.md`; motivación en notas privadas (fuera del repositorio)
(«Lecciones para OnyxCode», bloques A y B).

## 1. Renderer y ventanas

| Control | Dónde |
|---|---|
| Renderer de producción servido por `onyxcode://app/…` (esquema privilegiado `standard`+`secure`), nunca `file://`. Solo host `app`, solo archivos de `out/renderer` (sin `..` ni enlaces fuera), `nosniff`, COOP/CORP | `src/main/security/app-protocol.ts` |
| CSP por **cabecera** en cada HTML: `script-src 'self'`, `connect-src 'self' http://127.0.0.1:*`, sin frames/workers/objetos, `base-uri`/`form-action 'none'` (la `<meta>` se mantiene para el dev server) | `RENDERER_CSP` |
| Navegación: `will-navigate`/`will-redirect`/`will-frame-navigate` solo al origen propio (o el dev server); http(s) → navegador del sistema (solo desde ventanas de la app, nunca desde una vista previa); `window.open` denegado; `<webview>` bloqueado y `webviewTag:false` | `src/main/security/web-security.ts` |
| Permisos de la sesión por defecto: denegados salvo `notifications` y `clipboard-sanitized-write` para páginas propias; sin dispositivos, sin captura de pantalla desde el renderer, sin descargas | idem |
| Menú propio en producción (sin Recargar/DevTools) y `devTools:false` en la ventana principal empaquetada | idem, `src/main/index.ts` |
| Preload por ventana: principal = API completa; Quick Entry = `extras:quickSubmit/quickHide` + evento `quick-shown`; overlay = solo evento `computer:overlay`; píldora = overlay + `computer:stop`; assist (Modo guía / grabar una skill, Lote C) = `computer:teachRespond`/`computer:record:stop` + evento `computer:assist`; **navegador aparte (`browser-host`, Lote D)** = solo `window.api.browser` (todo `browser:*` salvo `sites:*`/`clearData`/`devServers`). Vista previa: sin preload, partición propia | `src/preload/{index,quick,overlay,pill,assist,browser-host}.ts` |
| OpenCode (`--cors`) solo acepta `onyxcode://app` (y el dev server sin empaquetar); ya no `null` | `src/main/index.ts` → servidores |
| **Pestañas del navegador integrado (Lote D):** `WebContentsView` por pestaña, sin preload, en `persist:onyxcode-web-{code\|tasks}` (nunca la sesión por defecto de `onyxcode://app`); eximidas de `harden()` por identidad de objeto de sesión (`isEmbeddedBrowserSession`), con sus propias guardas equivalentes (detalle en «3 quater»). Se alojan en el panel principal o en una **ventana «Navegador» aparte** (rol `browserHost`, se abre sola con `showInactive()` si la principal está minimizada/oculta) | `src/main/embedded-browser/{session,surface,popout}.ts` |

## 2. IPC (renderer → main)

Cada `ipcMain.handle` pasa por `guardInvoke` (`src/main/ipc/guard.ts`):

1. **Emisor**: frame principal (`senderFrame.parent === null`), URL con origen propio y ventana con
   rol registrado por main (`main`, `quick`, `overlay`, `pill`). Iframes, vistas previas, páginas que
   hayan navegado fuera o ventanas desconocidas → `FORBIDDEN`.
2. **Rol**: la ventana principal puede todo; las demás solo su lista (`CHANNEL_ROLES`).
3. **Payload**: esquema por canal (`src/main/ipc/schemas.ts`, validadores propios sin dependencias
   en `validate.ts`): tipos, objetos estrictos (clave inesperada → `INVALID`), rutas absolutas,
   longitudes máximas, `__proto__` prohibido. El handler recibe el payload **saneado**.

Las tablas de esquemas están tipadas contra los contratos `shared/ipc*.ts`: un canal nuevo sin
esquema no compila, y en desarrollo `missingSchemas()` muestra un error al arrancar.
**Al añadir un canal: contrato + handler + esquema (+ rol si lo usa una ventana secundaria).**

## 3. Procesos hijos y permisos de macOS (TCC)

- **`onyxcode-disclaim`** (`resources/launcher/disclaim.c`, `npm run build:launcher`, va en
  `Contents/Resources/launcher/`): `posix_spawn` con `POSIX_SPAWN_SETEXEC` + atributo *disclaim*
  (`responsibility_spawnattrs_setdisclaim`, vía `dlsym`; sin él, falla cerrado). El programa
  reemplaza al lanzador (mismo PID/grupo) y pasa a ser **responsable de sí mismo**: no hereda
  Accesibilidad ni Grabación de pantalla de OnyxCode. Se usa para **todos** los `opencode serve`
  (sidecar de Chat/Code, Tareas con sandbox y Tareas de acceso total).
- Lo que sí necesita esos permisos — el **MCP de Control del Mac** y su `cu-helper`/`screencapture` —
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
  mismo `onyxcode-disclaim` (`withDisclaim`, `process/disclaim.ts`), así que tampoco hereda
  Accesibilidad/Grabación de pantalla de OnyxCode — antes sí lo hacía (ver «Riesgos conocidos» más
  abajo, ya corregido). A diferencia de los servidores OpenCode, aquí **no** se usa `minimalEnv`:
  la terminal es una acción explícita del usuario (login shell, `TERM`, `LANG`, `PATH`…), así que se
  conserva casi todo `process.env` y solo se quitan `ELECTRON_RUN_AS_NODE`, `ELECTRON_RENDERER_URL`,
  `NODE_OPTIONS` y `DYLD_*` (inyectadas por Electron, no por el usuario). Verificado con
  `node-pty.spawn(launcher, [shell, '-l'], …)`: el PID del pty es el de la propia shell (mismo PID
  que tendría sin el lanzador, por `POSIX_SPAWN_SETEXEC`) y `echo ok` funciona con normalidad.

**Flujo Plan → Aprobar → Ejecutar y concesión por app** (`src/main/computer/{service,grants,mcp-server}.ts`):
antes de tocar la pantalla, el agente debe llamar `request_access` con su plan y la lista completa
de apps; `main` (`ComputerService`, aprobación **por sesión**, consultada por el MCP y por el
plugin `onyxcode-plan-gate` vía `GET .../plan-status?session=<id>` antes de CADA herramienta de acción)
lo hace cumplir del lado del servidor, no solo por prompt. La
tarjeta espera la respuesta del usuario SIN LÍMITE DE TIEMPO (ya no hay "sin respuesta en 5 min ⇒
denegado": eso mataba tareas por un simple retraso); la única forma de que quede sin responder es
que el proceso principal muera, y el único cierre forzado es `stop()` (kill-switch), que deniega lo
pendiente como respaldo. OnyxCode misma, el Dock, Spotlight, Centro de Control, `WindowServer` y
`loginwindow` (`grants.SYSTEM_EXEMPT_BUNDLE_IDS`) están exentos de la concesión por app: nunca se
bloquean a sí mismos ni piden acceso. Mientras una tarea de Control total está trabajando, la
ventana principal se minimiza (píldora + overlay siguen visibles, `tasks-handlers.ts`) para que
nunca quede en primer plano robándole el foco a la app que el agente está usando.

Consecuencia práctica: si el agente de Code o de acceso total ejecuta `screencapture` o intenta
controlar el Mac por su cuenta, macOS lo trata como el binario `opencode` (sin permisos: la captura
falla y el sistema puede **pedir** permiso a nombre de «opencode» — no conviene concederlo). En
Tareas con sandbox, además, Seatbelt impide ejecutar `screencapture`.

## 3 bis. Tareas: puerta del plan, carpetas, red, MCP, política y rutinas (Lote B)

Detalle de los hallazgos en `AUDIT.md` §9; resumen del lote B en la documentación interna de proceso.

**Puerta del plan por sesión.** El plugin `onyxcode-plan-gate` (`src/main/tasks/opencode-config.ts`)
se aplica a **toda** sesión del servidor de Control total, con clave en su propio `sessionID`: las
sesiones hijas de `task` y cualquier agente distinto de `computer` quedan bloqueadas (fail-closed)
hasta que el usuario apruebe el plan de esa sesión; solo pasan las herramientas de planificar
(`computer_request_access`, `todowrite`, `todoread`, `question`, `read`, `glob`, `grep`, `list`).
`computer.md` tiene `task: deny`. La aprobación dura toda la tarea hasta «Revocar», Detener o
archivar/borrar. En el sandbox y en el sidecar principal el plugin no hace nada (sin
`ONYXCODE_PLAN_GATE_URL`).

**Carpetas de trabajo** (`sandbox-profile.ts`, `folder-policy.ts`, `manager.ts`).
- Carpeta principal: escritura permitida; `unlink`/`rmdir`/`rename` denegados salvo la concesión
  «Permitir borrar, mover y renombrar» (`allowDelete`). Truncar no está protegido (mitigación:
  `session.revert`).
- Carpetas adicionales (vinculadas a un espacio o de confianza, para todas las tareas):
  - **`rw`** («Lectura y escritura»): se añaden a `allow file-write*`, pero con
    `(deny file-write-unlink …)` SIEMPRE: la concesión de borrado vale solo para la principal.
  - **`ro`** («Solo lectura»): la lectura ya la da `(allow default)` (menos los secretos); al final
    del perfil `(deny file-write* (subpath …))`, que gana incluso sobre una `rw` que la contenga.
  - `.onyxcode/trabajo/` de la principal (scratch del agente) permite borrar y renombrar.
- Seatbelt fija el perfil al lanzar el proceso: ampliar carpetas exige **reiniciar** el servidor
  sandbox (`restartSandbox`, con confirmación en la interfaz si hay tareas en curso; `applied` indica
  si el servidor en marcha ya usa el conjunto actual). En OpenCode, `agent.tasks.permission.external_directory`
  se abre solo para esas rutas (`<ruta>` y `<ruta>/*`) y el resto sigue en `ask`.
- Carpetas rechazadas con un motivo accionable (`forbiddenFolderReason` → `folder-policy.ts`): raíz o
  home, carpeta que contiene el home, carpetas del sistema (`/System /Library /Applications /usr /bin
  /sbin /etc /opt /private /tmp /var /dev /cores /Network`), raíz de `/Volumes`, volúmenes de red
  (`smbfs afpfs nfs webdav cifs ftp macfuse osxfuse`, leídos de `/sbin/mount`, caché de 30 s), el
  userData de la app, `~/Library` (iCloud Drive con su propio mensaje), la Papelera, las rutas de
  `defaultDeniedReadPaths` y, con política gestionada, todo lo que quede fuera de `allowedFolderRoots`.

**Red del sandbox.** `(deny network*)` salvo el proxy de egress local; el proxy deja pasar solo la
lista blanca (`proxy-policy.ts`):
- host del proveedor de modelos (`opencode.ai`);
- **búsqueda web del agente** (`mcp.exa.ai`), interruptor `webSearchEnabled` **activado por defecto**
  y visible en Ajustes → Red del sandbox; el servidor sandbox arranca con
  `OPENCODE_WEBSEARCH_PROVIDER=exa` para que sea un único host (sin eso OpenCode alterna con
  `search.parallel.ai`). Las consultas de búsqueda son un canal de salida posible ante prompt injection;
- npm y PyPI, solo si se activan sus interruptores;
- los hosts que el usuario añada («Permitir siempre»), y «Permitir esta vez» (no se persiste);
- los hosts de los **MCP remotos** marcados «Disponible en Tareas» (se añaden solos a la lista);
- `extraAllowedHosts` de la política gestionada.
Con `disableCustomHosts` (política) no se pueden añadir sitios ni se suman los hosts de MCP remotos.

**Credenciales de proveedor en Tareas con sandbox (falla cerrado).** El proceso main lee el `auth.json`
propio de la app (`userData/opencode-data`, ilegible dentro del sandbox) y construye el `OPENCODE_AUTH_CONTENT` del servidor sandboxeado
con `placeholderAuthContent` (`provider-egress.ts`), una lista blanca estricta:
- solo los proveedores de `PROVIDER_TARGETS` (hoy `opencode-go`) con `key`: su clave real vive en un
  `CredentialProxy` del proceso main (fuera del sandbox, con token en la ruta) y el servidor recibe una
  clave **centinela aleatoria** (`sandboxed-placeholder-<hex>`, no derivada de la real) más un `baseURL`
  que apunta al proxy;
- todo lo demás (otros proveedores, entradas OAuth, entradas sin `key`, cualquier otro campo) se **omite**;
  sin ninguno el contenido es `{}` (el motor arranca igual, verificado con opencode 1.18.33). Por eso en
  Tareas con sandbox solo está disponible OpenCode Go (más los modelos gratuitos de OpenCode, que no usan
  clave); la interfaz avisa y rechaza el envío si el servidor sandboxeado no tiene el proveedor del modelo («Para otros proveedores usa Control total, Chat o Code»).
- Cubierto por `provider-egress.test.ts` (incluye una prueba de propiedad: la salida nunca contiene una
  clave real de entrada, y una comprobación estática de que `sandbox.ts` solo asigna
  `OPENCODE_AUTH_CONTENT` con esa función).
**Sin aislamiento de credenciales fuera de ese caso:** en Control total (sin sandbox) y en Chat/Code el
motor lee el `auth.json` propio de la app (no el del CLI). Los MCP del usuario marcados «Disponible en Tareas»
llevan sus propios `environment`/`headers` en la config inline del servidor: son secretos que el usuario
decide compartir con Tareas al marcarlos.

**MCP del usuario dentro de Tareas** (`mcp-tasks.ts`). Solo entran los servidores activos y marcados
«Disponible en Tareas» (`userData/tasks-mcp.json`; nunca se escribe en `opencode/opencode.json`).
- **MCP locales**: se lanzan con el prefijo `/usr/bin/env -u OPENCODE_SERVER_PASSWORD -u
  OPENCODE_SERVER_USERNAME -u OPENCODE_AUTH_CONTENT -u OPENCODE_CONFIG_CONTENT -u ONYXCODE_PLAN_GATE_URL`,
  para que no hereden las credenciales del propio servidor. Heredan el perfil Seatbelt y necesitan el
  interruptor de npm o PyPI si descargan paquetes.
- **MCP remotos**: su host entra en la lista blanca de red; los que usan OAuth no funcionan en el
  sandbox (su XDG privado no tiene los tokens) y la interfaz lo avisa.
- «Preguntar en cada uso» pone `"<servidor>_*": ask`.

**Skills.** Las skills de la app (docx, xlsx, pdf, pptx) van en `userData/opencode-config/skills`
(copiadas al arrancar; el bundle es de solo lectura). El servidor sandbox arranca con
`OPENCODE_DISABLE_EXTERNAL_SKILLS=1`: no carga `~/.claude/skills` (evita colisiones de nombre y skills
ajenas), y sí las del proyecto (`.opencode/skills`).

**Permisos recordados** (`rules.ts`, `userData/tasks-rules.json`). «Siempre permitir» se guarda por
carpeta y se inyecta en `agent.<tasks|computer>.permission` al abrir la carpeta. **Nunca** se
recuerdan `external_directory`, `doom_loop`, `computer_*`, patrones de borrado (`rm`, `rmdir`,
`unlink`, `trash`, `srm`, `-delete`) ni patrones de bash que empiecen por comodín. Con
`disableAlwaysAllow` (política) `add` lanza error y las reglas guardadas no se aplican.

**Política gestionada** (`policy.ts`). Archivo `/Library/Application Support/OnyxCode/managed.json` (solo
un administrador escribe ahí; en desarrollo se puede forzar con `ONYXCODE_MANAGED_POLICY` si la app no está
empaquetada). Claves: `disableFullAccess`, `allowedFolderRoots`, `disableCustomHosts`,
`extraAllowedHosts`, `disableAlwaysAllow`, `disableRoutines`, `maxAutoArchiveDays`. Solo restringe
(salvo `extraAllowedHosts`) y **falla hacia el lado seguro**: un booleano que no sea exactamente
`false` cuenta como `true`; `allowedFolderRoots` inválido = lista vacía (ninguna carpeta); un archivo
ilegible o con JSON inválido activa todas las restricciones booleanas; los hosts y números inválidos se
descartan. Se relee al cambiar el archivo (mtime/tamaño), sin reiniciar. Con `disableFullAccess` ninguna
concesión previa de Control total vale y `grantFullAccess` falla.

**Rutinas desatendidas** (`scheduler/service.ts`, `scheduler/approvals.ts`).
- Solo las reglas de «Permitir sin preguntar» de la rutina se aprueban solas (todos los patrones deben
  casar con una regla del mismo permiso; un `*` suelto no vale como permiso). Lo demás se **rechaza**
  (por defecto) o **espera al usuario** con una notificación (`onAsk: 'wait'`). Las preguntas se rechazan.
- Todo queda en el historial de la ejecución: aprobado, rechazado, hosts bloqueados y «esperando
  aprobación». Los «sitios permitidos» de una rutina solo valen mientras dura la ejecución.
- **Control total en una rutina**: requiere el consentimiento explícito registrado al guardarla
  (`fullAccessConsentAt`) y que la carpeta siga teniendo la concesión de Control total; cada ejecución es
  una tarea nueva y **la aprobación del plan sigue siendo humana** (notificación «necesita que apruebes su
  plan»); sin aprobación, la ejecución termina por tiempo (45 min) con un error claro. `disableRoutines`
  (política) impide guardarlas y ejecutarlas.

**Capturas de Control total.** Se guardan temporalmente en `temp/onyxcode-computer` (últimas 20) y se
borran al pulsar Detener, al cerrar la app y a los 60 s sin tareas de Control total en curso. Las
capturas se envían al proveedor del modelo y quedan en el historial de la tarea.

**Servidor de Control total y el XDG real.** A diferencia del sandbox, el servidor de Control total
carga su `~/.config/opencode` global (MCP y plugins propios, sin sandbox); los datos (claves, sesiones)
viven en el almacén propio de la app, compartido con el sidecar principal y separado del CLI.

**Riesgo residual (config del CLI).** La config global `~/.config/opencode` sigue compartida con el CLI:
si allí hay `provider.*.options.apiKey` en `opencode.json`, ese proveedor aparecerá conectado en la app aunque
no esté en el almacén propio (y no pasa al sandbox de Tareas, que solo parte del `auth.json` propio).

## 3 ter. Control del Mac en segundo plano, Modo auto y navegador propio (Lote C)

Detalle de los hallazgos en `AUDIT.md` §10; resumen del lote C en la documentación interna de proceso.

**Acciones en segundo plano por Accessibility API.** Las herramientas `app_tree`/`app_find`/
`app_press`/`app_set_value`/`app_action`/`app_screenshot` (`computer/mcp-server.ts`) llaman a
`cu-helper ax-*` (`AXUIElementCopyElementAtPosition`, `AXUIElementPerformAction`,
`AXUIElementSetAttributeValue`) sobre una app CONCRETA nombrada por el modelo, no sobre la app en
primer plano: por eso comprueban el nivel con `requireTierFor(appRef, minTier, session)` en vez de
`requireTier` (que mira la app bajo el ratón/en primer plano). Nunca mueven el cursor real ni
activan la app. En modo «En segundo plano» (por defecto, `DEFAULT_COMPUTER_PREFS.mode =
'background'`), las herramientas de ratón/teclado real (`left_click`, `type_text`, `key`, `drag`,
`scroll`, `mouse_move`) se rechazan salvo que la sesión tenga foreground (`GET /control-mode`,
`ComputerService.isForeground`), que solo se concede con la tarjeta «¿Tomar el control de la
pantalla?» (`request_full_control`, aprobada con `approvePlan: true` y **sin** decisiones por app:
el nivel ya lo dio la tarjeta de acceso). Sin canal lateral, la comprobación falla cerrado (igual
que el kill-switch). «Ocultar las demás apps mientras controla» (`app-visibility.ts`,
`NSRunningApplication.hide()/unhide()`, sin TCC) solo actúa en modo `full` o al aprobarse un
takeover, nunca en segundo plano; conserva las apps con concesión, las del sistema y Finder, y
persiste el conjunto ocultado (`userData/computer-hidden.json`) para recuperarse tras un cierre
brusco.

**Modo auto: la allowlist es la frontera, no el motor.** `tasks/auto-mode.ts` es un módulo PURO
(sin Electron, sin red) que decide `allow`/`ask` mirando solo texto: comandos de bash contra una
lista cerrada de programas y opciones prohibidas (`isReadOnlyBash`), nombres de herramientas MCP
contra un prefijo de solo-consulta y una lista de palabras de escritura (`isReadOnlyMcpTool`), y
peticiones de acceso a apps contra una lista de apps y de exclusiones (`classifyAccess`). Ante
CUALQUIER duda (texto que no case exactamente, metadatos demasiado largos, algo que parezca
inyección) la respuesta es `ask`: el motor (`auto-approver.ts`) nunca amplía lo que decide
`auto-mode.ts`, solo ejecuta sus veredictos y lleva el registro. Nunca se aprueban en automático
`external_directory`, `doom_loop`, `computer_*`, `browser_*`, `edit`, `write`, `task`, `webfetch`,
`websearch`, ni nada con un plan, un `takeover` o un nivel distinto de «Solo ver». Opt-in DOBLE:
el interruptor maestro (apagado por defecto, kill switch) **y** la carpeta o la tarea concreta;
`policy.disableAutoMode` lo apaga para toda la organización sin tocar los ajustes del usuario. El
«Solo ver» que concede a mitad de tarea (`grantAutoView`) es **efímero por sesión**: nunca se
persiste en `computer-grants.json`, y es revocable desde el registro de Ajustes.

> **HISTÓRICO — ELIMINADO en el refactor fase 3 (nota añadida el 2026-09-29, revisión Fase 7).** El «navegador propio» / «Chrome aparte»
> (`chrome-devtools-mcp`, `browser/{gateway,service,sites}.ts`, y sus manejadores IPC) ya no existe en el
> código. Lo sustituye el **navegador integrado** (`embedded-browser/`, sección «3 quater» de este documento). Sus datos
> en disco (la carpeta y el JSON antiguos del navegador en `userData`) se borran al arrancar. El párrafo siguiente se conserva solo como registro
> del modelo de seguridad que tuvo; NO describe la app actual.
>
> **[Histórico] Navegador propio: diálogo por sitio, perfil aislado y lanzamiento con el entorno reducido.** El
navegador (`chrome-devtools-mcp` (histórico: eliminado en la fase 3 del refactor)) solo existe en Control total, desactivado por defecto, y corre
sobre un **perfil propio** (carpeta `browser/profile` del userData antiguo), nunca el Chrome personal del
usuario: no comparte cookies, historial ni sesiones, y sus descargas van a
`browser/downloads` del mismo userData antiguo. Cada navegación de primer nivel (`navigate_page`, `new_page`,
y tras `click`/`fill`/`fill_form`/`press_key`/`evaluate_script` se revisan TODAS las páginas
abiertas) pasa por un canal lateral HTTP con token en 127.0.0.1 hacia `browser/service.ts`; si el
sitio no está en «Permitir siempre» ni denegado ni con «una vez» ya concedido, aparece un diálogo
nativo (`dialog.showMessageBox`, en cola, sin ventana padre porque en Control total la principal
puede estar minimizada) con la URL LITERAL y el aviso «Las páginas pueden contener instrucciones
maliciosas». Si `list_pages` no se puede leer o interpretar, la pasarela (`browser/gateway.ts` (histórico: eliminado en la fase 3 del refactor))
falla cerrado (nunca asume que todo está bien) y manda a `about:blank` cualquier página en un host
no permitido. El proceso se lanza con `/usr/bin/env -u OPENCODE_SERVER_PASSWORD -u
OPENCODE_SERVER_USERNAME -u OPENCODE_AUTH_CONTENT -u OPENCODE_CONFIG_CONTENT -u
ONYXCODE_PLAN_GATE_URL` (igual que los MCP locales del usuario, `MCP_ENV_WRAPPER`), para que Chrome
nunca herede las credenciales del propio servidor de OpenCode; `--no-usage-statistics` y
`CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1` evitan que escriba en `~/.cache/chrome-devtools-mcp` del
usuario. `upload_file` se quita de `tools/list` antes de que el modelo la vea. El navegador corre
fuera de Seatbelt y del proxy de egress del sandbox (no hay sandbox en Control total): es la razón
de que quede fuera de alcance en Sandbox en esta versión.

**Ventana `assist` (Modo guía y grabar una skill): superficie IPC ampliada en dos canales, con el
mismo aislamiento que la píldora.** `src/preload/pill.ts` **no se tocó** en todo el lote; la
ventana nueva tiene su propio preload (`src/preload/assist.ts`) con su propia lista cerrada
(`ALLOWED_INVOKE = {'computer:teachRespond', 'computer:record:stop'}`, `on` solo acepta
`computer:assist`) y su propio rol en `CHANNEL_ROLES` (`assist`), sin tocar la entrada `pill`. Es
una ventana sin marco, transparente, con `setContentProtection(true)` y `showInactive` (nunca activa
OnyxCode ni le roba el foco al usuario), igual que la píldora de control. La grabación en sí
(`cu-helper record`) usa un tap de solo ESCUCHA (nunca inyecta eventos) y nunca guarda el texto
tecleado si `IsSecureEventInputEnabled()` está activo (campo seguro con foco); el texto tecleado
tampoco se envía al agente por defecto («Incluir el texto que tecleé», desactivado) y el prompt que
se le manda avisa explícitamente de que capturas y narración son **datos no confiables**.

## 3 quater. Navegador integrado en la ventana de la app (Lote D)

Detalle de los hallazgos en `AUDIT.md` §11; diseño completo, decisiones del usuario y guía de
prueba manual en `docs/LOTE-D.md`.

**Aislamiento por sesión: nunca la sesión por defecto.** Cada pestaña del navegador integrado
(`WebContentsView`, `sandbox:true, contextIsolation:true, nodeIntegration:false, webviewTag:false,
devTools:false`, **sin preload propio**) vive en `session.fromPartition('persist:onyxcode-web-code')`
o `'persist:onyxcode-web-tasks'` (`embedded-browser/session.ts`): dos perfiles separados entre sí y
completamente distintos de la `defaultSession` que sirve `onyxcode://app` y guarda las credenciales de
OpenCode. Ni el esquema `onyxcode:` ni `*-artifact:` existen en esas particiones (`protocol.handle` es
de la sesión por defecto y de la de la vista previa), así que una pestaña del navegador nunca puede pedir
una página propia de la app. **Tareas usa UNA sola partición compartida** (`persist:onyxcode-web-
tasks`) para Sandbox y Control total, sea cual sea la carpeta o la tarea — no una por carpeta ni
por tarea. Es una decisión explícita, reconfirmada por el usuario junto con el resto de defaults del
Lote D (2026-09-28): las cookies/sesiones iniciadas del navegador de Tareas son las mismas entre
tareas de un mismo día a día, igual que un Chrome real tiene un solo perfil; «Borrar datos» (Ajustes
→ Navegador) limpia esa partición entera. No es un descuido de diseño: si en el futuro se quisiera
aislamiento por carpeta, haría falta una partición por owner, con el coste de volver a iniciar
sesión en cada sitio por carpeta.

**La regla de red es la defensa real, no un permiso denegado más.** `webRequest.onBeforeRequest`
(`embedded-browser/surface.ts`) solo deja pasar `http(s):`, `ws(s):`, `data:`, `blob:` y `about:`, y
cancela cualquier petición (de cualquier tipo de recurso, no solo la navegación de primer nivel)
hacia un destino loopback o de red privada (`127.0.0.0/8`, `::1`, `10.0.0.0/8`, `172.16.0.0/12`,
`192.168.0.0/16`, `169.254.0.0/16`, `.local`) salvo que la página de primer nivel sea un origen
local ya **aprobado por el usuario** (`localhost:PUERTO`, aprobación por origen exacto, nunca por
comodín). Verificado en vivo (D0, reconfirmado por D5 contra el árbol final): esta build de
Electron/Chromium trae `LocalNetworkAccessChecks` desactivado, así que denegar `local-network-
access`/`loopback-network` en los `setPermissionRequestHandler` **no tiene ningún efecto
observable** por sí solo — sin la regla de `webRequest`, un `fetch` desde una página remota alcanza
sin problema un puerto loopback; con ella, queda bloqueado. Por eso esta regla es obligatoria y no
una capa de refuerzo opcional.

**Límite conocido: «Permitir siempre» de un origen local abre todo el loopback a esa página.** La regla
de red decide por el origen de la **página de primer nivel**, no por puerto de destino: una vez que un
origen local (`localhost:5173`) queda aprobado con «Permitir siempre», esa página puede hacer `fetch`
a cualquier OTRO puerto de loopback o de red privada (otro servidor de desarrollo, una base de datos
local, etc.), y con la aprobación persistida vale también en tareas futuras. La aprobación «en esta
tarea» NO cuenta para esta regla (no se persiste ni se consulta en `webRequest`: una página aprobada
solo para la tarea sigue bloqueada hacia otros puertos). Está fijado por el E2E
(`lotes.e2e.ts`, «observación: … sí alcanza otro puerto de loopback»); aprobar solo lo que el usuario
conoce es decisión suya, y acotar por puerto de destino requeriría una lista de destinos por origen.

**Esquemas externos (`mailto:`, `tel:`…) nunca abren otra aplicación.** Primer nivel: solo `http(s):` y
`about:blank`; subframes: `http(s):`, `about:`, `data:` y `blob:` (`sites.ts`, `subframeUrlAllowed`). Lo
demás se cancela en `will-navigate`/`will-redirect`/`will-frame-navigate`, `window.open` se deniega y el
permiso `openExternal` se rechaza; el registro solo lleva el esquema (nunca la dirección ni el
teléfono) y el usuario recibe un aviso en el panel. El respaldo tras confirmarse una navegación va en
`did-navigate` con `setImmediate` (nunca `stop()`/`loadURL()` síncronos dentro de un evento de inicio de
navegación: mataban el proceso principal, F7-B1).

**Aprobación por sitio: solo lo que decide el agente, no lo que el usuario ya visitó.** Una
navegación de primer nivel **atribuida al agente** hacia un sitio nuevo (eTLD+1, reutilizando
`browser/sites.ts` del Lote C) pide permiso con una tarjeta (`browser:approval`) fuera del
rectángulo de la vista — nunca superpuesta a la página —, con botones que se arman a los 700 ms, el
foco por defecto en «No» y Esc como «No»; sin anfitrión visible (ventana minimizada, sin panel ni
ventana aparte) cae a un `dialog.showMessageBox` nativo de respaldo, con la URL literal. Una
navegación cuenta como del **usuario** (y no pide nada) solo si hubo un `input-event` humano real en
esa pestaña en el segundo previo, o si vino de la barra de URL/pestaña nueva/«Usar esta»; con una
concesión de agente activa, todo lo demás se atribuye al agente por defecto (el sentido seguro).
`verifyAfterAction` es la red de seguridad tras cada acción: si la pestaña terminó en un host no
aprobado (redirección tardía mal atribuida), la devuelve atrás o a `about:blank`. Los orígenes
locales se aprueban por origen exacto (`localhost:PUERTO`), nunca por comodín, y por separado de los
sitios remotos.

**Campos y acciones sensibles: el agente nunca los toca.** `fill`/`type_text` rechazan de raíz
cualquier `input[type=password]` y los `autocomplete` `cc-*`/`one-time-code`/`current-
password`/`new-password`, con un mensaje que pide al usuario que lo escriba él (probado con
Electron real: el intento de fill sobre el campo de contraseña de una página real vuelve `isError`
con ese mensaje, nunca escribe nada). Antes de un clic, `DOM.getNodeForLocation` comprueba que el
nodo bajo el punto de destino es el objetivo o un descendiente (si algo lo tapa, error explícito:
protección anti-clickjacking) y `Overlay.highlightNode` lo resalta 400 ms para que el usuario vea
qué va a pulsar. Si el nombre accesible del objetivo casa con un patrón de acción sensible (pagar,
confirmar compra, eliminar cuenta/repositorio, transferir…), se pide confirmación explícita
(`confirmSensitive`) antes de dispatchar el clic real.

**Descargas: cuarentena manual y siempre bajo revisión.** Las descargas atribuidas al agente quedan
pausadas (`item.pause()`) hasta que el usuario decide en una tarjeta con nombre y destino
(`<carpeta>/.onyxcode/trabajo/descargas/` en Tareas, `~/Downloads/<APP_NAME>/` en Code); las del usuario usan
el diálogo de guardado nativo. Ninguna se abre sola. **Hallazgo D0, verificado con evidencia
directa:** Electron/macOS NO añade `com.apple.quarantine` automáticamente a lo que `will-download` +
`setSavePath` escriben (`xattr -p com.apple.quarantine` no encuentra el atributo tras la descarga),
así que `downloads.ts` lo añade a mano (`xattr -w com.apple.quarantine …`) en toda descarga
atribuida al agente, para que Gatekeeper avise antes de que algo la abra — coherente con el hallazgo
S4 (§2) sobre `tasks:openPath`.

**Lista blanca de CDP.** `cdp.ts` solo puede enviar los métodos de `ALLOWED_CDP`
(`embedded-browser/api.ts`): nunca `Network.getCookies`/`getAllCookies`/`setCookie`, `Storage.*`,
`Target.*`, `Browser.*`, `Fetch.*`, `DOM.setFileInputFiles`, `Page.addScriptToEvaluateOnNewDocument`,
`Emulation.*`, `Security.*` ni `Page.setDownloadBehavior`. Verificado por inspección directa del
array en cada paquete que tocó el archivo (D1–D5): ninguno de esos métodos aparece nunca en la
lista.

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
  de `node-pty` cargue bajo hardened runtime). Los binarios embebidos `cu-helper` y `onyxcode-disclaim`
  se listan en `mac.binaries` para que quede explícito que también se firman.
- **Notarización:** hook `afterSign` propio (`build/notarize.js`, usa `@electron/notarize`
  directamente) en vez de la opción `mac.notarize` de electron-builder, para loguear con claridad
  cuándo se omite. Solo notariza si `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` y `APPLE_TEAM_ID` están
  en el entorno; si no, lo salta con un mensaje y el build ad-hoc sigue funcionando igual que antes.

## 5. Riesgos conocidos / pendiente

- El token del MCP viaja en `OPENCODE_CONFIG_CONTENT` del servidor de acceso total (oculto a su
  bash por el plugin `onyxcode-env`). Otro proceso del mismo usuario **sin sandbox** (p. ej. el bash
  del modo Code) podría leer ese entorno (`ps eww`) y llamar al MCP. Mitigación futura: verificar el
  PID del cliente TCP (que sea descendiente del servidor de acceso total) o un canal por socket Unix.
- El `cu-helper` no es un bundle con identidad propia (lección 7): los permisos siguen siendo de
  OnyxCode.app.
- ✅ **Corregido** — El PTY de la terminal integrada ya no hereda los permisos de OnyxCode: se lanza
  con `onyxcode-disclaim` igual que los `opencode serve` (`src/main/pty/service.ts`, §3 arriba).
- Sin Developer ID + hardened runtime + notarización configurados (ver `docs/DISTRIBUCION.md`): cada
  build ad-hoc cambia la identidad y macOS olvida los permisos concedidos. La config ya soporta
  ambos casos (`electron-builder.js` + `build/notarize.js`); falta que el usuario aporte su propio
  Developer ID Application.
