# Seguridad de OnyxCode — modelo actual

Resumen de las defensas del proceso principal, las ventanas y los procesos hijos. Detalle de los
hallazgos y su estado en `AUDIT.md`; motivación en notas privadas (fuera del repositorio)
(«Lecciones para OnyxCode», bloques A y B).

## 1. Renderer y ventanas

| Control | Dónde |
|---|---|
| Renderer de producción servido por `onyxcode://app/…` (esquema privilegiado `standard`+`secure`), nunca `file://`. Solo host `app`, solo archivos de `out/renderer` (sin `..` ni enlaces fuera), `nosniff`, COOP/CORP | `src/main/security/app-protocol.ts` |
| CSP por **cabecera** en cada HTML: `script-src 'self'`, `connect-src 'self' http://127.0.0.1:*`, sin frames/workers/objetos, `base-uri`/`form-action 'none'` (la `<meta>` se mantiene para el dev server); las peticiones del servidor de cuentas (§3 sexies) salen desde main, no desde el renderer | `RENDERER_CSP` |
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
Los canales `account:*` (§3 sexies) son solo de la ventana principal y llevan esquemas estrictos.
Lo mismo vale para `app:testProviderKey` y `diag:*` (§3 nonies).

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
(`embedded-browser/session.ts`) solo deja pasar `http(s):`, `ws(s):`, `data:`, `blob:` y `about:`, y
cancela cualquier petición (de cualquier tipo de recurso, no solo la navegación de primer nivel)
hacia un destino loopback o de red privada (`127.0.0.0/8`, `::1`, `10.0.0.0/8`, `172.16.0.0/12`,
`192.168.0.0/16`, `169.254.0.0/16`, `.local`) salvo que (a) el destino tenga EXACTAMENTE el mismo origen `host:puerto` que la
página de primer nivel (su propio CSS/JS/imágenes/`ws` de HMR; `127.0.0.1` y `localhost` cuentan como
orígenes distintos) o (b) la página de primer nivel sea un origen local aprobado con «Permitir siempre»
(`localhost:PUERTO`, aprobación por origen exacto, nunca por comodín). (a) se añadió en F8-B41: antes solo
valía (b) y una página local escrita por el usuario o aprobada «en esta tarea» cargaba sin estilos ni
imágenes; (a) no amplía el alcance, la página ya está cargada desde ese origen. Lógica pura y probada en
`sites.ts` (`localSubresourceAllowed`) y `session.test.ts`. Verificado en vivo (D0, reconfirmado por D5 contra el árbol final): esta build de
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
solo para la tarea, o escrita por el usuario, sigue bloqueada hacia otros puertos; solo carga lo de su propio origen). Está fijado por el E2E
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

## 3 quinquies. Aviso de versión nueva

Aviso NO bloqueante de que hay una versión publicada más reciente (ya no es la única conexión de red propia de la app: la cuenta, §3 sexies, también contacta `api.onyxcode.cl`). Por sí solo no descarga, no instala y no ejecuta
nada: lee un JSON y, si el usuario pulsa «Descargar», abre en el navegador la página de la release. Si esta copia puede
actualizarse sola, el botón «Actualizar» inicia la descarga verificada de la sección 3 septies; **solo** al pulsarlo se
descarga algo (la comprobación automática sigue siendo únicamente el `GET` de abajo).

- **Qué se envía.** Un único `GET https://api.github.com/repos/{owner}/{repo}/releases/latest` (`owner/repo` es la
  constante `RELEASES_REPO` de `src/shared/brand.ts`; vacía = sin red y aviso apagado). Sin autenticación: cabeceras
  `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28` y `User-Agent: <APP_NAME>/<versión>`;
  `credentials: 'omit'`, sin `Authorization` ni `Cookie`. GitHub ve, como a cualquier cliente, la IP. Como mucho una
  vez cada 24 h (más «Buscar ahora», manual), con espera y tiempo límite de 8 s. Se puede apagar en Ajustes →
  Acerca de (`checkUpdates`); apagado no hay ninguna petición y un resultado que llegue tarde se descarta.
- **Qué se lee.** Solo `tag_name`, `html_url`, `draft` y `prerelease`; respuestas de más de 256 KB se rechazan.
  Se avisa únicamente si el tag es una versión semver mayor que `app.getVersion()` (un borrador, un tag ilegible o
  una prerelease frente a una app estable nunca avisan).
- **Validación de la URL.** `html_url` solo se usa si es `https:`, host exactamente `github.com`, sin usuario,
  contraseña ni puerto y con ruta bajo `/{owner}/{repo}/releases/`; si no, se usa
  `https://github.com/{owner}/{repo}/releases/tag/{tag}`. El renderer lo vuelve a comprobar antes de pedir abrirla
  (`app:openExternal`, que ya solo admite http/https). `redirect: 'error'`: una redirección se trata como fallo.
- **403/429 (límite de GitHub).** Se guarda `retryAfter` (de `Retry-After` o `X-RateLimit-Reset`, entre 1 h y 24 h)
  en `userData/update-check.json`; hasta entonces no se vuelve a preguntar, tampoco con «Buscar ahora». Cualquier otro
  fallo (red, tiempo, 5xx, JSON inválido) espera 1 h; no hay reintentos dentro de la sesión. El estado
  (`lastCheck`, `retryAfter`, `dismissed`) se escribe de forma atómica y tolera un fichero corrupto.
- **Variables de test.** `ONYXCODE_TEST_RELEASES_API`, `_REPO` y `ONYXCODE_TEST_UPDATE_DELAY_MS` solo se honran con la
  app SIN empaquetar (y la base debe ser `http://127.0.0.1:<puerto>` o `https:`); en la app empaquetada se ignoran y
  siempre se usa la API de GitHub. Las pruebas usan un servidor local; nunca llaman a api.github.com. Lo mismo vale para
  `ONYXCODE_TEST_UPDATE_PUBKEY` y `ONYXCODE_TEST_UPDATE_INSTALL_DIR` (actualizador, sección 3 septies). Única excepción:
  un **build de prueba** (`ONYXCODE_TEST_BUILD=1` en compilación, `docs/DISTRIBUCION.md` §11) las honra también
  empaquetado; un build normal no contiene ese código (el valor se sustituye en compilación y el resto se elimina).
- **Riesgos conocidos.** Quien controle el repositorio o la cuenta de GitHub de `RELEASES_REPO` controla qué versión
  se anuncia y la página a la que lleva «Descargar» (siempre dentro de ese repositorio): la app no verifica firmas de
  esa descarga manual («Descargar»), eso lo hace macOS (Developer ID y notarización, cuando existan); la ruta
  «Actualizar» sí verifica una firma Ed25519 propia (sección 3 septies). Un repositorio renombrado o movido
  devuelve una redirección y, con `redirect: 'error'`, nunca avisa. `/releases/latest` no devuelve prereleases. El
  `fetch` de Node no usa el proxy del sistema (tras un proxy obligatorio el aviso simplemente no llega). Sin
  `retryAfter` persistido, un fallo se reintenta en el siguiente arranque pasada 1 h.

## 3 sexies. Cuenta

> **Estado: activa.** `ACCOUNT_API` (`src/shared/brand.ts`) es `https://api.onyxcode.cl` (servidor de la Fase 2, contrato
> en `docs/CUENTAS-SERVIDOR.md`): la app exige iniciar sesión y es la única conexión de red propia, junto con el
> aviso de versión (§3 quinquies) y el actualizador (§3 septies), que no lleva datos de la cuenta. Todo el tráfico va
> por el proceso principal, de modo que la CSP de §1 no cambia. Para pruebas, `ONYXCODE_ACCOUNT_DISABLED=1` apaga la
> cuenta **solo con la app sin empaquetar** (los E2E y el smoke); en la app empaquetada se ignora siempre.

- **Flujo.** Cuenta obligatoria con dos entradas, sin contraseñas: (a) **correo + código** de 6 dígitos (`email/start` →
  `email/verify`) y (b) **Google por loopback** (RFC 8252) con PKCE S256, nunca por el esquema `onyxcode://`
  (ese esquema es solo interno). La app nunca habla con Google: abre en el navegador del sistema la `auth_url` que
  devuelve **nuestro** servidor. El flujo es OAuth **web mediado por el servidor**: Google redirige al callback
  `https://api.onyxcode.cl/v1/auth/google/callback` (no al loopback), el servidor canjea con Google (el `client_secret`
  vive solo allí), valida el `id_token` y redirige al loopback de la app con un código propio de un solo uso; la app lo
  recibe en un receptor local y el servidor lo canjea (`/v1/auth/exchange`). Detalle en `docs/CUENTAS-SERVIDOR.md` §2.
  La pantalla de acceso está montada **antes** de la app (`<AccountGate><App/></AccountGate>`): hasta pasar no se montan
  los efectos de `App` ni el asistente «Conecta tu IA».
- **Receptor loopback** (`src/main/account/loopback.ts`). Escucha solo en `127.0.0.1`, puerto aleatorio, como mucho
  5 minutos; acepta **una** petición `GET /callback` con `state` correcto (256 bits, comparación en tiempo constante) y
  se cierra. Otras rutas/métodos, `Host` distinto de `127.0.0.1:<puerto>` (anti DNS-rebinding) o `state` incorrecto se
  rechazan sin gastar el turno (una página ajena no puede romper el inicio de sesión) y tras 20 rechazos se abandona.
  Respuesta: una página mínima «Puedes volver a la app» con CSP `default-src 'none'`, `no-store` y `no-referrer`.
- **Sesión.** Token **opaco** emitido por el servidor. Se guarda en `userData/account.bin` cifrado con
  `safeStorage` (Llavero de macOS), modo 0600, **solo en main**; el renderer recibe un estado público
  `{required,status,email,provider,graceEndsAt,checking,memoryOnly}` **sin token** (hay pruebas unitarias y E2E que lo
  comprueban). Si `safeStorage.isEncryptionAvailable()` es falso, la sesión vive solo en memoria (la pantalla avisa) y
  no se escribe nada en claro. Un archivo ilegible se borra y cuenta como «sin sesión». Solo con la app **sin
  empaquetar** y `ONYXCODE_TEST_PLAIN_STORE=1` se usa un archivo de prueba en claro (`account.test.json`) para que los
  E2E no toquen el Llavero real.
- **Validación y gracia.** Al arrancar y cada 24 h, `GET /v1/me` con `Authorization: Bearer`. Sesión válida → abre;
  **401** (revocada/caducada) → bloquea al instante y borra la sesión; **404/410** (cuenta borrada) → bloquea y la
  borra; servidor sin respuesta (red, 5xx, 429…) → la app abre **mientras la última validación correcta tenga menos de
  30 días** y si no, bloquea («Sin conexión con el servidor», con «Reintentar»). Una validación anotada «en el futuro»
  (reloj atrasado más de 5 min) no da gracia. Lógica pura y exhaustivamente probada en `src/shared/account.ts`.
- **Qué sale a la red** (todo por `net.fetch` desde main; la CSP del renderer no cambia y sigue sin permitir internet):
  `POST /v1/auth/email/start {email}`, `POST /v1/auth/email/verify {email,code}`, `POST /v1/auth/google/start
  {redirect_uri,state,code_challenge}` (solo el *challenge*), `POST /v1/auth/exchange {code,code_verifier,redirect_uri}`,
  `GET /v1/me`, `POST /v1/logout`, `DELETE /v1/me`; todas con `credentials:'omit'` (sin cookies), `redirect:'error'`,
  sin cabecera `Origin`, tiempo máximo de 10 s, respuesta de hasta 256 KB y `User-Agent: <APP_NAME>/<versión>`. El
  servidor ve el correo, la IP y el momento. **No** sale ninguna conversación, archivo ni clave de IA.
- **Dominio único.** La app solo habla con el origen fijo `ACCOUNT_API` (`https://`, sin ruta ni credenciales; uno
  inválido deja la cuenta activa pero sin servidor: **falla cerrado**, nunca «sin login»). `ONYXCODE_ACCOUNT_URL` (servidor
  falso de E2E) y `ONYXCODE_ACCOUNT_DISABLED=1` solo se respetan con la app sin empaquetar, y la primera gana a la segunda. La URL del navegador para Google solo se abre si es
  `https:` (y, sin empaquetar, `http://127.0.0.1`).
- **Quick Entry, atajo global y bandeja** solo actúan con la cuenta al día (`isAccountAllowed()`); sin ella, «Nueva
  conversación», Quick Entry y Ajustes de la bandeja no hacen nada (quedan «Abrir» y «Salir») y una Quick Entry abierta
  se oculta al perderse la sesión. Con la cuenta apagada (solo posible sin empaquetar, en pruebas) nada de esto cambia.
- **IPC.** Canales `account:*` (estado, Google, cancelar, reintentar, enviar/verificar código, cerrar sesión, borrar,
  exportar) y evento `account:changed`; **solo** la ventana principal (no están en `CHANNEL_ROLES`), con esquemas
  estrictos (correo ≤ 254, código `^\d{6}$`). «Borrar mi cuenta» exige confirmación y **no** toca `opencode-data`
  (claves de IA) ni las conversaciones.
- **Riesgos conocidos.** (1) El bloqueo es del lado cliente: quien modifique su copia de la app puede saltárselo; la
  cuenta sirve para gestionar y contar usuarios, no es DRM. (2) Quien controle el servidor controla la `auth_url` a la
  que se manda al navegador (siempre `https`) y puede emitir sesiones, pero no ve datos locales. (3) Adelantar/atrasar el
  reloj del sistema dentro de la ventana de 30 días alarga la gracia. (4) Otro proceso del mismo usuario con acceso
  al Llavero (y su aviso) podría leer el token. (5) Sin *certificate pinning*: un CA comprometido o un proxy con
  certificado instalado ve el tráfico. (6) `net.fetch` usa la pila de Chromium y el proxy del sistema. (7) El correo es
  un dato personal: hay obligaciones legales (borradores `docs/PRIVACIDAD-BORRADOR.md` y `docs/TERMINOS-BORRADOR.md`,
  pendientes de revisión por un abogado). (8) Nada de esto está probado aún contra Google ni contra un servidor real.
- **Pruebas.** Servidor falso `e2e/fake-auth/server.mjs` (con sus propios tests) y `e2e/specs/account.e2e.ts`; nunca hay
  red real, Google ni correo.

## 3 septies. Actualizador propio («Actualizar»)

Sobre el aviso de la sección 3 quinquies: descarga la versión nueva desde la release de GitHub, la verifica y sustituye
la app. Solo está activo si `isValidRepo(RELEASES_REPO)` **y** `UPDATE_PUBLIC_KEY !== ''` (`src/shared/brand.ts`) **y** la
plataforma es macOS **y** la app está en una carpeta válida; si no, `UpdateState.installable` es `false` y la interfaz
queda como antes («Descargar»). El renderer solo pide acciones (`app:updateDownload`, `app:updateCancel`,
`app:updateInstall`, evento `app:updateProgress`): **nunca** aporta URLs ni rutas; main las construye.

**Modelo de confianza.** La autenticidad la da **únicamente** la firma Ed25519 del manifiesto `update.json`
(`update.json.sig`, sobre los **bytes exactos** del manifiesto). `codesign --verify` no prueba autenticidad (una firma
ad-hoc coherente la genera cualquiera) y solo se usa como control de integridad. Se verifica la firma **antes** de
interpretar el JSON (`crypto.verify(null, bytes, createPublicKey({key, format:'der', type:'spki'}), sig)`); límites:
manifiesto ≤ 16 KB, firma ≤ 1 KB, y el `size` firmado del ZIP (≤ 600 MB) es el tope real de lectura en streaming.

**Flujo.** `Actualizar` → (1) manifiesto y firma; (2) `validateManifest`: `appId` igual, `keyId` de la clave que verificó,
`version === tag` sin la `v`, versión **mayor** que `app.getVersion()` (anti-downgrade), nombre `OnyxCode-X.Y.Z-arm64.zip`;
(3) espacio libre (`statfs` ≈ 3× el tamaño); (4) descarga a `userData/update/staging/<ver>/` (0700, se borra al empezar) con
SHA-256 incremental; (5) hash y tamaño == los firmados; (6) `zipinfo -1` y cada entrada validada (`isSafeZipEntry`: nada
de `..`, rutas absolutas, `\`, NUL ni nada fuera de `OnyxCode.app/`; única excepción, los metadatos AppleDouble de `ditto
--sequesterRsrc` bajo `__MACOSX/OnyxCode.app/…/._x`, que `ditto -x` aplica como atributos y no crea nada fuera); tope
de tamaño descomprimido; (7) `ditto -x -k`; (8) recorrido `lstat` (todo symlink se resuelve **dentro** de la `.app`, sin
enlaces absolutos, dispositivos ni FIFOs); (9) `codesign --verify --deep --strict`; (10) `codesign -dv` con
`Identifier = APP_ID`; (11) `plutil`: `CFBundleIdentifier` y `CFBundleShortVersionString` == manifiesto; (12)
`xattr -dr com.apple.quarantine`. Solo entonces el estado es «Lista para reiniciar». **Nada del staging se ejecuta antes
de «installing»** y se vuelve a verificar (8 a 11) justo antes de sustituir.

**Descarga.** `fetch` con `redirect: 'manual'`, `credentials: 'omit'`, sin `Authorization` ni `Cookie`. GitHub redirige
`releases/download/…` a `release-assets.githubusercontent.com` / `objects.githubusercontent.com`; se siguen **a mano**
(máx. 3 saltos, solo `https`, host `github.com` o `*.githubusercontent.com` exacto — `githubusercontent.com.evil.example`
no vale —, sin credenciales ni puerto). (El `redirect: 'error'` del aviso solo vale para la API, que no redirige.)

**Sustitución.** `app.isInApplicationsFolder()` (admite `~/Applications`), ruta no trasladada (sin `/AppTranslocation/`),
fuera de `/Volumes/` y `fs.access(W_OK)` sobre la carpeta padre y el `.app`; si falla, solo «Descargar». El script de
reemplazo **no se ejecuta desde el `.app` que sustituye**: `resources/updater/swap.sh` viaja sellado en
`Contents/Resources/updater/`, se copia a `userData/update/run/` (0700, `0700` el archivo) y se lanza con
`spawn('/bin/sh', [copia, …args], {detached: true, stdio: 'ignore'}).unref()` — **nunca** `sh -c` con cadenas. Los
argumentos los valida `swap.ts` (PID = el de la propia app; rutas absolutas y normalizadas; `target` == ruta real de la
`.app` en ejecución; `staged` == `userData/update/staging/<ver>/extract/OnyxCode.app`; marcadores bajo
`userData/update`; copia `<dir>/.OnyxCode.app.bak-<ver>`) y `swap.sh` los vuelve a validar. `swap.sh` (POSIX, `set -eu`):
espera a que el PID termine (tope 60 s; si no, aborta **sin tocar nada** y escribe `result.json`), mueve `target → bak`
(mismo directorio: `rename` atómico; `ditto` solo si falla), `staged → target` (si falla restaura), abre la nueva y espera
hasta 90 s el archivo `boot-ok-<ver>`; si no aparece mata el PID que la nueva escribió en `booting-<ver>` (solo si es un
proceso de ese `.app`), mueve la nueva a `.OnyxCode.app.failed-<ver>`, restaura la copia, abre la vieja y escribe
`result.json {rolledBack: true}` (la vieja lo muestra como error). La app nueva escribe `booting-<ver>` (su PID) al
arrancar (solo si obtuvo el lock de instancia única) y `boot-ok-<ver>` tras `did-finish-load` **y** la confirmación del
renderer (`app:bootConfirm`). La copia de seguridad la borra la app nueva en el **siguiente** inicio tras un arranque ya
confirmado. Durante la sustitución, `second-instance` se ignora (`isUpdating`); `before-quit` ya detiene sidecar, Tareas y
navegador embebido y ni rutinas ni Quick Entry lo cancelan (revisado: el único `preventDefault` de cierre es el propio).

### Amenazas

| Amenaza | Defensa |
|---|---|
| Cuenta de GitHub comprometida | Puede subir ZIP y manifiesto pero **no firmarlos**: la clave privada no está nunca en GitHub ni en CI. Sin firma válida la descarga se descarta antes de tocar nada. |
| MITM / proxy hostil | `https` + firma Ed25519 del manifiesto (que contiene el SHA-256 y el tamaño del ZIP). Hosts permitidos y redirecciones limitadas. |
| Downgrade | Manifiesto firmado + `version == tag` + versión mayor que la actual + `Info.plist` coherente con el manifiesto. |
| Repetición de un manifiesto antiguo | Solo se ofrecen versiones **mayores** que la instalada y el manifiesto debe corresponder al tag de la release anunciada. **Riesgo aceptado:** un atacante con una cuenta comprometida podría re-publicar un manifiesto viejo *firmado* (vulnerable) mientras siga siendo más nuevo que la copia instalada. |
| ZIP con `../` o symlinks | Listado validado **antes** de extraer; recorrido `lstat` **después** (todo symlink dentro de la `.app`). |
| ZIP bomba | Tamaño del ZIP firmado (tope ≤ 600 MB) como tope real de lectura; tope del tamaño descomprimido; espacio libre comprobado. |
| TOCTOU | Staging 0700 en `userData`; se vuelve a verificar justo antes del `mv`. Un atacante con el mismo usuario queda **fuera del modelo** (ya puede modificar la `.app` instalada). |
| Script de reemplazo manipulable | Sellado en el `.app`, copiado a una carpeta 0700, argumentos validados dos veces, nunca `sh -c` con cadenas. |
| Clave privada perdida / filtrada | Perdida: no hay más actualizaciones automáticas (hay que bajar un `.dmg` a mano; el aviso sigue). Filtrada: no hay defensa para lo ya instalado; publicar una versión con clave nueva y avisar (rotación: la versión N lleva `[nueva, vieja]` y firma la vieja; desde la N+1 firma la nueva). `docs/DISTRIBUCION.md` §10. |

**Permisos de macOS (TCC).** Con firma ad-hoc macOS vuelve a pedir los permisos tras cada actualización. La mitigación es
un certificado de firma de código **autofirmado** del usuario (`ONYXCODE_SELF_SIGNED=1`, `docs/DISTRIBUCION.md` §10.3):
sin hardened runtime y sin notarizar; `cu-helper` y `onyxcode-disclaim` se firman con el mismo certificado conservando
`HELPER_ID`/`DISCLAIM_ID`. La primera migración ad-hoc → autofirmado pedirá los permisos una vez más.

**Variables y ganchos de prueba.** `ONYXCODE_TEST_UPDATE_PUBKEY` y `ONYXCODE_TEST_UPDATE_INSTALL_DIR` solo con la app sin
empaquetar (igual que `config.ts`); sin empaquetar **nunca** se sustituye nada («Reiniciar ahora» se rechaza). En
`swap.sh`, `ONYXCODE_SWAP_TEST_NO_OPEN` solo se acepta si el destino está bajo `$TMPDIR`. `ONYXCODE_TEST_FAIL_BOOT=1` solo
en un build de prueba (compilado con `ONYXCODE_TEST_BUILD=1`).

**No verificado aquí:** permisos TCC reales, Gatekeeper en otro Mac, la protección «Gestión de apps» de macOS 13+ al
modificar `/Applications` (el reemplazo se probó en directorios temporales, con `open` sustituido por ejecución
directa), proxy corporativo (el `fetch` de Node no usa el proxy del sistema) y disco lleno.

## 3 octies. Puntos de restauración de Tareas

Antes de cada mensaje que se envía a una tarea, el proceso principal guarda una instantánea de la carpeta de la tarea (`tasks:restore:create`, `src/main/tasks/restore-points.ts`). Sirve para
mostrar «Cambios en archivos» con su diferencia, «Deshacer los cambios de esta tarea», «Deshacer desde aquí», «Editar y reintentar» (que ahora sí restaura archivos) y «Rehacer». Es una copia
**propia de la app**, no usa git: el revert de OpenCode solo toma instantáneas en repositorios git (`vcs === 'git'`), así que en una carpeta sin git ocultaba mensajes pero **no restauraba archivos**
(el diálogo de «Editar y reintentar» prometía lo contrario; corregido).

**Cómo funciona.** El copiado lo hace el proceso principal, fuera del sandbox. Almacén en `userData/restore-points/<sha256(carpeta):16>/` con `objects/<sha256>` (contenido por hash; clon
`COPYFILE_FICLONE`, casi gratis en APFS), `points/<id>.json` (manifiesto `{v:1, entries:{ruta:{size,mtimeMs,mode,hash}}}`) y `points/<id>.meta.json`. Es incremental (si tamaño y fecha coinciden con
el punto anterior se reutiliza el hash) y se limita a 20 puntos por tarea y 30 días, con recolección de objetos huérfanos. Nada se escribe dentro de la carpeta del usuario.

**Qué restaura** (contenido y permisos `mode`) de archivos normales **dentro de la carpeta de la tarea**. Los archivos creados después del punto van a la **Papelera** (`shell.trashItem`; nunca
se borra con `rm`) junto con las carpetas nuevas que queden vacías. Antes de tocar nada se crea otro punto, «Antes de deshacer»: así deshacer se puede deshacer (`Rehacer`). Cada ruta se valida con
`lstat` componente a componente (un directorio intermedio que sea symlink rechaza esa ruta) y `realpath` dentro de la carpeta; se escribe en un temporal de la misma carpeta y `rename` atómico.
`tasks:restore:apply` responde `BUSY` si el monitor ve trabajo en curso en la carpeta. Solo la ventana principal puede invocar los canales (sin entrada en `CHANNEL_ROLES`), la carpeta pasa por
`TasksManager.assertInsideApproved` y las rutas que llegan del renderer solo valen si coinciden con un cambio calculado por main.

**Qué NO restaura:**

- Cambios **fuera** de la carpeta de la tarea. Tampoco se incluyen las carpetas vinculadas con escritura (decisión de esta primera versión: solo la carpeta principal).
- Efectos de comandos y de otras herramientas: instalaciones, `git push`, red, correos, otras apps, control del Mac.
- Lo excluido por los límites: `node_modules/`, `.git/` y `.onyxcode/` (la memoria), archivos de más de 50 MB (se listan como no restaurables), symlinks (se registran y no se siguen ni se restauran),
  y carpetas con más de 20 000 archivos o más de 2 GB (el punto queda «omitido» y la conversación avisa «Esta vez no se guardó un punto de restauración: …»; el mensaje se envía igualmente).
- Atributos extendidos y metadatos de Finder (etiquetas, ubicación de iconos, cuarentena…).
- Lo que cambie **mientras se crea** el punto (la copia no es atómica entre archivos).

**Amenazas.**

| Amenaza | Defensa |
|---|---|
| El agente altera o lee el almacén | **Sandbox:** `userData` ya está denegado al agente en el perfil Seatbelt (no se tocó el perfil); no puede leer ni escribir las copias. **Control total:** el agente corre sin sandbox y **sí podría** alterar o leer el almacén (la interfaz lo avisa junto al botón). Por decisión del usuario también se crean puntos en Control total. |
| Escape por symlink al restaurar | Recorrido sin seguir symlinks, validación de cada componente de la ruta y `realpath` dentro de la carpeta; una ruta con un directorio intermedio symlink se rechaza. Rutas con `..` o absolutas se rechazan. |
| Pérdida de datos al deshacer | Punto «Antes de deshacer» previo; lo creado va a la Papelera, nunca se borra; escritura atómica; si el punto previo no se puede guardar, no se deshace nada. |
| Archivo que existía pero no se pudo copiar (permisos, E/S, iCloud «solo en la nube», directorio ilegible) | **No se omite**: se registra con `hash:null` y motivo (`skip`), los directorios ilegibles en `unreadableDirs` y los stubs de iCloud en `cloudStubs`; nada de eso se trata como «nuevo», así que nunca va a la Papelera. Se muestran como «no restaurable» con su motivo (F8-B21). |
| Punto que bloquea la app o llena el disco | Copia y hash asíncronos; presupuesto de 30 s (el punto queda «omitido» y se limpian los temporales); se exige el tamaño a copiar + 512 MB libres (`statfs`) y ENOSPC también deja el punto omitido. |
| Confidencialidad de las copias | Son contenido **del usuario sin cifrar** en `userData`, con permisos `0700` (carpetas) y `0600` (manifiestos). Quien lea `userData` lee las copias. «Ajustes › Tareas › Almacenamiento» permite ver su tamaño y borrarlas; se borran también al eliminar la tarea. |
| Falso sentido de seguridad en carpetas sin git | El revert de OpenCode no restaura archivos sin git; el diálogo ya no lo promete. «Editar y reintentar» restaura con el punto propio y avisa si no hay uno. |
| Variable de pruebas | `ONYXCODE_E2E_TRASH_DIR` (Papelera de pruebas) solo se honra con la app sin empaquetar; guardia estática en `trash.test.ts`. |

**Verificado (F8-B21):** ExFAT, FAT32 y HFS+ con mayúsculas con imágenes `hdiutil` reales (`npm run test:fs`; granularidad de fecha, mayúsculas, deshacer/rehacer); carpetas de ~20 000 archivos y
archivos de 45 MB (`npm run test:stress`: límites, incremental, bucle de eventos y memoria); un archivo normal pequeño en APFS tiene `blocks > 0` (no se confunde con la nube).

**No verificado aquí:** iCloud Drive real (solo se imita con archivos dispersos de `blocks === 0`; el predicado es heurístico y un volumen de red/FUSE que no informe bloques se tomaría como «en la nube» y
no se copiaría, sin riesgo de pérdida pero sin protección), carpetas de red (bloqueos, latencia), un disco que se llena o se desconecta a mitad de la copia (ENOSPC se cubre con espacio inyectado, no con un disco
lleno real), y todo lo que dependa de un modelo real (el orden exacto en que el agente escribe respecto al punto).

## 3 nonies. Probar clave y Diagnóstico

**Probar clave** (`app:testProviderKey`, `src/main/providers/key-probe.ts`). La clave de un proveedor se guarda en `userData/opencode-data/opencode/auth.json` (la escribe el motor). Para probarla, **main** la lee
de ese archivo y hace un GET gratuito al proveedor; el renderer solo manda el id del proveedor (esquema `^[A-Za-z0-9._-]+$`) y recibe un estado. La clave nunca cruza el IPC, no se registra y
no forma parte de ningún mensaje de error (se construyen a mano). Salida a internet con `net.fetch` desde main (no se tocó la CSP ni `connect-src`), `redirect: 'manual'`, 10 s, solo el código HTTP.
La clave de Google va en cabecera (`x-goog-api-key`), nunca en la URL. Cada entrada de `PROBES` se verificó con una clave inválida; `opencode` y `opencode-go` quedan fuera porque su listado es público.
Un intento por proveedor a la vez y 5 s entre pruebas. Para proveedores `@ai-sdk/openai-compatible` la clave se envía al `api` https que declara el catálogo del motor (el mismo host al que iría el chat).
`ONYXCODE_E2E_KEY_PROBE_BASE` solo se honra sin empaquetar y solo con `http://127.0.0.1:<puerto>` (guardia estática en `key-probe.test.ts`).

**Diagnóstico** (`diag:logs`, `diag:copy`, `diag:export`, `src/main/diagnostics/`). Los registros del motor (stdout/stderr de `opencode serve`, su `.log` y un informe) salen de main **solo** por
`DiagnosticsService`, que los pasa por el redactor: secretos exactos conocidos (contraseña y `Authorization` del sidecar, valores de `auth.json`, cabeceras y entorno de los MCP), patrones de claves y tokens
y la carpeta del usuario (`~`). Lo redactado es lo único que llega al renderer, al portapapeles (lo escribe main) y al archivo exportado (0600, `chmod` aunque ya existiera). Una prueba estática vigila que los
handlers no lean registros por su cuenta. No incluye los registros del sandbox de Tareas. Los patrones son lineales (prueba con líneas de 1 MB < 200 ms).

| Amenaza | Defensa |
|---|---|
| La clave llega al renderer o a un registro | Solo main la lee; el resultado es un estado; propiedad en `key-probe.test.ts` con claves aleatorias; E2E comprueba DOM y salida de Electron. |
| Redirección que reenvíe la clave a otro host | `redirect: 'manual'`: un 3xx es «respuesta inesperada», no se sigue. |
| Falso «funciona» por un listado público | Cada sonda se verificó con curl y clave inválida; los proveedores con listado público son `unsupported`. |
| Un registro filtra un secreto | Redacción exacta + patrones antes de salir de main; el anillo guarda el texto crudo solo en memoria. |
| ReDoS en el redactor | Expresiones lineales; prueba de rendimiento con entradas adversarias. |

**No verificado aquí:** claves reales de los proveedores (solo claves falsas con curl y un servidor local), el comportamiento exacto de `net.fetch` con `redirect: 'manual'` frente a un 3xx real de un proveedor,
y los secretos sin forma conocida que no estén guardados en `auth.json` ni en los MCP.

## 3 decies. Catálogo MCP curado

Ajustes › MCP ofrece fichas de conectores verificados (`src/shared/mcp-catalog.ts`, incluidas en la app: **no se descarga ni se consulta ninguna lista externa**). v1 solo admite servidores **remotos**
con URL `https://`: añadir uno no ejecuta nada en el Mac (no hay `command` ni `npx`). Nada se escribe ni se conecta sin confirmar en el diálogo (host y URL completa, datos que salen, JSON exacto con el secreto enmascarado).

**Canales.** `mcp:catalog` (lectura) y `mcp:installCatalog`: solo ventana principal (sin entrada en `CHANNEL_ROLES`), esquema estricto (`id` `^[a-z0-9-]{1,64}$`, nombre MCP válido, máx. 10 valores de 4096 caracteres,
booleanos). El renderer **no manda URL ni cabeceras**: `buildCatalogEntry` (`main/extras/mcp-catalog-install.ts`) toma la ficha de la copia de main, exige que cada valor cumpla el patrón anclado de la ficha,
rechaza CR/LF/NUL y longitudes excesivas, y rechaza datos desconocidos. Los mensajes de error no repiten el valor. Un nombre repetido es error (nunca se pisa un servidor existente).

**Qué queda en disco.** La entrada en `userData/opencode/opencode.json` (el archivo ahora se escribe con permisos **0600**) y, si se pidió, `permission["<nombre>_*"]="ask"` («Preguntar antes de cada uso»,
formato verificado con el binario real de OpenCode: la configuración lo acepta y aparece como regla `ask` del agente). La procedencia (`catalogId`, versión, fecha, URL; **nunca el secreto**) va aparte en
`userData/mcp-catalog-installs.json` (0600) para no añadir claves desconocidas a `opencode.json`; sirve para marcar «Modificado» si la URL, el tipo o las cabeceras dejan de ser las del catálogo. Eliminar el servidor
limpia entrada, regla `ask` (solo si la puso la app) y procedencia.

| Riesgo | Defensa / límite |
|---|---|
| Un token queda en claro en disco | Igual que al añadir un servidor a mano: texto plano en `opencode.json`, ahora 0600 (solo el usuario). El diálogo lo dice. GitHub: usar un token de grano fino con permisos mínimos. |
| Inyección de cabeceras | Patrón anclado por entrada + rechazo de CR/LF/NUL; la plantilla se aplica con función de reemplazo (un `$&` no se expande). |
| Ficha que apunta a otro host | Test de catálogo: https, sin credenciales ni query, host del dominio del proveedor; `npm run check:mcp-catalog` (manual) comprueba que sigue respondiendo como MCP y que la documentación existe. |
| Un conector remoto lee o escribe en el servicio del usuario | El diálogo avisa cuando la ficha puede escribir; «Preguntar antes de cada uso» viene activado y pide aprobación por herramienta. El servicio remoto recibe lo que la IA le envíe: el texto «Qué datos salen» lo explica. |
| Tareas | Los conectores del catálogo **no** se ofrecen en Tareas: no se marcan (`tasks-mcp.json`), así que ni sus hosts entran en la Red del sandbox ni se cargan en el sandbox. No se tocó `mcp-tasks.ts`. |

**No verificado aquí:** el inicio de sesión OAuth completo de Linear, Notion, Sentry y Atlassian con cuentas reales (solo se comprobó con el binario que cada servidor registra el cliente y devuelve la URL de
autorización), el uso real de las herramientas con un modelo, y que un token real de GitHub conecte (la URL responde 401 sin credencial y con un token inválido; no se probó con uno válido). Cambios futuros de URL o de documentación de los
proveedores: los detecta `npm run check:mcp-catalog`, no la app.

## 3 undecies. Idioma de la interfaz (español / inglés beta)

- Superficie nueva mínima: el ajuste `language` (`'system' | 'es' | 'en'`) viaja por el canal ya existente `settings:set` (esquema `literal('system','es','en')`; cualquier otro valor se rechaza y `normalize` lo devuelve a `'system'`). **No hay canales IPC nuevos ni entradas en `CHANNEL_ROLES`.**
- Los diccionarios (`src/shared/i18n`) son datos estáticos del paquete: no se descarga ni se ejecuta nada y no se interpreta HTML (los textos se pintan como texto de React). `format()` solo sustituye `{nombre}` por valores del propio código.
- Los preloads secundarios no importan el módulo de idioma (hashes de `out/preload/{quick,overlay,pill,assist,browser-host}.js` idénticos a `main`, también tras T4c). Quick Entry, overlay, píldora y globo de guía reciben el idioma como parámetro de consulta `?lang=es|en` de su propia URL (`loadLocalizedPage`): el valor sale de `getLang()` en main (nunca de entrada del usuario), la página solo lo acepta si es `es` o `en` y no se añade ningún canal ni capacidad; la URL sigue siendo `onyxcode://app/…` (el origen no cambia, la validación del emisor y los roles de ventana tampoco).
- Main usa el idioma para la bandeja, el menú, los errores y avisos que construye (`merr.*`: cuenta, binario, carpetas, política de la organización, rutinas, notificaciones y cuadros nativos) y las ventanas con preload propio; no cambia reglas de seguridad (CSP, `webRequest`, navegación, política de carpetas y de la organización: solo cambia el texto del motivo). Los códigos que consume el código (`FULL_ACCESS_NOT_GRANTED`) no se traducen y el renderer ya no clasifica errores por su texto (`NetworkSection`). Las etiquetas de los roles estándar del menú (Archivo, Edición, Ventana) las pone Electron según la configuración regional del sistema.
- Siguen en español los prompts de agente (`resources/opencode/*.md`), los borradores legales, lo que lee el modelo (descripciones y resultados de los MCP de Control del Mac y del navegador), el registro del modo auto y los residuos listados en F8-B27.

- Los preloads secundarios no importan el módulo de idioma (hashes de `out/preload/{quick,overlay,pill,assist,browser-host}.js` idénticos a `main`).
- Main usa el idioma solo para la bandeja y el menú de la app (`src/main/i18n.ts`); no cambia reglas de seguridad (CSP, `webRequest`, navegación). Las etiquetas de los roles estándar del menú (Archivo, Edición, Ventana) las pone Electron según la configuración regional del sistema.
- Los prompts de agente (`resources/opencode/*.md`) y los mensajes de error que construye main (T4c) siguen en español.
- T4b (Code, Tareas, Rutinas, navegador) solo mueve texto al renderer: `shared/ipc-tasks.ts` no importa i18n (los hashes de los preloads no cambian) y no se toca ninguna regla de sandbox, proxy, `folder-policy` ni CSP. Los textos que viajan al agente o se persisten (prompts, marcadores, `UNDO_POINT_LABEL`) siguen en español para no cambiar contratos.

## 3 duodecies. Adjuntos de Chat (R2-B)

- Qué entra al modelo: el compositor de Chat adjunta imágenes (PNG, JPG, GIF, WebP; ≤ 5 MB), PDF (≤ 10 MB) y archivos de texto (≤ 1 MB, se envían como `text/plain`); máximo 5 adjuntos y 15 MB por mensaje. El renderer lee el archivo con `FileReader` y lo manda como parte `file` con URL **`data:`** dentro del propio mensaje (`session.promptAsync`). **No hay canales IPC nuevos** ni acceso de main al disco por este camino; el agente `chat` conserva `"*": deny` (solo `webfetch`/`websearch`) y no gana ninguna herramienta.
- Verificado con el binario embebido (opencode 1.18.33, `resources/opencode-bin`, un servidor real con el agente `chat.md` y un proveedor falso que registra la petición al modelo): las herramientas que recibe el modelo son solo `webfetch`; una imagen `data:` llega como bloque `image` base64, un PDF como `document` base64 y un texto `data:text/plain` como texto en línea (el motor lo anota «Called the Read tool», pero es un texto sintético, no una lectura de disco). Un nombre de archivo con `../` no lee nada: solo es una etiqueta.
- **Hallazgo importante:** una parte `file` con URL `file://…` SÍ hace que el motor lea ese archivo del disco y lo entregue al modelo **sin pasar por los permisos del agente** (con `"*": deny` incluido; así funcionan las menciones `@archivo` de Code). Por eso `sendChatMessage` rechaza cualquier adjunto que no sea `data:` antes de llamar al motor (`isSafeAttachmentUrl`), también en «Reintentar» y «Editar y reintentar», que reenvían las partes del historial. Si en el futuro se añade otro origen de adjuntos a Chat, debe pasar por esa guarda.
- Tipos rechazados a propósito: SVG (puede contener scripts y se pinta como imagen en el mensaje), ejecutables, archivos comprimidos y binarios sin tipo. La miniatura solo se pinta si el tipo es `image/*` y la URL empieza por `data:image/`.
- Privacidad: el contenido del adjunto sale hacia el proveedor de IA elegido igual que el texto del mensaje. Los borradores con adjuntos viven solo en memoria (almacén de borradores) y no se persisten.

## 3 terdecies. Descartar cambios en Code (`git:discard`, `git:discardUndo`)

Canal nuevo que **borra o sobrescribe archivos del proyecto** (R2-A, F8-B34). Solo ventana principal (no está en `CHANNEL_ROLES`; los preloads secundarios no cambian) y esquema estricto (`cwd` absoluto, hasta 200 rutas no vacías; `undoId` con forma de uuid). Lo ejecuta main (`src/main/git/service.ts`), no el renderer ni el modelo:

- **Qué puede tocar.** Solo archivos que `git status` reporta como cambiados en ese momento (nunca ignorados, nunca conflictos ni submódulos): una ruta que no está en el estado se rechaza. La ruta se valida contra la raíz real del repo (`realpath`): sin `..`, sin escapes absolutos, sin la raíz ni `.git`, y sin carpetas intermedias que sean enlaces simbólicos (el último componente no se resuelve: si es un enlace se mueve el enlace, nunca su destino). Se revalida justo antes de mover. Todo o nada: si una ruta no cuadra, no se descarta ninguna.
- **Nunca borrado definitivo.** Archivos nuevos (sin seguimiento o añadidos/renombrados al índice) van a la Papelera de macOS (`shell.trashItem`, o `ONYXCODE_E2E_TRASH_DIR` solo con la app sin empaquetar, igual que los puntos de restauración). Lo que tenía seguimiento se restaura con `git checkout HEAD -- <rutas>` (sin shell, `execFile`).
- **Deshacer.** Antes de restaurar se copia el contenido actual (archivos regulares ≤ 100 MB) a `userData/code-discard/<uuid>/` (carpeta `0700`, se purga a los 7 días). `git:discardUndo` solo lo restaura si el archivo sigue sin cambios desde el descarte (no pisa ediciones posteriores), exige que la copia sea del mismo repo y que el id tenga forma de uuid. Los archivos que fueron a la Papelera se recuperan desde ahí (no hay «Deshacer» propio).
- **Confirmación.** El renderer pide confirmación explícita con la lista de rutas afectadas antes de llamar al canal; main no tiene un segundo cuadro: un renderer comprometido podría invocar el canal, pero solo sobre archivos con cambios del repo abierto y con todo recuperable (Papelera o copia).
- **Límites.** Archivos > 100 MB, enlaces simbólicos o carpetas se descartan sin copia para «Deshacer» (los nuevos, a la Papelera igualmente).
- **Lo preparado (staged) se conserva (R3-B).** `git:discard` acepta `scope: 'unstaged'` (la fila de «No preparados»): solo el árbol de trabajo vuelve a lo que hay en el índice (`git checkout -- <rutas>`), el índice no se toca. Con el ámbito por defecto (`all`, fila de «Preparados») todo vuelve a HEAD como antes, pero «Deshacer» ahora devuelve también lo preparado: se guarda el blob del índice (`mode`+`oid`, validados con regex) y se vuelve a registrar con `git update-index --cacheinfo`/`git rm --cached`. «Deshacer» ya no depende de `git status` sino del hash del archivo justo después del descarte (solo actúa si sigue idéntico).

## 3 quaterdecies. Descartar un bloque (`git:discardHunk`, R3-B)

Canal nuevo, solo ventana principal (no está en `CHANNEL_ROLES`), esquema estricto (`cwd` absoluto, `path` ≤ 4096, `index` entero 0–100 000, `hunk` ≤ 1 MB). Descarta **un** bloque `@@` de un archivo modificado del árbol de trabajo, todo o nada:

- **Validación.** La ruta pasa por el mismo `discardTarget` (dentro del repo, sin `..`/`.git`/enlaces intermedios); el archivo debe figurar en `git status` con cambios en el árbol (`M`), no ser nuevo, conflicto, renombre ni enlace, y ser regular ≤ 100 MB. Main **recalcula el diff por su cuenta** (`git diff` sin preparar, un solo archivo) y exige que el texto del bloque recibido sea idéntico al del índice pedido: si el archivo cambió desde que el usuario vio el diff, se rechaza («vuelve a abrir el diff»). El renderer nunca aporta el parche que se aplica: lo construye main con la cabecera de git + el bloque verificado.
- **Todo o nada con copia previa.** Antes de aplicar se copia el archivo completo a `userData/code-discard/<uuid>/` (misma carpeta `0700` y purga de 7 días). Se ejecuta `git apply -R --check` y luego `git apply -R` (sin shell; `git apply` es atómico: o aplica todo el bloque o nada) solo sobre el árbol de trabajo (sin `--index`: lo preparado no se toca). Si algo falla se borra la copia y no cambia nada.
- **Deshacer.** Reusa `git:discardUndo`: restaura la copia solo si el archivo sigue siendo exactamente lo que dejó el descarte (hash sha256 en el manifiesto).
- **Límite conocido.** Entre la copia y la aplicación hay una ventana de milisegundos en la que una edición externa podría no quedar en la copia; `git apply` exige que el contexto coincida, así que un cambio en esas líneas hace fallar la operación, pero uno en otra zona del archivo se conservaría en el archivo y no en la copia (el hash de la copia se compara con el del archivo justo antes).

## 3 quindecies. Windows: arranque (tanda 1)

- **Entorno de los procesos hijos.** En Windows `minimalEnv` hereda una lista blanca propia (sin distinguir mayúsculas) y conserva `Path` ampliado; siguen fuera `ELECTRON_*`, `NODE_OPTIONS` y cualquier token del usuario. Se hereda `USERPROFILE`/`APPDATA`/`LOCALAPPDATA`/`TEMP`/`ProgramData` porque sin ellas OpenCode (Bun) no arranca; `ProgramFiles*` se hereda solo para localizar Git.
- **Sin modos POSIX.** `0600`/`0700` no se aplican en NTFS (`chmod` no tiene efecto): los archivos de `userData` (cuenta cifrada con DPAPI/`safeStorage`, `opencode.json`, almacén de OpenCode) dependen de la ACL heredada de `%APPDATA%`, que por defecto solo da acceso al usuario, a SYSTEM y a los administradores. Pendiente evaluar una ACL explícita en una tanda posterior.
- **Procesos.** Sin grupos de procesos: `taskkill /PID n /T /F` mata el árbol, y la limpieza de huérfanos (`killStaleServers`) verifica por PowerShell/CIM que el PID siga siendo un `opencode.exe serve` antes de matarlo (PID reutilizado). `opencode.exe` se lanza con `windowsHide` y sin `detached` (no abre consola).
- **Superficie reducida.** Fuera de macOS no se carga el código de Tareas (Seatbelt, proxy de credenciales), Control del PC ni el actualizador; sus canales IPC responden `PLATFORM_UNSUPPORTED`. Las rutinas en modo Tareas se rechazan al guardar y al ejecutar.
- **Política gestionada.** `%ProgramData%\OnyxCode\managed.json` (escribible solo por administradores en una instalación por defecto), mismo criterio *fail-closed*.
- **Binario embebido.** `pin.json` fija URL, tamaño y SHA-256 por plataforma; el ZIP se verifica antes de extraer con `tar.exe` de System32.

## 3 sexdecies. Windows: Code e interfaz (tanda 2)

- **Diagnóstico no filtra la carpeta del usuario.** `makeRedactor` sustituye por `~` todas las escrituras de una carpeta de Windows (barras `\`, `/` y `\\` de JSON, mayúsculas/minúsculas, `file:///`, `%5C`/`%3A`, Git Bash `/c/…`, WSL `/mnt/c/…`, UNC, espacios en el nombre) y, aunque el home no coincida, todo `<unidad>:\Users\<nombre>`. Un nombre más largo que el home no deja restos (se oculta como perfil ajeno). Las expresiones son lineales (sin cuantificadores anidados; hay una prueba con entradas patológicas de 100 000 caracteres). Limitación: una ruta relativa a la raíz sin unidad (`Users\x\…`) no se reconoce.
- **node-pty empaquetado.** En Windows `asarUnpack` saca `node_modules/node-pty/**` del `.asar`: `OpenConsole.exe` y `conpty.dll` se ejecutan/cargan desde disco. La shell es `pwsh.exe` o PowerShell 5.1 del sistema con ruta absoluta, nunca una ruta tomada del texto del usuario sin comprobar que existe.
- **Abrir en el editor.** Solo ejecuta `Code.exe` desde rutas fijas (`%LOCALAPPDATA%\Programs`, `%ProgramFiles%`) y sin shell; si no está, `shell.openPath`.

## 3 octodecies. Archivos del proyecto: vigilante, gestor y «Abrir en…» (F8-B45)

Canales nuevos (todos solo de la ventana principal: no están en `CHANNEL_ROLES`; esquema estricto en `IPC_SCHEMAS`): `files:watch`, `files:setDirs`, `files:unwatch`, `files:create`, `files:rename`, `files:trash`, `editors:list`, `editors:open`; evento `files:changed` (main → la ventana suscrita).

- **Vigilante (`main/files/watcher.ts`).** `fs.watch` (eventos del SO, sin polling): recursivo en macOS/Windows; en Linux solo las carpetas abiertas del panel (`files:setDirs`, sin enlaces simbólicos que salgan del proyecto). Coalescencia ≈200 ms (máx. 1 s), ignora `.git`, `node_modules` y carpetas de build habituales. Topes: 8 vigilantes recursivos y 120 carpetas; lo que excede queda en refresco manual. Errores (EMFILE/ENOSPC, carpeta borrada o desconectada) se capturan: se libera el vigilante y se avisa `status: 'lost'`. Se suscribe solo con el panel visible; se libera al cambiar de proyecto, ocultar la ventana, recargar o destruir el `webContents`. El evento solo lleva rutas relativas a la carpeta suscrita y el id de suscripción de esa ventana.
- **Proyecto activo.** Main no confía en el `cwd` del renderer para el gestor ni «Abrir en…»: solo actúan sobre una carpeta que **esa ventana** tiene suscrita (`files:watch`); si no, error «no es el proyecto que muestra el panel». Un renderer comprometido podría suscribir cualquier carpeta existente (el mismo nivel de confianza que ya tienen `git:*`); la protección frente a rutas hostiles no depende de esto sino de lo siguiente.
- **Gestor (`main/files/fs-ops.ts`).** Rutas relativas a la raíz con `realpath`: sin absolutas, `..`, componentes vacíos o `.`; nada en `.git` (cualquier nivel, sin distinguir mayúsculas) ni la propia raíz; carpetas intermedias que sean enlaces simbólicos se rechazan, y el último componente no se resuelve (un enlace se renombra/elimina como enlace). Nombres: sin separadores, `:`, control, espacios en los extremos ni punto final, ≤255 bytes, sin nombres reservados de Windows (en todas las plataformas) y sin `< > " | ? *` en Windows. Nunca sobrescribe (`wx` al crear; comprobación previa al renombrar: queda una ventana de carrera mínima entre `lstat` y `rename`, aceptada). Eliminar = `shell.trashItem` (carpeta de pruebas `ONYXCODE_E2E_TRASH_DIR`, solo sin empaquetar) con confirmación en la UI; nunca borrado definitivo. Errores traducidos.
- **«Abrir en…» (`main/editors/`).** El renderer envía solo un id de un catálogo fijo (`EDITOR_IDS`); main detecta cada editor por rutas conocidas (macOS: `/Applications` y `~/Applications` → `open -a <app> <carpeta>`; Windows: rutas típicas de `%LOCALAPPDATA%`/`%ProgramFiles%`; Linux: ejecutables absolutos en carpetas fijas, nunca el `PATH`) y lanza con `spawn` y arreglo de argumentos, sin shell. La carpeta debe ser absoluta (nunca se interpreta como opción) y la del proyecto activo. «Predeterminado del sistema» usa `shell.openPath`. El último editor se guarda en `extras.json › lastEditor` (solo lo escribe main, tras un lanzamiento correcto). Solo pruebas, sin empaquetar: `ONYXCODE_E2E_EDITOR_LOG` (+ `ONYXCODE_E2E_EDITORS`) registra la llamada en vez de lanzar nada.
- **No cambia.** Sandbox, proxy, plan-gate, folder-policy, CSP, `dialog:openInEditor` (VS Code del menú de proyecto).

## 3 septendecies. Control total sin carpeta (F8-B44)

**Cómo funciona hoy.** Control total arranca un `opencode serve` aparte **sin Seatbelt** (`noSandbox`), con el agente `computer`, el MCP de control del Mac y el plugin de la puerta del plan; usa el XDG real del usuario y no pasa por el proxy de egress ni por el credential proxy (esos son del sandbox). El `cwd` y `ONYXCODE_TASKS_FOLDER` eran la carpeta autorizada; de la carpeta solo dependen: el directorio de proyecto de OpenCode (sesiones por `directory`), el `AGENTS.md` y la memoria de esa carpeta, el proyecto/instrucciones guardados por carpeta en `userData`, los puntos de restauración y los entregables, y la lista blanca de rutas de las funciones de la interfaz (`assertInsideApproved`). La carpeta **no confina** en este modo: el agente ya podía tocar todo el equipo.

**Qué cambia.** El consentimiento pasa de «por carpeta» a «una vez por equipo» (`fullAccessConsentAt` en `tasks-folders.json`, escrito solo por main tras el diálogo; la UI no puede fijarlo). Sin él, o con `disableFullAccess`, `tasks:start {fullAccess}` falla con `FULL_ACCESS_NOT_GRANTED`. Con él, Control total arranca en cualquier carpeta que exista (por defecto la actual o, si no hay, la última usada en este modo o el home); no hace falta que esté autorizada para Sandbox. Las concesiones antiguas por carpeta siguen valiendo solo para su carpeta. La revocación (`tasks:fullAccess:revokeAll`, Ajustes › Tareas) borra el consentimiento y todas las concesiones y detiene los servidores sin sandbox.

**Modelo de amenazas.**

| Riesgo | Tratamiento |
| --- | --- |
| El agente actúa sin que el usuario lo sepa | Consentimiento explícito con diálogo (ratón, teclado, pantalla, todos los archivos y programas), con fecha y revocable; sin él main no arranca el servidor aunque el renderer lo pida (hay prueba E2E por IPC directo). El plan sigue aprobándose en cada tarea, cada app pide su nivel y ⌘⇧Esc / Detener cortan al instante (sin cambios). |
| Prompt injection (web, correo, pantalla) con acceso a todo el equipo | Igual que antes: sin sandbox ya podía tocar todo; la mitigación es la puerta del plan + aprobaciones por app + parada. Quitar la carpeta **no amplía** lo que el agente puede hacer, solo quita el paso de elegirla. |
| Un renderer comprometido lee archivos del usuario | Las funciones de la interfaz (`previewFile`, ZIP, abrir, QuickLook, proyecto/memoria) aceptan además el espacio de Control total **solo con consentimiento** y siguen negando los secretos que el perfil Seatbelt niega (`~/.ssh`, claves de nube y CLIs, config y datos de OpenCode). `userData` queda fuera por no estar en el home de trabajo. |
| Daño por una acción en el home sin deshacer | No se crean puntos de restauración de la carpeta personal (una instantánea de todo el home no es viable); se avisa en la tarea. Con una carpeta más pequeña elegida en Control total sí se crean. |
| Recorrer todo el home (CPU/IO, privacidad) | Los entregables no se calculan para el home; no se ejecuta la migración de la carpeta de trabajo antigua en el home. |
| Política de la organización | `disableFullAccess` anula consentimiento y concesiones; con `allowedFolderRoots` Control total exige además carpeta autorizada (fail-closed). |
| Rutinas desatendidas | Siguen exigiendo `fullAccessConsentAt` propio de la rutina, el consentimiento del equipo y plan aprobado por una persona; sin esto la ejecución falla o caduca. |
| Windows | El modo no existe (capacidad desactivada); los canales nuevos no se cargan allí. |

**No cambia.** Perfil Seatbelt, credential proxy, `provider-egress`, `proxy-policy`, `folder-policy` (el home sigue rechazado como carpeta de Sandbox), puerta del plan, aprobaciones por app, atajo de parada y comprobaciones TCC. **Riesgo residual:** como antes, otro proceso del usuario sin sandbox puede leer el entorno del servidor de Control total (ver §5); y la carpeta personal como `cwd` hace que un `AGENTS.md` suelto en `~` lo lea el agente (también el global de `~/.config/opencode`, como antes).

## 3 vicies. Control remoto desde el celular (F8-B48, prototipo)

**Qué es.** «Ajustes › Celular › Activar» muestra un QR; el celular lo escanea, abre una PWA servida por la propia app y se conecta
DIRECTO al Mac por un DataChannel WebRTC (cifrado DTLS, `node-datachannel` en `main`). Solo por RED LOCAL: no hay servidor en la
nube, ni Cloudflare, ni cuenta. Solo macOS (`PlatformCaps.remote`); con la función apagada no hay puertos, sockets ni módulos nativos
cargados y nada de la app cambia.

**Qué puede hacer el celular (lista blanca estricta, `src/main/remote/whitelist.ts`).** `sessions.list`, `session.messages`
(≤ 50), `session.prompt` (≤ 8000 caracteres), `session.abort` y `permission.reply` solo con `once` o `reject` (`always` no existe).
Nada más: ni archivos, ni terminal, ni ajustes, ni crear/borrar sesiones. El celular NO recibe nunca la contraseña del sidecar ni
acceso a él: el escritorio es el intermediario y valida cada trama (`shared/remote/protocol.ts`, claves desconocidas = rechazo).

**Ámbito.** Sesiones de Chat y de los proyectos recientes de Code (las del motor principal). Las de **Tareas** viven en otros motores y
no se exponen nunca; tampoco subsesiones ni sesiones marcadas como Tareas. Un id fuera del ámbito responde `not-found` sin llegar al
motor. Permisos de Control del Mac (`computer_*`/`browser_*`), carpetas (`external_directory`), plan-gate o desconocidos se ven como
«Apruébalo en el Mac» (solo lectura). Lo que sale hacia el celular se recorta: texto y resumen de herramientas, **nunca rutas
absolutas** (se reducen a `…/nombre`) ni secretos (patrones de `redact-patterns`), con tope de 64 KiB por trama.

**Cómo se vincula.**
1. Servidor HTTP+WebSocket mínimo (Node `http` + `ws`) que solo existe mientras el modo está activo, ligado ÚNICAMENTE a la IPv4 privada
   de la interfaz activa (10/8, 172.16/12, 192.168/16; nunca 0.0.0.0, loopback, VPN ni túneles), puerto aleatorio. Comprueba `Host` y
   `Origin` exactos (el navegador del celular manda siempre el de la página), admite como mucho 2 sockets, sirve la PWA estática con CSP
   estricta y se apaga del todo al detener.
2. El QR lleva un secreto de un solo uso de 32 B en el fragmento de la URL (`#s=…`, no viaja al servidor). Solo se guarda su sha256;
   caduca a los 120 s; se consume en el primer `hello` aunque falle; comparación en tiempo constante.
3. **Confirmación local obligatoria**: cuando el canal abre, el Mac muestra «¿Vincular este dispositivo?» con el nombre y un código de
   6 dígitos derivado de las huellas DTLS de ambos SDP (sha256 de las dos huellas ordenadas). El celular calcula y muestra el mismo.
   Si no coinciden hay un intermediario: el dueño debe rechazar.
4. Al aceptar, el escritorio entrega por el DataChannel un secreto de dispositivo (32 B) que el celular guarda en `localStorage`; el
   escritorio solo guarda su sha256 en `userData/remote.bin`, cifrado con `safeStorage` (sin `safeStorage` la función se desactiva con
   una explicación; nunca se escribe en claro).
5. Las reconexiones mandan `hello{resume, deviceId}` por señalización (sin ningún secreto) y, ya dentro del canal cifrado, `auth{deviceId,
   secret}` como primera trama (10 s de plazo, un solo intento). El secreto de dispositivo nunca viaja por HTTP ni por señalización.

**Límites.** 10 peticiones/s (ráfaga 20), 6 prompts/min, 64 KiB por trama, 3 violaciones (trama inválida, fuera de lista, binario,
límite excedido, petición sin autenticar) = desconexión. Máx. 3 dispositivos vinculados y uno conectado a la vez (el mismo dispositivo
puede reemplazar su propia sesión vieja).

**Cortes.** «Cortar todo» (Ajustes, entrada en el menú de la bandeja con el modo activo, acción `remote.stopAll` en el registro de
atajos, sin atajo por defecto) cierra conexiones y servidor y anula el secreto del QR. Se apaga solo a los 30 min sin conexiones y al
salir de la app. Revocar un dispositivo (Ajustes) lo desconecta al instante.

**Amenazas y riesgo aceptado del prototipo.**

| Amenaza | Defensa |
|---|---|
| Otro equipo de la red usa el QR/URL | Secreto de un solo uso con caducidad + confirmación local con código de 6 dígitos |
| Atacante activo en la misma Wi-Fi durante la ventana de 120 s (interceptar el hello o cambiar el SDP) | Se detecta si el dueño compara el código de 6 dígitos (cada lado calcula el suyo con las huellas que vio). **Riesgo aceptado y documentado**: si el dueño no compara, un intermediario podría vincularse |
| Robo del secreto de dispositivo | Solo viaja por el DataChannel (DTLS) y vive en `localStorage` del celular; el Mac guarda solo el hash; se puede revocar |
| Celular comprometido o prestado | Lista blanca mínima, `once`/`reject`, sin Control del Mac ni carpetas, límites, revocación y «Cortar todo» |
| Servidor local explotable | Se liga solo a la IP privada, `Host`/`Origin` exactos, ≤ 2 sockets, sirve solo la carpeta de la PWA (sin `..`, solo extensiones conocidas), existe solo mientras está activo |
| Desbordamiento / inundación | Tamaños máximos por trama, cubo de fichas, 6 prompts/min, desconexión a las 3 violaciones |
| Fuga de rutas o secretos al celular | Recorte de texto y herramientas en `events.ts` |

Una IP local por HTTP **no es contexto seguro**: la PWA no usa `crypto.subtle` (hash con `@noble/hashes`, fijado); `RTCPeerConnection` y
`crypto.getRandomValues` sí funcionan. No funciona en el prototipo: instalar la PWA, service worker, avisos push ni conexión fuera de
casa (fase 2: PWA estática en HTTPS, Worker de señalización sin estado tras la interfaz `SignalingTransport`, TURN, push, Windows).
Tampoco depende de que la red permita tráfico entre clientes: en una Wi-Fi con «aislamiento de clientes» la PWA mostrará
«no se encuentra el equipo».

**No cambia.** Sandbox, credential proxy, `provider-egress`, `proxy-policy`, plan-gate, `folder-policy` y la CSP del renderer.
Los preloads secundarios (`quick`, `overlay`, `pill`, `assist`, `browser-host`) quedan idénticos byte a byte. Los canales `remote:*` son
solo de la ventana principal (esquemas estrictos en `main/ipc/schemas.ts`).

## 3 unvicies. Política «celular» y confirmación en el Mac (F8-B51, tanda T3)

Base del control remoto con paridad: todo lo que el celular pida al Mac (canal IPC o ruta HTTP del motor) pasa por
`src/main/remote/policy.ts` (`decide(request, ctx)`, función pura) **antes** de ejecutarse. **Denegar por defecto**: un canal, ruta o
evento sin entrada explícita se rechaza (`unknown-channel` / `unknown-route` / `deny`). Las pruebas (`policy.test.ts`) fallan si aparece
un canal invoke (`missingSchemas()` y las listas de `shared/ipc*.ts`), un evento o una ruta de `resources/opencode-bin/api-routes.json`
sin clasificar, o si queda una entrada de algo que ya no existe.

**Clases.** R lectura · M mutación acotada al ámbito · D peligrosa: el despachador pide confirmación en el Mac
(`remote/confirm-queue.ts`) y ejecuta solo si el dueño la aprueba · X prohibida. Reducir privilegios (detener, revocar, denegar) es M;
ampliarlos (reanudar, conceder, recordar, aceptar «siempre») es D o X. Todo `remote:*` (incluido `remote:confirmAction`) es X para el
celular: se rechaza por prefijo antes de mirar la tabla.

**Ámbito.** Toda ruta absoluta y todo `directory` deben estar dentro de las carpetas permitidas (recientes de Code, carpetas de Tareas
ya aprobadas y, solo para HTTP, el directorio de Chat); se ignoran la raíz y el home como «carpeta permitida». La comprobación es léxica
(`..`, prefijo de hermano `proj-evil`, rutas relativas): **no resuelve enlaces simbólicos, eso lo debe hacer el despachador con
`realpath`** antes de ejecutar. Rutas relativas (`path`, `parent`, `paths`) no pueden escapar de `cwd`. Una sesión conocida debe
pertenecer al `directory` de la petición. `workspace` en la query y claves de query raras se rechazan.

**Tabla final (resumen).**

| Área | R | M | D | X |
|---|---|---|---|---|
| Chat HTTP | `session.list/get/messages/status/todo/children/diff/message`, `experimental.session.list`, `provider.list`, `config.providers`, `permission/question.list`, agentes/comandos/skills | `session.create/update(título, archivar)/promptAsync` (agente `chat`, solo `data:`)`/abort/revert/unrevert/summarize/fork/delete(una)`, `question.reply/reject`, `permission.reply once/reject` | `session.create/update` con `permission` propio | `permission.reply always`, `session.shell`, `session.init/share`, mensaje síncrono, borrar mensajes/partes, `auth.*`, `provider.auth/oauth`, `config.*`, `global.dispose/upgrade`, `instance.dispose`, `/pty`, `/tui`, `/mcp`, `/project`, `/path`, `/sync`, `/experimental/*` salvo `session`, toda la API nueva `/api/*` |
| Code HTTP | `file.list/read/status`, `find.*`, `vcs.*` (en el dir, sin escapar) | `promptAsync` (agentes `plan`/`build`; `file://` solo bajo el dir de la sesión), `session.command` | `permission.reply once` de `external_directory`, de Control del Mac (`computer_*`/`browser_*`), MCP o de tipo desconocido | las mismas X |
| Git | `isRepo/status/diff/branches/currentBranch/log/worktrees` | `commit`, `discardHunk`, `discard` (≤ 20 archivos), `discardUndo`, `createWorktree` | `discard` de todo o > 20, `removeWorktree` | — |
| Archivos | `files:watch/setDirs/unwatch`, `editors:list` | `files:create`, `rename`/`trash` de UN archivo | `rename`/`trash` de carpeta (o de algo cuyo tipo no se conoce) | `editors:open`, `dialog:*`, `tasks:reveal/openPath/quickLook/zip/importFiles/exportMarkdown/htmlToPdf` |
| Terminal | — | — | — | `pty:*` (hasta F4) |
| Ajustes | `settings:get`, `extras:getPrefs/versions`, `mcp:catalog`, `tasks:prefs:get`, `computer:prefs:get` | `settings:set` solo `defaultModel`/`theme`/`language`; `extras:setPrefs` `modelsByMode/showTray/notificationsEnabled/soundEnabled`; `tasks:prefs:set` `notify/stallWarnMinutes`; `computer:prefs:set` `hideOtherApps/unhideOnFinish` | `tasksGlobalInstructions`, `addRecentFolder`, `tasks:prefs:set` `autoArchiveDays/idleStopMinutes/maxServers`, `computer:prefs:set{mode:'full'}` | `opencodeBin`, `checkUpdates`, `recentFolders`, `onboarded`, `routinesTermsAcknowledged`, `quickEntryShortcut`, `keybindings`, `lastEditor`, `mcp:getConfig/save/remove/setEnabled/revealConfig/installCatalog`, `tasks:mcp:set` |
| Tareas / Control / Rutinas | listados, estado, actividad, entregables, vista previa (≤ 8 MiB), restauración (`list/changes`), `routines:list/history/preview` | `tasks:start` sin control total, `removeFolder`, `revokeFullAccess/revokeAll`, `computer:stop/revokeGrant/denyApp/revokePlan`, `respondAccess` solo rechazando, `routines:delete`, `routines:toggle` a apagado, `restore:create/forget`, `rules:remove`, `auto:revoke` | `start{fullAccess}`, `grantFullAccess`, `fullAccess:consent`, `approveFolder`, `folders:link/unlink`, `trusted:set/remove`, `network:*` (menos `state`), `deleteGrant:set`, `restore:apply`, `storage:clean*`, `auto:set/consider/clearLog`, `project:save` con instrucciones/enlaces, `memory:save/delete`, `agentsMd:save`, `rules:add`, `respondAccess` con concesiones o plan, `setGrant`, `undenyApp`, `computer:resume`, `routines:save/runNow/toggle` a encendido | `pickFolder`, `requestPermissions` (TCC), `teach*`, `record*`, `showMainWindow` |
| Navegador | `browser:state/capture` | `newTab/closeTab/selectTab/navigate/history/toChat`, `agent` pausar/detener, `respond` denegar | `agent` reanudar, `respond` con cualquier permiso | `attach/detach/pick/popOut/setViewMode/openExternal/devServers/sites:*/clearData` |
| App / cuenta / actualizador / diagnóstico | `app:info` (sin `userDataPath`), `updateState`, `account:state`, `opencode:status/connection` (credenciales reescritas) | `checkUpdates`, `dismissUpdate`, `updateCancel` | `updateDownload`, `updateInstall`, `signOut`, `opencode:restart` | `openExternal`, `notify`, `setAttention`, `opencodeInfo/Action`, `pickOpencodeBin`, `bootConfirm`, `testProviderKey`, `account:google/email*/delete/export/cancel/retry`, `diag:*` |
| Remoto / onboarding | — | — | — | todo `remote:*`; el onboarding (`onboarded`) |

**Prompts.** El cuerpo de `prompt_async` solo admite `messageID`, `model`, `agent`, `variant` y `parts` (texto y archivo; nada de
`tools`, `system` ni subtareas). El agente debe ser `chat`, `plan`, `build`, `tasks` o `computer`; en el directorio de Chat solo `chat`;
`computer` solo en carpetas con control total ya confirmado en el Mac. `model` (y `providerID/modelID` de `summarize`/`command`) debe estar
en `provider.list`. Adjuntos: `data:` base64; `file://` solo bajo el directorio de la sesión (sin `..`, sin prefijo de hermano, sin host) y
**nunca en Chat**; cualquier otro esquema se rechaza.

**Casos límite y decisiones estrictas (revisar en la prueba manual).**
- `permission.reply once` se trata como M solo si el tipo del permiso es conocido y normal (`edit`, `bash`, `read`, `webfetch`…); si el
  tipo es desconocido (p. ej. el despachador aún no lo cacheó) se confirma en el Mac (D). `always`, `remember` o un valor raro: X.
- `files:rename/trash`: sin saber si la ruta es carpeta se asume que lo es (D); el despachador aporta `isDirectory`.
- `GET /experimental/session` lista sesiones de TODOS los proyectos: la política lo deja pasar (R) pero T4 debe filtrar la respuesta por
  ámbito. Igual con los SSE `/event` y `/global/event`.
- `GET /file/content` puede leer cualquier archivo del proyecto (también `.env`): es R en el ámbito; T4 puede añadir un filtro de nombres.
- `tasks:project:save` (instrucciones/enlaces), `memory:*` y `agentsMd:save` condicionan al agente de forma persistente: D.
- `routines:save/runNow` no se pueden acotar por carpeta a partir del id: D siempre. Activar una rutina es D; apagarla, M.
- `GET /mcp`, `GET /project*`, `GET /path`, `GET /config` quedan en X aunque sean lecturas (nombres de servidores, rutas del sistema,
  variables y cabeceras con secretos).
- `tasks:mcp:set` es X (D6: nada de MCP desde el celular), aunque solo conmute un interruptor.
- `settings:set` con un solo campo prohibido rechaza TODA la llamada, aunque traiga otros permitidos.
- Cambio respecto al prototipo: las rutas absolutas **dentro del ámbito** ya se pueden mostrar en el celular (con `~`); fuera del ámbito
  y `userDataPath` (`app:info`, vía `sanitizeResult`) nunca.
- Eventos: `CELULAR_EVENTS` (`allow`/`sanitize`/`deny`, denegar por defecto). Se descartan los de terminal, capturas de Control del PC,
  cuenta, atajos y MCP; se recortan (`sanitize`) los que llevan credenciales del motor o rutas (`opencode:connection`, `tasks:server`,
  `settings:changed`, `files:changed`…).

**Cola de confirmación (`remote/confirm-queue.ts`).** FIFO, máx. 2 pendientes (la 3.ª responde `busy`), 10 peticiones nuevas por minuto
(`rate-limited`), deduplicada por `sha256(canal + payload canónico)` y dispositivo (repetir la misma llamada pendiente se une a ella y no
gasta cupo). La aprobación vale SOLO para esa llamada: el resultado lleva el `digest` y el despachador debe comprobar que coincide con
lo que va a ejecutar; se consume al resolver (repetir la llamada pide otra). Solo se muestra la primera; rechazo automático a los 90 s
**desde que se muestra**; revocar o «Cortar todo» llama a `cancelAll`/`cancelDevice`. Contrato IPC: evento `remote:confirmRequest`
(`RemoteConfirmRequest`: nombre, huella de 8 hex, resumen es/en, detalle, `expiresAt`) y `remote:confirmAction {requestId, accept}`, solo
de la ventana principal (no está en `CHANNEL_ROLES` de ninguna otra). La interfaz (`RemoteConfirmHost.tsx`), el PIN y la auditoría
`remote-audit.jsonl` son de la tanda T6.

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
- **Control remoto (F8-B48):** `node-datachannel` es un addon nativo (`@node-datachannel/darwin-arm64/node_datachannel.node`):
  va en `asarUnpack` (`node_modules/@node-datachannel/**`) y electron-builder lo firma como cualquier otro Mach-O. La PWA compilada
  (`pwa/dist`) va por `extraResources` → `Contents/Resources/pwa` (solo si existe al empaquetar).
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
