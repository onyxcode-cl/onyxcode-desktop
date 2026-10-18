# Seguridad de Lazunox — modelo actual

Resumen de las defensas del proceso principal, las ventanas y los procesos hijos. Detalle de los
hallazgos y su estado en `AUDIT.md`; motivación en notas privadas (fuera del repositorio)
(«Lecciones para Lazunox», bloques A y B).

## 1. Renderer y ventanas

| Control                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Dónde                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Renderer de producción servido por `lazunox://app/…` (esquema privilegiado `standard`+`secure`), nunca `file://`. Solo host `app`, solo archivos de `out/renderer` (sin `..` ni enlaces fuera), `nosniff`, COOP/CORP                                                                                                                                                                                                                                                                                             | `src/main/security/app-protocol.ts`                             |
| CSP por **cabecera** en cada HTML: `script-src 'self'`, `connect-src 'self' http://127.0.0.1:*`, sin frames/workers/objetos, `base-uri`/`form-action 'none'` (la `<meta>` se mantiene para el dev server); el renderer no tiene permiso de red a internet (el aviso de versión y el actualizador salen desde main)                                                                                                                                                                                               | `RENDERER_CSP`                                                  |
| Navegación: `will-navigate`/`will-redirect`/`will-frame-navigate` solo al origen propio (o el dev server); http(s) → navegador del sistema (solo desde ventanas de la app, nunca desde una vista previa); `window.open` denegado; `<webview>` bloqueado y `webviewTag:false`                                                                                                                                                                                                                                     | `src/main/security/web-security.ts`                             |
| Permisos de la sesión por defecto: denegados salvo `notifications` y `clipboard-sanitized-write` para páginas propias; sin dispositivos, sin captura de pantalla desde el renderer, sin descargas                                                                                                                                                                                                                                                                                                                | idem                                                            |
| Menú propio en producción (sin Recargar/DevTools) y `devTools:false` en la ventana principal empaquetada                                                                                                                                                                                                                                                                                                                                                                                                         | idem, `src/main/index.ts`                                       |
| Preload por ventana: principal = API completa; Quick Entry = `extras:quickSubmit/quickHide` + evento `quick-shown`; overlay = solo evento `computer:overlay`; píldora = overlay + `computer:stop`; assist (Modo guía / grabar una skill, Lote C) = `computer:teachRespond`/`computer:record:stop` + evento `computer:assist`; **navegador aparte (`browser-host`, Lote D)** = solo `window.api.browser` (todo `browser:*` salvo `sites:*`/`clearData`/`devServers`). Vista previa: sin preload, partición propia | `src/preload/{index,quick,overlay,pill,assist,browser-host}.ts` |
| OpenCode (`--cors`) solo acepta `lazunox://app` (y el dev server sin empaquetar); ya no `null`                                                                                                                                                                                                                                                                                                                                                                                                                   | `src/main/index.ts` → servidores                                |
| **Pestañas del navegador integrado (Lote D):** `WebContentsView` por pestaña, sin preload, en `persist:lazunox-web-{code\|tasks}` (nunca la sesión por defecto de `lazunox://app`); eximidas de `harden()` por identidad de objeto de sesión (`isEmbeddedBrowserSession`), con sus propias guardas equivalentes (detalle en «3 quater»). Se alojan en el panel principal o en una **ventana «Navegador» aparte** (rol `browserHost`, se abre sola con `showInactive()` si la principal está minimizada/oculta)   | `src/main/embedded-browser/{session,surface,popout}.ts`         |

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
Lo mismo vale para `app:testProviderKey` y `diag:*` (§3 nonies).

## 3. Procesos hijos y permisos de macOS (TCC)

- **`lazunox-disclaim`** (`resources/launcher/disclaim.c`, `npm run build:launcher`, va en
  `Contents/Resources/launcher/`): `posix_spawn` con `POSIX_SPAWN_SETEXEC` + atributo _disclaim_
  (`responsibility_spawnattrs_setdisclaim`, vía `dlsym`; sin él, falla cerrado). El programa
  reemplaza al lanzador (mismo PID/grupo) y pasa a ser **responsable de sí mismo**: no hereda
  Accesibilidad ni Grabación de pantalla de Lazunox. Se usa para **todos** los `opencode serve`
  (sidecar de Chat/Code, Tareas con sandbox y Tareas de acceso total).
- Lo que sí necesita esos permisos — el **MCP de Control del Mac** y su `cu-helper`/`screencapture` —
  corre en un **`utilityProcess`** de main (`src/main/computer/mcp-host.ts`), que expone MCP
  _Streamable HTTP_ en `127.0.0.1:<puerto>/mcp` con `Authorization: Bearer <token>` (32 bytes
  aleatorios, comparación en tiempo constante; rechaza `Origin` y `Host` ajenos). OpenCode lo usa
  como MCP `remote` (`oauth:false`). Puerto y token fijos durante la sesión; si muere se relanza
  con enfriamiento. El kill-switch (estado en memoria de main) no cambia.
- **Entorno mínimo** para servidores y MCP (`src/main/process/child-env.ts`): `PATH` ampliado,
  `HOME`, `USER`, `LOGNAME`, `SHELL`, `TMPDIR`, `LANG`/`LC_*`, `TZ`, `TERM`, proxy/CA y `XDG_*`,
  más las variables explícitas de la app. No pasan `ELECTRON_*`, `NODE_OPTIONS`, `DYLD_*` ni tokens
  exportados en la shell del usuario.
- **Terminal integrada** (`src/main/pty/service.ts`): la shell del usuario también se lanza con el
  mismo `lazunox-disclaim` (`withDisclaim`, `process/disclaim.ts`), así que tampoco hereda
  Accesibilidad/Grabación de pantalla de Lazunox — antes sí lo hacía (ver «Riesgos conocidos» más
  abajo, ya corregido). A diferencia de los servidores OpenCode, aquí **no** se usa `minimalEnv`:
  la terminal es una acción explícita del usuario (login shell, `TERM`, `LANG`, `PATH`…), así que se
  conserva casi todo `process.env` y solo se quitan `ELECTRON_RUN_AS_NODE`, `ELECTRON_RENDERER_URL`,
  `NODE_OPTIONS` y `DYLD_*` (inyectadas por Electron, no por el usuario). Verificado con
  `node-pty.spawn(launcher, [shell, '-l'], …)`: el PID del pty es el de la propia shell (mismo PID
  que tendría sin el lanzador, por `POSIX_SPAWN_SETEXEC`) y `echo ok` funciona con normalidad.

**Flujo Plan → Aprobar → Ejecutar y concesión por app** (`src/main/computer/{service,grants,mcp-server}.ts`):
antes de tocar la pantalla, el agente debe llamar `request_access` con su plan y la lista completa
de apps; `main` (`ComputerService`, aprobación **por sesión**, consultada por el MCP y por el
plugin `lazunox-plan-gate` vía `GET .../plan-status?session=<id>` antes de CADA herramienta de acción)
lo hace cumplir del lado del servidor, no solo por prompt. La
tarjeta espera la respuesta del usuario SIN LÍMITE DE TIEMPO (ya no hay "sin respuesta en 5 min ⇒
denegado": eso mataba tareas por un simple retraso); la única forma de que quede sin responder es
que el proceso principal muera, y el único cierre forzado es `stop()` (kill-switch), que deniega lo
pendiente como respaldo. Lazunox misma, el Dock, Spotlight, Centro de Control, `WindowServer` y
`loginwindow` (`grants.SYSTEM_EXEMPT_BUNDLE_IDS`) están exentos de la concesión por app: nunca se
bloquean a sí mismos ni piden acceso. Mientras una tarea de Control total está trabajando, la
ventana principal se minimiza (píldora + overlay siguen visibles, `tasks-handlers.ts`) para que
nunca quede en primer plano robándole el foco a la app que el agente está usando.

Consecuencia práctica: si el agente de Code o de acceso total ejecuta `screencapture` o intenta
controlar el Mac por su cuenta, macOS lo trata como el binario `opencode` (sin permisos: la captura
falla y el sistema puede **pedir** permiso a nombre de «opencode» — no conviene concederlo). En
Tareas con sandbox, además, Seatbelt impide ejecutar `screencapture`.

### 3.1 Llavero de macOS y actualizaciones (`resources/keybox`)

macOS reconoce a un programa sin Team ID de Apple por el hash exacto de su código (`cdhash`, lista de particiones del elemento del Llavero), que cambia en cada versión: una app con firma ad-hoc o autofirmada volvía a pedir la contraseña del Llavero tras cada actualización (un certificado autofirmado propio no lo evita). Qué hace Lazunox:

- **No toca el Llavero al abrirse** si nunca vinculaste un celular (`DevicesStore.hasData`; el estado del Celular y el temporizador de «fuera de casa» ya no consultan el cifrado). Medido con el registro de macOS: 0 rechazos con el cifrado de cookies de Electron encendido.
- **Los celulares vinculados** (`remote.bin`) se cifran con AES-256-GCM con una llave de 32 bytes que guarda `lazunox-keybox` en el Llavero. Ese auxiliar es diminuto, se compila una vez de forma reproducible y va en git, así que su `cdhash` es el mismo en todas las versiones; tras un único «Permitir siempre» el Llavero no vuelve a preguntar.
- **Solo entrega la llave a Lazunox:** comprueba que su proceso padre cumple `identifier "cl.bentec.lazunox" and certificate leaf = H"<el certificado con el que él mismo está firmado>"`. Un programa ajeno, con otro identificador o sin el certificado, recibe un rechazo (código 3); y quien intente leer el elemento directamente no está en su lista de particiones (macOS lo pregunta). Límite honesto: hay una carrera mínima entre el lanzamiento y la comprobación, y un proceso con el mismo certificado podría pedirla.
- **Respaldo:** si el auxiliar falta o rechaza (desarrollo, Windows, build ad-hoc) se usa `safeStorage` como antes, y lo cifrado con `safeStorage` se sigue leyendo (formato `v10`) y pasa al formato nuevo al guardar.
- **Pendiente:** las cookies del navegador integrado usan la llave propia de Chromium («Lazunox Safe Storage»); su primera escritura tras cada actualización puede mostrar el cuadro del Llavero.

### 3.2 Imágenes de internet en presentaciones y documentos HTML (`extras/remote-images.ts`)

La ventana de artifacts (documentos y presentaciones que escribe la IA) sigue **sin red**: su CSP solo admite `data:` y `blob:`, y cancela cualquier petición http(s). Para que las fotos de la web se vean, la APP las descarga y las incrusta como `data:` antes de servir el HTML (un único punto: el manejador del esquema de la ventana, por el que pasan la ventana, el modo presentación, el PDF y el PowerPoint). Límites: solo https, solo dominios de la lista `ALLOWED_IMAGE_HOSTS` (Unsplash, Pexels, Pixabay, Wikimedia, Flickr), URL de hasta 400 caracteres, sin credenciales ni cookies, cada redirección se vuelve a validar, el dominio no puede resolver a una red privada o local, máximo 24 imágenes, 6 MB cada una y 40 MB en total, 12 s por imagen, y se comprueba el contenido real (PNG, JPEG, GIF, WebP o AVIF; el SVG se descarta). Lo que no cumple se sustituye por una imagen gris que lo explica. Riesgo residual honesto: la app contacta con esos bancos de imágenes por orden de la IA (verían tu IP y la dirección de la imagen pedida); una dirección con parámetros solo llega a esos dominios, no a uno elegido por un atacante.

## 3 bis. Tareas: puerta del plan, carpetas, red, MCP, política y rutinas (Lote B)

Detalle de los hallazgos en `AUDIT.md` §9; resumen del lote B en la documentación interna de proceso.

**Puerta del plan por sesión.** El plugin `lazunox-plan-gate` (`src/main/tasks/opencode-config.ts`)
se aplica a **toda** sesión del servidor de Control total, con clave en su propio `sessionID`: las
sesiones hijas de `task` y cualquier agente distinto de `computer` quedan bloqueadas (fail-closed)
hasta que el usuario apruebe el plan de esa sesión; solo pasan las herramientas de planificar
(`computer_request_access`, `todowrite`, `todoread`, `question`, `read`, `glob`, `grep`, `list`).
`computer.md` tiene `task: deny`. La aprobación dura toda la tarea hasta «Revocar», Detener o
archivar/borrar. En el sandbox y en el sidecar principal el plugin no hace nada (sin
`LAZUNOX_PLAN_GATE_URL`).

**Carpetas de trabajo** (`sandbox-profile.ts`, `folder-policy.ts`, `manager.ts`).

- **Qué se puede leer y escribir de verdad (texto de la interfaz alineado en F8-B193).** La interfaz ya no dice
  «lee y escribe solo en tus carpetas»: eso era falso en macOS.
  - **macOS (Seatbelt, `(allow default)` + denegaciones):** _escritura_ solo en la carpeta principal, las adicionales
    `rw`, el directorio privado del servidor y temporales (`/private/tmp`, `/private/var/folders`); _lectura_ de TODO lo
    que el usuario puede leer salvo la lista `defaultDeniedReadPaths` (claves SSH/nube, `auth.json` y datos de
    OpenCode, tokens de CLIs, historiales de shell, navegadores, Safari, cookies, Llavero, Mail, Mensajes) y el
    `userData` de la app. Desde F8-B194 la lista se endureció (ver abajo); sigue siendo legible todo lo demás:
    `~/Documents`, `~/Desktop`, `~/Downloads`, `~/Pictures`, el resto de `~/Library` y los toolchains del usuario
    (`~/.cargo`, `~/.rustup`, `~/.nvm`…). Red: solo los proxies locales (lista blanca de sitios).
  - **Windows (WSL2 + Landlock, `wsl.conf` sin automontaje):** la distro NO ve el resto del PC; solo existen los
    montajes de la carpeta principal y las adicionales (`rw`/`ro`) más el sistema Linux de la imagen (`/usr`, `/etc` de
    solo lectura…). Escritura solo en las `rw` y el directorio privado. Es más estricto que macOS en lectura; no hay
    nada equivalente que endurecer (confirmado por lectura de `wsl-spec.ts`/`wsl.ts`: no hay montajes del `HOME`).
  - **Lecturas endurecidas en macOS (F8-B194, antes eran legibles y se vigilaban como «a valorar»):** `~/.codex`
    (`auth.json` de otro CLI), `~/.claude` y `~/.claude.json`, `~/Library/Application Support/Claude`,
    `~/.zshrc`/`~/.zprofile`/`~/.zshenv`/`~/.bashrc`/`~/.bash_profile`/`~/.profile` (pueden exportar variables con
    claves), `~/.gitconfig`, `~/.config` ENTERA, `~/.npm`, `~/.cache`, `~/Library/Group Containers`,
    `~/Library/HTTPStorages`. Medido con `sandbox-exec` y el perfil real: antes se podían leer, ahora dan «Operation
    not permitted» (leer, listar y escribir). Mantiene la limitación de red (sitios permitidos), pero ya no hace falta
    confiar en ella para estos archivos.
- Carpeta principal: escritura permitida; `unlink`/`rmdir`/`rename` denegados salvo la concesión
  «Permitir borrar, mover y renombrar» (`allowDelete`). Truncar no está protegido (mitigación:
  `session.revert`).
- Carpetas adicionales (vinculadas a un espacio o de confianza, para todas las tareas):
  - **`rw`** («Lectura y escritura»): se añaden a `allow file-write*`, pero con
    `(deny file-write-unlink …)` SIEMPRE: la concesión de borrado vale solo para la principal.
  - **`ro`** («Solo lectura»): la lectura ya la da `(allow default)` (menos los secretos); al final
    del perfil `(deny file-write* (subpath …))`, que gana incluso sobre una `rw` que la contenga.
  - `.lazunox/trabajo/` de la principal (scratch del agente) permite borrar y renombrar.
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
  llevaban sus `environment`/`headers` en la config inline del servidor; con sandbox ya no (F8-B79): las cabeceras las pone el proxy MCP de main y los locales con secretos no entran. En Control total la config inline sigue llevándolos.

**MCP del usuario dentro de Tareas** (`mcp-tasks.ts`). Solo entran los servidores activos y marcados
«Disponible en Tareas» (`userData/tasks-mcp.json`; nunca se escribe en `opencode/opencode.json`).

- **MCP locales**: se lanzan con el prefijo `/usr/bin/env -u OPENCODE_SERVER_PASSWORD -u
OPENCODE_SERVER_USERNAME -u OPENCODE_AUTH_CONTENT -u OPENCODE_CONFIG_CONTENT -u LAZUNOX_PLAN_GATE_URL`,
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

**Política gestionada** (`policy.ts`). Archivo `/Library/Application Support/Lazunox/managed.json` (solo
un administrador escribe ahí; en desarrollo se puede forzar con `LAZUNOX_MANAGED_POLICY` si la app no está
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

**Capturas de Control total.** Se guardan temporalmente en `temp/lazunox-computer` (últimas 20) y se
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
> navegador (`chrome-devtools-mcp` (histórico: eliminado en la fase 3 del refactor)) solo existe en Control total, desactivado por defecto, y corre
> sobre un **perfil propio** (carpeta `browser/profile` del userData antiguo), nunca el Chrome personal del
> usuario: no comparte cookies, historial ni sesiones, y sus descargas van a
> `browser/downloads` del mismo userData antiguo. Cada navegación de primer nivel (`navigate_page`, `new_page`,
> y tras `click`/`fill`/`fill_form`/`press_key`/`evaluate_script` se revisan TODAS las páginas
> abiertas) pasa por un canal lateral HTTP con token en 127.0.0.1 hacia `browser/service.ts`; si el
> sitio no está en «Permitir siempre» ni denegado ni con «una vez» ya concedido, aparece un diálogo
> nativo (`dialog.showMessageBox`, en cola, sin ventana padre porque en Control total la principal
> puede estar minimizada) con la URL LITERAL y el aviso «Las páginas pueden contener instrucciones
> maliciosas». Si `list_pages` no se puede leer o interpretar, la pasarela (`browser/gateway.ts` (histórico: eliminado en la fase 3 del refactor))
> falla cerrado (nunca asume que todo está bien) y manda a `about:blank` cualquier página en un host
> no permitido. El proceso se lanza con `/usr/bin/env -u OPENCODE_SERVER_PASSWORD -u
OPENCODE_SERVER_USERNAME -u OPENCODE_AUTH_CONTENT -u OPENCODE_CONFIG_CONTENT -u
LAZUNOX_PLAN_GATE_URL` (igual que los MCP locales del usuario, `MCP_ENV_WRAPPER`), para que Chrome
> nunca herede las credenciales del propio servidor de OpenCode; `--no-usage-statistics` y
> `CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1` evitan que escriba en `~/.cache/chrome-devtools-mcp` del
> usuario. `upload_file` se quita de `tools/list` antes de que el modelo la vea. El navegador corre
> fuera de Seatbelt y del proxy de egress del sandbox (no hay sandbox en Control total): es la razón
> de que quede fuera de alcance en Sandbox en esta versión.

**Ventana `assist` (Modo guía y grabar una skill): superficie IPC ampliada en dos canales, con el
mismo aislamiento que la píldora.** `src/preload/pill.ts` **no se tocó** en todo el lote; la
ventana nueva tiene su propio preload (`src/preload/assist.ts`) con su propia lista cerrada
(`ALLOWED_INVOKE = {'computer:teachRespond', 'computer:record:stop'}`, `on` solo acepta
`computer:assist`) y su propio rol en `CHANNEL_ROLES` (`assist`), sin tocar la entrada `pill`. Es
una ventana sin marco, transparente, con `setContentProtection(true)` y `showInactive` (nunca activa
Lazunox ni le roba el foco al usuario), igual que la píldora de control. La grabación en sí
(`cu-helper record`) usa un tap de solo ESCUCHA (nunca inyecta eventos) y nunca guarda el texto
tecleado si `IsSecureEventInputEnabled()` está activo (campo seguro con foco); el texto tecleado
tampoco se envía al agente por defecto («Incluir el texto que tecleé», desactivado) y el prompt que
se le manda avisa explícitamente de que capturas y narración son **datos no confiables**.

## 3 quater. Navegador integrado en la ventana de la app (Lote D)

Detalle de los hallazgos en `AUDIT.md` §11; diseño completo, decisiones del usuario y guía de
prueba manual en `docs/LOTE-D.md`.

**Aislamiento por sesión: nunca la sesión por defecto.** Cada pestaña del navegador integrado
(`WebContentsView`, `sandbox:true, contextIsolation:true, nodeIntegration:false, webviewTag:false,
devTools:false`, **sin preload propio**) vive en `session.fromPartition('persist:lazunox-web-code')`
o `'persist:lazunox-web-tasks'` (`embedded-browser/session.ts`): dos perfiles separados entre sí y
completamente distintos de la `defaultSession` que sirve `lazunox://app` y guarda las credenciales de
OpenCode. Ni el esquema `lazunox:` ni `*-artifact:` existen en esas particiones (`protocol.handle` es
de la sesión por defecto y de la de la vista previa), así que una pestaña del navegador nunca puede pedir
una página propia de la app. **Tareas usa UNA sola partición compartida** (`persist:lazunox-web-
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
(`<carpeta>/.lazunox/trabajo/descargas/` en Tareas, `~/Downloads/<APP_NAME>/` en Code); las del usuario usan
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

Aviso NO bloqueante de que hay una versión publicada más reciente (junto con el actualizador y, si se activa, el servicio de conexión del celular, es de las pocas conexiones de red propias de la app). Por sí solo no descarga, no instala y no ejecuta
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
- **Variables de test.** `LAZUNOX_TEST_RELEASES_API`, `_REPO` y `LAZUNOX_TEST_UPDATE_DELAY_MS` solo se honran con la
  app SIN empaquetar (y la base debe ser `http://127.0.0.1:<puerto>` o `https:`); en la app empaquetada se ignoran y
  siempre se usa la API de GitHub. Las pruebas usan un servidor local; nunca llaman a api.github.com. Lo mismo vale para
  `LAZUNOX_TEST_UPDATE_PUBKEY` y `LAZUNOX_TEST_UPDATE_INSTALL_DIR` (actualizador, sección 3 septies). Única excepción:
  un **build de prueba** (`LAZUNOX_TEST_BUILD=1` en compilación, `docs/DISTRIBUCION.md` §11) las honra también
  empaquetado; un build normal no contiene ese código (el valor se sustituye en compilación y el resto se elimina).
- **Riesgos conocidos.** Quien controle el repositorio o la cuenta de GitHub de `RELEASES_REPO` controla qué versión
  se anuncia y la página a la que lleva «Descargar» (siempre dentro de ese repositorio): la app no verifica firmas de
  esa descarga manual («Descargar»), eso lo hace macOS (Developer ID y notarización, cuando existan); la ruta
  «Actualizar» sí verifica una firma Ed25519 propia (sección 3 septies). Un repositorio renombrado o movido
  devuelve una redirección y, con `redirect: 'error'`, nunca avisa. `/releases/latest` no devuelve prereleases. El
  `fetch` de Node no usa el proxy del sistema (tras un proxy obligatorio el aviso simplemente no llega). Sin
  `retryAfter` persistido, un fallo se reintenta en el siguiente arranque pasada 1 h.

## 3 sexies. Cuenta (retirada en 0.4.x)

La app **ya no tiene cuentas ni inicio de sesión** (F8-B88; sustituye a F8-B19). Se quitaron `src/main/account/` (cliente HTTP,
servicio, almacén `account.bin`, receptor loopback, PKCE), los 9 canales `account:*` y el evento `account:changed` (contrato,
esquemas y política del remoto), `ACCOUNT_API` y las variables de pruebas `LAZUNOX_ACCOUNT_URL`, `LAZUNOX_ACCOUNT_DISABLED` y
`LAZUNOX_TEST_PLAIN_STORE`. Ya no hay tráfico a un servidor de cuentas ni receptor en `127.0.0.1` para el callback de Google.
Al arrancar se borra la sesión heredada: ver §3 quadragies bis. El diseño original se conserva en `docs/archive/CUENTAS-SERVIDOR.md`
(archivado). La guardia `src/test/no-accounts.test.ts` evita que reaparezcan canales, dominios o variables de cuenta.

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
`version === tag` sin la `v`, versión **mayor** que `app.getVersion()` (anti-downgrade), nombre `Lazunox-X.Y.Z-arm64.zip`;
(3) espacio libre (`statfs` ≈ 3× el tamaño); (4) descarga a `userData/update/staging/<ver>/` (0700, se borra al empezar) con
SHA-256 incremental; (5) hash y tamaño == los firmados; (6) `zipinfo -1` y cada entrada validada (`isSafeZipEntry`: nada
de `..`, rutas absolutas, `\`, NUL ni nada fuera de `Lazunox.app/`; única excepción, los metadatos AppleDouble de `ditto
--sequesterRsrc` bajo `__MACOSX/Lazunox.app/…/._x`, que `ditto -x` aplica como atributos y no crea nada fuera); tope
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
`.app` en ejecución; `staged` == `userData/update/staging/<ver>/extract/Lazunox.app`; marcadores bajo
`userData/update`; copia `<dir>/.Lazunox.app.bak-<ver>`) y `swap.sh` los vuelve a validar. `swap.sh` (POSIX, `set -eu`):
espera a que el PID termine (tope 60 s; si no, aborta **sin tocar nada** y escribe `result.json`), mueve `target → bak`
(mismo directorio: `rename` atómico; `ditto` solo si falla), `staged → target` (si falla restaura), abre la nueva y espera
hasta 90 s el archivo `boot-ok-<ver>`; si no aparece mata el PID que la nueva escribió en `booting-<ver>` (solo si es un
proceso de ese `.app`), mueve la nueva a `.Lazunox.app.failed-<ver>`, restaura la copia, abre la vieja y escribe
`result.json {rolledBack: true}` (la vieja lo muestra como error). La app nueva escribe `booting-<ver>` (su PID) al
arrancar (solo si obtuvo el lock de instancia única) y `boot-ok-<ver>` tras `did-finish-load` **y** la confirmación del
renderer (`app:bootConfirm`). La copia de seguridad la borra la app nueva en el **siguiente** inicio tras un arranque ya
confirmado. Durante la sustitución, `second-instance` se ignora (`isUpdating`); `before-quit` ya detiene sidecar, Tareas y
navegador embebido y ni rutinas ni Quick Entry lo cancelan (revisado: el único `preventDefault` de cierre es el propio).

### Amenazas

| Amenaza                             | Defensa                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cuenta de GitHub comprometida       | Puede subir ZIP y manifiesto pero **no firmarlos**: la clave privada no está nunca en GitHub ni en CI. Sin firma válida la descarga se descarta antes de tocar nada.                                                                                                                                                      |
| MITM / proxy hostil                 | `https` + firma Ed25519 del manifiesto (que contiene el SHA-256 y el tamaño del ZIP). Hosts permitidos y redirecciones limitadas.                                                                                                                                                                                         |
| Downgrade                           | Manifiesto firmado + `version == tag` + versión mayor que la actual + `Info.plist` coherente con el manifiesto.                                                                                                                                                                                                           |
| Repetición de un manifiesto antiguo | Solo se ofrecen versiones **mayores** que la instalada y el manifiesto debe corresponder al tag de la release anunciada. **Riesgo aceptado:** un atacante con una cuenta comprometida podría re-publicar un manifiesto viejo _firmado_ (vulnerable) mientras siga siendo más nuevo que la copia instalada.                |
| ZIP con `../` o symlinks            | Listado validado **antes** de extraer; recorrido `lstat` **después** (todo symlink dentro de la `.app`).                                                                                                                                                                                                                  |
| ZIP bomba                           | Tamaño del ZIP firmado (tope ≤ 600 MB) como tope real de lectura; tope del tamaño descomprimido; espacio libre comprobado.                                                                                                                                                                                                |
| TOCTOU                              | Staging 0700 en `userData`; se vuelve a verificar justo antes del `mv`. Un atacante con el mismo usuario queda **fuera del modelo** (ya puede modificar la `.app` instalada).                                                                                                                                             |
| Script de reemplazo manipulable     | Sellado en el `.app`, copiado a una carpeta 0700, argumentos validados dos veces, nunca `sh -c` con cadenas.                                                                                                                                                                                                              |
| Clave privada perdida / filtrada    | Perdida: no hay más actualizaciones automáticas (hay que bajar un `.dmg` a mano; el aviso sigue). Filtrada: no hay defensa para lo ya instalado; publicar una versión con clave nueva y avisar (rotación: la versión N lleva `[nueva, vieja]` y firma la vieja; desde la N+1 firma la nueva). `docs/DISTRIBUCION.md` §10. |

**Permisos de macOS (TCC).** Con firma ad-hoc macOS vuelve a pedir los permisos tras cada actualización. La mitigación es
un certificado de firma de código **autofirmado** del usuario (`LAZUNOX_SELF_SIGNED=1`, `docs/DISTRIBUCION.md` §10.3):
sin hardened runtime y sin notarizar; `cu-helper` y `lazunox-disclaim` se firman con el mismo certificado conservando
`HELPER_ID`/`DISCLAIM_ID`. La primera migración ad-hoc → autofirmado pedirá los permisos una vez más.

**Variables y ganchos de prueba.** `LAZUNOX_TEST_UPDATE_PUBKEY` y `LAZUNOX_TEST_UPDATE_INSTALL_DIR` solo con la app sin
empaquetar (igual que `config.ts`); sin empaquetar **nunca** se sustituye nada («Reiniciar ahora» se rechaza). En
`swap.sh`, `LAZUNOX_SWAP_TEST_NO_OPEN` solo se acepta si el destino está bajo `$TMPDIR`. `LAZUNOX_TEST_FAIL_BOOT=1` solo
en un build de prueba (compilado con `LAZUNOX_TEST_BUILD=1`).

**No verificado aquí:** permisos TCC reales, Gatekeeper en otro Mac, la protección «Gestión de apps» de macOS 13+ al
modificar `/Applications` (el reemplazo se probó en directorios temporales, con `open` sustituido por ejecución
directa), proxy corporativo (el `fetch` de Node no usa el proxy del sistema) y disco lleno.

## 3 septies bis. Actualizador de Windows

Misma confianza y mismas comprobaciones que el del Mac (sección 3 septies): la autenticidad la da **solo** la firma Ed25519 del
manifiesto `update-win32-x64.json`, con la misma clave. `platform` (`win32-x64`) va dentro de los bytes firmados y `parseManifest`
exige la plataforma esperada: un manifiesto del Mac no vale en Windows ni al revés, aunque su firma sea correcta. El estado
`installable` además exige carpeta válida (`win-location.ts`) y `UPDATE_PUBLIC_KEY` no vacía.

Lo que cambia respecto al Mac:

- **Verificación del paquete.** No hay `codesign` ni `plutil`. `WinUpdateInstaller` lee el índice del ZIP en JS puro (`zip-index.ts`)
  y valida cada nombre **antes** de extraer (`isSafeZipEntryWin`: raíz `Lazunox/`, sin `..`, `\`, `:`, ADS, nombres reservados ni
  duplicados sin distinguir mayúsculas; sin enlaces). Extrae con `%SystemRoot%\System32\tar.exe` por ruta absoluta y argumentos en
  array, nunca con shell. Después coteja lo extraído con el índice (ficheros, tamaños, carpetas), exige `Lazunox.exe`,
  `app.asar` y `opencode.exe`, y compara nombre y versión del `package.json` del `app.asar` (cabecera leída en JS puro) con el
  manifiesto. Authenticode es opcional (`UPDATE_WIN_CERT_THUMBPRINT`, vacío hoy).
- **Staging hermano.** La carpeta nueva se deja junto a la instalada (`.Lazunox.staging-<ver>`, mismo volumen, para renombrar de
  forma atómica); si no se puede escribir ahí, la ubicación se marca como no válida y solo queda «Descargar».
- **`swap.ps1`.** Va sellado en `resources\updater\`, se copia a `userData\update\run\` y se lanza con `powershell.exe` por ruta
  absoluta y `-File` (sin `-Command` ni shell). Valida sus argumentos (destino llamado `Lazunox`, sin `..` ni flujos alternativos,
  carpetas hermanas); espera a que muera la app vieja antes de tocar nada; aparta la carpeta actual a `.Lazunox.bak-<ver>`, pone la
  nueva, espera `boot-ok-<ver>` y, si no llega, vuelve atrás y escribe `result.json`.
- **Scripts de publicación.** `publish-update.mjs --platform win32-x64` arma el ZIP en JS puro con orden y fecha fijos y revisa nombres,
  ficheros imprescindibles, enlaces y versión del asar; `sign-update.mjs` repite la revisión del ZIP antes de firmar;
  `verify-update.mjs` re-valida firma, hash, estructura y versión. La clave privada sigue sin salir del Mac.

| Amenaza (solo Windows)                                                               | Defensa                                                                                          |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Manifiesto del Mac reutilizado en Windows (o al revés)                               | `platform` dentro de lo firmado + `parseManifest` por plataforma + nombres de archivo distintos. |
| ZIP con `..`, `C:`, ADS, `aux`, enlaces o duplicados que solo difieren en mayúsculas | `checkZipEntriesWin` antes de extraer; cotejo con el índice después.                             |
| Defender pone en cuarentena un fichero tras extraer                                  | El conteo y los tamaños no cuadran: no se instala.                                               |
| `app.asar` de otra versión dentro de un ZIP bien firmado                             | Versión del asar frente al manifiesto, en los scripts y en la app.                               |
| Argumentos hostiles a `swap.ps1`                                                     | Validación en `swap-win.ts` y otra vez en el script (probado en un PC real, ver abajo).          |
| PowerShell bloqueado (AppLocker, modo restringido)                                   | No aparece `result.json`: la app lo detecta y deja «Descargar».                                  |

**Verificado:** pruebas en macOS (`src/test/update-scripts-win.test.ts`, `installer-win.test.ts`, `zip-index.test.ts`,
`asar-version.test.ts`, `swap-win.test.ts`), incluida la ida y vuelta publicar → firmar → instalador de la app con hash, plataforma y
versión manipulados. `swap.ps1` en un PC Windows real con `scripts/win/swap-check.ps1`: camino feliz, vuelta atrás y argumentos
hostiles, 0 fallos.

**No verificado:** `tar.exe` de Windows con un ZIP de estos scripts (las pruebas usan el bsdtar de macOS); el reemplazo con la app
real completa; el instalador NSIS por usuario con una actualización encima; Defender, SmartScreen y Smart App Control; Authenticode
(no hay certificado). `UPDATE_PUBLIC_KEY` sigue sin definir, así que el actualizador está apagado en las dos plataformas.

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
- Lo excluido por los límites: `node_modules/`, `.git/` y `.lazunox/` (la memoria), archivos de más de 50 MB (se listan como no restaurables), symlinks (se registran y no se siguen ni se restauran),
  y carpetas con más de 20 000 archivos o más de 2 GB (el punto queda «omitido» y la conversación avisa «Esta vez no se guardó un punto de restauración: …»; el mensaje se envía igualmente).
- Atributos extendidos y metadatos de Finder (etiquetas, ubicación de iconos, cuarentena…).
- Lo que cambie **mientras se crea** el punto (la copia no es atómica entre archivos).

**Amenazas.**

| Amenaza                                                                                                   | Defensa                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El agente altera o lee el almacén                                                                         | **Sandbox:** `userData` ya está denegado al agente en el perfil Seatbelt (no se tocó el perfil); no puede leer ni escribir las copias. **Control total:** el agente corre sin sandbox y **sí podría** alterar o leer el almacén (la interfaz lo avisa junto al botón). Por decisión del usuario también se crean puntos en Control total. |
| Escape por symlink al restaurar                                                                           | Recorrido sin seguir symlinks, validación de cada componente de la ruta y `realpath` dentro de la carpeta; una ruta con un directorio intermedio symlink se rechaza. Rutas con `..` o absolutas se rechazan.                                                                                                                              |
| Pérdida de datos al deshacer                                                                              | Punto «Antes de deshacer» previo; lo creado va a la Papelera, nunca se borra; escritura atómica; si el punto previo no se puede guardar, no se deshace nada.                                                                                                                                                                              |
| Archivo que existía pero no se pudo copiar (permisos, E/S, iCloud «solo en la nube», directorio ilegible) | **No se omite**: se registra con `hash:null` y motivo (`skip`), los directorios ilegibles en `unreadableDirs` y los stubs de iCloud en `cloudStubs`; nada de eso se trata como «nuevo», así que nunca va a la Papelera. Se muestran como «no restaurable» con su motivo (F8-B21).                                                         |
| Punto que bloquea la app o llena el disco                                                                 | Copia y hash asíncronos; presupuesto de 30 s (el punto queda «omitido» y se limpian los temporales); se exige el tamaño a copiar + 512 MB libres (`statfs`) y ENOSPC también deja el punto omitido.                                                                                                                                       |
| Confidencialidad de las copias                                                                            | Son contenido **del usuario sin cifrar** en `userData`, con permisos `0700` (carpetas) y `0600` (manifiestos). Quien lea `userData` lee las copias. «Ajustes › Tareas › Almacenamiento» permite ver su tamaño y borrarlas; se borran también al eliminar la tarea.                                                                        |
| Falso sentido de seguridad en carpetas sin git                                                            | El revert de OpenCode no restaura archivos sin git; el diálogo ya no lo promete. «Editar y reintentar» restaura con el punto propio y avisa si no hay uno.                                                                                                                                                                                |
| Variable de pruebas                                                                                       | `LAZUNOX_E2E_TRASH_DIR` (Papelera de pruebas) solo se honra con la app sin empaquetar; guardia estática en `trash.test.ts`.                                                                                                                                                                                                               |

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
`LAZUNOX_E2E_KEY_PROBE_BASE` solo se honra sin empaquetar y solo con `http://127.0.0.1:<puerto>` (guardia estática en `key-probe.test.ts`).

**Diagnóstico** (`diag:logs`, `diag:copy`, `diag:export`, `src/main/diagnostics/`). Los registros del motor (stdout/stderr de `opencode serve`, su `.log` y un informe) salen de main **solo** por
`DiagnosticsService`, que los pasa por el redactor: secretos exactos conocidos (contraseña y `Authorization` del sidecar, valores de `auth.json`, cabeceras y entorno de los MCP), patrones de claves y tokens
y la carpeta del usuario (`~`). Lo redactado es lo único que llega al renderer, al portapapeles (lo escribe main) y al archivo exportado (0600, `chmod` aunque ya existiera). Una prueba estática vigila que los
handlers no lean registros por su cuenta. No incluye los registros del sandbox de Tareas. Los patrones son lineales (prueba con líneas de 1 MB < 200 ms).

| Amenaza                                      | Defensa                                                                                                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| La clave llega al renderer o a un registro   | Solo main la lee; el resultado es un estado; propiedad en `key-probe.test.ts` con claves aleatorias; E2E comprueba DOM y salida de Electron. |
| Redirección que reenvíe la clave a otro host | `redirect: 'manual'`: un 3xx es «respuesta inesperada», no se sigue.                                                                         |
| Falso «funciona» por un listado público      | Cada sonda se verificó con curl y clave inválida; los proveedores con listado público son `unsupported`.                                     |
| Un registro filtra un secreto                | Redacción exacta + patrones antes de salir de main; el anillo guarda el texto crudo solo en memoria.                                         |
| ReDoS en el redactor                         | Expresiones lineales; prueba de rendimiento con entradas adversarias.                                                                        |

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

| Riesgo                                                      | Defensa / límite                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Un token queda en claro en disco                            | Igual que al añadir un servidor a mano: texto plano en `opencode.json`, ahora 0600 (solo el usuario). El diálogo lo dice. GitHub: usar un token de grano fino con permisos mínimos.                                      |
| Inyección de cabeceras                                      | Patrón anclado por entrada + rechazo de CR/LF/NUL; la plantilla se aplica con función de reemplazo (un `$&` no se expande).                                                                                              |
| Ficha que apunta a otro host                                | Test de catálogo: https, sin credenciales ni query, host del dominio del proveedor; `npm run check:mcp-catalog` (manual) comprueba que sigue respondiendo como MCP y que la documentación existe.                        |
| Un conector remoto lee o escribe en el servicio del usuario | El diálogo avisa cuando la ficha puede escribir; «Preguntar antes de cada uso» viene activado y pide aprobación por herramienta. El servicio remoto recibe lo que la IA le envíe: el texto «Qué datos salen» lo explica. |
| Tareas                                                      | Los conectores del catálogo **no** se ofrecen en Tareas: no se marcan (`tasks-mcp.json`), así que ni sus hosts entran en la Red del sandbox ni se cargan en el sandbox. No se tocó `mcp-tasks.ts`.                       |

**No verificado aquí:** el inicio de sesión OAuth completo de Linear, Notion, Sentry y Atlassian con cuentas reales (solo se comprobó con el binario que cada servidor registra el cliente y devuelve la URL de
autorización), el uso real de las herramientas con un modelo, y que un token real de GitHub conecte (la URL responde 401 sin credencial y con un token inválido; no se probó con uno válido). Cambios futuros de URL o de documentación de los
proveedores: los detecta `npm run check:mcp-catalog`, no la app.

## 3 undecies. Idioma de la interfaz (español / inglés beta)

- Superficie nueva mínima: el ajuste `language` (`'system' | 'es' | 'en'`) viaja por el canal ya existente `settings:set` (esquema `literal('system','es','en')`; cualquier otro valor se rechaza y `normalize` lo devuelve a `'system'`). **No hay canales IPC nuevos ni entradas en `CHANNEL_ROLES`.**
- Los diccionarios (`src/shared/i18n`) son datos estáticos del paquete: no se descarga ni se ejecuta nada y no se interpreta HTML (los textos se pintan como texto de React). `format()` solo sustituye `{nombre}` por valores del propio código.
- Los preloads secundarios no importan el módulo de idioma (hashes de `out/preload/{quick,overlay,pill,assist,browser-host}.js` idénticos a `main`, también tras T4c). Quick Entry, overlay, píldora y globo de guía reciben el idioma como parámetro de consulta `?lang=es|en` de su propia URL (`loadLocalizedPage`): el valor sale de `getLang()` en main (nunca de entrada del usuario), la página solo lo acepta si es `es` o `en` y no se añade ningún canal ni capacidad; la URL sigue siendo `lazunox://app/…` (el origen no cambia, la validación del emisor y los roles de ventana tampoco).
- Main usa el idioma para la bandeja, el menú, los errores y avisos que construye (`merr.*`: binario, carpetas, política de la organización, rutinas, notificaciones y cuadros nativos) y las ventanas con preload propio; no cambia reglas de seguridad (CSP, `webRequest`, navegación, política de carpetas y de la organización: solo cambia el texto del motivo). Los códigos que consume el código (`FULL_ACCESS_NOT_GRANTED`) no se traducen y el renderer ya no clasifica errores por su texto (`NetworkSection`). Las etiquetas de los roles estándar del menú (Archivo, Edición, Ventana) las pone Electron según la configuración regional del sistema.
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
- **Nunca borrado definitivo.** Archivos nuevos (sin seguimiento o añadidos/renombrados al índice) van a la Papelera de macOS (`shell.trashItem`, o `LAZUNOX_E2E_TRASH_DIR` solo con la app sin empaquetar, igual que los puntos de restauración). Lo que tenía seguimiento se restaura con `git checkout HEAD -- <rutas>` (sin shell, `execFile`).
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
- **Sin modos POSIX.** `0600`/`0700` no se aplican en NTFS (`chmod` no tiene efecto): los archivos de `userData` (datos cifrados con DPAPI/`safeStorage` como `remote.bin`, `opencode.json`, almacén de OpenCode) dependen de la ACL heredada de `%APPDATA%`, que por defecto solo da acceso al usuario, a SYSTEM y a los administradores. Pendiente evaluar una ACL explícita en una tanda posterior.
- **Procesos.** Sin grupos de procesos: `taskkill /PID n /T /F` mata el árbol, y la limpieza de huérfanos (`killStaleServers`) verifica por PowerShell/CIM que el PID siga siendo un `opencode.exe serve` antes de matarlo (PID reutilizado). `opencode.exe` se lanza con `windowsHide` y sin `detached` (no abre consola).
- **Superficie reducida.** Fuera de macOS no se carga el código de Tareas (Seatbelt, proxy de credenciales), Control del PC ni el actualizador; sus canales IPC responden `PLATFORM_UNSUPPORTED`. Las rutinas en modo Tareas se rechazan al guardar y al ejecutar.
- **Política gestionada.** `%ProgramData%\Lazunox\managed.json` (escribible solo por administradores en una instalación por defecto), mismo criterio _fail-closed_.
- **Binario embebido.** `pin.json` fija URL, tamaño y SHA-256 por plataforma; el ZIP se verifica antes de extraer con `tar.exe` de System32.

## 3 sexdecies. Windows: Code e interfaz (tanda 2)

- **Diagnóstico no filtra la carpeta del usuario.** `makeRedactor` sustituye por `~` todas las escrituras de una carpeta de Windows (barras `\`, `/` y `\\` de JSON, mayúsculas/minúsculas, `file:///`, `%5C`/`%3A`, Git Bash `/c/…`, WSL `/mnt/c/…`, UNC, espacios en el nombre) y, aunque el home no coincida, todo `<unidad>:\Users\<nombre>`. Un nombre más largo que el home no deja restos (se oculta como perfil ajeno). Las expresiones son lineales (sin cuantificadores anidados; hay una prueba con entradas patológicas de 100 000 caracteres). Limitación: una ruta relativa a la raíz sin unidad (`Users\x\…`) no se reconoce.
- **node-pty empaquetado.** En Windows `asarUnpack` saca `node_modules/node-pty/**` del `.asar`: `OpenConsole.exe` y `conpty.dll` se ejecutan/cargan desde disco. La shell es `pwsh.exe` o PowerShell 5.1 del sistema con ruta absoluta, nunca una ruta tomada del texto del usuario sin comprobar que existe.
- **Abrir en el editor.** Solo ejecuta `Code.exe` desde rutas fijas (`%LOCALAPPDATA%\Programs`, `%ProgramFiles%`) y sin shell; si no está, `shell.openPath`.

## 3 septdecies. Windows: instalador y paridad (tanda 4)

- **Paquete.** NSIS por usuario (`perMachine: false`: no pide administrador ni escribe en `Program Files`), sin firma Authenticode (SmartScreen avisará; ver `docs/DISTRIBUCION.md` §12). Los fuses son los de macOS: `RunAsNode`, `NODE_OPTIONS` e inspector de Node desactivados, cookies cifradas, integridad del `.asar` y carga solo desde el `.asar`. La terminal funciona con `runAsNode` desactivado (la prueba `pack-check.ps1` abre una PowerShell real en la app empaquetada). El `.asar` de Windows no contiene `helper.swift`, el lanzador, el actualizador ni `cu-helper` (comprobado con `asar list`).
- **Depuración remota.** `--remote-debugging-port` es un interruptor de Chromium (no del inspector de Node) y sigue disponible con los fuses; solo lo usa la prueba `pack-check.ps1` en `C:\onyx\` con un `--user-data-dir` temporal. Quien pueda lanzar la app con ese argumento ya ejecuta código como el usuario; no es una superficie nueva, pero conviene saberlo.
- **Navegador integrado.** Invariante que importa en Windows: una `WebContentsView` solo recibe entrada si está colgada de la ventana; `layoutView` cuelga exactamente la vista de la pestaña activa (una por owner). Los clics del agente (CDP `Input.*`) dependen de ello.

## 3 octodecies. Archivos del proyecto: vigilante, gestor y «Abrir en…» (F8-B45)

Canales nuevos (todos solo de la ventana principal: no están en `CHANNEL_ROLES`; esquema estricto en `IPC_SCHEMAS`): `files:watch`, `files:setDirs`, `files:unwatch`, `files:create`, `files:rename`, `files:trash`, `editors:list`, `editors:open`; evento `files:changed` (main → la ventana suscrita).

- **Vigilante (`main/files/watcher.ts`).** `fs.watch` (eventos del SO, sin polling): recursivo en macOS/Windows; en Linux solo las carpetas abiertas del panel (`files:setDirs`, sin enlaces simbólicos que salgan del proyecto). Coalescencia ≈200 ms (máx. 1 s), ignora `.git`, `node_modules` y carpetas de build habituales. Topes: 8 vigilantes recursivos y 120 carpetas; lo que excede queda en refresco manual. Errores (EMFILE/ENOSPC, carpeta borrada o desconectada) se capturan: se libera el vigilante y se avisa `status: 'lost'`. Se suscribe solo con el panel visible; se libera al cambiar de proyecto, ocultar la ventana, recargar o destruir el `webContents`. El evento solo lleva rutas relativas a la carpeta suscrita y el id de suscripción de esa ventana.
- **Proyecto activo.** Main no confía en el `cwd` del renderer para el gestor ni «Abrir en…»: solo actúan sobre una carpeta que **esa ventana** tiene suscrita (`files:watch`); si no, error «no es el proyecto que muestra el panel». Un renderer comprometido podría suscribir cualquier carpeta existente (el mismo nivel de confianza que ya tienen `git:*`); la protección frente a rutas hostiles no depende de esto sino de lo siguiente.
- **Gestor (`main/files/fs-ops.ts`).** Rutas relativas a la raíz con `realpath`: sin absolutas, `..`, componentes vacíos o `.`; nada en `.git` (cualquier nivel, sin distinguir mayúsculas) ni la propia raíz; carpetas intermedias que sean enlaces simbólicos se rechazan, y el último componente no se resuelve (un enlace se renombra/elimina como enlace). Nombres: sin separadores, `:`, control, espacios en los extremos ni punto final, ≤255 bytes, sin nombres reservados de Windows (en todas las plataformas) y sin `< > " | ? *` en Windows. Nunca sobrescribe (`wx` al crear; comprobación previa al renombrar: queda una ventana de carrera mínima entre `lstat` y `rename`, aceptada). Eliminar = `shell.trashItem` (carpeta de pruebas `LAZUNOX_E2E_TRASH_DIR`, solo sin empaquetar) con confirmación en la UI; nunca borrado definitivo. Errores traducidos.
- **«Abrir en…» (`main/editors/`).** El renderer envía solo un id de un catálogo fijo (`EDITOR_IDS`); main detecta cada editor por rutas conocidas (macOS: `/Applications` y `~/Applications` → `open -a <app> <carpeta>`; Windows: rutas típicas de `%LOCALAPPDATA%`/`%ProgramFiles%`; Linux: ejecutables absolutos en carpetas fijas, nunca el `PATH`) y lanza con `spawn` y arreglo de argumentos, sin shell. La carpeta debe ser absoluta (nunca se interpreta como opción) y la del proyecto activo. «Predeterminado del sistema» usa `shell.openPath`. El último editor se guarda en `extras.json › lastEditor` (solo lo escribe main, tras un lanzamiento correcto). Solo pruebas, sin empaquetar: `LAZUNOX_E2E_EDITOR_LOG` (+ `LAZUNOX_E2E_EDITORS`) registra la llamada en vez de lanzar nada.
- **No cambia.** Sandbox, proxy, plan-gate, folder-policy, CSP, `dialog:openInEditor` (VS Code del menú de proyecto).

## 3 septendecies. Control total sin carpeta (F8-B44)

**Cómo funciona hoy.** Control total arranca un `opencode serve` aparte **sin Seatbelt** (`noSandbox`), con el agente `computer`, el MCP de control del Mac y el plugin de la puerta del plan; usa el XDG real del usuario y no pasa por el proxy de egress ni por el credential proxy (esos son del sandbox). El `cwd` y `LAZUNOX_TASKS_FOLDER` eran la carpeta autorizada; de la carpeta solo dependen: el directorio de proyecto de OpenCode (sesiones por `directory`), el `AGENTS.md` y la memoria de esa carpeta, el proyecto/instrucciones guardados por carpeta en `userData`, los puntos de restauración y los entregables, y la lista blanca de rutas de las funciones de la interfaz (`assertInsideApproved`). La carpeta **no confina** en este modo: el agente ya podía tocar todo el equipo.

**Qué cambia.** El consentimiento pasa de «por carpeta» a «una vez por equipo» (`fullAccessConsentAt` en `tasks-folders.json`, escrito solo por main tras el diálogo; la UI no puede fijarlo). Sin él, o con `disableFullAccess`, `tasks:start {fullAccess}` falla con `FULL_ACCESS_NOT_GRANTED`. Con él, Control total arranca en cualquier carpeta que exista (por defecto la actual o, si no hay, la última usada en este modo o el home); no hace falta que esté autorizada para Sandbox. Las concesiones antiguas por carpeta siguen valiendo solo para su carpeta. La revocación (`tasks:fullAccess:revokeAll`, Ajustes › Tareas) borra el consentimiento y todas las concesiones y detiene los servidores sin sandbox.

**Modelo de amenazas.**

| Riesgo                                                               | Tratamiento                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El agente actúa sin que el usuario lo sepa                           | Consentimiento explícito con diálogo (ratón, teclado, pantalla, todos los archivos y programas), con fecha y revocable; sin él main no arranca el servidor aunque el renderer lo pida (hay prueba E2E por IPC directo). El plan sigue aprobándose en cada tarea, cada app pide su nivel y ⌘⇧Esc / Detener cortan al instante (sin cambios).       |
| Prompt injection (web, correo, pantalla) con acceso a todo el equipo | Igual que antes: sin sandbox ya podía tocar todo; la mitigación es la puerta del plan + aprobaciones por app + parada. Quitar la carpeta **no amplía** lo que el agente puede hacer, solo quita el paso de elegirla.                                                                                                                              |
| Un renderer comprometido lee archivos del usuario                    | Las funciones de la interfaz (`previewFile`, ZIP, abrir, QuickLook, proyecto/memoria) aceptan además el espacio de Control total **solo con consentimiento** y siguen negando los secretos que el perfil Seatbelt niega (`~/.ssh`, claves de nube y CLIs, config y datos de OpenCode). `userData` queda fuera por no estar en el home de trabajo. |
| Daño por una acción en el home sin deshacer                          | No se crean puntos de restauración de la carpeta personal (una instantánea de todo el home no es viable); se avisa en la tarea. Con una carpeta más pequeña elegida en Control total sí se crean.                                                                                                                                                 |
| Recorrer todo el home (CPU/IO, privacidad)                           | Los entregables no se calculan para el home; no se ejecuta la migración de la carpeta de trabajo antigua en el home.                                                                                                                                                                                                                              |
| Política de la organización                                          | `disableFullAccess` anula consentimiento y concesiones; con `allowedFolderRoots` Control total exige además carpeta autorizada (fail-closed).                                                                                                                                                                                                     |
| Rutinas desatendidas                                                 | Siguen exigiendo `fullAccessConsentAt` propio de la rutina, el consentimiento del equipo y plan aprobado por una persona; sin esto la ejecución falla o caduca.                                                                                                                                                                                   |
| Windows                                                              | El modo no existe (capacidad desactivada); los canales nuevos no se cargan allí.                                                                                                                                                                                                                                                                  |

**No cambia.** Perfil Seatbelt, credential proxy, `provider-egress`, `proxy-policy`, `folder-policy` (el home sigue rechazado como carpeta de Sandbox), puerta del plan, aprobaciones por app, atajo de parada y comprobaciones TCC. **Riesgo residual:** como antes, otro proceso del usuario sin sandbox puede leer el entorno del servidor de Control total (ver §5); y la carpeta personal como `cwd` hace que un `AGENTS.md` suelto en `~` lo lea el agente (también el global de `~/.config/opencode`, como antes).

## 3 vicies. Control remoto desde el celular (F8-B48, prototipo)

> **Histórico, con correcciones.** Esta sección describe el prototipo v1 (F8-B48). Lo vigente: la lista de lo que puede hacer el celular es la política
> R/M/D/X de §3 unvicies (`policy.ts`), las rutas dentro del ámbito sí se muestran (con `~`), la autenticación es la del protocolo v3 (§3 tricies) y los
> límites y arreglos de la auditoría están en §3 tricies bis. Donde algo de abajo contradiga esas secciones, mandan ellas.

**Qué es.** «Ajustes › Celular › Activar» muestra un QR; el celular lo escanea, abre una PWA servida por la propia app y se conecta
DIRECTO al Mac por un DataChannel WebRTC (cifrado DTLS, `node-datachannel` en `main`). Solo por RED LOCAL: no hay servidor en la
nube, ni Cloudflare, ni cuenta. Solo macOS (`PlatformCaps.remote`); con la función apagada no hay puertos, sockets ni módulos nativos
cargados y nada de la app cambia.

**Qué puede hacer el celular.** En el prototipo v1 eran 5 operaciones (`sessions.list`, `session.messages`, `session.prompt`, `session.abort`,
`permission.reply`; sigue existiendo `whitelist.ts` como respaldo del protocolo v1/v2 de la sesión). Hoy el celular llama a casi todo lo que usa el
renderer, **pero cada canal IPC y cada ruta del motor pasa por la política `policy.ts`** (denegar por defecto; R lectura, M mutación acotada al ámbito,
D confirmación en el Mac, X prohibida; §3 unvicies), y las carpetas, archivos de proyecto, git y Tareas SÍ están al alcance **dentro del ámbito** y sin
archivos sensibles. El celular NO recibe nunca la contraseña del sidecar ni acceso directo a él: el escritorio es el intermediario y valida cada trama
(`shared/remote/protocol.ts`, claves desconocidas = rechazo).

**Ámbito.** Sesiones de Chat y de los proyectos recientes de Code (las del motor principal). Las de **Tareas** viven en otros motores y
no se exponen nunca; tampoco subsesiones ni sesiones marcadas como Tareas. Un id fuera del ámbito responde `not-found` sin llegar al
motor. Permisos de Control del Mac (`computer_*`/`browser_*`), carpetas (`external_directory`), plan-gate o desconocidos se ven como
«Apruébalo en el Mac» (solo lectura). Lo que sale hacia el celular se recorta: texto y resumen de herramientas, secretos (patrones de `redact-patterns`),
rutas **fuera del ámbito** y `userDataPath`/`opencodeBin`; las rutas dentro del ámbito se pueden ver (con `~`; §3 unvicies), con tope de 64 KiB por trama.

**Cómo se vincula.**

1. Servidor HTTP+WebSocket mínimo (Node `http` + `ws`) que solo existe mientras el modo está activo, ligado ÚNICAMENTE a la IPv4 privada
   de la interfaz activa (10/8, 172.16/12, 192.168/16; nunca 0.0.0.0, loopback, VPN ni túneles), puerto aleatorio. Comprueba `Host` y
   `Origin` exactos (el navegador del celular manda siempre el de la página), admite como mucho 2 sockets, sirve la PWA estática con CSP
   estricta y se apaga del todo al detener.
2. El QR lleva un secreto `q` de 32 B en el fragmento de la URL (`#s=…`, no viaja al servidor). **`q` no sale nunca del celular** (v3,
   §3 tricies): el `hello` lleva solo `qid = HKDF(q, "pair-id")` y el canal se autentica con `HKDF(q, "pair-auth")`. El Mac guarda en memoria
   solo `qid` y esa clave; caduca a los 120 s; un `qid` ajeno NO lo consume (5 fallos lo anulan); solo un `hs3` correcto lo consume.
3. **Confirmación local obligatoria**: cuando el canal abre y el celular supera el handshake, el Mac muestra «¿Vincular este dispositivo?»
   con el nombre y un código de 6 dígitos (`sasCode`) derivado del transcript del handshake (huellas DTLS de ambos SDP, nonces y un
   compromiso previo del celular, §3 tricies). El celular lo calcula y lo muestra **después** de verificar la prueba del Mac. Si no
   coinciden hay un intermediario: el dueño debe rechazar.
4. Al aceptar, el escritorio entrega por el DataChannel un secreto de dispositivo (32 B) que el celular guarda en `localStorage`; el
   escritorio solo guarda su sha256 en `userData/remote.bin`, cifrado con `safeStorage` (sin `safeStorage` la función se desactiva con
   una explicación; nunca se escribe en claro).
5. Las reconexiones mandan `hello{resume, deviceId}` por señalización (sin ningún secreto) y, dentro del canal, el handshake v3 `hs1/hs2/hs3` (HMAC
   con la clave derivada del secreto de dispositivo, ligado a las huellas DTLS de los dos extremos y a nonces de un solo uso; 10 s de plazo para
   todo el handshake, un solo intento) y `authed{proof}`: el Mac prueba que tiene la clave antes de que el celular mande el PIN. **El secreto de
   dispositivo no viaja nunca** (ni por HTTP, ni por señalización, ni por el canal); la trama `auth{secret}` del prototipo ya no existe.

**Límites.** 10 peticiones/s (ráfaga 20), 6 prompts/min, 64 KiB por trama, 3 violaciones (trama inválida, fuera de lista, binario,
límite excedido, petición sin autenticar) = desconexión. Máx. 3 dispositivos vinculados y uno conectado a la vez (el mismo dispositivo
puede reemplazar su propia sesión vieja).

**Cortes.** «Cortar todo» (Ajustes, entrada en el menú de la bandeja con el modo activo, acción `remote.stopAll` en el registro de
atajos, sin atajo por defecto) cierra conexiones y servidor y anula el secreto del QR. Se apaga solo a los 30 min sin conexiones y al
salir de la app. Revocar un dispositivo (Ajustes) lo desconecta al instante.

**Amenazas y riesgo aceptado del prototipo.**

| Amenaza                                                                | Defensa                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Otro equipo de la red usa el QR/URL                                    | Secreto de un solo uso con caducidad + confirmación local con código de 6 dígitos. Quien solo ve la red no ve `q` (no viaja): sin `q` no puede ni vincularse ni leer el `deviceSecret`                                                                                                                                                                                                                                                  |
| Atacante activo en la misma Wi-Fi (intermediario que termina dos DTLS) | **Sin `q` no puede vincularse ni reconectar**: el HMAC del handshake va ligado a las huellas DTLS que ve cada pila, que con un intermediario son distintas, y no tiene la clave para fabricarlo. Con `q` filtrado (QR fotografiado), el código de 6 dígitos con compromiso previo lo detecta (acierta con prob. 1e-6 por intento, 5 intentos por QR). El riesgo aceptado se reduce a «el dueño no compara Y alguien vio el QR»          |
| Robo del secreto de dispositivo                                        | **No viaja nunca**: el celular prueba que lo tiene con un HMAC ligado a las huellas DTLS de los dos extremos y a nonces de un solo uso, y el Mac prueba lo mismo antes de recibir el PIN. Vive en `localStorage` del celular; el Mac guarda su sha256, que desde v3 es material de clave (`K = HKDF(sha256)`; cifrado con `safeStorage`); se puede revocar. Con el secreto robado y sin el PIN no se llega a nada (5 PIN malos revocan) |
| Página alterada al cargarla por HTTP                                   | **Riesgo residual aceptado hasta la fase 2 (HTTPS)**: la PWA se sirve por `http://IP:puerto`; un intermediario activo justo cuando el celular abre la página puede servir JavaScript propio en ese origen, leer el secreto de `localStorage` y capturar el PIN que escribe el dueño. Ningún protocolo dentro de la página lo evita (y la confirmación por conexión tampoco lo evitaba: el atacante usa la conexión legítima del dueño)  |
| Celular comprometido o prestado                                        | Política R/M/D/X acotada al ámbito (§3 unvicies), `always` inexistente, acciones D con confirmación en el Mac, PIN, límites, revocación y «Cortar todo». Aprobar `bash`/`edit` «una vez» desde el celular es D salvo el ajuste por dispositivo «Aprobar comandos» y la lista de denegación (§3 tricies quinquies)                                                                                                                       |
| Servidor local explotable                                              | Se liga solo a la IP privada, `Host`/`Origin` exactos, ≤ 2 sockets, sirve solo la carpeta de la PWA (sin `..`, solo extensiones conocidas), existe solo mientras está activo                                                                                                                                                                                                                                                            |
| Desbordamiento / inundación                                            | Tamaños máximos por trama, cubo de fichas, 6 prompts/min, desconexión a las 3 violaciones                                                                                                                                                                                                                                                                                                                                               |
| Fuga de rutas o secretos al celular                                    | Recorte de texto y herramientas en `events.ts`, filtro de archivos sensibles en lecturas y diffs, `sanitizeResult` por canal (§3 tricies bis)                                                                                                                                                                                                                                                                                           |

Una IP local por HTTP **no es contexto seguro**: la PWA no usa `crypto.subtle` (hash con `@noble/hashes`, fijado); `RTCPeerConnection` y
`crypto.getRandomValues` sí funcionan. No funciona en el prototipo: instalar la PWA, service worker, avisos push ni conexión fuera de
casa (fase 2: PWA estática en HTTPS, Worker de señalización sin estado tras la interfaz `SignalingTransport`, TURN, push, Windows).
Tampoco depende de que la red permita tráfico entre clientes: en una Wi-Fi con «aislamiento de clientes» la PWA mostrará
«no se encuentra el equipo».

**No cambia.** Sandbox, credential proxy, `provider-egress`, `proxy-policy`, plan-gate, `folder-policy` y la CSP del renderer.
Los preloads secundarios (`quick`, `overlay`, `pill`, `assist`, `browser-host`) quedan idénticos byte a byte. Los canales `remote:*` son
solo de la ventana principal (esquemas estrictos en `main/ipc/schemas.ts`).

**Invocador remoto (F8-B51, T2).** El celular llamará al IPC por `invokeAs`: mismo esquema estricto que una ventana, remitente virtual
(`id` negativo, propiedad de pty/archivos aislada por remitente) y un gancho `authorize` que debe aprobar canal y payload ya validado;
sin gancho, denegado. No se añade ningún rol a `CHANNEL_ROLES`. Los eventos salen por `ipc/event-bus.ts`: los suscriptores remotos
tienen lista blanca por canal (vacía = nada) y recorte; los envíos dirigidos a una ventana nunca llegan al celular.

## 3 unvicies. Política «celular» y confirmación en el Mac (F8-B52, tanda T3)

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

| Área                             | R                                                                                                                                                                                    | M                                                                                                                                                                                                                                                                      | D                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | X                                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat HTTP                        | `session.list/get/messages/status/todo/children/diff/message`, `experimental.session.list`, `provider.list`, `config.providers`, `permission/question.list`, agentes/comandos/skills | `session.create/update(título, archivar)/promptAsync` (agente `chat`, solo `data:`)`/abort/revert/unrevert/summarize/fork/delete(una)`, `question.reply/reject`, `permission.reply once/reject`                                                                        | `session.create/update` con `permission` propio                                                                                                                                                                                                                                                                                                                                                                                                                          | `permission.reply always`, `session.shell`, `session.init/share`, mensaje síncrono, borrar mensajes/partes, `auth.*`, `provider.auth/oauth`, `config.*`, `global.dispose/upgrade`, `instance.dispose`, `/pty`, `/tui`, `/mcp`, `/project`, `/path`, `/sync`, `/experimental/*` salvo `session`, toda la API nueva `/api/*` |
| Code HTTP                        | `file.list/read/status`, `find.*`, `vcs.*` (en el dir, sin escapar)                                                                                                                  | `promptAsync` (agentes `plan`/`build`; `file://` solo bajo el dir de la sesión), `session.command`                                                                                                                                                                     | `permission.reply once` de `external_directory`, de Control del Mac (`computer_*`/`browser_*`), MCP o de tipo desconocido                                                                                                                                                                                                                                                                                                                                                | las mismas X                                                                                                                                                                                                                                                                                                               |
| Git                              | `isRepo/status/diff/branches/currentBranch/log/worktrees`                                                                                                                            | `commit`, `discardHunk`, `discard` (≤ 20 archivos), `discardUndo`, `createWorktree`                                                                                                                                                                                    | `discard` de todo o > 20, `removeWorktree`                                                                                                                                                                                                                                                                                                                                                                                                                               | —                                                                                                                                                                                                                                                                                                                          |
| Archivos                         | `files:watch/setDirs/unwatch`, `editors:list`                                                                                                                                        | `files:create`, `rename`/`trash` de UN archivo                                                                                                                                                                                                                         | `rename`/`trash` de carpeta (o de algo cuyo tipo no se conoce)                                                                                                                                                                                                                                                                                                                                                                                                           | `editors:open`, `dialog:*`, `tasks:reveal/openPath/quickLook/zip/importFiles/exportMarkdown/htmlToPdf`                                                                                                                                                                                                                     |
| Terminal                         | —                                                                                                                                                                                    | —                                                                                                                                                                                                                                                                      | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `pty:*` (hasta F4)                                                                                                                                                                                                                                                                                                         |
| Ajustes                          | `settings:get`, `extras:getPrefs/versions`, `mcp:catalog`, `tasks:prefs:get`, `computer:prefs:get`                                                                                   | `settings:set` solo `defaultModel`/`theme`/`language`; `extras:setPrefs` `modelsByMode/showTray/notificationsEnabled/soundEnabled`; `tasks:prefs:set` `notify/stallWarnMinutes`; `computer:prefs:set` `hideOtherApps/unhideOnFinish`                                   | `tasksGlobalInstructions`, `addRecentFolder`, `tasks:prefs:set` `autoArchiveDays/idleStopMinutes/maxServers`, `computer:prefs:set{mode:'full'}`                                                                                                                                                                                                                                                                                                                          | `opencodeBin`, `checkUpdates`, `recentFolders`, `onboarded`, `routinesTermsAcknowledged`, `quickEntryShortcut`, `keybindings`, `lastEditor`, `mcp:getConfig/save/remove/setEnabled/revealConfig/installCatalog`, `tasks:mcp:set`                                                                                           |
| Tareas / Control / Rutinas       | listados, estado, actividad, entregables, vista previa (≤ 8 MiB), restauración (`list/changes`), `routines:list/history/preview`                                                     | `tasks:start` sin control total, `removeFolder`, `revokeFullAccess/revokeAll`, `computer:stop/revokeGrant/denyApp/revokePlan`, `respondAccess` solo rechazando, `routines:delete`, `routines:toggle` a apagado, `restore:create/forget`, `rules:remove`, `auto:revoke` | `start{fullAccess}`, `grantFullAccess`, `fullAccess:consent`, `approveFolder`, `folders:link/unlink`, `trusted:set/remove`, `network:*` (menos `state`), `deleteGrant:set`, `restore:apply`, `storage:clean*`, `auto:set/consider/clearLog`, `project:save` con instrucciones/enlaces, `memory:save/delete`, `agentsMd:save`, `rules:add`, `respondAccess` con concesiones o plan, `setGrant`, `undenyApp`, `computer:resume`, `routines:save/runNow/toggle` a encendido | `pickFolder`, `requestPermissions` (TCC), `teach*`, `record*`, `showMainWindow`                                                                                                                                                                                                                                            |
| Navegador                        | `browser:state/capture`                                                                                                                                                              | `newTab/closeTab/selectTab/navigate/history/toChat`, `agent` pausar/detener, `respond` denegar                                                                                                                                                                         | `agent` reanudar, `respond` con cualquier permiso                                                                                                                                                                                                                                                                                                                                                                                                                        | `attach/detach/pick/popOut/setViewMode/openExternal/devServers/sites:*/clearData`                                                                                                                                                                                                                                          |
| App / actualizador / diagnóstico | `app:info` (sin `userDataPath`), `updateState`, `opencode:status/connection` (credenciales reescritas)                                                                               | `checkUpdates`, `dismissUpdate`, `updateCancel`                                                                                                                                                                                                                        | `updateDownload`, `updateInstall`, `opencode:restart`                                                                                                                                                                                                                                                                                                                                                                                                                    | `openExternal`, `notify`, `setAttention`, `opencodeInfo/Action`, `pickOpencodeBin`, `bootConfirm`, `testProviderKey`, `diag:*`                                                                                                                                                                                             |
| Remoto / onboarding              | —                                                                                                                                                                                    | —                                                                                                                                                                                                                                                                      | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | todo `remote:*`; el onboarding (`onboarded`)                                                                                                                                                                                                                                                                               |

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
  atajos y MCP; se recortan (`sanitize`) los que llevan credenciales del motor o rutas (`opencode:connection`, `tasks:server`,
  `settings:changed`, `files:changed`…).

**Cola de confirmación (`remote/confirm-queue.ts`).** FIFO, máx. 2 pendientes (la 3.ª responde `busy`), 10 peticiones nuevas por minuto
(`rate-limited`), deduplicada por `sha256(canal + payload canónico)` y dispositivo (desde F8-B67, repetir la misma llamada pendiente responde `busy`: ya no se une a ella, y no
gasta cupo). La aprobación vale SOLO para esa llamada: el resultado lleva el `digest` y el despachador debe comprobar que coincide con
lo que va a ejecutar; se consume al resolver (repetir la llamada pide otra). Solo se muestra la primera; rechazo automático a los 90 s
**desde que se muestra**; revocar o «Cortar todo» llama a `cancelAll`/`cancelDevice`. Contrato IPC: evento `remote:confirmRequest`
(`RemoteConfirmRequest`: nombre, huella de 8 hex, resumen es/en, detalle, `expiresAt`) y `remote:confirmAction {requestId, accept}`, solo
de la ventana principal (no está en `CHANNEL_ROLES` de ninguna otra). La interfaz (`RemoteConfirmHost.tsx`), el PIN y la auditoría
`remote-audit.jsonl` son de la tanda T6.

## 3 vicies bis. Protocolo v2 del control remoto (F8-B53)

Transporte multiplexado sobre el mismo DataChannel (ordenado, fiable, DTLS). **No añade superficie**: el despachador de `call`/`http`/`sub`
es inyectable y, sin él, toda trama v2 responde `unavailable`; la política «celular» (denegar por defecto) y el proxy del motor llegan en
otras tandas. Lo que sí fija este bloque:

- **Todo se valida en ambos lados** (`protocol.ts`): claves desconocidas = rechazo, ids `1..2^31-1`, canales/motores por expresión
  regular, rutas HTTP absolutas sin `..`, `//` ni separadores codificados, cabeceras solo `content-type`/`accept` sin caracteres de control.
- **Anti-repetición**: los ids de `call`/`http`/`sub` deben crecer estrictamente; uno repetido o menor es una violación (3 = desconexión).
- **Memoria acotada**: mensajes ensamblados ≤ 16 MiB (subida) / 8 MiB (bajada), ≤ 32 MiB en ensamblado a la vez, anunciados en la cabecera (`ck`)
  y verificados al final; trozo huérfano, fuera de orden o de más = violación. Salida con tope equivalente.
- **Denegación de servicio**: ≤ 32 llamadas en vuelo y 6 streams (el exceso recibe `busy`), crédito por transferencia/stream (ventana 256 KiB; un
  `credit` mayor que lo enviado es violación), cubo de 40 lecturas/s (ráfaga 120) para `call`/`http`/`sub` y red de seguridad para `chunk`/`credit`/`cancel`.
- **Reanudación sin filtrar**: el búfer circular (30 s / 2 MiB) guarda lo que el Mac YA filtró y recortó; un hueco, un reinicio o un evento que no cabe
  en una trama producen `reset` (el celular vuelve a leer el estado), nunca eventos inventados.
- **Compatibilidad**: la señalización exige `v: 3` (desde F8-B66; `v: 2` en este bloque); un celular con una PWA anterior recibe `error{code:'version'}`
  (también si su `hello` ya no tiene la forma válida) y no llega a abrir canal. Las tramas v1 de la lista blanca del prototipo siguen funcionando mientras no se retire.
- Los errores v2 solo llevan un código y un `msg` opcional de ≤ 200 caracteres escrito por el despachador; los errores internos salen como `failed`.

## 3 vicies ter. Proxy del motor y concentrador de eventos del celular (F8-B54, tanda T4)

Conecta el multiplexor (T1) con `invokeAs` (T2) y la política (T3). El despachador real vive en `src/main/remote/engine-proxy.ts`
(`EngineProxy`), el ámbito y lo aprendido en `engine-scope.ts`, las credenciales en `engine-registry.ts`, los eventos en `event-trim.ts` y
`sse-hub.ts`, y las rutas en `path-guard.ts`; `engine-host.ts` los ensambla y `service.ts` los cablea (sin `engine` toda trama v2 sigue
respondiendo `unavailable`).

- **`call` (IPC)**: se canonizan las rutas (`realpath` de toda cadena bajo claves de ruta; las relativas deben seguir dentro de `cwd`/`folder`
  tras resolver enlaces) → `decide`. R/M se ejecutan con `invokeAs` y el remitente virtual del celular; **D** espera la confirmación del Mac
  (`ConfirmQueue`; la aprobación vale solo para el `sha256` de esa llamada exacta y, si la llamada se cancela mientras espera, NO se ejecuta);
  **X** y lo desconocido responden `forbidden` con un código corto. La política se aplica otra vez sobre el payload YA validado por el esquema
  (gancho `authorize`). `remote:*` se rechaza siempre. Sin UI de confirmación (T6) el respaldo RECHAZA toda acción D.
- **`http` (sidecar)**: el `fetch` es del main y la cabecera `Authorization` (Basic) la pone el Mac; el celular solo manda `content-type`/`accept`.
  `directory` debe ser absoluto y se sustituye por su `realpath` antes de decidir y de reenviar (un enlace dentro del ámbito que sale fuera
  acaba en `out-of-scope`); `path` de `GET /file` y `/file/content` debe quedar dentro del directorio real; los `file://` y `source.path` de un
  prompt se resuelven igual y no pueden ser sensibles. `GET /file/content` rechaza archivos sensibles aunque la política lo permita
  (`path-guard.ts`: `.env*` salvo `.example/.sample/.template`, claves y almacenes `.pem .key .p12 .pfx .keystore .jks .kdbx`, `id_*` sin `.pub`,
  `.ssh .aws .gnupg .kube .docker`, `.git/config` y `.git/hooks`, `.npmrc .netrc .git-credentials`, credenciales de gcloud/gh/opencode, Llavero;
  se comprueba la ruta léxica Y la real, de modo que `notas.txt -> .env` no cuela). Los listados (`/file`, `/find`, `/find/file`) quitan esos
  archivos y `GET /session`, `/experimental/session` y `children` se filtran por ámbito; `provider.list`/`config.providers` salen sin claves.
  Cuerpo ≤ 12 MiB, respuesta ≤ 6 MiB (`too-large`), 120 s de tope y cancelación con el `AbortSignal` de la conexión. La política recibe lo que
  necesita (directorio de la sesión, tipo del permiso, modelos de `provider.list`) aprendido de respuestas y eventos YA filtrados; solo se
  consulta al motor, y solo para directorios dentro del ámbito, cuando `decide` lo pide.
- **Credenciales**: `opencode:connection`, `opencode:restart`, el evento `opencode:connection` y `tasks:start` salen con
  `baseUrl = lazunox://engine/main` o `lazunox://engine/task/<token>` y `authorization = ''`; el token es opaco (96 bits), estable por carpeta y su
  mapeo está solo en el Mac; caduca con «Cortar todo», el apagado a los 30 min y el cierre del servicio (no al soltar el Wi-Fi unos segundos,
  para que una reconexión no deje al celular con un token muerto). Red de seguridad: todo texto de una respuesta, error o evento pasa por
  `registry.scrub`, que tacha el valor `Authorization`, su base64, `usuario:clave` y la clave.
- **Eventos**: UN stream de subida por motor y bajo demanda (`client.global.event()` del SDK v2, al llegar un `sub`), cerrado cuando no queda
  ningún dispositivo. Lista blanca de tipos (`session.* message.* permission.* question.* todo.* file.edited vcs.branch.updated
server.connected global.disposed`), solo del ámbito (los servidores de tarea, solo de su carpeta), salidas de herramientas recortadas a 4000
  caracteres y publicación en el `EventLog` con `seq`. Si el stream de subida se reconecta se marca un hueco (`reset`). El bus de la app
  (T2) alimenta el motor `main` con `CELULAR_EVENTS` (`deny` por defecto) y recorte por canal (`tasks:server`, `settings:changed` sin
  `opencodeBin`, `browser:*` solo de carpetas del ámbito); también llega con la ventana cerrada.
- **Puerto estable (D1)**: el primer puerto libre se guarda en `remote.bin` (cifrado, junto a los dispositivos); si está ocupado se usa otro sin
  pisar el guardado. El HTTP sigue sin cifrar en la LAN (riesgo aceptado hasta el HTTPS de la fase 2).
- **Forma de `res` de `http`** (contrato para el shim de `fetch`, T5): `{status, contentType?, body, encoding?: 'base64'}`; `/event` y
  `/global/event` no se sirven por `http` (`unsupported`): el celular usa `sub`, y cada `ev` lleva `oc = type` y `p = {directory, id?, properties}`.
- **Límites conocidos**: los diffs (`/session/{id}/diff`, `/vcs/diff`) y el texto de los mensajes pueden contener secretos que el agente leyó;
  solo se tachan las credenciales del motor. La confirmación de acciones D depende de la UI de T6.

## 3 vicies quater. Confirmación en el Mac, PIN y auditoría del control remoto (F8-B55, tanda T6)

Todo se aplica **dentro del canal ya autenticado** (secreto de dispositivo) y **antes** de cualquier llamada; el celular no puede invocar nada de esto
(`remote:*` está en X en la política y el despachador lo rechaza; `remote:confirmAction` solo existe para la ventana principal).

- **Confirmación de cada conexión nueva (D3) — OPCIONAL desde F8-B66**: con el ajuste «Pedir confirmación en el Mac en cada conexión» (Ajustes › Celular;
  **apagado por defecto**) o la política `requireConnectionConfirm`, al reconectar un dispositivo ya vinculado el canal queda en «esperando confirmación» sin
  acceso hasta que el dueño pulsa «Permitir» en el Mac; con el ajuste apagado entra directamente a la fase de PIN, sin ningún diálogo en el Mac (la defensa
  contra un intermediario es ahora el handshake ligado a las huellas, §3 tricies, que es lo que hacía necesaria la pregunta). **Un dispositivo sin PIN
  SIEMPRE confirma**, aunque el ajuste esté apagado: si no, un secreto robado de un vínculo sin PIN (antiguo o tras «Restablecer PIN») bastaría para fijar un PIN
  nuevo y entrar. Opción «Recordar 12 h» por dispositivo (solo tiene efecto con el ajuste encendido; apagarlo la borra); caducada, se vuelve a pedir. La política
  manda: forzada, el interruptor queda desactivado. Vincular un dispositivo nuevo ya es la confirmación (con código de 6 dígitos) y se confirma SIEMPRE.
- **Diálogo** (`RemoteConfirmHost.tsx`): nombre y huella (8 hex de sha256 del `deviceId`), acción en es/en, detalle, hora, cuenta regresiva; «Rechazar» enfocado,
  «Permitir» activo tras 1,5 s, rechazo automático a los 90 s. Sin ventana principal: `dialog.showMessageBox` sin padre (Rechazar por defecto) + rebote del
  Dock y notificación; si el diálogo falla o lanza, **se rechaza**. Las confirmaciones usan la cola de T3 (máx. 2 pendientes, 10/min, aprobación ligada a la llamada exacta).
- **PIN (D4)**: el celular fija un PIN de 6 dígitos con `pin-set` al vincular (o en la primera conexión de un dispositivo anterior sin PIN). El Mac guarda solo
  `scrypt(pin, sal)` (N=2^15, r=8, p=1, sal de 16 bytes por dispositivo) dentro de `remote.bin` (cifrado con `safeStorage`); nunca el PIN, nunca en logs ni auditoría.
  `pin-verify` se comprueba en tiempo constante. Cada fallo suma un retardo (1, 2, 4… hasta 30 s) durante el cual no se verifica; **5 fallos seguidos (persistidos, no se
  reinician al reconectar) revocan el dispositivo**. Cambiar el PIN exige «Restablecer PIN» desde el Mac. Reconectar con actividad hace <5 min no repite el PIN; en frío sí
  (con la política `requirePin:true` nunca hay reconexión «en caliente»). **El plazo de validez del vínculo se renueva cuando el acceso se abre** (PIN correcto o reconexión
  en caliente), no al presentar la clave (H11): quien solo tiene la clave y no pasa del PIN ya no mantiene vivo un vínculo.
- **Bloqueo por inactividad**: tras 5 min sin llamadas del celular (los `ping` y los eventos no cuentan) el Mac vuelve a exigir el PIN (`locked{why:'inactive'}`);
  mientras tanto descarta todo lo que no sea lectura (`isRead`, inyectable; sin clasificador no se atiende nada) y no entrega eventos ni suscripciones. **Cualquier bloqueo
  (por inactividad o «Bloquear ahora») cierra las suscripciones ya abiertas (H3)**: el Mac manda un `res` de error por suscripción, descarta los eventos en cola y `drain`
  no emite sin el acceso abierto (`canEmit`); tras el PIN, el celular vuelve a suscribirse con `since` y recupera lo pendiente del búfer.
- **«Cortar todo» y «Quitar todos» (H6)** borran también «Recordar 12 h» y la actividad reciente en memoria: al reactivar el mismo día no hay reconexión «en caliente» ni confianza de 12 h.
- **Sin acceso, nada**: con confirmación o PIN pendientes solo se atienden `ping`, `pin-set` y `pin-verify`; `call`/`http`/`sub`/`req` responden `forbidden` sin llegar al despachador ni al motor.
- **Auditoría** `userData/remote-audit.jsonl` (rotada a 2 archivos de ≤ 256 KiB): vinculaciones, conexiones, confirmaciones (aprobadas/rechazadas/caducadas), revocaciones,
  fallos de PIN (solo el contador), bloqueos y llamadas rechazadas por la política (**solo canal y clase `X`**, nunca payload ni rutas). Los campos se filtran contra una lista
  cerrada (huella de 8 hex, nombre saneado, canal con alfabeto restringido); cualquier otro dato se descarta. Visible en Ajustes › Celular › Actividad (filtro por dispositivo).
- **Trazabilidad de cambios**: `ipc-remote.ts` añade `remote:setRemember`, `remote:resetPin`, `remote:auditList` y el evento `remote:confirmDismiss` (todos X/deny para el celular, con esquema).
- **Límites conocidos**: el PIN de 6 dígitos solo resiste por el tope de 5 fallos + retardo (el atacante ya necesita el secreto de dispositivo); el diálogo nativo de respaldo no se cierra solo a
  los 90 s (la cola ya rechazó); la clasificación de lecturas para el bloqueo la debe aportar el despachador (T4).

## 3 vicies quinquies. PWA completa del celular (F8-B56, tanda T5)

La misma interfaz React de `src/renderer/src` corre en el navegador del celular (o de un escritorio) con shims de `window.api` y `fetch` sobre el
DataChannel. **No cambia ninguna regla del Mac**: todo lo que el celular puede hacer lo sigue decidiendo `decide` (política «celular»); ocultar un botón
en la interfaz es solo comodidad, nunca el control.

- **Carga después de autenticar**: el arranque ligero (`pwa/src`, ~25 KB gzip) vincula, autentica y pide confirmación/PIN; solo cuando el Mac da acceso
  (`unlocked`) descarga `app/entry.json` (nombres con huella de JS/CSS, validados con una lista de caracteres y prefijo `assets/`) y arranca la interfaz.
  Antes de eso no existe en la página nada de la interfaz completa. Si la carga falla o tarda >25 s se queda la interfaz ligera de respaldo.
- **Aislamiento de las dos capas**: la capa ligera (vinculación, PIN, «confirma en tu Mac», reconectando, sin conexión) vive en un **shadow root**; sus
  estilos globales no tocan a la interfaz completa ni al revés. Mientras tapa (`cover`) la interfaz completa queda `inert`. El bloqueo a los 5 min lo decide
  el Mac (`locked{why:'inactive'}`): la capa ligera vuelve a tapar y pide el PIN sin recargar; al desbloquear se reanudan los eventos con `since`.
- **`window.api`**: se arma con el MISMO código que el preload (`src/preload/window-api.ts`: `makeBridge` + los `build*Api`), sobre un `ipcRenderer` falso:
  `invoke` → `call{ch,p}` y la respuesta vuelve como `IpcResult`; `on` → bus de eventos remoto. La lista de canales sigue siendo la de `src/shared/ipc*.ts`;
  `window.api.platform = 'remote'`. **`window.fetch`** solo intercepta `lazunox://engine/…` (el resto va al `fetch` original y la CSP solo deja `'self'`).
- **El celular nunca ve credenciales**: lo que recibe ya viene con `authorization = ''` y `baseUrl = lazunox://engine/…`; el shim reenvía solo `content-type`
  y `accept` (aunque el SDK ponga `Authorization`, no sale hacia el Mac).
- **Errores tipados** (`RemoteLinkError`: `disconnected`, `forbidden`, `locked`, `denied`, `expired`, `unavailable`, `busy`, `rate-limited`, `too-large`…) con
  texto es/en; `forbidden` + detalle `locked` = PIN pedido, `rejected` = el dueño dijo que no. **Las mutaciones nunca se reintentan solas**: un fallo es definitivo
  y el `AbortSignal` solo envía `cancel`.
- **Esperar una acción «D»**: la interfaz no sabe cuáles lo son, así que cualquier llamada que tarde >1,5 s muestra «Esperando a tu Mac…» (hasta 90 s). Si el Mac rechaza o
  caduca, la acción falla con `denied`/`expired`; nunca se ejecuta por el simple paso del tiempo.
- **Contexto no seguro** (HTTP en IP local): se rehacen `crypto.randomUUID` (lo usa la vigilancia de archivos de Code) y `navigator.clipboard.writeText`
  (`execCommand('copy')`; la lectura del portapapeles se rechaza). Solo si faltan.
- **Servidor estático** (`lan-server.ts`): `.gz` precomprimido con `Content-Encoding` solo para texto y solo si el cliente acepta gzip (el `.gz` no se pide directamente);
  `Cache-Control: immutable` **solo** para archivos con huella de Vite (8 caracteres con dígito/mayúscula, `assets/…`); `index.html`, `entry.json` y lo demás `no-store`;
  sin service worker ni manifest; MIME correctos (`.js .css .svg .woff2 .map .json`). CSP: `default-src 'none'`, `script-src 'self'` (sin inline ni eval), `img-src 'self' data: blob:`,
  `font-src 'self'`, `connect-src 'self' ws://host`, sin `worker-src`. Los estáticos van por HTTP normal (no por el DataChannel); no cuentan para el límite de 2 sockets de
  señalización y siguen sujetos a la comprobación de `Host` (421) y a GET/HEAD.
- **Sin terminal, diálogos, `openExternal`, vista nativa ni actualizador**: la superficie `remote` de `platform-caps` los oculta (y el Mac los rechaza igualmente: `pty:*`, `dialog:*`,
  `app:openExternal`, `browser:attach`, `app:update*` son X). Los enlaces se abren en una pestaña del propio navegador del celular (`noopener`, solo `http(s)`).
- **Peso**: sin xterm, `highlight.js` con 15 lenguajes, Tareas/Rutinas/Ajustes y el diccionario inglés en trozos aparte.
- **Límites conocidos**: el HTTP de la LAN sigue sin cifrar (riesgo aceptado hasta el HTTPS de la fase 2): un intermediario activo justo cuando el celular abre la página podría alterar el JS que se sirve
  (y leer el secreto o el PIN desde él; ver §3 tricies); las defensas son el handshake ligado a las huellas DTLS (cubre la conexión, no el código de la página), el código de 6 dígitos, el PIN, la
  confirmación opcional de cada conexión y que todo lo peligroso se confirma en el Mac. `style-src` conserva `'unsafe-inline'` (estilos en línea de React).
  El código de la interfaz completa llega al celular por una conexión no autenticada; los datos del celular (conversaciones) solo viajan por el DataChannel cifrado.

## 3 vicies sexies. Caducidad de vínculos y política de la organización del control remoto (F8-B57)

**Secreto de dispositivo.** El celular guarda el secreto (32 bytes aleatorios); `remote.bin` (cifrado con `safeStorage`)
guarda SOLO su sha256. Con 256 bits de entropía un sha256 simple basta (no hay diccionario que atacar), por eso no se
cambió el hash ni hubo que migrarlo. **Desde v3 ese hash es material de clave** (`K = HKDF(hash)` autentica al celular, §3 tricies): quien descifre `remote.bin`
puede autenticarse como el celular (antes el hash solo no servía para entrar). `remote.bin` sigue cifrado con `safeStorage` (Llavero) y el hash no sale del almacén
(`authKey` devuelve la derivación); quien puede descifrarlo ya controla el Mac. Ni el estado de Ajustes, ni la auditoría, ni los registros incluyen el secreto ni su
hash (prueba en `devices-store.test.ts`).

**Caducidad por dispositivo** (`devices-store.ts`). Cada vínculo tiene `ttlDays` (30, 90 —por defecto—, 365 o `null` = nunca,
SOLO desde el Mac: `remote:setDeviceTtl`, canal clase «X», no invocable desde el celular) y `renewedAt`. Caduca a
`renewedAt + ttlDays`; el plazo se renueva y se apunta `lastUsedAt` cuando el acceso se abre (`touch`: PIN correcto o reconexión en caliente), no al presentar la clave. Un vínculo caducado:

- se rechaza tras el handshake con `auth-failed {why:'expired', proof}` y se audita (`expired`); el celular debe
  volver a vincularse. `expired` solo se dice a quien supera el handshake (el Mac ya verificó la prueba del celular, así que puede probar quién es con `proof`, y el celular
  solo borra su vínculo ante una prueba válida); con una clave mala o un intermediario sigue siendo `auth-failed` a secas, sin prueba (no revela si el dispositivo existe ni si caducó);
- sigue visible en Ajustes › Celular (`Caducado`, con su fecha) hasta que se quita; no ocupa hueco al vincular otro;
- si al reconectar quedaban 7 días o menos, `authed` lleva `expiring:true` (y `expiresAt`, el vigente: no se renueva hasta abrir el acceso) para que el celular avise.
  `remote.bin` anterior (campo `lastSeenAt`, sin `ttlDays`/`renewedAt`) se migra al leerlo: 90 días contados desde ese momento
  (no caducan de golpe) y se reescribe de inmediato. Ajustes muestra último uso y caducidad, el plazo de cada celular,
  «Quitar» y «Quitar todos» (con confirmación; audita `revoked-all`).

**Política de la organización** (`org-policy.ts`, `docs/POLITICA-ORGANIZACION.md`). Bloque `remote` del mismo `managed.json`
de Tareas. FAIL CLOSED: archivo presente pero ilegible/inválido, `remote` que no es un objeto o `enabled` distinto de `true`
⇒ el control remoto queda deshabilitado y Ajustes lo explica («Bloqueado por la política de tu organización»). La política
manda sobre los ajustes del usuario; la app no tiene ninguna forma de cambiarla ni de saltársela, y en la app empaquetada
se ignora la variable `LAZUNOX_MANAGED_POLICY` (solo vale en desarrollo). Se relee cuando el archivo cambia: al activar, en
cada conexión (señalización y autenticación) y cada 5 s mientras está encendido; `enabled:false` corta de inmediato las
conexiones vivas (`stopAll`, auditoría `policy-blocked`). `allowRemember:false` borra los vínculos al activar y al cortar;
`allowConfirmRemember12h:false` quita «Recordar 12 h»; `requirePin:true` exige el PIN en cada conexión (sin reconexión en
caliente); `requireConnectionConfirm:true` (F8-B66) obliga a confirmar en el Mac cada conexión de un celular ya vinculado (ausente = `false`; un valor raro o un
archivo inválido = `true`, fail closed); `maxDevices` y `deviceTtlDays` recortan los límites de fábrica (el plazo efectivo es el menor).
**No verificado**: nada con Jamf/Intune reales, ni con `managed.json` escrito por root en `/Library` (las pruebas usan archivos
temporales).

## 3 vicies septies. Interfaz de celular y bloqueo manual (F8-B58, tanda T7)

- **Trama `lock`** (cliente → Mac): validada estrictamente (sin claves extra), solo con el canal autenticado (si no, cuenta como violación). `AccessGate.lockNow()` pasa a `verify-pin` SIN el modo «lecturas permitidas» del bloqueo por inactividad: no se atiende nada hasta verificar el PIN (con los mismos 5 fallos y retardos). Auditado como `locked`. No amplía privilegios: solo los reduce.
- **Desvincular** en el celular borra el secreto local y recarga; no avisa al Mac (la revocación sigue siendo desde sus Ajustes).
- La interfaz móvil no añade canales ni rutas: reutiliza los de la política «celular». En Ajustes del celular no se ofrecen proveedores/claves (X), reinicio del servidor ni instrucciones globales (D); no se pide `provider.auth` desde el celular.

## 3 vicies octies. Code en pantalla de celular (F8-B59, tanda T8)

Solo interfaz: no se abre ningún canal ni ruta nuevos; todo lo que hace Code en el celular pasa por la política «celular» ya existente.

- **Qué se ofrece depende de la política, pero el Mac manda**: la pantalla del celular no ofrece «siempre» (`permission.reply always` es X) ni «una vez» para permisos que la política manda confirmar (`external_directory` y cualquier tipo desconocido = D): muestra «Apruébalo en el Mac». `src/shared/remote/mac-confirm.ts` es solo un espejo para avisar a la persona; `mac-confirm-parity.test.ts` lo compara con `decide()`. Si se desfasara, la política sigue decidiendo.
- **Adjuntos**: solo partes `data:` con los límites de Chat (5 MB imagen, 10 MB PDF, 1 MB texto, 15 MB total, 5 archivos); `doSend` filtra `file://` de los adjuntos desde el celular. Las menciones `@archivo` siguen siendo `file://` bajo el directorio de la sesión (la política lo acota).
- **Archivos**: crear/renombrar/borrar de UN archivo es M; carpetas o varios, D (confirmación en el Mac, con aviso previo). `.git` sigue protegido. «Abrir en…» (`editors:open`) no se ofrece (X).
- **Navegador del agente**: solo `browser:state` y `browser:capture` (R, ámbito por dueño). `captureForUi` no comprueba que la pestaña pertenezca al dueño indicado (solo la política lo hace con el `owner`): pendiente de endurecer en main.
- **Foco/teclado**: sin atajos de teclado en el celular; el permiso ya no escucha 1/2/3.

## 3 vicies novies. Celular integrado (F8-B60)

Sin cambios de superficie de ataque: solo interfaz. Code en el celular usa los mismos canales que en F8-B59 (la política no cambia; `policy.ts` intacto). Cambios, Archivos y el navegador del agente (solo vista) siguen ejecutando las mismas llamadas; solo cambia dónde se dibujan (pantallas de la pila de navegación). El historial del navegador solo guarda marcas `{lazunoxNav:true}` sin datos. Los permisos nuevos se llevan a la vista (el usuario siempre ve la tarjeta antes de decidir).

## 3 tricies. Autenticación mutua ligada a las huellas DTLS y reconexión sin confirmación obligatoria (F8-B66, protocolo v3)

**Qué cambia y por qué.** Hasta v2 el celular mandaba `auth{deviceId, secret}` dentro de un DataChannel cuyo par DTLS nadie comprobaba (las huellas viajan por `ws://` plano), así
que un intermediario en la LAN (ARP/AP falso) que terminara dos DTLS podía leer el secreto y el PIN; por eso el Mac pedía «Permitir» en cada conexión. v3 quita la causa en vez del
síntoma: **ninguna credencial viaja** y la autenticación va ligada a las huellas DTLS que ve cada pila. Código: `src/shared/remote/handshake.ts` (TypeScript puro, `@noble/hashes`; lo
usan igual el Mac y la PWA), `peer-session.ts` (Mac) y `pwa/src/client.ts` (celular).

**Base verificada: la pila DTLS comprueba la huella del SDP.** El diseño solo vale si libdatachannel verifica el certificado del par contra la huella de su SDP remoto (el navegador lo
hace siempre). Se comprobó con la librería real (`node-datachannel` 0.33.4, `rtc-fingerprint.test.ts`): con una huella falsa en el offer (lado Mac) o en el answer (lado celular) el canal NO
abre; sin manipular, abre y `remoteFingerprint()` coincide con la huella del SDP. `disableFingerprintVerification` es `false` por defecto y no se toca. Defensa en profundidad (`rtc.ts`): al abrir
el canal se compara `remoteFingerprint()` con la huella estricta del offer aplicado; si no casan, se cierra antes de que exista sesión.

**Mecanismo** (`handshake.ts`; pruebas en `handshake.test.ts`, con vectores fijos calculados aparte con HKDF/HMAC de Python):

- _Huellas estrictas_ (`sdpFingerprintStrict`): se recogen TODAS las `a=fingerprint`; si hay alguna que no sea `sha-256`, un valor mal formado, o dos valores distintos, se rechaza. Con dos
  huellas distintas el intermediario podría poner la real en la primera línea (la que hasheamos) y la suya en otra (la que verifica la pila).
- _Claves_ (HKDF-SHA256, sal fija de versión): reconexión `K = HKDF(sha256(secreto))` (el celular parte del secreto que ya guarda; el Mac, del hash que ya guarda: **los celulares vinculados siguen
  sirviendo sin volver a vincular**); vinculación `K = HKDF(q)` con `q` el secreto del QR, que nunca sale del celular (el `hello` lleva `qid = HKDF(q, "pair-id")`).
- _Transcript_ con alfabetos cerrados: modo, id, huella del offer (celular), huella del answer (Mac), dos nonces de 32 B frescos y, solo al vincular, compromiso y revelaciones del código. Cada lado usa
  las huellas **de su propia pila** (`localDescription`/`remoteDescription` en el celular; el offer aplicado y el answer generado en el Mac). `c2h` (celular → Mac) y `h2c` (Mac → celular) usan etiquetas
  distintas: una prueba no se puede reflejar como la otra.
- _Tramas_: `hs1` (celular) → `hs2` (Mac) → `hs3` (celular) y el Mac contesta con `proof` en `authed`/`pair-pending`/`auth-failed{why:'expired'}`. El celular **no manda el PIN ni nada más hasta verificar `proof`**, y
  descarta cualquier otra trama antes (cierra con «respuesta no válida»). Un solo intento, 10 s para todo el handshake, `hs*` fuera de orden = corte inmediato, `auth` antiguo = violación. El Mac con un
  dispositivo desconocido usa una clave de relleno aleatoria y hace el mismo trabajo (resultado siempre `auth-failed`).
- _Código de 6 dígitos con compromiso previo_: el celular se compromete a `rp` (`cm = sha256(rp)`) antes de ver `rm`; el Mac revela `rm` antes de ver `rp`. Un intermediario que conoce `q` no puede elegir su
  certificado después de ver el del otro lado (sin compromiso bastaban ~2^10 certificados por cumpleaños, y libdatachannel probablemente reutiliza el certificado): le acierta al azar con prob. 1e-6 por
  intento; 5 fallos (de `qid` o de vinculación) anulan el QR (`pairMaxFails`), y el dueño compara.
- _QR_: un `qid` ajeno ya no consume el QR (antes cualquier `hello` falso lo quemaba: DoS de H8); solo un `hs3` correcto lo consume; un único intento de vinculación en curso; un fallo cuenta solo si el canal llegó a abrirse.
- _Fallos sin prueba no borran nada en el celular_: `auth-failed` sin `proof`, `signal-error invalid` y `bye revoked` previo a la prueba son inyectables por un intermediario; el celular muestra «No se pudo verificar tu Mac» o
  «Tu Mac no reconoció este celular» con «Reintentar»/«Olvidar vinculación», y solo borra sus credenciales ante una prueba válida (`expired` con `proof`, `bye revoked` tras verificar).
- _Versión_: `PROTOCOL_VERSION = 3`; una pestaña anterior recibe `error{code:'version'}` y se recarga sola UNA vez (marca en `sessionStorage`); las anteriores a esta versión no saben recargarse y muestran
  «Versión incompatible» (recargar a mano una vez). No se mantiene la vía antigua: no hay degradación posible.

**Confirmación por conexión opcional.** Con el handshake ligado a las huellas, para un dispositivo ya vinculado **con PIN** el Mac deja de pedir «Permitir» en cada conexión. Queda el ajuste «Pedir confirmación en el Mac en cada
conexión» (apagado por defecto, `devices-store` → `remote.bin`) y la política `requireConnectionConfirm` de `managed.json`. Se conservan la confirmación de la vinculación (siempre), el PIN (5 fallos revocan), el bloqueo por
inactividad, la caducidad, la revocación y la auditoría `connected`; un dispositivo sin PIN siempre confirma. Detalle y pruebas en §3 vicies quater y §3 vicies sexies.

**Auditoría**: `auth-bad-proof` («intento de conexión sin la clave correcta, posible intermediario») con la huella del `deviceId` que dijo ser; nunca secretos ni claves.

**Qué NO cubre (riesgo residual documentado).**

- _Solo red local_: el servidor se liga a la IP privada y no hay STUN/TURN; fuera de casa hace falta la fase 2 (`docs/REMOTO-FASE2.md`). El handshake no depende del transporte: un Worker de señalización o un relé TURN
  comprometido es un «intermediario» más y queda cubierto porque no tiene `K`; `qid` sirve de identificador de sala (el Worker nunca ve `q`). Con la PWA en otro origen el Mac tendrá que aceptar `v` N y N-1.
- _Código de la página alterado al cargarla_: la PWA se sirve por HTTP; `index.html`/`entry.json` van con `no-store`, pero un intermediario activo justo cuando el celular abre la página puede servir JavaScript propio
  en el mismo origen, que lee el secreto de `localStorage` y captura el PIN mientras se escribe. Ningún protocolo dentro de la página lo evita (y la confirmación por conexión tampoco: el atacante usaría la
  conexión legítima del dueño). Solo lo arregla el HTTPS de la fase 2.
- _Celular comprometido o desbloqueado_ con la página abierta y actividad de menos de 5 min: entra sin PIN (reconexión «en caliente»); la política `requirePin:true` lo cierra.
- _`remote.bin` descifrado_: el hash del secreto es ahora material de clave (ver §3 vicies sexies).
- _Secretos capturados antes de esta versión_ (por la vía antigua) siguen siendo válidos, porque la clave se deriva del mismo secreto: si preocupa, «Quitar todos» y volver a vincular una vez.
- _`sdpFingerprintStrict` ante navegadores raros_: si un navegador pusiera varias huellas distintas o no `sha-256`, la conexión se rechaza (falla cerrado); probado con los SDP de libdatachannel, **pendiente de
  la prueba manual con un iPhone/navegador real** (paso 1 de `docs/REMOTO-PRUEBA-MANUAL.md`).

**Numeración de esta sección.** Desde F8-B66 las secciones del remoto van en orden y sin duplicados: B53 = «3 vicies bis», B54 = «3 vicies ter» (proxy), B55 = «3 vicies quater» (confirmación/PIN), B56 = «3 vicies quinquies» (PWA),
B57 = «3 vicies sexies» (caducidad y política), B58 = «3 vicies septies», B59 = «3 vicies octies», B60 = «3 vicies novies», B66 = esta. Las entradas de `CHANGELOG-FASE8.md` anteriores a F8-B66 que citan «vicies ter/quater/quinquies»
usan los nombres antiguos (B55 se llamaba «vicies ter», B57 «vicies quater», B58–B60 «vicies quinquies»).

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
  de `node-pty` cargue bajo hardened runtime). Los binarios embebidos `cu-helper` y `lazunox-disclaim`
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
  bash por el plugin `lazunox-env`). Otro proceso del mismo usuario **sin sandbox** (p. ej. el bash
  del modo Code) podría leer ese entorno (`ps eww`) y llamar al MCP. Mitigación futura: verificar el
  PID del cliente TCP (que sea descendiente del servidor de acceso total) o un canal por socket Unix.
- El `cu-helper` no es un bundle con identidad propia (lección 7): los permisos siguen siendo de
  Lazunox.app.
- ✅ **Corregido** — El PTY de la terminal integrada ya no hereda los permisos de Lazunox: se lanza
  con `lazunox-disclaim` igual que los `opencode serve` (`src/main/pty/service.ts`, §3 arriba).
- Sin Developer ID + hardened runtime + notarización configurados (ver `docs/DISTRIBUCION.md`): cada
  build ad-hoc cambia la identidad y macOS olvida los permisos concedidos. La config ya soporta
  ambos casos (`electron-builder.js` + `build/notarize.js`); falta que el usuario aporte su propio
  Developer ID Application.
- **Control remoto (F8-B66)**: la PWA se sirve por HTTP en la LAN, así que un intermediario activo justo cuando el celular abre la página puede servir código propio (leer el secreto, capturar el PIN); el handshake v3 protege la
  conexión, no el código de la página. Solo lo arregla el HTTPS de la fase 2 (`docs/REMOTO-FASE2.md`). Mientras tanto la LAN es un requisito de confianza: no usar el control remoto en redes públicas o de invitados. Ver §3 tricies.

## 3 tricies bis. Arreglos de la auditoría del control remoto (F8-B67)

Auditoría de solo lectura del 2026-10-03 sobre el remoto v3; aquí los hallazgos corregidos (cada uno con una prueba que reproduce el ataque y fallaba antes del arreglo).

- **Archivos sensibles en todas las lecturas (hallazgo 1).** `isSensitiveEither` ya no solo cubre `/file/content`, `/file`, `/find*` y adjuntos: también `tasks:previewFile`, `git:diff` con `path`
  (rechazo `sensitive-file`, por nombre léxico y real), y los diffs se filtran **por nombre de archivo** en las respuestas de `git:diff`, `GET /vcs/diff`, `/vcs/diff/raw` (por bloques del diff),
  `/session/{id}/diff`, `/file/status`, `/vcs/status`, `summary.diffs` de los mensajes y el evento `session.diff` (`diff-filter.ts`). Lista ampliada: `.envrc`, `.env-*`, `.env_*`, `*.tfvars` (`.json`), `.vault*`.
  Límite: lo que el agente lea con una herramienta (`cat .env` en `bash`) sigue pudiendo salir en el texto de los mensajes (hallazgo 2).
- **Confirmaciones que muestran lo que se aprueba (hallazgo 5).** El detalle del diálogo incluye los `patrones` de `tasks:rules:add`, el comando/rutas/patrones del permiso (aprendidos del motor) en
  `POST /permission/.../reply`, el conjunto `permission` de `POST`/`PATCH /session`, prompt y horario de `routines:save` y el contenido de AGENTS.md, memoria e instrucciones. Todo texto del celular pasa por
  `confirm-detail.ts`: sin saltos ni caracteres de control/dirección, sin secretos (`redact-patterns`), máx. 240 caracteres por línea y 12 líneas (resumen «… (+N)»); la cola lo aplica otra vez (doble red).
- **Rutas fuera del ámbito en canales R (hallazgo 9).** `settings:get` (sin `opencodeBin`; `recentFolders` solo del ámbito), `tasks:trusted:list` (solo del ámbito) y `tasks:policy` (sin `source` ni
  `allowedFolderRoots`) usan el mismo recorte que `settings:changed`; `sanitizeResult` recibe el predicado de ámbito y, sin él, cierra por defecto.
- **Acciones M acotadas y con rastro (hallazgo 10).** `git:createWorktree` pasa a **X** (creaba `../.repo-worktrees/` fuera del proyecto; el celular no lo usa). `routines:delete`, `routines:toggle` (apagar),
  `tasks:tasks:forget` y `tasks:restore:forget` exigen que la carpeta de la rutina/tarea esté en el ámbito (el despachador la averigua con `routines:list`/`tasks:tasks:list`; desconocida = `scope-unknown`).
  **Toda acción M ejecutada** (IPC o HTTP) deja `action-run` en `remote-audit.jsonl` con canal (plantilla de ruta, sin ids) y clase, dispositivo y nombre; nunca payload. Ojo: ocupa espacio del registro rotativo.
- **Una aprobación, una ejecución (hallazgo 7).** Una llamada D idéntica a otra pendiente ya no se une a ella: responde `busy`. El digest de lo aprobado se compara con el de lo que de verdad se ejecuta
  (IPC: el payload ya validado por el esquema en `authorize`, de un solo uso; HTTP: método, ruta, query y cuerpo enviados al motor frente a una copia tomada al pedir la confirmación); si difiere, `digest-mismatch`.
- **Documentación (hallazgo 12).** §3 vicies queda marcada como histórica y corregida (lista blanca v1, «nunca rutas absolutas», tabla de amenazas) y `REMOTO-FASE2.md` ya no dice que el secreto esté en `IndexedDB`
  (hoy `localStorage`; `IndexedDB` es el plan de la fase 2).

**Pendiente (no tocado aquí).** Hallazgo 2 (resuelto en §3 tricies quinquies, F8-B74), 3 (bloqueo no corta suscripciones abiertas), 4 (resuelto por el
protocolo v3 para la reconexión; el código de 6 dígitos queda con compromiso previo), 6 («Cortar todo» no borra confianza/actividad), 8 (DoS de vinculación en LAN) y 11 (`devices.touch` antes del PIN).

## 3 tricies ter. Navegador integrado: SSRF local, puerta de aprobación, portapapeles y «Abrir en el editor» (F8-B68)

Revisión externa de 4 hallazgos, verificados leyendo el código. Los cuatro eran reales (ninguno descartado).

1. **SSRF local (ALTO)**. `isLoopbackOrPrivateHost` solo miraba IPv4 textual, `localhost` y `::1`. Ahora clasifica por la IP real (`embedded-browser/ip-class.ts`):
   IPv6 mapeada (`::ffff:7f00:1`), «compatible», NAT64 y 6to4 se desmapean; loopback, privadas, link-local (incluye 169.254.169.254), CGNAT, `0.0.0.0/8`, ULA `fc00::/7`,
   `fe80::/10`, site-local, multicast y reservadas cuentan como locales; `*.localhost`/`.local`/`.internal`/`.lan` y el punto final (`localhost.`) también. Las notaciones
   decimal/octal/hexadecimal de IPv4 (`2130706433`, `0x7f.1`) ya las normaliza `new URL()`; se cubren además en la función exportada. **Anti-rebinding**: en `webRequest`,
   un subrecurso/subframe hacia un NOMBRE cuyo DNS resuelve a una IP local se cancela salvo que su origen esté aprobado con «Permitir siempre» (caché de 3 s, tope de
   2,5 s; falla abierta si no resuelve). Límite conocido: la resolución de Node y la de Chromium son independientes (TOCTOU), así que reduce la ventana, no la elimina; el
   frame principal sigue sin comprobación DNS (lo elige el usuario/agente tras la puerta, y desde ahí sus subrecursos locales se bloquean).
2. **`window.open` y bypass (MEDIO)**. `window.open`/`target=_blank` cargaban el destino con `loadURL` directo (sin `will-navigate`), saltando la puerta; y `bypassOnce` era un
   interruptor por pestaña (toda la carga, o 2 s en atrás/adelante) que dejaba pasar redirecciones a otro destino. Ahora la pestaña nueva se abre vacía y emite
   `open-request`; `service.ts` la manda a `resolveNavigationApproval` (misma puerta que cualquier navegación). La exención (`nav-bypass.ts`) es por URL EXACTA, de un solo
   uso y por pestaña; atrás/adelante/recargar eximen solo la URL de la entrada de destino, 2 s. Una redirección del servidor a otro destino vuelve a pasar por la puerta
   (`ERR_ABORTED` del `loadURL` original se ignora porque la puerta relanza la navegación). Pendiente: prueba manual en la app (no se abrió Electron).
3. **`clipboard-sanitized-write` (MEDIO)**. Se concedía a cualquier origen. `permissionOriginOk` exige origen https (o http local), igual al de la página de nivel
   superior, frame principal; `file:`, `data:`, `about:blank`, opacos, otros orígenes y subframes se deniegan, tanto en el handler de petición como en el de comprobación.
4. **`dialog:openInEditor` (MEDIO)**. Solo comprobaba que la ruta existiera: podía lanzar un `.app`/ejecutable por el respaldo `open`. Ahora hace `realpath` (los enlaces
   simbólicos hacia fuera se rechazan), exige que la ruta esté dentro del proyecto activo de la ventana (`hub.isActive`) o de una carpeta reciente, y aplica
   `assertSafeToOpen` antes de los respaldos `open`/`shell.openPath` (VS Code sí puede abrir un script como texto). Pruebas: `dialog/service.test.ts`.

## 3 tricies quater. Tareas, MCP y credenciales: 6 hallazgos de la revisión externa (F8-B69)

Verificados leyendo el código; cinco eran reales y uno se resuelve solo en parte (el 6).

- **5. `mcp:getConfig` devolvía secretos (real, MEDIO).** `maskAppMcpConfig` (`extras/mcp-config.ts`) sustituye TODOS los valores de `headers` y `environment` por `MCP_VALUE_MASK` (`shared/mcp-catalog.ts`)
  en `mcp:getConfig` y en lo que devuelve/emite `afterMcpChange` (`mcp:save|remove|setEnabled|installCatalog`, evento `mcp:changed`). Al guardar, un valor igual al marcador significa «sin cambios»: `saveMcpServer`
  restituye el secreto guardado del mismo servidor (`previousName ?? name`, así renombrar lo conserva); un marcador sin secreto previo se descarta. El formulario del renderer no cambió: muestra `CLAVE=••••••••`.
  Límite: `client.config.get` del motor OpenCode (otro camino, fuera de la app) puede devolver la config fusionada con sus valores.
- **6. Tokens en el entorno del sandbox (real, MEDIO; CERRADO para el sandbox en F8-B79, ver §3 tricies sexies).** `OPENCODE_CONFIG_CONTENT` llevaba las cabeceras del MCP del navegador y de los MCP del usuario en el entorno de
  `opencode serve`, legible con `ps eww` desde el sandbox (el perfil Seatbelt no puede impedirlo: F8-B75). Primera mitigación (F8-B69): el token del navegador es por servidor y se revoca al terminar. Cierre real (F8-B79): un proxy MCP
  local fuera del sandbox pone las cabeceras; el servidor sandboxeado solo recibe una URL loopback y un token de sesión. Queda abierto lo que se explica allí (MCP locales con secretos, `command`/`cwd`, Control total).
- **7. `setHost`/`allowOnce` (real, BAJO).** `tasks/host-rules.ts` (`parseEgressHost`): minúsculas, sin punto final, etiquetas válidas, al menos dos etiquetas (rechaza `com`, `io`, `localhost`), sin sufijos públicos
  habituales (`co.uk`, `github.io`…), un único `*.` inicial y solo seguido de un dominio completo, sin IP locales/privadas ni notaciones raras (`2130706433`) ni `.local`/`.internal`. Se aplica a `allow` y a `allowOnce`;
  `block`/`unset` aceptan una forma sana para poder retirar entradas heredadas. Las rutinas llaman al gestor directamente (no pasan por el IPC).
- **8. `pty:create` (real, BAJO).** `shell` solo vale si es absoluta, sin `..`, con nombre de la lista cerrada (`sh bash zsh fish dash ksh tcsh csh nu pwsh`; en Windows `pwsh/powershell/cmd/bash/wsl .exe`) y, en macOS/Linux,
  listada en `/etc/shells` o en un directorio de sistema/gestor de paquetes (`ipc/pty-shell.ts`). `cwd` es absoluto y sin `..`. No se acota a «carpetas aprobadas»: la terminal de Code abre el proyecto que la
  persona eligió y no existe un ámbito de Tareas para él.
- **9. `CredentialProxy` y `..` (real, BAJO).** `safeUpstreamRest` (`tasks/proxy.ts`) rechaza `.`/`..` (también `%2e`), `\`, `//`, `%2f`/`%5c`/`%25` (doble codificación), bytes de control, `#` y un resto que no empiece por
  `/` o `?` (antes `/<token>x` pasaba el prefijo); además comprueba que el destino final siga en el origen y bajo el prefijo de la API. Responde 400.
- **10. Token del MCP del navegador (real, BAJO).** Nunca se revocaba: `revokeToken`, sustitución por atadura y `knownTokens()` en `embedded-browser/mcp-server.ts`. El redactor de Diagnóstico oculta los tokens emitidos
  (secretos exactos, `extraSecrets`) y todo token de 43 caracteres base64url aunque no tenga cifras.
- Pruebas: `tasks/proxy.path.test.ts`, `tasks/host-rules.test.ts`, `ipc/pty-shell.test.ts`, `extras/mcp-config.mask.test.ts`, `embedded-browser/mcp-server.token.test.ts`, `diagnostics/redact.test.ts`.

### Tareas: `process-info*` denegado hacia otros procesos (F8-B75, autorizado por el dueño)

- **Cambio (solo añade).** `sandbox-profile.ts` añade `(deny process-info*)` + `(allow process-info* (target self))` (la forma de los perfiles del sistema; `(deny process-info* (target others))` se acepta pero NO se aplica). Con el sandbox real (`sandbox-exec`), `proc_pidpath`/`proc_pidinfo` de OTRO proceso devuelven 0 y los del propio siguen. Prueba: `tasks/sandbox-profile.procinfo.test.ts` (rojo antes, verde después); el snapshot de `sandbox-profile.test.ts` solo gana esas 5 líneas por perfil.
- **Límite verificado, NO cerrado: `ps eww` / `ps -E` / `sysctl(KERN_PROCARGS2)`.** En esta macOS (Darwin 27) esa lectura de argumentos y entorno de otro proceso del mismo usuario no pasa por ninguna operación Seatbelt: se probó `(allow default)(deny X)` con `process-info*` (todas las formas), `sysctl*`/`sysctl-read` (con `sysctl-name "kern.procargs2"` también), `signal`, `mach*`, `ipc*`, `system*`, `iokit*`, `process-codesigning*`, `job-creation`, `file-ioctl`… y un proceso sandboxeado siguió leyendo el `TOKEN` en el entorno ajeno (los binarios restringidos por SIP, como `/bin/sleep`, no muestran entorno ni sin sandbox). Por tanto el perfil NO puede cerrar el hallazgo 6: lo cerró F8-B79 quitando los secretos de ese entorno (proxy MCP local, §3 tricies sexies). `/proc` no existe en macOS.
- **Efectos secundarios.** `lsof -p <otro>`, `top`/`vmmap`/`sample` sobre otros procesos dejan de ver datos de libproc; `ps` sobre el propio proceso y la lista (`KERN_PROC_ALL`) no dependen de esto. Verificado: `opencode --version`, `opencode serve --port <p>` (HOME/XDG aislados, contraseña aleatoria: health 200 con auth y 401 sin ella, cero huérfanos), `bash`, `git`, `node`, `python3`. NO se pudo ejecutar `/bin/ps` dentro del sandbox anidado de la sesión de pruebas (el arnés lo impide), así que `ps`/`pkill` bajo el perfil nuevo deben probarse a mano.

## 3 tricies quinquies. Aprobar comandos desde el celular (F8-B74, hallazgo 2 de la auditoría del remoto)

**Problema.** Responder «una vez» a un permiso `bash` o `edit` desde el celular era clase M (sin confirmar en el Mac) y el agente `build` está admitido: un celular desbloqueado
podía pedir «ejecuta `cat ~/.ssh/id_rsa`» y aprobarlo él mismo, saltándose el ámbito, `path-guard` y la lista de archivos sensibles (la salida vuelve por SSE).

**Diseño (decidido por el dueño).**

- **Ajuste por dispositivo `canApproveCommands`, apagado por defecto** (`devices-store.ts`; los vínculos de `remote.bin` anteriores, o con un valor que no sea `true` exacto, se leen como apagado y el archivo no se reescribe).
  Con él apagado, `permission.reply «once»` de `bash`, `edit`, `external_directory`, `webfetch`, `task` y de Control del Mac es **clase D**: el Mac muestra el comando o la ruta exactos (los que pidió el motor, con
  `confirm-detail`: sin saltos ni secretos y, en líneas largas, el principio y el final para que el recorte no esconda lo último). `reject` sigue siendo M; `always`, nunca.
- **Encenderlo exige una confirmación EN EL MAC**: diálogo nativo propio (`remote-handlers.ts`, es/en: «este celular podrá aprobar comandos y ediciones del agente mientras estés fuera»; «Cancelar» por defecto y con Esc) que
  ninguna página puede pulsar. Sin diálogo, con error o rechazado, queda apagado. `remote:setApproveCommands` es X para el celular: no puede encenderlo. Se apaga desde Ajustes › Celular (interruptor por dispositivo, con
  etiqueta accesible, estado `aria-live` y un aviso fijo mientras haya alguno encendido) o con «Cortar todo» (`stopAll` también lo apaga). Auditoría: `approve-enabled`, `approve-disabled`.
- **Con él encendido**, `bash`/`edit` «una vez» se aprueban desde el celular SOLO si pasan la **lista de denegación** (`command-denylist.ts`), evaluada en el Mac sobre el texto REAL del permiso: los `patterns` y el
  `metadata.command/filepath` que el motor anunció (`EngineKnowledge.permissionText`), nunca algo que mande el celular. Lo que coincida, o si no hay texto, o es demasiado largo (> 2000 car.), es D. `external_directory`,
  `webfetch`, `task` y Control del Mac siguen siendo D aunque el ajuste esté encendido.
  Cubre: `sudo`/`su`/`doas`, `rm` recursivo o `rmdir` fuera del directorio de la sesión (o del propio directorio), `curl|wget … | sh|bash|zsh` y cualquier tubería hacia un intérprete (`python`, `node`, `perl`…), `curl/wget` que suben datos,
  `ssh`/`scp`/`sftp`, `rsync` a hosts, `git push`, `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/Library/Keychains` (y `.kube`, `.docker`, claves `id_*`, `.netrc`, `authorized_keys`, `LaunchAgents`, `.zshrc`…), `security`, `osascript`,
  `launchctl`, `defaults write`, `chmod -R`/`chown -R`, `dd`, `diskutil`, `mkfs*`, `crontab`, `eval`/`source`, shells (`bash -c`), `node -e`/`python -c`, `find -exec/-delete`, `xargs` con comandos destructivos, redirecciones y rutas absolutas,
  `~` o `..` fuera del directorio de la sesión (con `realpath`, así un enlace simbólico que sale cuenta como fuera) y archivos sensibles por nombre (`.env`, claves…). Variantes ofuscadas: comillas partidas (`s"u"do`), `\`, variables (`${X}do`),
  `$()`, comillas inversas, `$'…'`, llaves (`{su,do}`), comodines en el nombre, sustituciones de procesos y caracteres de control **se deniegan en bloque**; base64 en tubería hacia un shell queda cubierto por «tubería a intérprete». El nombre
  del comando se compara en minúsculas (APFS no distingue mayúsculas). Una edición debe quedar estrictamente dentro del directorio de la sesión, sin comodines y sin archivo sensible.
- **Límite de 20 aprobaciones por celular y hora** (`approval-limit.ts`, ventana deslizante en memoria). Pasado el tope la aprobación se trata como D (el Mac pregunta). Cada aprobación ejecutada sin confirmar deja `approve-command` en
  `remote-audit.jsonl` con canal (plantilla de ruta), clase M, dispositivo y nombre, **nunca el texto del comando**.
- **El celular enseña el comando completo antes de aprobar**: la tarjeta de permiso de la PWA muestra `metadata.command` íntegro (con desplazamiento, sin recorte) y, en el celular, también los `patterns` que difieran de él; para una edición, la ruta y el diff.

**Límites reconocidos (lo que esto NO es).** La lista de denegación es una **heurística, no un límite de seguridad**: un comando que deja pasar (`npm run x`, `make`, `./script.sh`, `git commit` con ganchos, `python script.py`) ejecuta lo que el proyecto
defina, y siempre habrá una forma que nadie previó. El límite real es: el ajuste apagado por defecto, la confirmación en el Mac para encenderlo, el ámbito de carpetas, el tope por hora, la auditoría y «Cortar todo». Ante la duda, D (se prefiere un
falso positivo —el Mac pregunta— a uno negativo). El diálogo del Mac recorta cada línea a 240 caracteres (principio y final); un comando más largo muestra `…` en medio. Un celular apagado/desconectado no puede responder a una confirmación D (caduca a los 90 s y se rechaza).

**Pruebas** (todas fallaban antes del arreglo): `engine-proxy.test.ts` («hallazgo 2»: el ataque `cat ~/.ssh/id_rsa` con el ajuste apagado, `sudo`, `rm -rf ~`, `curl x | sh`, variantes ofuscadas, tope por hora, texto del motor y no del celular, ajuste no
encendible desde el celular, auditoría sin el texto), `command-denylist.test.ts` (120 casos), `policy.test.ts`, `devices-store.test.ts` (migración de `remote.bin`), `service-access.test.ts` (diálogo, rechazo, «Cortar todo»), `MobileCode.render.test.tsx` (comando completo).

## 3 tricies sexies. Proxy local de MCP fuera del sandbox de Tareas (F8-B79, cierre del hallazgo 6)

**Problema (verificado con el sandbox real).** El agente de una Tarea, dentro de Seatbelt, lee el `environ` de `opencode serve` con `ps eww` / `sysctl kern.procargs2` (F8-B75: ninguna regla de Seatbelt lo impide), y ahí vivían el token del MCP del
navegador y los tokens estáticos de los MCP del usuario (`OPENCODE_CONFIG_CONTENT`).

**Diseño** (`tasks/mcp-proxy.ts`, análogo al `CredentialProxy` de la clave del proveedor). Cada servidor sandboxeado tiene su `McpProxy` en main (fuera del sandbox), en `127.0.0.1` con puerto aleatorio. La configuración MCP del servidor lleva solo
`http://127.0.0.1:<puerto><ruta>` y `Authorization: Bearer <token de sesión>`; el proxy QUITA esa cabecera y pone las reales al reenviar. Los secretos reales (token del navegador, cabeceras y credenciales de URL de los MCP remotos) no llegan al entorno, a los
argumentos ni a la configuración del proceso. El único puerto MCP que Seatbelt abre es el del proxy: el del MCP del navegador integrado ya no se abre (`extraOutboundPorts`).

- **Token de sesión**: 32 bytes aleatorios por servidor MCP (alcance mínimo: sirve para ese destino y nada más), comparado en tiempo constante (hashes de longitud fija contra todas las rutas, sin salir antes), caduca a las 12 h, se revoca con `revokeRoute` y al
  apagar el proxy; 401 idéntico para ausente/erróneo/caducado/revocado. El proxy vive lo que el proceso: `onExit` y el fallo de arranque lo apagan (`manager.ts`), igual que la revocación del token real del navegador.
- **Destinos en lista cerrada**: el origen sale solo de la ruta registrada por main; el cliente nunca elige host (forma absoluta, `*` → 400). Rutas normalizadas con `safeUpstreamRest` (`..`, `.`, `//`, `\`, `%2f/%5c/%25`, `#`, controles → 400). **No se siguen redirecciones**
  (un 3xx del destino → 502 y sin `location`). Solo `Host` propio (anti rebinding), nunca `Origin`, solo GET/POST/DELETE. Cabeceras del cliente y de la respuesta en lista cerrada (sin cookies). La consulta registrada de la URL (claves en `?key=`) se aplica en el destino y no se expone.
- **Límites**: cuerpo 8 MB (413), 32 peticiones simultáneas y 16 por ruta (429), 120 s hasta las cabeceras (504), 15 min de inactividad de un flujo SSE. Sin secretos en registros (solo nombre de ruta y estado); los tokens de sesión se añaden al redactor de Diagnóstico (`knownMcpProxyTokens`; además
  los cubre la regla de 43 caracteres base64url). `stop()` cierra servidor, conexiones y peticiones al destino y olvida las rutas.
- **MCP remotos con cabeceras** → por el proxy (también con `oauth` sin campos secretos: `clientSecret` y similares se quitan de la config del sandbox). Su host deja de entrar en la red del sandbox (antes sí). Los remotos sin cabeceras no tienen secretos y siguen directos por el proxy de salida.
- **MCP locales (stdio) con `environment` secreto: NO entran en el sandbox** (falla cerrado, aviso en Ajustes › MCP y registro). Lanzarlos fuera del sandbox detrás del proxy exigiría un puente stdio→HTTP en main y ejecutar código de terceros SIN Seatbelt (más permisos que hoy):
  se descartó por debilitar el aislamiento. Quien los necesite usa Control total. Los locales sin variables siguen como antes.
- **Navegador integrado**: su MCP va por el proxy con el token real inyectado; el servidor MCP del navegador no cambia (`embedded-browser/mcp-server.ts` intacto) y el plugin `lazunox-session` sigue inyectando `lazunox_session`.

**Pruebas** (`mcp-proxy.test.ts`, `mcp-tasks.sandbox.test.ts`, `mcp-proxy.real.test.ts`): el secreto real llega al servidor MCP simulado y el de sesión no; el token no sirve para otro servidor, ni caducado, ni revocado, ni tras `stop()`; `../`, `//`, `%2f`, forma absoluta, `Host`/`Origin`
ajenos y métodos raros se rechazan; las redirecciones no se siguen (el otro servidor no recibe nada); límites (413/429/504); redactor. **`ps eww` real**: el control (config sin proxy, comportamiento anterior) SÍ revela los secretos —prueba del ataque— y con el proxy no aparece ninguno.
**Sandbox y OpenCode reales, sin modelos** (`startTasksServer`, opencode 1.18.33, HOME/XDG aislados): el `ps eww` del `opencode serve` real no contiene los secretos ni el puerto real de los MCP; `GET /mcp` del servidor sandboxeado da `connected` para el navegador y un MCP de usuario a través del proxy y el
servidor simulado recibe solo el secreto real; dentro del mismo perfil de red, `curl` al puerto real de cada MCP falla (000) y al del proxy sin token válido da 401; al parar no quedan procesos (pid) ni puerto. El OpenCode se lanzó con `LAZUNOX_NO_DISCLAIM=1` y una carpeta de config vacía (el lanzador `lazunox-disclaim` y la
instalación del plugin por red no funcionan bajo el arnés de pruebas y son ajenos a esto).

**Límites que siguen (no se disimulan).**

- El token de sesión SÍ es legible por el agente (está en el entorno de `opencode serve`) y sirve contra el proxy mientras el servidor viva: el agente puede llamar a esos MCP con `curl` saltándose «Preguntar en cada uso», que es un permiso de OpenCode, no del proxy. Antes podía lo mismo con el token real y
  además usarlo desde cualquier sitio y para siempre; ahora el alcance es un solo servidor MCP, solo mientras vive el servidor de la Tarea (y ≤ 12 h). Lo mismo ocurre con el token del `CredentialProxy` en el `baseURL` del proveedor.
- `OPENCODE_SERVER_PASSWORD` sigue en ese entorno: da acceso al propio servidor sandboxeado (el mismo agente), no a nada de fuera.
- Secretos puestos por el usuario en `command` (p. ej. `--token xyz`) o `cwd` de un MCP local no se detectan: siguen yendo al proceso.
- Servidor remoto con SSE antiguo que anuncie un `endpoint` en forma ABSOLUTA (otro host): el cliente iría directo por la red de salida sin credenciales y fallaría; el transporte HTTP en streaming y el SSE con ruta relativa funcionan (la ruta del destino se conserva en el proxy).
- Un MCP remoto configurado por el usuario hacia un host local/privado se alcanza tal cual (es el destino que él eligió); el proxy no filtra por IP, solo por la lista cerrada de rutas registradas.
- **Control total** (sin sandbox) NO cambia: su config inline sigue llevando las cabeceras y el token del MCP de Control del Mac en `OPENCODE_CONFIG_CONTENT` (ver §5); allí no hay aislamiento que proteger.
- Pendiente de prueba manual del dueño (no se abrió Electron): ver el informe de F8-B79 en `CHANGELOG-FASE8.md`.

## 3 tricies septies. Control remoto fuera de casa, entrega 1 (F8-B77)

**Qué es.** El modo «También fuera de casa» de Ajustes › Celular. Se elige con un selector («Solo esta red» por defecto; no cambia nada para quien no lo active). Con él, la
señalización WebRTC (SDP/ICE) pasa por un servicio de conexión en Cloudflare Workers (`https://remoto.onyxcode.cl`, `cloud/remoto-worker/`) y la página del celular se sirve por HTTPS desde
ese mismo origen. Los datos viajan por el DataChannel directo (STUN siempre); el relé (TURN) está implementado pero **apagado por defecto** y sin secretos. El Mac sigue siendo el único
punto de confianza y **no abre ningún puerto**: sale hacia fuera con un WebSocket. Passkeys y avisos push NO están en esta entrega (siguientes entregas; ver `docs/REMOTO-FASE2.md`).

**Autenticación: sin cambios de algoritmo.** El handshake v3 (`hs1/hs2/hs3`, HMAC ligado a las huellas DTLS, etiqueta `lazunox-auth-v3`) es el mismo. Con el renombre total (0.5.0) las etiquetas y la sal pasaron a `lazunox/remote/v3`, `lazunox-auth-v3` y `lazunox-sas-v3` (D5): los celulares vinculados con una versión anterior no se reconocen y hay que vincularlos de nuevo (el Llavero y `remote.bin` también empiezan de cero con la identidad nueva). El protocolo pasa a **v4** y el Mac acepta v3 y v4
(`MIN_PROTOCOL_VERSION = 3`): v4 añade `caps` en `authed`/`pair-pending`, `room` en `paired`, `b` (id de compilación, solo diagnóstico) en `hs1`, la trama de señalización `turn`, los códigos
`host-offline`/`rate` y la trama `entry`. A un celular v3 el Mac le habla exactamente como antes (sin `caps` ni `room`). El servicio y los relés son «intermediarios»: no tienen `K` ni `q`, así que
no pueden hacerse pasar por el Mac ni por el celular (las huellas DTLS que ve cada pila no cuadrarían). Pueden negar el servicio, ver metadatos y tirar o retrasar tramas.

**Salas.** Una sala por Mac: `room = b64u(sha256(hostToken))`. Solo quien presenta `hostToken` (32 B en `remote.bin`, cifrado; cabecera `x-lazunox-host`, nunca en la URL) puede hacer de Mac en ella; un host
nuevo sustituye al anterior. El celular solo conoce `room` (se la da el Mac al vincular, por el canal ya autenticado: `paired{room}`). La vinculación usa una **sala efímera** distinta
(`pairHostToken(q)`, derivada de `q` con HKDF, de modo que el servicio no puede derivar `q` ni el `qid`) que solo existe mientras el QR vale (120 s); un `hello` solo vale por SU sala (resume por la sala
de vinculación, o pair por la del Mac, se rechaza sin gastar el QR). «Quitar todos» renueva `hostToken` (la dirección anterior deja de contestar y el Mac reabre con la nueva).

**Código de vinculación.** En el modo nube el QR lleva `#c=XXXX-XXXX-XXXX-XXXX` (16 caracteres Crockford = 80 bits; el fragmento no se envía a ningún servidor) y el mismo código se puede **escribir**
(en iOS la app instalada tiene almacenamiento aparte de Safari). `q = HKDF(código, …, "pair-code")`; el código de 6 dígitos comparado en los dos aparatos y la confirmación en el Mac siguen igual.
80 bits frente a un atacante que solo vive 120 s en una sala que no puede ver: la fuerza bruta es inviable; si el QR se fotografía, el código de 6 dígitos con compromiso previo sigue delatando al intermediario.

**Lo que el HTTPS arregla y lo que introduce.** Arregla: por HTTP en la Wi-Fi un intermediario activo servía su propio JS (leía el secreto de `localStorage` y capturaba el PIN). Introduce: **el código lo sirve un
tercero**; quien controle el despliegue (cuenta de Cloudflare, la máquina desde la que se publica o Cloudflare mismo) controla el JS que ve el PIN y usa la clave del vínculo. Es la raíz de confianza de la
PWA y no se puede eliminar desde dentro de la página. Defensas, por valor real:

1. **Menos que robar**: en HTTPS la clave del vínculo es un `CryptoKey` HKDF→HMAC **no exportable** en IndexedDB (`pwa/src/keys.ts`, `store.ts`; el secreto en claro se olvida tras importarlo). Un script malicioso puede
   **usarla** con la página abierta, no llevársela. Todo lo clase D sigue confirmándose en el Mac. El PIN sí se puede capturar al escribirlo (por eso la passkey, en una entrega futura, se **suma** al PIN).
2. **Publicación endurecida**: el sitio se publica **solo desde el Mac del dueño** (`scripts/build-site.mjs` + `scripts/site-release.mjs`; nada de CI con secretos), 2FA en Cloudflare, sin tokens de API (`wrangler login`).
3. **Vigilancia desde el Mac** (`site-watch.ts`): el dueño firma `site-manifest.json` con una clave Ed25519 que no está en CI ni en Cloudflare (`SITE_PUBLIC_KEY`/`SITE_KEY_ID` en `brand.ts`, vacías hasta que el dueño
   ponga la suya). Al activar la nube y cada 6 h el Mac verifica la firma **sobre los bytes exactos antes de leer el JSON**, la versión mínima (`seq`, sin retrocesos), la clave nombrada, el sha256 de cada archivo del
   arranque (`index.html`, `sw.js`, `manifest.webmanifest`, el JS/CSS que enlaza) y que la CSP de `index.html` sea la firmada. Si no cuadra: auditoría `site-mismatch`, aviso rojo en Ajustes y el modo nube **se pausa**
   (el socket saliente se cierra; la red local sigue). Sin clave configurada o sin red queda «sin verificar» y la nube funciona (un fallo de red no es una prueba de manipulación).
4. **SRI para la interfaz completa**: tras `unlocked` el Mac manda `entry{v, js, files:[{p, sri}]}` (sha384 calculado en el Mac desde su `pwa/dist/app`) y la página carga la interfaz con `integrity`. Sirve para la
   **coherencia de versión** (la interfaz llama a canales IPC de la versión del Mac), contra corrupción y caché; **no** protege de un arranque malicioso (podría ignorarlo). Los trozos dinámicos (`import()`) no llevan SRI. El sitio
   publica la unión de los `app/assets` de las últimas 10 versiones; **orden de publicación: primero el sitio, después la app** (`docs/DISTRIBUCION.md`). Un Mac sin la capacidad `entry` no recibe la interfaz a ciegas: queda la ligera.
5. **CSP estricta** en `_headers` (`default-src 'none'; script-src 'self'; connect-src 'self' wss://remoto.onyxcode.cl; worker-src 'self'; …`), `nosniff`, `no-referrer`, COOP `same-origin`, `Permissions-Policy` sin cámara/micrófono/geolocalización. Sin terceros.
6. **Organizaciones**: `allowOutsideNetwork`, `allowRelay`, `allowPush`, `requirePasskey` en `managed.json` (`docs/POLITICA-ORGANIZACION.md`): con archivo y la clave ausente, lo de «fuera de casa» queda **cerrado**;
   `allowOutsideNetwork:false` no abre ningún socket y corta el abierto al instante (`policy-blocked`).

**Lo que NO sirve (y no se construyó).** «Hash del código comprobado en el handshake»: la página informaría su propio hash y un arranque malicioso mentiría; `b` en `hs1` es solo diagnóstico, jamás un control. «Fijar la
versión con el service worker»: el navegador revisa `sw.js` en cada navegación y lo sustituye si cambia; un SW no puede impedir su propio reemplazo (por eso `sw.js` está en el manifiesto vigilado y el SW solo cachea).

**Service worker** (`pwa/public/sw.js`, 61 líneas): `index.html` red primero; `assets/*` y `app/assets/*` con huella, caché primero; nunca toca `/v1/*` ni otro origen; sin `push` (entrega 3). Una versión nueva se avisa («Hay una versión nueva»), no se impone.

**Abuso y denegación de servicio** (`RoomCore` y `routeEdge`, compartidos con el doble local; todo probado):

- Antes de despertar ninguna sala: nombre de sala de 43 car. base64url (si no, 404), `Origin` exactamente en `ALLOWED_ORIGINS` (si no, 403), host sin `Origin` (un navegador no puede hacer de Mac), límite por IP (binding de rate limiting + regla del panel; fallo cerrado).
- Por sala: ≤ 2 celulares a la vez (`busy`), ≤ 30 celulares/min (`rate`), ≤ 80 tramas y ≤ 60 s en señalización por celular, tramas ≤ 32 KiB, host «muerto» si el último `ping` respondido tiene > 150 s o si no contesta `ready`/`error` en 5 s (`host-offline`). El DO **no guarda nada**
  (sin `storage`, sin alarmas, sin `console`: una prueba lo vigila sobre el código fuente; `observability` apagada; los contadores viven en el adjunto del socket del host y sobreviven a la hibernación).
- TURN: solo tras `grant` del Mac (que lo manda después de que `authorize` aceptó el `hello` y solo si `allowRelay`), ≤ 20 `grant`/h por sala, credenciales de 8 h, `TURN_ENABLED` apagado por defecto, servidores validados (esquema `stun:`/`turn:`/`turns:` y host `*.cloudflare.com`);
  si falla o no hay secretos, todo sigue con STUN. `turn` llega antes de `ready` (el respondedor del Mac se crea al llegar la offer).
- Cuota gratuita compartida por todos los Macs: si se agota, la nube cae hasta el reinicio de las 00:00 UTC y **la red local sigue** (riesgo asumido y documentado; Workers de pago como salida).

**Reposo y red.** `powerMonitor`: `suspend` cierra el socket del Mac al instante (el servicio sabe enseguida que no contesta), `resume`/`unlock-screen` y los cambios de red reabren ya; reconexión con espera exponencial con azar (1…60 s) y ping de aplicación cada 60 s.
Con el Mac dormido o apagado no hay forma de despertarlo: el celular dice «Tu Mac no está disponible» (`host-offline`). «Disponible fuera de casa» es opcional (apagado por defecto): arranca el servicio al abrir la app sin QR y sin apagado por inactividad;
«Cortar todo» lo apaga; salir de la app, la política o la inactividad **no** lo apagan. El `rtc` espera 6 s antes de dar por muerta una conexión en `disconnected`.

**Privacidad: qué ve cada tercero.**

| Quién                                  | Ve                                                                                                                                                                                                                                                    | No ve                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Cloudflare (sitio)                     | IP y navegador del celular al cargar la página, hora                                                                                                                                                                                                  | Nada del vínculo (el código va en el fragmento `#c=`)                                       |
| Cloudflare (servicio de conexión)      | IP del Mac y del celular, horas y duración, `room` (seudónimo estable del Mac), `deviceId` del `hello`, SDP (candidatos ICE con IP privadas y públicas, huellas DTLS públicas), `qid` al vincular, `hostToken` (solo sirve para ser host de esa sala) | `q`, el código, el secreto de dispositivo, la clave, el PIN, cualquier dato de conversación |
| Cloudflare (STUN, y TURN si se activa) | IP de cada lado; con TURN, bytes y tiempos de una conexión cifrada por DTLS                                                                                                                                                                           | Contenido                                                                                   |

Sin cuentas ni correos; el servicio no registra nada propio. En la interfaz de la app el servicio se llama «servicio de conexión» (Cloudflare solo se nombra en esta documentación y en la de privacidad). Mejora opcional futura: cifrar el SDP extremo a extremo con una clave del vínculo para ocultar las IP privadas al servicio.

**Auditoría** (sin secretos): `cloud-started`, `connection-changed` (con `why: lan|cloud`), `away-enabled`, `away-disabled`, `site-mismatch` (con motivo fijo: `bad-signature`, `file-hash`, `file-missing`, `csp`, `rollback`, `key-id`, `no-manifest`, `no-signature`, `manifest-shape`), `site-restored`, `policy-blocked`.
Los canales `remote:setConnection` y `remote:setAway` tienen esquema estricto y son clase **X** para el celular: salir de casa solo se enciende en el Mac.

**Riesgos que siguen (no se disimulan).**

- Cuenta de Cloudflare o Mac del dueño comprometidos: pueden servir JS malicioso **solo al celular**; la vigilancia detecta un cambio no dirigido, no una versión distinta servida a un cliente concreto. Mitigan la clave no exportable, que lo peligroso se confirma en el Mac y 2FA en la cuenta; la passkey y `requirePasskey` llegan en la entrega 2.
- Un JS malicioso con la página abierta puede usar la clave del vínculo y capturar el PIN al teclearlo.
- Mientras `SITE_PUBLIC_KEY` esté vacía, la vigilancia no verifica nada (Ajustes dice «sin verificar»). La comprobación de `Content-Security-Policy` y de los hashes depende de lo que sirva el borde de Cloudflare en el momento de comprobar.
- Los metadatos (IP, horas, sala) son visibles para el servicio; la `room` es un seudónimo estable por Mac hasta «Quitar todos».
- El modo LAN (HTTP) conserva su riesgo conocido de un intermediario en la propia Wi-Fi (ver §3 tricies); el modo nube no lo tiene.
- `requirePasskey:true` bloquea el modo nube hasta que existan las passkeys (no puede cumplirlo).
- Por verificar en el entorno real (no se tocó Cloudflare ni se hizo ninguna petición de red): el binding de rate limiting en el plan gratuito, el máximo de archivos de los estáticos, si los `ping` con respuesta automática cuentan como mensajes facturables, si `getSelectedCandidatePair` informa bien «vía relé» y el comportamiento de iOS/Android (instalación, almacenamiento, `integrity` en `modulepreload`).

**Pruebas** (sin red, sin Cloudflare, sin Electron): `room-core.test.ts` (token, sustitución del host, host muerto, `ready` en 5 s, tamaños y topes, `busy`, `rate`, TURN tras `grant` y antes de la siguiente trama, `grant` n.º 21, hibernación y `to`+`kick`), `cloud.test.ts` y `protocol-v4.test.ts` (salas, código Crockford, validadores),
`worker-client.test.ts` (cabecera, reintentos con reloj falso, `suspend`/`resume`, ping, sin `allowed()` no se crea ningún socket) y `service-cloud.test.ts` (vinculación y reconexión completas por el doble local con el mismo `RoomCore`, sala de vinculación, revocado, TURN solo tras `authorize`, política, pausa del sitio, «Cortar todo», `away`),
`site-watch.test.ts` (firma válida, de otra clave, archivo alterado o ausente, CSP, retroceso, clave vacía, sin red, y de punta a punta con `scripts/site-release.mjs`), `pwa-keys.test.ts` (vector idéntico noble/WebCrypto, `CryptoKey` no exportable, handshake completo), `org-policy.test.ts`, `entry-info.test.ts`, `site-lib.test.mjs`.

## 3 tricies octies. Tareas en Windows con WSL2: preparación sin activar (F8-B81)

**Alcance.** Se prepara, sin activarlo, el aislamiento de Tareas en Windows; en macOS el único cambio es de estructura. `capsFor('win32').tasks` sigue en `false` mientras la bandera de producto `tasksWin` esté apagada (apagada por defecto, la lee `main`), y `backends/index.ts` no importa el backend WSL: Windows sigue desactivado con su aviso. Estado, pendiente y checklist del PC en `docs/WINDOWS-TAREAS.md`.

**Extracción de Seatbelt sin cambio de comportamiento (autorizada por el dueño para `sandbox*`, `proxy*` y `provider-egress`).** `startTasksServer` delega el «cómo se lanza» en `selectBackend()` (`src/main/tasks/backends/`); los proxies, el centinela, el token, `waitForHealth` y `stop` siguen en `sandbox.ts`. `sandbox-profile.ts`, `proxy.ts`, `proxy-policy.ts` y `provider-egress.ts` no se tocaron. Prueba: `sandbox.equivalence.test.ts` compara, contra un fixture capturado con el código ANTERIOR (commits `baeb0bd` y `c70fbdb`), el perfil SBPL byte a byte para 9 entradas fijas, y para 4 lanzamientos completos (con y sin sandbox, con y sin credenciales, sin directorio privado) el `command`, los `args`, el `env`, las opciones de `spawn`, los constructores de los proxies, `trackPid`/`killTree` y la limpieza. Las guardias estáticas de `provider-egress.test.ts` pasan sin editar y `backends.static.test.ts` las amplía a `backends/*` (ningún archivo lee credenciales; solo `wsl-spec.ts` nombra `OPENCODE_AUTH_CONTENT`, para exigir que sea un centinela). Ningún snapshot se regeneró.

**Modelo de la fase 1 (lo que ya está escrito y probado con dobles).**

- La clave real no cabe en la trama: `buildWslInit` no tiene acceso a `readProviderAuth`; solo admite entorno con prefijos `OPENCODE_`/`LAZUNOX_`/proxies, descarta `XDG_*`, `HOME` y las rutas del anfitrión (las reconstruye desde los montajes), y `OPENCODE_AUTH_CONTENT` solo puede ser `{}` o entradas `{type:'api', key:'sandboxed-placeholder-<16 hex>'}`; `encodeInit` además falla (`init_secret`) si aparece cualquier texto de una lista de secretos. El lanzador de Python repite la validación (lista cerrada, rechaza todo lo demás) y la comprueba contra la misma trama generada por TypeScript.
- `wsl.exe`: solo existen los comandos de `WslCommand`, todos sobre `Lazunox-Tareas`; **nunca `--shutdown`** (mataría las distros del usuario), ni `--mount`/`--update`/`-d` de otra distro; `assertAllowedWslArgs` exige coincidencia exacta con las plantillas. Entorno mínimo (`SystemRoot`, `windir`, `SystemDrive`, `TEMP`, `TMP`, `LOCALAPPDATA`) con `WSLENV=''` y `WSL_UTF8=1`; ruta absoluta de `wsl.exe`, sin shell.
- `wsl.conf`: sin automontaje ni `fstab`, sin interop, sin `appendWindowsPath`, sin systemd. El lanzador se niega a arrancar si existe `WSLInterop`, si no hay Landlock con ABI ≥ 2 o si quedan unidades montadas; usa espacios de nombres de montaje, red y PID propios (solo `lo`), monta únicamente las carpetas concedidas con `noexec,nosuid,nodev` (`ro` las de solo lectura) y ejecuta el servidor como `lazunox` sin capacidades, con `NO_NEW_PRIVS` y Landlock antes del `exec`.
- Landlock: la carpeta principal es `rw-nodelete` (sin `REMOVE_FILE`/`REMOVE_DIR`/`REFER`, el equivalente de `file-write-unlink` denegado) salvo `allowDelete`; el scratch `.lazunox/trabajo` solo dentro de la principal; las `rw` adicionales nunca borran; las `ro`, solo lectura. No se maneja `TRUNCATE` (igual que en macOS). Tampoco se conceden `MAKE_SYM`/FIFO/sockets/dispositivos en carpetas de Windows (decisión abierta del dueño).
- Rutas (`wsl-paths.ts`): `C:\…` ⇄ `/win/c/…`; se rechazan UNC y de dispositivo, ADS (`:`), `..`, nombres reservados, nombres 8.3, segmentos que Windows normaliza (punto o espacio final), caracteres inválidos y de control, y la barra invertida en una ruta de Linux; al volver, solo lo que cae dentro de un montaje concedido. Los enlaces y junctions no se pueden ver sin tocar el disco: `checkNoLinks` los detecta con un `lstat` inyectado (ataques A2-A4, pendientes en el PC).
- Puente (`bridge-protocol.ts`, `wsl-bridge-host.ts`): tramas ≤ 1 MiB, ≤ 256 flujos, INIT ≤ 64 KiB, errores tipados y decodificador envenenado tras el primer error (se corta la sesión: EOF al lanzador); control de flujo por créditos; el agente solo puede pedir salir a los puertos permitidos (egress, credenciales, proxy MCP) de `127.0.0.1` de Windows, y cualquier otro se rechaza sin conectar y se registra. Salida de `wsl.exe` decodificada como UTF-16LE (con o sin BOM) o UTF-8.

**Riesgos que siguen (no se disimulan).** Nada de lo anterior se ha ejecutado en Windows ni en una VM (no se instaló WSL ni se tocó el PC de pruebas); el lanzador de Python no se ejecutó en la Mac: solo análisis estático y la parte pura. Por verificar en el PC: que `drvfs` presente junctions y symlinks NTFS como enlaces que no atraviesan (A2-A3, bloqueante), el fallo abierto WSL#12443 al entrar elevado (por eso cada prueba se repite en una sesión no elevada), `--cd /` y el entorno mínimo de `wsl.exe`, y `mount -t drvfs` con el automontaje apagado. Un fallo del núcleo Linux de WSL daría root en la VM y, con ello, `mount -t drvfs` de todo Windows (comparable a escapar de Seatbelt por XNU, pero el núcleo lo actualiza Microsoft y el usuario puede tenerlo desactualizado: mostrar la versión en Diagnóstico). Las demás distros del usuario comparten la VM; `truncate` no está protegido; las consultas de búsqueda web son un canal de salida, igual que en macOS.

**Pruebas** (todas en la Mac, sin Windows, sin Electron): `sandbox.equivalence.test.ts`, `backends/{backends.static,wsl-paths,wsl-spec,bridge-protocol,wsl-bridge-host,wsl-status,wsl,launcher.static}.test.ts`, `platform-caps.test.ts` (matriz plataforma × bandera) y `resources/wsl/test_protocol.py` (vectores compartidos con TypeScript, validación de INIT, multiplexor con sockets de 127.0.0.1).

## 3 tricies novies. Modo viaje: túnel rápido sin cuenta, lado del Mac (F8-B85)

**Alcance.** Opción «Modo viaje» del control remoto: salir de casa **sin ninguna cuenta** (ni del usuario ni de Lazunox) con un túnel rápido de Cloudflare (`cloudflared tunnel --url http://127.0.0.1:<puerto>` → `https://<palabras>.trycloudflare.com`). Es **experimental y sin garantía**: Cloudflare lo ofrece «para pruebas y desarrollo» y puede limitarlo o retirarlo. Este bloque es solo el lado del Mac (binario, proceso, servidor, política, servicio); la interfaz de Ajustes y la PWA son de las tandas siguientes. Todo se probó con un `cloudflared` **falso** (`e2e/fake-cloudflared/fake-cloudflared.mjs`): no se abrió ningún túnel ni se descargó nada real desde el código; la verificación real previa (T0, `cloudflared` 2026.9.3 en el Mac del dueño) fijó los hechos que siguen.

**Arquitectura.** Un segundo ejemplar del servidor de señalización (`LanSignalingServer` en modo `tunnel`) **ligado a 127.0.0.1** en un puerto aleatorio (nunca la IP de la red local ni `0.0.0.0`; se niega a arrancar si no es loopback) más un proceso hijo `cloudflared` que lo publica. Por el túnel solo se exponen: `GET /k/<T>` (puerta), `GET /__lazunox/probe/<nonce>` (autocomprobación del Mac, un solo uso), la PWA estática y el WebSocket `/ws`. Nada de IPC, motor ni otras rutas. Los datos van por WebRTC directo con STUN públicos sin cuenta (`stun.cloudflare.com`, `stun.l.google.com`; sin TURN), con DTLS y el handshake v3 + PIN sin cambios: Cloudflare ve la PWA, la señalización y metadatos, nunca `q`, secretos, PIN ni conversaciones.

**Puerta, `Host` y `Origin`.**

- `T` = 16 bytes aleatorios por túnel, solo en memoria (se renueva si el túnel se relanza). El QR lleva `https://<host>/k/<T>#s=<q>` (el fragmento no viaja a ningún servidor; `T` sí viaja a Cloudflare: es antiabuso, no una credencial). `GET /k/<T>` con `T` correcto (comparación en tiempo constante) responde `303 → /` con `Set-Cookie: __Host-lazunoxk=<T>; Path=/; Secure; HttpOnly; SameSite=Lax` (prefijo `__Host-`: sin `Domain`). Sin la galleta **todo** (incluidos `/`, `/ws`, `/cdn-cgi/`, la sonda con nonce erróneo y `/k/` con clave errónea, con cualquier método) devuelve **el mismo 404** (mismo cuerpo y cabeceras; el rechazo del WebSocket sin galleta es el mismo 404). 20 intentos erróneos por minuto bloquean `/k/*` con 429 durante 60 s sin afectar a quien ya tiene galleta.
- Mientras `cloudflared` no haya impreso el nombre, **todo responde 503** (no hay ventana en la que se acepte otro `Host`). Después: `Host` exacto igual al host público (421 con `127.0.0.1:<puerto>` u otro; en T0 se comprobó que el borde reenvía el `Host` público) y, en el WebSocket, `Origin` exacto igual al origen público. El nombre solo vale si casa con `https://<2–8 palabras>.trycloudflare.com` (sin puerto ni ruta); en la salida de `cloudflared` se busca solo **después** del banner «Your quick Tunnel has been created!», con esa regex estricta (el aviso legal nombra `https://www.cloudflare.com/…` y «trycloudflare.com» sin esquema y no casa); algo con aspecto de URL que no case, o una segunda URL distinta, es fallo cerrado (`bad-url`) y se mata el proceso.
- `/cdn-cgi/` lo sirve Cloudflare en el mismo origen (en T0: `trace`, `email-decode`, `challenge-platform`): no se usa y no hay nada sensible bajo esa ruta; el servidor local responde a esa ruta el mismo 404.
- Cabeceras: CSP con `connect-src 'self' wss://<host>`, `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy` vacío, `no-store` salvo los recursos con huella; sin HSTS (el dominio no es nuestro). `Cf-Connecting-Ip`/`X-Forwarded-For` se usan **solo** como pista para el límite de ritmo por visitante (falsificables desde un proceso local: por eso los límites **globales** son los que protegen), nunca para autenticar.

**Límites.** 2 sockets de señalización; upgrades de WebSocket 10/min por visitante y 30/min global; HTTP 60/10 s por visitante y 200/10 s global (429); tramas de señalización ≤ 32 KiB; solo GET/HEAD (sin cuerpo). **Keepalive del WebSocket**: el borde corta un WebSocket sin tráfico a ~125 s (medido en T0, y no hay `permessage-deflate`); el Mac manda un `ping` cada 25 s y cierra el socket si en 90 s no llega nada del celular.

**Autocomprobación antes de enseñar el QR.** Tras leer la URL, el Mac pide por internet `/__lazunox/probe/<nonce>` (nonce de 16 bytes, un solo uso, 30 s) y su propia `index.html` y los scripts que referencia (con la galleta, sin comprimir) y compara bytes con lo que sirve él. Reintenta 1 s → 30 s ante fallos de red o 5xx/530 (el nombre puede tardar en resolver; en T0 hubo un 522 intermitente al abrir un WebSocket, 1 de ~6: el celular debe reintentar). Si no llega: `unreachable`. Si llega distinto: `site-mismatch` en la actividad y **no** se muestra el QR. Detecta alteraciones no dirigidas, no una versión distinta servida a un cliente concreto: Cloudflare, como terminador TLS, podría alterar el JS en tránsito (riesgo de infraestructura que no se elimina desde la página; se acepta y se documenta, como en el modo nube).

**Binario `cloudflared`.** Descarga **bajo demanda y con consentimiento** (el diálogo es del Mac; sin consentimiento, o con `allowTravelDownload:false`, no hay ninguna petición). `resources/cloudflared/pin.json` (compilado dentro del código firmado de la app) fija la versión y, para macOS arm64, **dos hashes** (el del `.tgz` y el del binario extraído; la release publica el del binario en el cuerpo y el del `.tgz` en el campo `digest` de la API), los tamaños exactos y la firma esperada: Developer ID Application: Cloudflare Inc., equipo `68WVV388M8`, identificador `cloudflared`. Descarga solo de `github.com/cloudflare/cloudflared/releases/download/…` y de `objects.githubusercontent.com`/`release-assets.githubusercontent.com` (lista cerrada; redirecciones comprobadas una a una), tope de bytes exacto, SHA-256 en flujo; `tar -tzf` debe listar **un único archivo regular** llamado `cloudflared` (sin rutas, `..`, enlaces ni más archivos); tamaño y hash del binario; `codesign --verify --strict` con el requisito Developer ID del equipo **antes** de dejarlo en `userData/bin/cloudflared-<versión>/cloudflared` (0700). **Antes de CADA arranque** se vuelven a comprobar tipo, permisos, tamaño, SHA-256 y firma; si algo no casa se borra, se audita `travel-binary-bad-hash` y se pide reinstalar. Sin auto-actualización (`--no-autoupdate`): se actualiza con Lazunox (otro `pin.json`). El generador `scripts/cloudflared/pin.mjs` exige que coincidan el cálculo local, el `digest` de la API y la tabla del cuerpo de la release, y la firma; solo lo corre una persona con red (`--network`), nunca la app ni CI, y se prueba únicamente con dobles. Solo macOS arm64 está fijado: no hay asset de Windows verificado.

**Proceso y cero huérfanos.** `cloudflared` corre en su propio grupo, vía `withDisclaim` (no hereda los permisos TCC de Lazunox), con entorno mínimo (`HOME` privado en `userData/cloudflared/home`, `PATH` del sistema, solo los proxies del usuario), sin `--config` (un archivo vacío da `ERR … was empty`) y envuelto por un **vigía `/bin/sh`**: si Lazunox muere (incluso con `kill -9`) el `stdin` del vigía se cierra y mata al túnel (verificado en T0: 0,12 s); además el vigía deja solo a `cloudflared` con `stderr` abierto, de modo que su cierre delata la muerte del proceso al instante. Se registra en `pids.json` (`kind: cloudflared`) y `killStaleServers()` limpia al arrancar **solo** lo que de verdad es el nuestro (`isOurCloudflared`: ruta fija `…/bin/cloudflared-*/cloudflared` con `--no-autoupdate` y `--url http://127.0.0.1:<puerto>`; un PID reciclado u otro `cloudflared` no se tocan). `stop()` cierra el `stdin`, `killTree` con SIGTERM, espera ≤ 3 s y remata el árbol (también un nieto en otro grupo) con SIGKILL; `killNow()` síncrono al salir (`process.on('exit')`). Caídas: relanzamiento con espera exponencial con azar 2…60 s, máximo 6 seguidas (`rate` empieza en 60 s); cada relanzamiento da **URL y `T` nuevas** y el servicio revoca los vínculos del túnel anterior, audita `travel-url-changed` y muestra QR nuevo. Tras 6 caídas: `failed`, se corta todo y Ajustes enseña el código del error. Una pérdida de conexión con el proceso vivo no se toca (`cloudflared` reconecta solo); si en 120 s no vuelve se marca `offline`.

**Servicio.** PIN **obligatorio**: un vínculo de viaje se crea `kind: travel` con `expiresAt` = fin del túnel; el celular que se va sin fijar su PIN pierde el vínculo; por el túnel solo reconecta un vínculo de viaje **con** PIN (los vínculos de LAN/nube no entran y los de viaje no valen en otro modo) y **nunca** se confirma la conexión en el Mac. Si la política (`requireConnectionConfirm`, `requirePasskey`, `allowTravelMode:false`) o el ajuste «Pedir confirmación en cada conexión» lo impiden, el modo viaje queda **bloqueado** (no se abre ni puerto ni proceso). El vínculo vale solo para ese túnel: se borra al cerrarlo (inactividad, tope de horas, «Cortar todo», salir de la app, política, caída), al relanzar con otra URL, al arrancar el servicio y al iniciar la app, y el celular recibe `bye{travel-ended}`. Cierres: 30 min sin conexiones (`idle30`) o «Mantener abierto» 4/12/24 h; en todos los casos vida absoluta ≤ `travelMaxHours` de la política; como mucho un vínculo de viaje a la vez. `travel-ice-failed` (sin IPs) cuenta las conexiones directas que no abrieron canal (`directFailures` en el estado).

**Política** (`docs/POLITICA-ORGANIZACION.md`): `allowTravelMode`, `allowTravelDownload` y `allowTravelRelay` relajan (sin archivo `true`; con archivo y la clave ausente `false`; solo `true` exacto permite); `travelMaxHours` 1–24 (con archivo y clave ausente, 1). Archivo inválido: todo cerrado. Se relee con `POLICY_POLL_MS`.

**Riesgos que siguen (no se disimulan).**

- Cloudflare puede limitar, cambiar o retirar los túneles rápidos (sin garantía de servicio; 429 al crear demasiados). `*.trycloudflare.com` está bloqueado en algunas redes corporativas y EDR por su uso en campañas de malware: la página puede no cargar o alertar al ver una app lanzar `cloudflared`.
- Cloudflare, como terminador TLS, podría alterar el JS en tránsito (la autocomprobación solo detecta cambios no dirigidos); ve IP, horas, host, `T`, la PWA y la señalización.
- El nombre `*.trycloudflare.com` puede reciclarse: por eso el vínculo es efímero, se revoca al cerrar el túnel y la PWA no registra service worker (tanda siguiente).
- La conexión directa falla con NAT simétrico en ambos lados o redes sin UDP; hasta el respaldo cifrado (entrega 2) el diagnóstico es «tu red no permite conexión directa».
- Un proceso local del mismo usuario puede falsificar `Host` y `Cf-Connecting-Ip` y llegar a la señalización (sin la clave del vínculo no pasa del handshake v3); también puede reescribir `userData` (el re-hash antes de cada arranque cubre corrupción y manipulaciones torpes, no a un atacante con ese acceso).
- No se verificó con el binario real: la supervivencia de la URL a un corte de red o a horas de reposo, `--protocol auto` con UDP 7844 bloqueado, un `/etc/cloudflared/config.yml` ajeno (daría `config-conflict`) ni redes móviles. Falta el aviso al celular 5 min antes del tope (no hay trama para ello).

**Pruebas** (sin red, sin Cloudflare, sin Electron): `tunnel/cloudflared.test.ts` (formato real capturado en T0, URL estricta, errores, plazos, nieto, `killNow`, SIGKILL al padre y `killStaleServers`), `tunnel/binary.test.ts` (hash correcto/incorrecto, tamaño de más, redirecciones, `tgz` con enlace/`..`/dos archivos/subcarpeta/ruta absoluta, binario sobredimensionado, firma, re-hash antes de arrancar, permisos 0700, sin consentimiento y política sin petición), `tunnel/pin-lib.test.ts`, `signaling/lan-server-tunnel.test.ts` (loopback, 503, `Host`/`Origin`, 404 idéntico, galleta, límites, sonda de un solo uso, keepalive), `signaling/tunnel-transport.test.ts` (con el falso real: apertura, puerta + WebSocket, corte por inactividad sin pings, 522, `inject`, errores, relanzamientos, rendición), `service-travel.test.ts`, `org-policy.test.ts`, `devices-store.test.ts`, `shared/remote/travel.test.ts`.

## 3 quadragies. Modo viaje: modelo de amenazas final, interfaz y tabla por tipo de red (F8-B86)

**Alcance.** Cierra el modo viaje (entrega 1: conexión **directa**; el respaldo cifrado por el WebSocket del túnel NO existe). Lo del Mac está en §3 tricies novies (F8-B85); aquí: la interfaz de Ajustes, el consentimiento, la PWA del celular en este modo, el modelo de amenazas final y qué funciona en cada red. **El dueño decidió no ofrecer un servidor propio como intermediario**: la interfaz no muestra la opción de servicio fijo; es «Solo esta red» (predeterminado) o «Modo viaje (sin cuenta), experimental».

**Interfaz (Ajustes › Celular).** Selector de modo; explicación corta y honesta (el enlace cambia al reiniciar el túnel, hay que vincular en casa, el Mac debe estar encendido con Lazunox abierta, puede no funcionar en redes móviles o de empresa, el tráfico pasa por la red de Cloudflare que no ve las conversaciones pero sí que hay un túnel y la señalización). **Consentimiento obligatorio** antes de descargar `cloudflared` (diálogo con tamaño ≈ 20 MB, origen oficial, verificación de firma y huellas, se puede borrar; botón «Descargar y activar», foco inicial en «Cancelar»): sin él no hay ninguna petición de red (`activateTravelFlow`, probado). Duración `idle30` (predeterminada) / 4 / 12 / 24 h recortada por `travelMaxHours`; estado del túnel con `aria-live`, cuenta atrás solo con duración fija, motivos de error por código (nunca texto crudo del binario), bloqueos por política / confirmar cada conexión / passkey con explicación, QR «válido solo para este túnel». En Windows o Mac Intel el modo no se ofrece y se explica. `remote:travelInstall` (`{ consent: true }` exacto) y `remote:setTravelKeep` tienen esquema estricto y son clase **X**: el celular no puede descargar nada ni cambiar la duración.

**PWA en modo viaje** (`pwa/src/mode.ts`, `rtc.ts`, `client.ts`). Se reconoce **solo** con HTTPS y el origen exacto `https://<palabras>.trycloudflare.com` (HTTP, puertos, subdominios o dominios parecidos no cuentan). El vínculo vive en IndexedDB **de ese origen** con la clave `CryptoKey` NO exportable (sin sala: el origen identifica al Mac) y vale solo para ese túnel; `bye{travel-ended}` con la prueba del Mac lo borra (sin prueba no se borra: podría estar inyectado). No se instala como app (se bloquea `beforeinstallprompt`) ni registra service worker (y retira cualquiera previo): el origen es efímero y reciclable. Señalización por `wss://<host>/ws` con **reintento ante el 522** (3 intentos, 0,5/1,5/4 s: `TRAVEL_WS_RETRY`); ICE solo con los STUN públicos (`TRAVEL_STUN_URLS`, sin relé aunque llegara uno) y plazo de **12 s**; el keepalive es del Mac (ping cada 25 s; el navegador contesta solo). Errores propios: «el enlace caducó, vuelve a escanear en casa» (no se llegó al túnel), «el Mac no responde» (canal cerrado), «tu red bloquea la conexión directa» (`ice-failed`) y «modo viaje cerrado». Ninguno borra el vínculo salvo `travel-ended` verificado. Presupuesto de peso respetado (arranque 286 KB gzip, `boot.js` 201 KB).

**Modelo de amenazas final.**

| Quién / qué                                                         | Capacidad                                                                                                              | Defensa                                                                                                                                                                                        | Riesgo que queda                                                                                                                                                  |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quien conozca el host (escáner, historial, registros de Cloudflare) | Pedir páginas al túnel                                                                                                 | Puerta `/k/<T>` (128 bits, solo memoria) → 404 idéntico para todo sin galleta; límites de ritmo; 2 sockets                                                                                     | `T` viaja por Cloudflare y sale en el historial del navegador del celular al escanear: es antiabuso, no credencial. Denegación de servicio mientras dure el túnel |
| Quien fotografíe el QR (120 s)                                      | Intentar vincular                                                                                                      | `q` en el fragmento (no viaja); código de 6 dígitos + «¿Vincular?» en el Mac, PIN obligatorio; 5 fallos anulan el QR                                                                           | Hay que vincular **en casa**, con el QR delante                                                                                                                   |
| Quien robe el vínculo del celular                                   | Reconectar                                                                                                             | Hace falta el PIN (scrypt, 5 fallos revocan); el vínculo caduca con el túnel y se revoca al cerrarlo                                                                                           | Un vínculo robado y un PIN conocido valen mientras viva ESE túnel                                                                                                 |
| Cloudflare (termina TLS)                                            | Ver IP del celular y del Mac, horas, host, `T`, la PWA, el SDP y la señalización; **podría alterar el JS en tránsito** | Los datos van por WebRTC/DTLS directo con el handshake v3 ligado a las huellas (Cloudflare no tiene `K`); la autocomprobación detecta cambios no dirigidos; lo peligroso se confirma en el Mac | **No se elimina** desde la página: confianza en Cloudflare. Una alteración dirigida a un cliente no se detecta. No ve `q`, secretos, PIN ni conversaciones        |
| STUN (Cloudflare, Google)                                           | Ver la IP pública de cada lado                                                                                         | Dos proveedores, sin cuenta                                                                                                                                                                    | Ven IP y hora                                                                                                                                                     |
| Nuevo dueño de un nombre `*.trycloudflare.com` reciclado            | Servir su JS en ese origen y usar la clave guardada allí                                                               | Vínculo efímero y revocado al cerrar; clave no exportable; sin service worker; borrado en `travel-ended`                                                                                       | Mientras el túnel vive el nombre es nuestro; después, la clave ya no abre nada                                                                                    |
| Proceso local del mismo usuario                                     | Falsificar `Host`/`Cf-Connecting-Ip`; reescribir `userData`                                                            | Sin la clave del vínculo no pasa del handshake v3; re-hash y firma de `cloudflared` antes de cada arranque                                                                                     | Quien escribe en `userData` ya gana (como con el resto de la app)                                                                                                 |
| Redes / EDR                                                         | Bloquear `*.trycloudflare.com` o alertar al ver `cloudflared`                                                          | Consentimiento explícito, ruta y firma fijas                                                                                                                                                   | Nada técnico lo evita                                                                                                                                             |
| Cloudflare como servicio                                            | Limitar, cambiar o retirar los túneles rápidos (sin garantía; «para pruebas y desarrollo»)                             | Etiqueta «experimental», errores claros                                                                                                                                                        | Puede dejar de funcionar sin aviso                                                                                                                                |

**TABLA HONESTA: qué funciona en cada red (entrega 1 = conexión directa, sin relé).** Mac en casa con un router doméstico normal. **Verificado** = medido con el binario real o con pruebas; **esperado** = deducido de cómo funciona la perforación de NAT y de la documentación, **no comprobado**; **no verificado** = no se ha probado nunca.

| Red del celular                                      | Carga la página (túnel)                            | Conexión directa                                                         | Estado de la evidencia                                                                                                                           |
| ---------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wi-Fi de otra casa (router doméstico)                | Sí                                                 | Casi siempre sí (NAT de mapeo independiente en ambos lados)              | **Esperado.** No verificado con una segunda casa. En T0 solo se vio que el Mac de pruebas tiene NAT de mapeo independiente (preserva el puerto)  |
| 4G/5G con CGNAT «cono» o IPv6 en ambos lados         | Sí                                                 | Normalmente sí                                                           | **Esperado, no verificado.** IPv6 y operadoras chilenas sin probar                                                                               |
| 4G/5G con CGNAT simétrico                            | Sí                                                 | **Depende del router de casa**: si filtra por dirección y puerto, **no** | **Esperado; es el caso de fallo más probable.** No verificado. Sin respaldo cifrado la app solo diagnostica «tu red bloquea la conexión directa» |
| Café/hotel con UDP abierto (portal cautivo aceptado) | Sí                                                 | Normalmente sí                                                           | **Esperado, no verificado**                                                                                                                      |
| Red que bloquea UDP saliente                         | Sí                                                 | **No**                                                                   | **Esperado.** No verificado                                                                                                                      |
| Red corporativa con filtro DNS/proxy                 | **A menudo no** (dominio bloqueado por reputación) | No                                                                       | **Esperado, no verificado.** Nada que hacer sin un servidor propio                                                                               |
| Mac en una red que bloquea 7844 (oficina)            | —                                                  | —                                                                        | El túnel no abre («este Mac no logró conectarse con Cloudflare»). `--protocol auto` con UDP 7844 cerrado: **no verificado**                      |
| Mac dormido, apagado o reiniciado                    | —                                                  | —                                                                        | Dormido: quizá vuelve, **no verificado** (T0 no probó 10 min ni 2 h de reposo). Reiniciado: el enlace muere y hay que vincular de nuevo en casa  |
| Corte de red del Mac con el túnel vivo               | —                                                  | —                                                                        | Se supone que `cloudflared` reconecta con la misma URL: **no verificado**                                                                        |

Verificado en T0 con el binario real (2026.9.3, Mac arm64, Chile): firma Developer ID y notarización, URL en ≈ 4 s y registro en ≈ 9 s, `Host` público reenviado, `Origin` conservado, WebSocket hasta 1 MiB, corte a ~125 s sin tráfico (por eso el ping de 25 s), sin `permessage-deflate`, un 522 intermitente (por eso el reintento), vigía de `stdin` (el hijo muere en 0,12 s tras `kill -9` al padre), STUN de Cloudflare y de Google responden. **No se ha probado todavía en ningún celular real ni con datos móviles**: los pasos están en `docs/REMOTO-PRUEBA-MANUAL.md` (sección «Modo viaje») y sus resultados deben anotarse aquí antes de dar el modo por probado.

**Qué NO hace y por qué.** Sin servidor fijo no hay forma segura de avisar al celular de una URL nueva (cada túnel nuevo tiene otro nombre), de despertar el Mac ni de instalar la PWA. El respaldo por el WebSocket del túnel con cifrado propio queda para una entrega posterior tras revisión criptográfica externa; hasta entonces, donde la perforación falle, el modo viaje no conecta.

**Verificación real de punta a punta (F8-B87).** `scripts/travel-smoke.cjs` (a mano, NO en `npm test`) corre dentro de Electron con los componentes de producción y red real: descarga, extracción, dos hashes, firma, ejecución sin Gatekeeper, ciclo de vida (vigía, `withDisclaim`, `HOME` privado), URL, autocomprobación, rutas del túnel y cierre sin huérfanos. Encontró dos fallos que los simulacros no podían ver: (1) `net.fetch(url, { redirect: 'manual' })` de Electron lanza «Redirect was cancelled» y la descarga fallaba al instante; ahora `tunnel/manual-fetch.ts` usa `net.request` (evento `redirect`, siempre se aborta y cada salto lo valida `CloudflaredBinary`: lista cerrada de hosts, https, sin puerto ni credenciales; el pin, el tamaño exacto y los dos SHA-256 no cambian); (2) el nombre del túnel aún no existe en el DNS cuando `cloudflared` imprime la URL y la primera consulta quedaba en la caché negativa del resolvedor (60 s), así que la autocomprobación daba `ENOTFOUND` y el QR no salía: ahora `signaling/tunnel-dns.ts` pregunta a los servidores autoritativos de `trycloudflare.com` (el nombre del túnel lo ven esos servidores de Cloudflare, no un resolvedor público) y conecta a la IP que dan con el certificado validado por SNI; solo con el autoritativo inaccesible recurre al sistema. Además: el proceso corre en la carpeta de su `HOME` privado y el plazo de arranque pasa de 30 a 60 s (una ejecución real superó 30 s). **Sin verificar con el binario real**: los pings del Mac por el túnel y `hello`→`ready` por el WebSocket del túnel (probados con el falso; con el real se vio que el WebSocket abre con galleta y `Origin` exactos y que el servidor responde), redes móviles y celular real.

## 3 quadragies bis. Retirada de las cuentas y migración de la sesión heredada (F8-B88)

**Decisión del dueño:** Lazunox ya no tiene cuentas ni inicio de sesión. El comportamiento es el de la antigua compilación con
`ACCOUNT_API = null`, sin el código muerto.

**Superficies que desaparecen.** (1) Los 9 canales invoke `account:state|google|cancel|retry|emailStart|emailVerify|signOut|delete|export`
y el evento `account:changed`, con sus esquemas, handlers y entradas de la política del remoto (la **R** `account:state` y la **D**
`account:signOut`). (2) La red saliente de main hacia el servidor de cuentas (`/v1/auth/*`, `/v1/me` cada 24 h, `/v1/logout`,
`DELETE /v1/me`). (3) El servidor HTTP loopback en `127.0.0.1:<aleatorio>` y la apertura del navegador con una `auth_url` dictada por el
servidor. (4) El token portador guardado en disco. (5) Las variables `LAZUNOX_ACCOUNT_URL`, `LAZUNOX_ACCOUNT_DISABLED` y
`LAZUNOX_TEST_PLAIN_STORE`. (6) El bloqueo de Quick Entry, atajo global y bandeja por falta de sesión. No cambian la CSP (la cuenta
salía por `net.fetch` desde main, que la CSP no controla), `CHANNEL_ROLES`, los preloads ni el protocolo `lazunox://app`.

**Migración.** `cleanLegacyAccountSession` (`src/main/legacy-account-cleanup.ts`, sin Electron: no recibe `safeStorage`) se llama en cada
arranque, junto a la limpieza del navegador heredado, y es idempotente. Borra **solo** estos archivos regulares (o el enlace, nunca su
destino) directamente en `userData`, sin recursión: `account.bin`, `account.bin.tmp`, `account.test.json` y `account.test.json.tmp`.
Una carpeta con ese nombre no se toca. Se puede quitar en una versión >= 0.6.

**Qué NO se borra.** La clave del Llavero del sistema (`Lazunox Safe Storage`, que comparte `remote.bin`): la función no descifra ni
invalida nada, así que `remote.bin` (los celulares vinculados) sigue descifrándose. Tampoco `settings.json`, `opencode-data/` (claves de
IA), las conversaciones, `migrations.json` ni la `localStorage` del renderer (la bandera inerte `lazunox.account.note` queda, sin datos
personales).

**Guardias.** `policy.test.ts` (cobertura al 100 %: la política no puede conservar canales que ya no existen), `schemas.test.ts`,
`src/test/no-accounts.test.ts` (ningún canal, política, dominio ni variable de cuenta en `src/`) y `legacy-account-cleanup.test.ts`.

**Fuera del repo.** El servidor, el VPS, el DNS `api.onyxcode.cl`, el cliente OAuth y la base de usuarios los gestiona el dueño; **sus
datos en el servidor no se borran desde la app**. Volver a una versión antigua con la cuenta encendida obliga a entrar de nuevo.

**Barra de aprobación de Tareas (F8-B93).** La barra compacta sobre el compositor se oculta solo si la tarjeta equivalente (mismo comando o ruta LITERAL y los mismos botones, en el mismo orden) está visible en la conversación al ≥60 %. Cierre seguro: si la tarjeta no existe, está en otra tarea o el navegador no ofrece `IntersectionObserver`, la barra se muestra (`shouldShowBar`, `approval-bar.test.ts`).

## 3 quadragies ter. Tarjetas de permiso de escritorio (ND)

Rediseño SOLO de escritorio de las tarjetas de permiso de Tareas y Code (anatomía `oc-perm`, `role="alertdialog"`); el celular/PWA no cambia ni un píxel (`isRemoteSurface()` bifurca; `policy.ts`, `src/shared/remote/mac-confirm.ts` y `mac-confirm-parity.test.ts` quedan sin diff).

**Teclado seguro (solo escritorio; `lib/perm-guard.ts` + `usePermGuard`).** No hay atajo global: la lógica vive en `onKeyDown` del contenedor de la tarjeta. `⌘↵` (Ctrl+↵ en Windows) solo responde con foco en la tarjeta, `document.hasFocus()`, tarjeta visible ≥60 % (`IntersectionObserver`), armada 600 ms y sin `repeat`/IME/Alt/Shift; si el foco está en la textarea de «Rechazar con indicaciones», `⌘↵` envía la nota (rechazo), nunca permite. `Enter` sin modificador NUNCA permite: sobre «Permitir una vez»/«Permitir siempre» hace `preventDefault()`. `Esc` rechaza (o cierra la nota). Ningún botón Permitir recibe foco automático (la tarjeta no roba el foco al compositor); se llega por Tab, clic o «Revisar». Con varias pendientes, `⌘↵` solo actúa en la tarjeta que tiene el foco y, al resolver una, el foco pasa al contenedor de la siguiente (arranca desarmada), nunca a un botón Permitir.

**Armado.** Los botones que conceden acceso se deshabilitan hasta 600 ms de visibilidad continua (`data-armed`); se desarman si la tarjeta deja de verse o el contenedor se desplaza >24 px. Sin `IntersectionObserver`, el clic arma por tiempo y `⌘↵` queda desactivado. Doble envío: `busyRef` síncrono; tras responder, todo `disabled` hasta desmontar; un error rehabilita y desarma.

**Retirada del 1/2/3 global de Code (decisión del dueño).** El `window.addEventListener('keydown')` que hacía «2» = permitir siempre desde el compositor vacío se elimina (riesgo existente). El prop `hotkeys` se conserva y solo decide si se pinta el `<kbd>` de `⌘↵`; la rama móvil (`MobilePermissionCard`) queda intacta. §3 vicies octies («el permiso ya no escucha 1/2/3») sigue válida para el celular; ahora vale también para el escritorio.

**Contenido literal y orden.** El comando/diff se muestra literal, envuelto y sin recortar hasta 200 líneas / 20 000 caracteres (después `max-h-96` + «El comando sigue: N líneas en total»), con prefijo `$` (`aria-hidden`), y los caracteres ocultos se avisan como hoy. La consecuencia (`effect`) la redacta la app, no el modelo; la descripción del modelo va aparte y «no verificada». La barra compacta, para un comando destructivo, con salto de línea, >120 caracteres o caracteres ocultos, solo ofrece «Revisar» y «Rechazar» (nunca se aprueba a ciegas).

**Riesgo residual.** El clic que cae en otro botón al moverse la tarjeta se mitiga con posiciones fijas + armado/desarme; el atajo accidental, con las condiciones de `⌘↵` y el bloqueo de Enter; la fuga al celular, con la bifurcación `isRemoteSurface()` y las pruebas `*mobile-pin` (fijadas antes de tocar el código). Como antes, la confirmación en el Mac del remoto (`policy.ts`) y el sandbox Seatbelt no cambian.

**Guardias.** `perm-guard.test.ts` (barrido de teclas: nunca se devuelve «always»; cada condición falsa de `⌘↵` → `none`; Enter → `block-enter`; `armState` <600 ms no, 600 ms sí, desarme al ocultarse y con Δy>24), `PermissionPrompt.desk.test.tsx`/`PermissionCard.desk.test.tsx` (orden DOM, `aria-*`, `<kbd aria-hidden>`, botones Permitir `disabled` en el primer render, sin `<kbd>1</kbd>` en Code), `e2e/specs/permisos-escritorio.e2e.ts` (axe limpio, doble clic → una respuesta, foco al segundo contenedor y nunca a un botón Permitir).

## Rediseño de la PWA: la tarjeta de permiso también en la raíz de Tareas (F8-B102)

El flujo de aprobación **no cambia**: mismas respuestas (`replyPermission` / `replyPermissionAlways`, rechazo con mensaje), misma política del Mac
(`policy.ts`, `canApproveCommands`, confirmación en el Mac, tope de 20/h) y mismos textos de seguridad. Sin diff en `src/main/**`, `src/shared/remote/**`,
`policy.ts`, `mac-confirm*`, `command-denylist.ts` ni `pwa/src/**`. Lo que cambia es la presentación en el celular: la tarjeta (`PermissionCard`)
ahora se muestra también en **Inicio de Tareas**, con el título de la tarea encima, y los botones salen de `perm-actions.ts`. Orden en un permiso
**destructivo**: «Rechazar» arriba (ancho completo, 44 px), después «Permitir una vez» (peligro) y «Rechazar con indicaciones»; sin «Permitir siempre».
Ningún botón de permiso lleva `autoFocus` y se deshabilitan mientras hay una respuesta en curso. Push «Esperando aprobación» y avisos fuera de la app
**no se implementan** (siguen pendientes de decisión). El punto de la pestaña Tareas y el aviso de Inicio solo reflejan permisos cuando el store de
Tareas ya está conectado a una carpeta.

## 3 quadragies quater. Tareas en Windows: beta opcional (decisión del dueño 2026-10-07; antes «APAGADO»; F8-B105/B106/B107, W10)

**Decisión del dueño (2026-10-07).** Tareas en Windows pasa de «apagado hasta tener informes» a **beta opcional**: va en el instalador de Windows con la imagen incluida (`resources\wsl\images`), el usuario la enciende con un consentimiento propio y no se publica nada. Esto es una decisión expresa del dueño y **acepta el riesgo de lo no verificado**; no es una prueba de que el aislamiento funcione. En este árbol `TASKS_WIN_BUILD` sigue en `false` hasta el commit aparte que lo cambia; lo que sigue describe el diseño aprobado y lo que ya existe.

**Verificado (PC real).** La batería parcial `scripts/win/attack/attack_suite.py` (38 pruebas) y una sesión real 2/2 (`wsl-it.ps1`: `setup()` desde la imagen, `ready`, servidor como `lazunox` con uid 1000, `CapEff=0`, `NoNewPrivs=1`, montajes `noexec,nosuid,nodev`, `case=off`). Aislamiento de la distro: Landlock, sin red salvo el proxy, solo carpetas aprobadas, sin SUID, sin interop y sin unidades montadas.

**NO verificado (el aviso de la beta lo dice sin eufemismos).** La batería A1–A20 completa y los informes de las dos sesiones (elevada y normal); el fallo abierto de WSL con sesión elevada (microsoft/WSL#12443); A3 (symlink NTFS); la imagen y el OpenCode de Linux no están firmados por un tercero; no hay auditoría externa. Defender y SmartScreen sobre un instalador sin firma Authenticode tampoco se han probado.

**La guardia de informes se sustituye por la puerta de beta consentida.** `gate()` falla cerrado y exige: (1) consentimiento beta vigente (`userData/tasks-win-beta-consent.json`, `{version, at}`, escrito **solo por `main`**, versionado y revocable; relido del disco en cada arranque de servidor, así que revocar apaga el backend aunque la app siga abierta; archivo ausente, corrupto o de otra versión = sin consentimiento; el ajuste `tasksWinBeta` que escribe el renderer **no cuenta**); (2) huella del paquete incluido (`lstat` sin enlaces, tamaño y sha256 contra `pin.json`); (3) carga (`.py` y OpenCode) con su huella; (4) `state.json` del usuario con el `rootfsSha` del pin; (5) distro `ready` (`startTasksServer`); (6) política `disableWslTasks`. Además: **Tareas se niega a arrancar si Lazunox corre elevado (administrador)**, como Control del PC (respuesta 1 del dueño, por WSL#12443). **Alcance honesto de la huella:** es una comprobación de integridad contra corrupción, **no** contra un atacante local con permiso de escritura en la carpeta de la app (puede cambiar `pin.json` igual que el paquete). `tasks-win-report.ts` queda archivado como herramienta opcional (si algún día se completa la batería A1–A20 vuelve a valer) y deja de usarse en producción.

**Imagen: solo avanzar, descarga conservada.** Se avanza de versión de imagen y no se reinstala una anterior (respuesta 2). La URL de `wsl-rootfs` conserva la forma de URL del repo de la imagen WSL que fija `wsl-pin.ts` (organización D9 pendiente) aunque el archivo no esté publicado, y `parseWslPin` no se relaja (respuesta 3): el camino de descarga se conserva y falla cerrado (404) si se usa; el predeterminado es el archivo incluido, copiado a la caché y verificado con el mismo sha256.

**Texto anterior de esta sección (previo a la decisión).** Los puntos siguientes se escribieron cuando la función estaba apagada; donde dicen «informe del PC» o «sigue APAGADO» manda el bloque de decisión de arriba.

**En una frase (anterior).** Tareas en Windows no se puede activar hoy, y a propósito. El código del aislamiento con WSL2 está escrito y probado en macOS con dobles; **nada de esto se ha ejecutado en un Windows real**. Que las pruebas de macOS pasen no significa que el aislamiento de Windows funcione. (Matiz de la decisión: lo marcado arriba como «Verificado (PC real)» sí se ejecutó en un PC real.)

**Qué existe (verificado en macOS, con la plataforma inyectada).**

- **Apagado de verdad.** `TASKS_WIN_BUILD` es un `false` literal en `src/shared/feature-flags.ts` (una guardia lee ese literal). Con él en `false`, la bandera `tasksWin` es falsa aunque el usuario la pida, aunque exista `LAZUNOX_TASKS_WIN=1` y aunque no haya política. En Windows no hay modo Tareas, ni canales de Tareas, ni backend.
- **Falla cerrado.** En Windows, `selectBackend` ya no devuelve «sin aislamiento»: lanza salvo que estén todos los permisos (bandera, constante, informe del PC en verde y la imagen fijada). `startTasksServer` rechaza `noSandbox` en win32 y exige que el entorno aislado esté `ready` antes de abrir proxies o procesos. «Control total» no existe en `main` en Windows (también se descartan concesiones viejas en disco). La batería A18 de macOS cubre estos puntos por completo.
- **Guardia con informe del PC.** `tasks-win-report.guard.test.ts` impide poner `TASKS_WIN_BUILD=true` sin dos informes (`docs/evidence/tasks-win-report.{elevated,normal}.json`, sesión elevada y normal) en verde, con los hashes de los archivos de aislamiento iguales a los actuales (si cambia un byte de `launcher.py` hay que repetir la batería) y con la imagen y la versión de OpenCode iguales a las fijadas. Hoy esos informes **no existen**: la guardia solo valida el esquema.
- **Política de carpetas restrictiva** (`folder-policy-win.ts`, zona intocable; la decisión D4 del dueño sigue por confirmar). Lista cerrada que falla cerrado: solo discos fijos locales (se rechazan red, extraíbles, `subst`); raíces de unidad, `Windows`, `Program Files*`, `ProgramData`, `Users` salvo el perfil propio, todo `AppData`, claves (`.ssh`, `.aws`…), la carpeta de Lazunox y cualquier carpeta que contenga una zona vetada. Si no se puede leer la lista de unidades o está caducada (más de 120 s), no se aprueba nada. Una carpeta con un enlace simbólico o junction dentro (o en un ancestro) se rechaza, y también si no se pudo comprobar.
- **Rutas: traducir no es autorizar.** `C:\a\b` ⇄ `/win/c/a/b` (UNC, `\\?\`, `\\.\`, ADS `:`, `..`, nombres reservados, 8.3 y relativas se rechazan). Toda ruta que llega a `main` pasa por una sola puerta (`resolveUiPath`) y después por `assertInsideApproved` (con `realpath.native`). En la interfaz, el renderer solo traduce para hablar con OpenCode (`directory` de las llamadas) y para **mostrar** `C:\…`; la autorización sigue únicamente en `main` y no se movió al renderer (`src/renderer/.../tasks/impl/{path-map,conn-paths}.ts`).
- **Almacenamiento.** En Windows `storage.ts` no usa `du`: recorre el árbol con Node, sin seguir enlaces y con tope de 200 000 entradas y 60 s.
- **Estado del entorno.** `tasks:sandbox:status|setup|cancel` y la tarjeta «Preparar Tareas en Windows». «Volver a comprobar» manda `force` y se salta la caché de 5 s de `main` (el sondeo automático la usa, porque sondear arranca la distro). El canal sigue siendo de lectura para el celular.
- **Modelo del aislamiento** (sin cambios respecto a F8-B81): distro propia sin unidades ni interop, red vacía, Landlock, clave real fuera de la VM, `wsl.exe` en lista cerrada y nunca `--shutdown`.

**Batería A1–A20 (22 filas con A6b y A7b).** Está **diseñada y automatizada solo en su parte de macOS** (`win-attack.battery.test.ts`): 1 ataque queda cubierto por completo en macOS (A18, sin aislamiento imposible), 10 solo en parte (rutas, política, enlaces con `lstat` inyectado: A1–A6b, A7b, A16, A19) y 11 exigen el PC (A7–A15, A17, A20: montajes, interop, canario de credenciales, red, escalada, borrado con Landlock, puente real, ciclo de vida). **No se ha ejecutado ninguno en el PC**; el guion `scripts/win/tasks-attack.ps1`, el «shim» y el arnés de PC están diseñados en el plan pero **todavía no están en el repositorio**.

**Lo que falta antes de poder encender (no se disimula).**

1. La imagen Debian fijada (`wsl-rootfs` en `pin.json`), el empaquetado de `resources/wsl` y su descarga/importación real.
2. Correr la batería en el PC, en sesión elevada y en sesión normal, y guardar los dos informes en `docs/evidence/`.
3. Lo que solo se sabe en Windows real: si `drvfs` deja pasar junctions y symlinks NTFS (A2/A3, bloqueante; si pasan, no se enciende), el fallo abierto WSL#12443 al entrar elevado, `case=off` en los montajes, las unidades de red y `subst` reales, y el rendimiento.
4. La decisión del dueño sobre la política de carpetas (D4) y sobre la bandera (D2), y el cambio de `TASKS_WIN_BUILD` en un commit aparte.

**Riesgos que seguirán aunque todo salga bien.** `truncate` no está protegido (igual que en macOS); las demás distros del usuario comparten la VM y el núcleo de WSL, que actualiza Microsoft (se mostrará su versión en Diagnóstico); un hardlink que el usuario ya hubiera creado hacia fuera de la carpeta sí se lee; los nombres que Windows no maneja bien (reservados, punto o espacio final) pueden dejar residuos; las consultas de búsqueda web son un canal de salida, igual que en macOS.

**Pruebas (macOS, sin Windows ni Electron).** `win-attack.battery`, `ui-path`, `folder-policy.win`, `win-context`, `win-drives`, `select-backend`, `sandbox.win`, `tasks-win-flag`, `tasks-win-report` y su guardia, `storage.test.ts` (recorrido con Node), `tasks-sandbox-handlers.test.ts` (`force`), `actions.directory.test.ts` (ruta del sandbox en las llamadas y ruta de Windows en pantalla; macOS idéntico), más `sandbox.equivalence.test.ts` sin regenerar su fixture.

## 3 quadragies quinquies. Control del PC en Windows: beta opcional con Tareas (decisión del dueño 2026-10-07; antes «APAGADO», plan win-C)

**Decisión del dueño (2026-10-07).** Control del PC en Windows pasa a **beta opcional**, disponible **solo si Tareas beta está encendida** (`tasksWin` en la fórmula de `resolveComputerWin`) y con `cu-helper.exe` presente. No tiene interruptor propio: su puerta es el consentimiento de la tarjeta (`computer-win-consent.json`, casilla + armado de 600 ms, escrito solo por `main`; sin consentimiento el MCP responde «sin consentimiento» antes de cada herramienta). Se niega a arrancar si Lazunox corre elevado. Está **cableado** (`src/main/computer/computer-win-flag.ts` → `computerWinOn` en `main/index.ts` → `caps.computer` y `TasksManager`; el empaquetado exige el helper compilado) pero en este árbol sigue apagado mientras `TASKS_WIN_BUILD` sea `false`. Es una decisión expresa del dueño que acepta el riesgo de lo no verificado.

**Verificado en el PC real: solo** que el helper compila y responde `version`, `screens`, `cursor` y `permissions` (`session` salió 12 por escritorio seguro: falla cerrado). **NO verificado, sin eufemismos:** SendInput, UI Automation, capturas con máscara, STOP/EOF, Defender y SmartScreen; firma Authenticode pendiente; y todo lo no verificado de Tareas (sección anterior), porque Control del PC corre dentro de ella.

**Texto anterior de esta sección (previo a la decisión).** Donde dice «no se puede activar hoy» o «sigue APAGADO» manda el bloque de decisión de arriba.

**En una frase.** Control del PC en Windows (UI Automation) no se puede activar hoy, y a propósito: depende de las banderas `computerWin` y `tasksWin` (Control total es un modo de Tareas, que en Windows sigue apagado, sección anterior) y casi todo lo que toca el escritorio **no se ha ejecutado nunca en un Windows real**. Que las pruebas de macOS pasen no demuestra que SendInput, UI Automation o las capturas funcionen en Windows.

**Modelo.** Windows no tiene TCC; lo sustituye la propia app. Las piezas, igual que en macOS pero con otras puertas:

- **Helper nativo** `cu-helper.exe` (Rust, `resources/computer-use/win/`), un proceso por comando y el mismo protocolo de línea de comandos y JSON (`resources/computer-use/protocol.json`). Manifiesto `asInvoker`, DPI por monitor, **sin `uiAccess`**: no puede ni debe controlar ventanas elevadas. Solo el monitor principal en la v1.
- **Consentimiento de equipo**, versionado y revocable (`src/main/computer/policy/consent-win.ts`); sin él, todo lo que genera entrada o captura falla cerrado con código 12. El helper lo recibe por `COMPUTER_WIN_CONSENT=1`; que el MCP lo ponga tras consultar a `main` (`GET /consent`) es parte del cableado de C4, que aún no está en esta rama.
- **Se niega, sin excepciones, a actuar** si Lazunox corre elevado, si hay escritorio seguro (UAC, Ctrl+Alt+Supr, bloqueo), si no hay sesión interactiva (SSH) o si la ventana destino tiene integridad alta. Lista de **bloqueadas siempre** por ejecutable o AUMID (`consent.exe`, `LogonUI.exe`, Seguridad de Windows, `mmc`, `regedit`, Administrador de tareas, gestores de contraseñas): nunca concedibles, enmascaradas y sin acciones.
- **Concesiones por app** (ver, clic, control total) con clave `exe:<ruta>|pub:<editor>` o `aumid:<id>` (`policy/app-key.ts`): un `chrome.exe` falso en otra carpeta no hereda la concesión.
- **Capturas con máscara que falla cerrado:** Windows no puede sacar del compositor las apps sin concesión como ScreenCaptureKit; se tapan por orden Z y, si no se puede enmascarar con seguridad, **no hay captura** (en macOS sigue siendo «lo que se pueda»).
- **Teclas:** política pura en `policy/win-keys.ts` (rechaza `win+r`, `win+x`, `win+l`, `ctrl+shift+esc`, `ctrl+alt+del`, `cmd`, el propio atajo de parada…), **límites de tasa** por sesión (`policy/rate-limit.ts`) y **registro auditable sin el texto tecleado** (`policy/audit.ts`). Son comportamientos nuevos que **solo existen en Windows** hasta que el dueño decida llevarlos al Mac.
- **Parada:** botón Detener, Esc físico (gancho `WH_KEYBOARD_LL` de solo escucha, que anota la hora y no guarda teclas), atajo global **`Ctrl+Alt+Mayús+Esc`** (`Ctrl+Mayús+Esc` es el Administrador de tareas y no se puede registrar), bloqueo de sesión y, por stdin, `STOP`/EOF: el helper suelta botones y modificadores y sale con 3; después se ejecuta siempre `release-input`.
- **Agente** `resources/opencode/agents-win/computer.win.md`: mismo flujo Plan → Aprobar → Ejecutar y la misma puerta del plan (`lazunox-plan-gate`), sin grabación, voz ni Seatbelt, con `ctrl` en vez de `cmd`, nunca aprobar UAC, nunca teclear secretos, sin acciones destructivas sin confirmar y trata lo que devuelve la pantalla y UI Automation como datos no confiables. **Control total no tiene sandbox**: las reglas de `bash` (confirmar `SendKeys`, `CopyFromScreen`, `Get-Clipboard`, `reg`, `schtasks`; denegar `cu-helper`, `RunAs`, `Set-MpPreference`, `shutdown`) son defensa en profundidad, **no una frontera**.
- **Qué agente se usa** (`src/main/tasks/computer-agent.ts`, llamado desde `manager.ts`): en macOS no cambia nada (ni se toca el archivo); en Windows `computer.md` se sustituye por `computer.win.md` solo con `computerWin` y `tasksWin` efectivas, se restaura el de macOS al apagarlas y, si falta el de Windows con la función encendida, **no se deja el de macOS** (falla cerrado). `computer.win.md` nunca queda como agente propio.
- **Paquete:** `cu-helper.exe` y `computer.win.md` solo entran al instalador de Windows con la función activa y jamás los fuentes de Rust ni `target/` (`docs/DISTRIBUCION.md` §12.2; lo vigila `scripts/check-win-bundle.mjs`).

**Verificado en un PC Windows real** (el PC de pruebas): el helper **compila** y responde a las consultas básicas `version`, `screens`, `cursor` y `permissions`; `session` salió con **12** por escritorio seguro (sesión de SSH sin escritorio interactivo): falla cerrado, como se diseñó. Nada más.

**Verificado en macOS** (dobles, sin Windows ni Electron): la parte pura del helper (`cargo test`), el contrato `protocol.json` frente a los dos helpers, el helper falso, el MCP con la plataforma de Windows inyectada, las políticas de teclas, tasas, claves de app, geometría, consentimiento y registro, el contenido de `computer.win.md` y la selección del agente (`agent-prompts.test.ts`, `computer-agent.test.ts`), la configuración del paquete (`scripts/check-win-bundle.test.mjs`) y que el E2E de Windows se salta fuera de Windows. El equivalente de macOS no cambia (`mcp-server.equivalence.test.ts`).

**NO verificado (no se disimula):**

- **SendInput:** clic con error ≤ 2 px físicos con escalado 100/150/175 %, arrastre, tecleo con acentos, ñ, emoji e IME, y el efecto de UIPI.
- **UI Automation:** `app_tree`, `app_find`, `app_press`, `app_set_value`, `app_action` y `find_element` en la página de prueba, Bloc de notas, Calculadora y Explorador; tiempos y roles; campos de contraseña en navegadores.
- **Capturas con máscara:** orden Z con una app sin concesión bajo una concedida, ventanas bloqueadas, carrera entre enumerar y capturar, y que `WDA_EXCLUDEFROMCAPTURE` oculte el overlay.
- **STOP y EOF:** `STOP` por stdin a mitad de un arrastre o un tecleo, `release-input`, el Esc físico del gancho, el atajo global `Ctrl+Alt+Mayús+Esc` (que `globalShortcut.register` devuelva `true`) y el bloqueo de sesión (`Win+L`).
- **Clickjacking:** que el helper vea una ventana casi transparente de otro proceso encima del punto (hay un escenario de prueba con ventanas propias, `scripts/win/clickjack.ps1`, que solo consulta).
- **Defender y SmartScreen:** un exe sin firmar que combina gancho de teclado, SendInput y captura puede ser heurísticamente sospechoso (posible cuarentena); sin escaneo a demanda hecho. SmartScreen solo mira el instalador descargado.
- **Firma Authenticode: pendiente.** Sin ella, `service` no puede comprobar la firma del helper antes de lanzarlo y la concesión por editor depende de `WinVerifyTrust` sobre binarios de terceros, no del nuestro.
- **Integración en `main` y la interfaz** (servicio, overlay, concesiones, tarjeta de consentimiento, textos `.win`): es la tanda C4/C5, que va en otra rama y cuelga de Tareas en Windows.

**Cómo se prueba cuando el dueño lo pida** (sesión gráfica desbloqueada y sin elevar; nunca por SSH puro): `scripts/win/run-cu.ps1 -Step check|defender|clickjack|e2e` y el spec `e2e/specs/computer-win.e2e.ts` (solo win32 y con `LAZUNOX_CU_E2E=1`), siempre sobre una ventana propia de prueba (`e2e/fixtures/cu-target.html`) y nunca con apps del usuario. `check` y `defender` son de solo lectura; `clickjack` solo consulta `app-at`; `e2e` mueve el ratón real y teclea en la ventana de prueba.

**Preguntas para el dueño (nada de esto se ha aplicado).**

1. ¿Cuándo? Recomendación: nada se enciende hasta pasar S1–S15 en el PC, y solo después de Tareas en Windows (T-W4).
2. ¿Firma Authenticode antes de publicar? (La beta podría ir sin firma; con ella `service` verificaría el helper.)
3. ¿Aceptas `Ctrl+Alt+Mayús+Esc` como atajo de parada en Windows (más el Esc físico)?
4. ¿Registro auditable, límites de tasa, teclas bloqueadas y parada al bloquear la sesión también en el Mac? Hoy solo en Windows.
5. ¿Capturas que fallan cerradas también en el Mac (más adelante)?
6. ¿Las listas de bloqueadas y exentas, incluido que las **ventanas de carpetas del Explorador** pidan concesión?
7. ¿v1 sin varios monitores y sin «Grabar una skill» en Windows?
8. ¿Aceptas el residuo de que Control total no tiene sandbox (las reglas de `bash` no son una frontera)?
9. Para las pruebas en el PC: sesión abierta y desbloqueada, tareas programadas interactivas de un solo uso, abrir tú un aviso de UAC (S3) y lanzar Lazunox como administrador (S1).

## 3 quadragies sexies. Memoria aprendida: el agente propone, el usuario aprueba (decisión del dueño, 2026-10-07)

**Alcance.** Primera tanda de "autonomía de aprendizaje" (comparación con Hermes Agent de Nous Research): memoria
persistente **local**, sin servidor ni canal de mensajería (esas dos partes quedaron fuera, decisión expresa del
dueño). Cubre solo memoria (hechos); las skills propuestas por el agente quedan para una segunda tanda.

**El agente nunca escribe memoria.** Al final de un turno puede terminar con un bloque ` ```lazunox-memoria``` `
(hasta 5 propuestas JSON: `alcance` usuario/proyecto, `tipo`, `texto` ≤300 caracteres, `porque` opcional). El
renderer lo extrae (`src/shared/memory-proposal.ts`, puro) y lo muestra en `MemoryProposalCard` bajo el último
mensaje de una tarea terminada, con casilla por propuesta (nada preseleccionado si hay un aviso) y texto editable.
Solo al pulsar «Guardar seleccionadas» se llama a `tasks:learn:accept`, y **solo entonces** `main` escribe algo.

**Filtros, en los dos lados (nunca se confía en el renderer):**

- **Secretos** (`maskSecretPatterns`): si enmascarar cambia el texto, la propuesta entera se descarta, sin guardar
  nada de ella ni en el registro.
- **Inyección** (`looksLikeInjection`, movido a `src/shared/injection-patterns.ts`, mismas regex de Modo auto) y
  **dato personal** (correo/teléfono/RUT, heurística): solo MARCAN la propuesta (no preseleccionada); la aprobación
  humana es la única defensa real contra un "recuerdo" falso o inducido por una página/archivo malicioso.
- `main` (`src/main/tasks/learned-memory.ts`) revalida todo de cero: tipo, largo, secretos otra vez.

**Dónde vive, y por qué NO es `.lazunox/memoria.md`.** `userData/memoria/` (`usuario.md` global;
`proyectos/<slug>-<sha256(realpath)·8>.md` por carpeta), fuera del árbol del proyecto. El sandbox de Tareas ya
deniega leer/escribir `userData`: el agente sandboxeado **no puede** tocarla aunque quisiera, sin tocar
`sandbox-profile.ts` (zona intocable). Además nunca viaja por accidente con un `git push`, iCloud o Dropbox de la
carpeta del proyecto. La memoria vieja de `.lazunox/memoria.md` sigue existiendo (compatibilidad): el agente ahora
solo la LEE, nunca la escribe ni la crea (`resources/opencode/agents/tasks.md`).

**Interruptor global `learningEnabled`** (Ajustes › General, `true` por defecto, decisión del dueño): si está
apagado, no se inyecta ninguna memoria aprendida en el prompt y se le dice al agente que no proponga. Las
ejecuciones de Rutinas (desatendidas) sí reciben la memoria ya aprobada, pero se les pide no proponer nada nuevo
(nadie puede revisar una tarjeta en una ejecución programada).

**Control remoto (celular): todo `X`.** `tasks:learn:{get,accept,remove,clear}` y el ajuste `learningEnabled`
quedan prohibidos desde el celular (`src/main/remote/policy.ts`): ver, aprobar o borrar memoria aprendida se queda
solo en el Mac/PC del dueño.

**No verificado / pendiente:** detección de skills que el agente cree sin pasar por la tarjeta (ediciones
manuales, o de una versión anterior de la app, directo en `.opencode/skills/`); memoria/skills propuestas
desde Rutinas (hoy se suprime del todo); aviso de edición externa de los `.md` de memoria (Control total
podría tocarlos con `bash`: hoy no se detecta ni se impide); compactación de memoria vieja; memoria para el
modo Code (hoy solo Tareas). Nada de esto se ha probado en un Windows real más allá de typecheck/pruebas
(jsdom/Node), igual que el resto de Tareas en Windows.

## 3 quadragies septies. Skills propuestas: mismo patrón que la memoria aprendida (F8-B113)

**Cierra el otro hueco silencioso** que encontró el plan de la sección anterior: "Crear skill de esta tarea"
(`CREATE_SKILL_PROMPT`) y la skill grabada por demostración (`buildRecordedSkillPrompt`) escribían
`.opencode/skills/<nombre>/SKILL.md` directo, sin pasar por ningún filtro de secretos ni por una tarjeta
editable (la grabada sí pedía confirmar con la herramienta `question`, pero el texto libre de esa
confirmación no pasa por `maskSecretPatterns` ni por `looksLikeInjection`).

**Mismo patrón que la memoria.** El agente termina su turno con un bloque `lazunox-skill` ({name,
description, body}); `SkillProposalCard` lo muestra editable; solo al aprobar, `tasks:skill:accept` (clase
`X` en el control remoto) llama a `src/main/tasks/learned-skills.ts`, que revalida TODO de nuevo: `name` con
la misma regex de agentskills.io (1-64 caracteres, `a-z0-9-`, sin guion al principio/final, sin `--`, lo que
garantiza que la ruta final queda siempre dentro de `<carpeta>/.opencode/skills/`, nunca fuera), largo de
`description`/`body`, y `maskSecretPatterns` sobre los dos. **A diferencia de la memoria, SÍ se escribe
dentro de la carpeta del proyecto** (`.opencode/skills/`, no `userData`): es donde OpenCode las descubre, no
se puede mover. La protección acá es la validación estricta del nombre, no el sandbox de `userData`.

**Nunca sobrescribe.** Si ya existe una skill con ese nombre en esa carpeta, `tasks:skill:accept` se niega
(`reason: 'ya-existe'`); el usuario tiene que elegir otro nombre. Solo se escribe `SKILL.md`: no se crean
`scripts/`/`assets/` (código ejecutable que el agente propuso y que otra tarea correría después sería un
salto de riesgo aparte, fuera de alcance de esta tanda).

**No verificado:** una skill escrita fuera de este flujo (a mano, o de una versión anterior de la app) sigue
sin detectarse ni avisarse en la interfaz. `skillAlreadyExists`/`skillPathFor` existen y se podrían usar para
eso, pero no hay ninguna pantalla que los use todavía.

## 3 quinquagies. Visor de documentos

**Por qué existe.** Modo Tareas necesita mostrar PDF, Word, Excel y PowerPoint dentro de la propia app, con
calidad real, en vez de depender del visor del sistema operativo (y de que exista uno). El contenido que se
muestra es, por definición, **no confiable**: lo puede haber generado un agente de IA o puede venir de
cualquier carpeta que el usuario autorizó a Tareas, igual que cualquier otro archivo del árbol de trabajo.

**Por qué no puede vivir en la ventana principal.** La CSP de la ventana principal (`RENDERER_CSP`, zona
intocable de la sección 7 de `AGENTS.md`) trae `worker-src 'none'` y `frame-src 'none'`: PDF.js no podría usar
sus workers y un `.docx` no podría aislarse en un iframe. Además esa ventana tiene `window.api` con acceso a
IPC real: un fallo de parseo (tipo CVE-2024-4367 de PDF.js, ejecución de JS arbitrario) o un `.docx` con una
imagen enlazada a `http://127.0.0.1:<puerto>/…` podría alcanzar el sidecar o los proxies locales de Tareas. El
visor necesita su propio aislamiento, separado del de la app.

**Modelo de amenaza y capas de defensa**, de la más externa a la más interna:

| #   | Capa                                     | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Dónde                                                                                          |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | Vista nativa aislada                     | `WebContentsView` propia, `sandbox:true`, `contextIsolation:true`, **sin preload** (no hay IPC posible desde el documento que se muestra); `will-navigate`/`will-redirect`/`will-attach-webview` prevenidos; `setWindowOpenHandler` niega siempre                                                                                                                                                                                                                                                 | `src/main/viewer/view.ts`                                                                      |
| 2   | Sesión aislada                           | Partición propia `doc-viewer`, sin persistencia (`cache:false`, sin `persist:`): no comparte cookies, storage ni caché con la app ni con el navegador integrado. `webRequest.onBeforeRequest` cancela TODO lo que no empiece con el esquema propio `lazunox-viewer:` — ni una imagen externa de un `.docx` ni una acción `/URI` de un PDF pueden alcanzar la red. Permisos denegados, descargas bloqueadas                                                                                        | `src/main/viewer/session.ts`                                                                   |
| 3   | Esquema propio y privilegiado            | `lazunox-viewer://viewer/…`, registrado junto al esquema de la app principal (`registerSchemesAsPrivileged` solo se puede llamar una vez por proceso — **no se tocó** `RENDERER_CSP` ni `handleAppScheme`). CSP propia y estricta (`VIEWER_CSP`): `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; frame-src 'none'; object-src 'none'; connect-src 'self'; frame-ancestors 'none'` (con `'unsafe-inline'` en `style-src`, exigido por PDF.js y docx-preview)        | `src/main/security/app-protocol.ts` (solo la entrada del esquema), `src/main/viewer/scheme.ts` |
| 4   | Acceso a bytes por token, nunca por ruta | Token aleatorio de 256 bits, de un solo uso activo (abrir otro documento revoca el anterior). El manejador del esquema vuelve a validar que la carpeta sigue autorizada CADA VEZ que sirve bytes del documento (`tasks:viewer:open` ya la valida al abrir, pero el manejador no confía en eso: la carpeta pudo desaprobarse entretanto). Solo acepta `GET`, responde con `cache-control: no-store` y `x-content-type-options: nosniff`. Topes de tamaño por tipo (PDF/PPTX 100MB, DOCX/XLSX 25MB) | `src/main/viewer/tokens.ts`, `src/main/viewer/scheme.ts`                                       |
| 5   | Saneado posterior al render              | Solo para Word por ahora: después de que `docx-preview` renderiza el documento, se recorre el DOM resultante asumiéndolo hostil — todo `<a>` queda inerte, cualquier `src`/`poster`/`srcset` que no sea `data:` se elimina, se sacan `<script>`/`<iframe>`/`<object>`/`<embed>`/`<link>`/`<meta>`/`<form>` del árbol, se sacan atributos `on*`, se limpia cualquier `url(http://…)` dentro de estilos (inline o en el `<style>` que inyecta el propio docx-preview)                               | `src/viewer/docx/sanitize.ts`                                                                  |
| 6   | Canales IPC con la clase más restrictiva | `tasks:viewer:open/attach/close` son clase `X` (la vista es nativa de la ventana del Mac, lee bytes de cualquier archivo autorizado; no tiene sentido para el control remoto desde el celular); el celular sigue usando el `tasks:previewFile` viejo                                                                                                                                                                                                                                              | `src/main/remote/policy.ts`                                                                    |

**Qué NO hace esta arquitectura todavía** (para no sobre-prometer): no hay sandboxing de proceso del sistema
operativo (Seatbelt) para el proceso de render del documento; la defensa es toda a nivel de Electron/Chromium
(sesión, esquema, CSP). Es la misma aceptación que ya tiene `artifact-window.ts` para el mismo tipo de
contenido.

**Archivos clave:** `src/main/viewer/{session,scheme,tokens,doc-kind,view}.ts`, `src/viewer/docx/sanitize.ts`.

## 3 quinquagies bis. Cambios de 0.5.29 a 0.5.35: canales nuevos, avisos, pegado y botón Ejecutar (F8-B168 a F8-B173)

Resumen de superficie y límites; el detalle y las pruebas de cada punto están en `CHANGELOG-FASE8.md`. Todo lo de abajo se comprobó leyendo el código.

| Cambio                                                       | Canal / archivo                                                                                   | Quién puede invocarlo                                                                                            | Límite que importa                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nombre del equipo (F8-B168)                                  | `app:hostName` (`main/ipc/app.ts`)                                                                | Solo la ventana principal (sin entrada en `CHANNEL_ROLES`); celular: **X**                                       | Sin argumentos (esquema `none`); devuelve `os.hostname()` recortado a 100 caracteres. Solo se muestra en el panel «Entorno».                                                                                                                                                                  |
| Volver al motor incluido (F8-B169)                           | `app:useBundledEngine` (`main/ipc/onboarding.ts`, `opencode/use-bundled.ts`)                      | Solo la ventana principal; celular: **X**                                                                        | No descarga ni ejecuta nada nuevo: borra `settings.opencodeBin`. Si `OPENCODE_BIN` fija otro motor responde `pinned` y no cambia nada; sin motor incluido, `unavailable`. `OpencodeInfo.bundledAvailable` solo informa.                                                                       |
| Punto de restauración con Control total en el home (F8-B170) | `tasks:restore:create` con `wholeHome` (`main/ipc/tasks-restore-handlers.ts`)                     | Ventana principal; celular **M** acotado al ámbito (`scoped('M','folder')`, sin cambio)                          | La carpeta sigue pasando por `assertInsideApproved`. Si cubre la carpeta personal no se copia nada (`status:'skipped'`, `wholeHome:true`): en ese caso no hay punto de restauración, a propósito.                                                                                             |
| Avisos del sistema de Tareas (F8-B171)                       | `TasksPrefs.notify.enabled` y `notify.{done,approval,question,error}` (`main/tasks/os-notify.ts`) | Cambiar el ajuste: `tasks:prefs:set` (celular: campo `notify` **M**). Disparar el aviso: solo el monitor de main | Solo con la ventana sin foco y con los dos interruptores (app y Tareas) encendidos; un aviso por tarea y tipo cada 60 s; el aviso lleva solo el título de la tarea (≤ 80 caracteres, una línea), sin rutas ni contenido. Ni el renderer ni el celular pueden crear avisos con este mecanismo. |
| Pegar archivos en el compositor (F8-B172)                    | `clipboard:readFilesForPaste`, `tasks:pasteFromClipboard` (`main/clipboard/paste-files.ts`)       | Ventana principal con el foco; celular: **X**                                                                    | El renderer no manda rutas: main las lee del portapapeles. Solo archivos regulares (sin carpetas, enlaces ni dispositivos), sin ejecutables ni extensiones bloqueadas (`BLOCKED_OPEN_EXTENSIONS`), máx. 10 archivos / 25 MB cada uno / 50 MB en total; `fstat` sobre el descriptor abierto.   |
| Botón ▶ «Ejecutar» (F8-B173)                                 | `shared/terminal-command.ts`, `renderer/src/components/ShellRunButton.tsx`, `terminal-capture.ts` | Solo Code de escritorio, con un clic; no existe en el celular, Chat, Tareas ni Overdrive                         | Heurística de confirmación, **no** un límite de seguridad; el comando delicado o de varias líneas se muestra completo antes de escribirse; salida a la IA sin teclas, con secretos tachados y recortada a 8000 caracteres; desactivable en Ajustes › General.                                 |

**Botón ▶ «Ejecutar» (detalle de seguridad).**

- _Qué se escribe_: solo el bloque que la persona ve, limpio de prompts y comentarios (`prepareTerminalCommand`; máx. 4000 caracteres y 40 líneas; sin caracteres de control; solo shells de esta plataforma). Se escribe en la terminal interna del proyecto con el `pty:write` ya existente (clase **X** para el celular), con Enter por línea. No hay ejecución automática: ni la IA ni una respuesta pueden pulsar el botón.
- _Qué se confirma_: `dangerousCommandReason` marca borrar, elevar privilegios, descargar y ejecutar, permisos recursivos o `777`, discos, sistema/arranque, procesos, git destructivo (`push --force`, `reset --hard`, `clean -f`…), rutas de secretos (`.ssh`, `.env`, `.aws/credentials`, llavero…) y desinstalar paquetes. Esa heurística se puede esquivar (por ejemplo, un script que llame a otro comando): el control real es el clic explícito y que la confirmación muestre el comando completo. `mayAskPassword` solo avisa.
- _Qué recibe la IA_: únicamente lo que el shell imprimió tras el comando (nunca las teclas), tal como se veía en el búfer de la terminal, sin secuencias ANSI, sin el eco del comando ni el prompt final. `scrubTerminalSecrets` tacha llaves PEM, cabeceras `Authorization`/`Cookie`/`X-Api-Key`, variables que contienen KEY/TOKEN/SECRET/PASSWORD/PASSWD/PWD/CREDENTIAL/AUTH y los patrones de `redact-patterns.ts` (máscara `REDACT_MASK`). Si casi toda la salida era un secreto no se envía nada. Se conserva el final, hasta 8000 caracteres.
- _Cuándo_: una sola vez por ejecución, a la misma sesión (en cola si está ocupada) mientras el interruptor «La IA ve la salida de los comandos que ejecutas con ▶» esté encendido (por defecto sí, decisión del dueño; `AUTO_SHARE_DEFAULT`); si está apagado o se cambió de sesión, se adjunta como pastilla al siguiente mensaje o se manda con «Enviar a la IA ahora».
- _Límite conocido_: un secreto en un formato que ningún patrón reconoce sí llegaría a la IA; la tarjeta muestra la misma salida saneada que se comparte y el interruptor permite apagar el envío.

**Actualizador.** En 0.5.29–0.5.35 no cambió ningún archivo de `src/main/update/`, `resources/updater/` ni `scripts/update-lib.mjs`; el modelo de las secciones 3 septies y siguientes sigue vigente. Lo que sí cambió es el proceso de publicación: `scripts/release.sh` (F8-B174) encadena los scripts existentes y no puede publicar sin una confirmación escrita por una persona en un terminal; no lee ni imprime las claves de firma ni de despliegue.

**Archivos clave:** `src/main/ipc/{app,onboarding,tasks-restore-handlers,clipboard-handlers}.ts`, `src/main/clipboard/paste-files.ts`, `src/main/tasks/os-notify.ts`, `src/shared/{terminal-command,terminal-capture,terminal-context,paste-files}.ts`, `src/renderer/src/components/ShellRunButton.tsx`, `src/main/remote/policy.ts`.

## Archivos del Chat: «Ver aquí», «Abrir con tu programa» y «Mostrar en la carpeta»

Cuando la IA crea o menciona un archivo en el Chat, la tarjeta ofrece verlo en el panel lateral, abrirlo con el programa del sistema o mostrarlo en su carpeta. La ruta sale del texto del modelo (dato no confiable), así que `src/main/files/chat-files.ts` valida cada acción en main:

- Solo rutas absolutas dentro de las carpetas del chat (`userData/chat-workspace`), de los documentos generados del chat y de los proyectos recientes, con `realpath` (un enlace que escapa se rechaza) y solo archivos regulares.
- Ejecutables y lanzadores (la lista de `tasks/open-policy.ts`, archivos con bit de ejecución o sin extensión) no se muestran ni se abren: solo «Mostrar en la carpeta». `.js` y `.svg` se pueden ver pero no abrir con el sistema.
- Nombres de secretos (`.env`, llaves, `credentials*`…) no se ofrecen.
- Imagen y texto se leen en main con tope (10 MB / 512 KB) y se pintan como `<img>` (data URL) o texto/Markdown; no hay `iframe` ni HTML en bruto (la CSP no se tocó). PDF/Word/Excel/PowerPoint van por el visor nativo aislado (tipo por bytes mágicos, token de un solo uso; su validador de ruta revalida al servir). HTML usa la vista previa aislada de los bloques html.
- Canales `extras:chatFile:{info,read,viewNative,open,reveal}`: esquema estricto y clase X (no remoto) en `remote/policy.ts`.

## Disparador por archivo de las Rutinas (F8-B175)

- **Qué es**: una rutina puede dispararse cuando aparece o cambia un archivo en una carpeta que la persona eligió. Corre con el mismo modo de acceso, lista blanca y aprobaciones que cualquier rutina: el disparador no añade permisos.
- **Validación de carpeta** (`watchFolderReason`, `fileFolderProblem`): absoluta, existente, sin `..`, ni raíz, ni carpeta personal completa, ni datos de la app, ni UNC o rutas de red en Windows; se comprueba también la ruta real (`realpath`) y la política de carpetas del gestor de Tareas. En modos Tareas y Code debe ser la carpeta de la rutina (ya autorizada) o una dentro de ella. Se revalida en cada `sync`; si deja de ser válida el vigilante se cierra.
- **Datos, no instrucciones**: el nombre del archivo se limpia (una línea, sin caracteres de control, acotado), se cita entre comillas y el prompt declara que son datos. El contenido nunca se lee ni se inserta.
- **Anti-bucle y topes**: eventos durante la ejecución y un margen posterior se toman como salida propia; archivos preexistentes no disparan; tope por hora; ignora ocultos, temporales, carpetas y enlaces simbólicos.
- **Sin vigilantes huérfanos**: un vigilante por rutina activa, creado y destruido solo por `FileWatchManager.sync`; se cierran al pausar, borrar, cambiar la configuración y al detener el planificador. Sin reconocer el aviso de términos no se vigila nada.
- **Política remota**: guardar una rutina con `schedule.kind = 'file'`, o editar una que ya lo tenga, es **X** desde el celular (`file-trigger-forbidden`); `routines:inbox:list` es R y `routines:inbox:resolve` es X. Pruebas en `src/main/remote/policy.test.ts`.
- **Windows: la política de carpetas se relee antes de validar (F8-B178)**. La política de carpetas de Windows (`folder-policy-win.ts`) es síncrona y solo vale con una lectura de unidades de los últimos 120 s (`WinHost.context()` devuelve `undefined` si caducó y la política rechaza TODO con «No se pudo comprobar la política de carpetas de Windows…»: falla cerrado). Antes solo `tasks:approveFolder` releía las unidades, así que guardar una rutina por archivo fallaba salvo justo después de aprobar la carpeta en Tareas, y la tarjeta pasaba a «Carpeta no disponible» en cuanto caducaba la lectura. Ahora `routines:save` y `routines:toggle` (al activar), el arranque del planificador y cada tick llaman a `RoutineTasksPort.refreshPolicy()` antes de validar/sincronizar (solo si hay rutinas por archivo activas; coste cero si no). No se relajó ninguna regla: la carpeta vigilada sigue pasando por `watchFolderReason` (ahora también `//servidor/…` es red), `realpath` y `TasksManager.folderForbidden` (política de Windows: solo discos fijos, ni raíz de unidad, ni carpeta personal completa, ni `AppData`/datos de la app/credenciales, ni UNC/`\\?\`/`\\.\`, ni `..`, ni otros usuarios, ni enlaces/junctions en la ruta o la propia carpeta, ni la política de la organización). Para el disparador la comprobación de enlaces es **superficial** (ancestros y la propia carpeta, vía `ruta real` que sigue las junctions; NO se recorren las entradas de dentro porque el disparador no es recursivo e ignora enlaces, y recorrerlas bloqueaba el proceso principal en cada tick). Tareas, Code y la política de carpetas de Tareas no cambian. **No hace falta aprobar la carpeta en Overdrive** en modo Chat; en Tareas/Code sigue exigiéndose la carpeta de la rutina (autorizada en Tareas) y la vigilada debe estar dentro de ella. Pruebas: `src/main/scheduler/service.win.test.ts` (tabla de rutas de Windows aceptadas/rechazadas con disco falso, caducidad, arranque, Tareas/Code, guardar→vigilar→disparar).
- **Verificado en el PC Windows de pruebas** (F8-B178, modo Chat, perfil aislado): guardar sin aprobar en Tareas, rechazos de raíz/carpeta personal/red/sistema/AppData/`..`, 1 archivo = 1 ejecución, 5 = 1 agrupada, vigilancia viva pasados 5 min. **No verificado**: OneDrive real con «archivos a petición», unidades de red/extraíbles reales, bloqueos de archivo con copias lentas, Tareas/Code en Windows real.

## 3 quinquagies ter. Importar desde otras herramientas (F8-B177)

Ajustes › Importar trae a Lazunox las instrucciones de un proyecto y servidores MCP definidos en otras herramientas. Es una función de **lectura de archivos elegidos por la persona**; el riesgo es copiar secretos, o dejar que un archivo ajeno haga ejecutar algo. Invariantes (código en `src/main/extras/import-sources.ts` y `import-service.ts`):

- **Nada de escaneo.** El renderer no manda rutas: `extras:import:pick` solo dice «carpeta» o «archivo» y `main` abre el diálogo nativo. De la carpeta elegida se leen nombres fijos (`AGENTS.md`, `CLAUDE.md`, `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`); la carpeta se valida con `assertInstructionsFolder` (ni raíz, ni home, ni `userData`).
- **Lectura acotada.** Solo archivos normales de hasta 256 KB (`IMPORT_MAX_BYTES`); un enlace simbólico se resuelve con `realpath` y debe quedar dentro de la carpeta elegida (si sale, se descarta); un archivo elegido a mano se lee en su destino real. Instrucciones de hasta 200 000 caracteres (igual que `AGENTS.md`).
- **Los secretos no se copian ni se muestran.** Variables de entorno y cabeceras de un MCP se sustituyen por referencias por nombre (`{env:NOMBRE}`, que OpenCode resuelve al arrancar; una cabecera `Authorization` conserva solo el esquema `Bearer`/`Basic`); el valor de origen no se guarda en ninguna parte ni viaja al renderer. Un secreto en los argumentos del comando (patrones de `redact-patterns.ts` o el valor que sigue a una opción tipo `--api-key`), en la URL (usuario:clave, `?token=`…) o en un texto de instrucciones descarta ese elemento con el motivo (en las instrucciones, los números de línea, nunca el contenido). Los resúmenes de la vista previa se enmascaran aunque el elemento se descarte.
- **Comandos peligrosos.** Se descartan lanzadores de terminal con texto de comandos (`sh -c`, `powershell`, `cmd` salvo `cmd /c npx|node|…`), programas de la lista de denegación (`sudo`, `rm`, `curl`, `ssh`, `osascript`, `reg`…) y argumentos que encadenan comandos (`| ; && $( )` o comillas inversas). Un comando que no es un lanzador conocido (npx, node, uvx, docker…) se importa con aviso. El `cwd` de origen no se copia.
- **Mismo esquema que el alta manual.** Cada entrada pasa por `mcpEntry` (el esquema estricto de `mcp:save`) y se guarda con `saveMcpServer` (mismo `toEntry`, archivo `0600`). Los servidores importados quedan **desactivados** (`enabled: false`) hasta que la persona los activa en MCP; los nombres se sanean al patrón de nombres de MCP y nunca pisan uno existente.
- **Nada se ejecuta** durante la importación: solo se lee un archivo y se escribe `AGENTS.md` o el archivo MCP de la app. Confirmación explícita elemento por elemento (todo desmarcado). La ficha de la vista previa es de un solo uso y caduca a los 10 min; al aplicar se revalida (si `CLAUDE.md` cambió desde la vista previa, o apareció un `AGENTS.md`, no se escribe).
- **Control remoto:** `extras:import:pick` y `extras:import:apply` son clase **X** (`policy.ts`; el celular no importa). La sección está oculta en la superficie remota.
- **No cubierto:** configuraciones en TOML; resolución de `${VAR}` del origen; las referencias `{env:…}` dependen de que la variable exista en el entorno de la app (una app abierta desde el Finder no hereda las de la terminal: se pueden definir editando el conector en MCP).

## 3 quinquagies quinquies. Galería «Lo que has creado» (F8-B180)

Nuevo ítem de la barra lateral (modo `gallery`, solo escritorio) que junta en tarjetas lo que la IA creó en Chat y en Overdrive. No agrega permisos nuevos: reutiliza la validación de `files/chat-files.ts` (ruta absoluta, `realpath` dentro de carpetas permitidas, archivos regulares, nombres de secretos fuera, ejecutables y lanzadores sin ver ni abrir; `.js`/`.svg` sin abrir con el sistema) y los canales `extras:chatFile:{viewNative,read,open,reveal}` para «Ver aquí», «Abrir con tu programa» y «Mostrar en la carpeta».

| Qué                                                                                                               | Dónde                                                                                                                                                                                                                                                                                                                                | Quién puede                                                                                          | Límite                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Lista (`extras:gallery:list`), miniatura (`extras:gallery:thumb`), «Quitar de la lista» (`extras:gallery:remove`) | `main/files/gallery*.ts`, `main/ipc/extras-handlers.ts`                                                                                                                                                                                                                                                                              | Solo la ventana principal; celular **X** (`remote/policy.ts`)                                        | Esquema estricto (`pathReq`, la lista no recibe nada); tope de 500 entradas                                                                     |
| Índice local                                                                                                      | `userData/gallery-index.json` (0600, escritura atómica)                                                                                                                                                                                                                                                                              | Solo main                                                                                            | Ruta, tipo, fecha, origen, sesión/carpeta y título; nunca contenido. Todo lo leído del disco se revisa campo a campo; un archivo roto se ignora |
| Fuentes                                                                                                           | (1) documentos generados en Chat, al crearlos; (2) archivos de `userData/chat-workspace` y de los «abiertos aparte», al abrir la galería (recorrido de 3 niveles y 600 entradas, sin ocultos); (3) entregables de `tasks:deliverables` (Overdrive), que ya exigen carpeta autorizada; (4) archivos guardados con «Descargar/Guardar» | Cada alta se valida igual que una acción                                                             | Nada fuera de esas fuentes: la galería no recorre carpetas del usuario                                                                          |
| Overdrive                                                                                                         | La entrada guarda su carpeta autorizada (`root`); en cada lista y en cada acción se vuelve a preguntar a `TasksManager.assertInsideApproved`                                                                                                                                                                                         | Si se revoca la carpeta, los archivos pasan a «Archivo no encontrado» y dejan de poder verse/abrirse | Solo ese archivo, dentro de esa carpeta                                                                                                         |
| «Descargar/Guardar»                                                                                               | El destino lo elige la persona con el diálogo nativo; la entrada autoriza **ese archivo exacto** (`root` = el propio archivo), no su carpeta                                                                                                                                                                                         | Ver/abrir/mostrar solo ese archivo                                                                   | Un archivo vecino de la misma carpeta sigue sin estar permitido                                                                                 |
| Miniaturas                                                                                                        | Imágenes PNG/JPG/GIF/WebP/BMP de hasta 10 MB, reducidas a 320 px con `nativeImage` y guardadas en `userData/gallery-thumbs` (máx. 600 archivos, 256 KB cada una); texto/Markdown/HTML: primera línea de los primeros 4 KB, que la interfaz pinta como texto                                                                          | Solo main                                                                                            | Sin red; Office y PDF **no** se renderizan (ni con programas externos): la interfaz dibuja un ícono por tipo. SVG no tiene miniatura            |

- «Quitar de la lista» no borra el archivo: lo saca del índice y el recorrido automático no lo vuelve a traer.
- Un archivo borrado o movido sale con «Archivo no encontrado» y la opción de quitarlo; no se intenta rastrearlo.
- Los documentos temporales del Chat (`lazunox-chat-docs`) los barre la app a las 24 h o al cerrar la conversación: su entrada pasa a «no encontrado» (solo «Descargar» o «Abrir aparte» los deja en una ruta duradera).
- «Ver aquí» cambia a Chat y abre el panel de siempre (con una conversación nueva el panel usa el id `galeria` solo para cerrar la vista nativa).
- No verificado: Windows real (solo rutas de Windows inyectadas en las pruebas), miles de archivos reales, Overdrive con carpetas autorizadas reales.

## 3 quinquagies quater. Modos de permisos de Code (F8-B179)

Los modos del chip («Preguntar siempre», «Editar sin preguntar», «Solo explorar», «Automático», «Todo sin preguntar») no los aplica la app: **solo escribe reglas en la sesión del motor** y el motor decide. Qué hace el motor 1.19.0 (verificado con el motor real, `docs/estudio-competencia/permisos-arreglo.md`):

- `session.update({ permission })` **añade** las reglas al final de las que la sesión ya tenía; no las reemplaza. Gana la **última** que coincide (permiso y patrón con comodines). Cambiar de modo en una sesión dejaba vigentes los `ask` del modo anterior.
- El motor lee las reglas de la sesión **al empezar** cada respuesta: un cambio de modo no alcanza a la respuesta en curso (el chip avisa «El cambio vale desde el próximo mensaje»).
- En una orden compuesta (`ls && ls > f`, `ls | ls > f`) el motor evalúa cada subcomando **por separado y sin su redirección**: una regla `allow` para `ls` deja pasar `ls > f` (se comprobó: escribió el archivo sin preguntar). Por eso **no se permiten comandos de lectura con reglas del motor**.
- Los subagentes (herramienta `task`) heredan solo las reglas `external_directory` y `deny` del padre: los `ask` no se heredan.

### Cómo queda

- **Bloque autosuficiente por modo** (`src/shared/permission-rules.ts`, `rulesetForMode`): cada bloque fija, para cada permiso que la app gestiona (`edit`, `write`, `read`, `bash`, `webfetch`, `websearch`, `external_directory`, `task`), un valor explícito con patrón `*`, y luego sus excepciones. El resultado depende solo del **último** bloque: una sesión creada en «Preguntar siempre» y pasada a «Automático» se comporta igual que una creada en «Automático» (prueba con un simulador del motor para todas las parejas de modos, `permission-rules.test.ts`). El agente `plan` manda sobre el modo (`effectiveModeFor`); «Solo explorar» también envía su bloque (niega `edit`/`write` salvo `.opencode/plans/*.md`, como el agente `plan`).
- **Idempotente**: solo se reenvía si la sesión no termina ya con el bloque pedido (`endsWithRuleset`); ya no crece la lista en cada mensaje. Al volver a un modo anterior se añade su bloque una vez más (el motor no permite quitar reglas).
- **Tabla** (sesión nueva o cambiada, igual): «Preguntar siempre» pregunta `edit`, `write`, `bash`, `webfetch`, `websearch`, carpetas externas y **lanzar un subagente**; «Editar sin preguntar» permite `edit`/`write` y **pregunta** comandos, web y carpetas externas; «Solo explorar» niega editar y pregunta los comandos que no son de lectura; «Automático» edita y lee sin preguntar, aprueba comandos de solo lectura y pruebas, y pregunta lo demás (web incluida); «Todo sin preguntar» permite todo salvo `doom_loop`.
- **Aprobación automática de comandos de lectura** (Automático y Solo explorar): el motor pregunta por todo comando (`bash * ask`) y la app responde «una vez» solo si la sesión termina con ese bloque y el **comando completo** (`metadata.command`) es un único comando simple de la lista (`ls`, `dir`, `pwd`, `git status|diff|log|show|rev-parse`, `git branch` solo para listar, `Get-ChildItem`, `Get-Location`; en Automático además `npm run` y `npm test`), sin redirecciones, tuberías, `;`, `&`, `$`, comillas inversas, barra invertida, paréntesis, saltos de línea, `--output` ni `--exec` (`isAutoApprovableCommand`). Cualquier otra cosa sale como tarjeta. No están `cat`/`type`/`Get-Content` (saltarían la pregunta de `.env`), `find`, `curl`, `npm install`. **Si la ventana no está abierta nadie aprueba**: el motor espera. Comparar no tiene interfaz que apruebe: allí el motor permite las cinco órdenes de siempre (prefijos `git status`, `git diff`, `git log`, `npm run`, `npm test`) y «Todo sin preguntar» ya **no se rebaja** a «Automático».
- **Siempre pregunta** (en todos los modos salvo «Todo sin preguntar», que levanta los dos primeros): carpetas fuera del proyecto y lectura de `.env`; la repetición sospechosa (`doom_loop`) pregunta incluso en «Todo sin preguntar». El chip lo dice en una nota.

### No cubierto (dicho con honestidad en la interfaz)

- **Conectores externos (MCP)**: no llevan regla propia; caen en el `*: allow` del agente y pueden actuar sin avisar (inferido del código del motor; no se probó con un conector real). No se cubrieron con un `*` porque preguntaría por herramientas internas de uso normal.
- **Subagentes**: con «Preguntar siempre» se pregunta al lanzarlos, pero lo que hacen dentro no pasa por las reglas del padre (solo `external_directory` y `deny` se heredan).
- La lista de reglas de una sesión solo crece (cada cambio de modo suma un bloque); no hay forma de quitar reglas del motor.
- Overdrive (Tareas) y Chat no cambian: su agente y sus reglas son otros.

## 3 quinquagies sexies. Personalización: habilidades y conectores (F8-B181)

Pantalla «Personalización» (Habilidades / Conectores / Tuyos). Catálogo: `resources/catalogo/catalogo.json` (sin servidor ni descargas; `docs/CATALOGO.md`).

- **Habilidades = código de terceros.** Son instrucciones y, a veces, programas que el agente puede usar. La pantalla lo dice con un aviso claro y **nada se instala sin confirmación**.
- **Solo desde una carpeta elegida en el diálogo nativo** (lo abre `main`; el renderer nunca manda una ruta). `skill-folder.ts` solo lee: exige `SKILL.md` con `name` y `description`, rechaza enlaces simbólicos, archivos especiales, binarios ejecutables (Mach-O, ELF, PE), tipos desconocidos y texto que parezca un secreto, y pone topes (200 archivos, profundidad 4, 2 MB por archivo, 8 MB en total). **No ejecuta ni importa nada.**
- **Vista previa y confirmación**: `personalizacion:skills:pick` devuelve lo que se copiará (lo leído, no la carpeta viva) y una ficha de un solo uso de 10 minutos; `install` compara la huella y rechaza si la carpeta cambió. Instalación atómica (copia a un temporal y renombra). Nunca pisa una habilidad incluida ni una ya instalada.
- **Interruptor de habilidades incluidas**: quita o restaura la copia de trabajo (`opencode-config/skills`); el paquete no se toca y aplica a conversaciones nuevas. `prepareOpencodeConfigDir` conserva las propias y no restaura las apagadas.
- **Canales** `personalizacion:skills:{list,setEnabled,pick,install,remove}`: esquema estricto en `schemas.ts` (nombres `^[a-z0-9]+(-[a-z0-9]+)*$`, ficha hexadecimal de 32) y **clase X** en `policy.ts` (nunca desde el celular).
- **Conectores**: solo remotos `https` del catálogo empaquetado; reutilizan `mcp:save`/`mcp:remove` de Ajustes (misma validación, mismo guardado cifrado de secretos, `useMcpConnections`). Desactivados por defecto: se conectan tras el paso a paso (qué podrá y qué NO, aviso de que verá los datos y se los pasa al modelo, casilla «Entiendo»). Los valores secretos van enmascarados, no se registran ni se reescriben en pantalla. Sin OAuth propio.
- **Sello «Revisado por Lazunox»** solo en fichas del catálogo empaquetado.
- **Pruebas**: `src/main/personalizacion/personalizacion.test.ts` (carpetas hostiles, topes, huella, ficha caducada, apagar/encender), `src/main/ipc/personalizacion-ipc.test.ts` (esquemas y clase X), `src/test/catalogo.test.ts`, `PersonalizacionView.test.tsx`.
- **No verificado**: Windows real; conectores contra los servicios reales desde esta pantalla; habilidades con binarios propios de cada plataforma (se rechazan los ejecutables).

## 3 quinquagies septies. Búsqueda dentro de los mensajes (F8-B182)

La paleta busca en el contenido de las conversaciones de Chat y Code. Sin canales IPC nuevos ni cambios en `main`: es solo renderer.

- **Solo en memoria.** El texto preparado para buscar vive en la memoria de la ventana (`src/renderer/src/features/search/`). No hay archivo en `userData` ni en ningún otro lugar; cerrar la app lo borra y «Borrar lo leído» (pie de la paleta, `clearSearchIndex`) lo vacía al instante y detiene las lecturas hasta que se vuelva a abrir la paleta. Nada sale del equipo (se lee el historial por el mismo cliente local del motor que ya usa la app).
- **Qué se guarda y qué no.** Solo el texto visible de los mensajes del usuario y de la IA. No: resultados de herramientas (donde caería el contenido de un `.env`), razonamiento, archivos, el bloque de adjuntos ni los bloques internos de memoria. Antes de guardar se tapan secretos con `maskSecretPatterns` (`src/shared/redact-patterns.ts`) y los bloques de llave privada; el texto tapado no se puede buscar ni aparece en el fragmento.
- **Topes**: 300 conversaciones, 20 000 caracteres por mensaje y 400 000 por conversación; lectura con 2 en paralelo y pausa.
- **Fuera de alcance**: las tareas de Overdrive (sandbox por carpeta) no se leen desde aquí. El celular no tiene paleta (`no-command-palette` en la PWA), así que no hay superficie remota nueva.
- **Pruebas**: `search-index.test.ts` (secretos y llaves privadas no se encuentran, herramientas y razonamiento no se indexan), `search-service.test.ts` (vaciar y no releer).

## 3 quinquagies octies. Conectores de la vida diaria: por qué no hay correo ni calendario todavía (F8-B184)

Sin canales IPC nuevos, sin cambios de `main`, del motor ni de permisos. Lo que se decidió y por qué:

- **No se ofrece un conector de correo, calendario o archivos que no pueda quedarse en solo lectura.** El motor (OpenCode 1.19.0) pide al servicio todos los permisos que el servidor anuncia, no los de la configuración; para Gmail eso incluye `gmail.send`, `gmail.modify` y acceso total. Un «solo consulta» que dependa de un texto de la ficha y no de un candado real no se publica. Comprobado con la dirección de autorización que arma el motor (Dropbox: nueve permisos, seis de escritura).
- **Los servidores oficiales de Google no se pueden conectar desde el motor**: responden sin sesión, el motor los marca «conectado» y no inicia sesión (dirección de autorización vacía). No se parchea con trucos (cabeceras falsas, tokens pegados a mano): un token pegado caduca en una hora y obligaría a guardar credenciales en la configuración.
- **Credenciales**: ninguna vía considerada pasa tokens por servidores de terceros; los intermediarios de pago se descartaron por eso. Con inicio de sesión del motor, el acceso queda en `mcp-auth.json` del motor (modo 0600, dentro de su carpeta de datos); un servidor local guardaría el suyo (p. ej. cifrado AES-256-GCM con la clave en el Llavero, según su documentación, sin verificar aquí).
- **Si se decide implementar** (`docs/conectores-cotidianos.md` §4): conectores locales (programa fijado por versión y hash, `--read-only` obligatorio, consentimiento explícito y repaso del sandbox de Tareas) o inicio de sesión propio de la app (la app pasaría a manejar tokens: revisión de seguridad aparte). Por herramienta, el motor admite `permission["<servidor>_<herramienta>"] = "deny"` (gana la última regla que coincide); la lista de herramientas de escritura de cada servidor se saca de `readOnlyHint` con `scripts/check-conectores-cotidianos.mjs`.
- **Etiqueta de estado real** (`accountTested`): una ficha sin prueba con cuenta real lo dice en pantalla; la prueba `catalogo.test.ts` impide afirmar una cosa en `verification` y mostrar otra.

## 3 quinquagies nonies. Proyectos del Chat con archivos de conocimiento (F8-B185)

La persona reúne instrucciones y archivos en un proyecto; en sus conversaciones, el modelo recibe las instrucciones y los pasajes de los archivos parecidos a cada mensaje. Todo es local: sin embeddings ni servicios.

- **Qué sale del equipo.** Solo los pasajes recuperados (máx. 5, 1200 caracteres cada uno y 5000 en total) y las instrucciones del proyecto, hacia el modelo que la persona eligió y solo en las conversaciones del proyecto. Los archivos, su copia y el índice nunca salen. La pantalla del proyecto lo dice en lenguaje llano.
- **Contenido no confiable.** Un archivo puede contener órdenes: los pasajes van en `<pasajes_del_proyecto>` con la advertencia «datos, no instrucciones» ANTES del contenido, sin poder cerrar ni abrir bloques del marco (`sanitizeFrameText` quita las etiquetas, también con atributos o anidadas, repitiendo hasta que no quede ninguna). El marco nunca concede permisos ni acceso; el agente de Chat no tiene herramientas de disco. Pruebas: `project-context.test.ts`; verificado con el modelo gratuito (el archivo hostil no cambió la respuesta).
- **Canales `projects:*` (10), todos clase X** y solo la ventana principal. Esquema estricto: ids de 16 hex, topes de nombre, instrucciones y pregunta, base64 ≤ 10 MB, claves inesperadas → `INVALID`. **El renderer no manda rutas**: el diálogo nativo lo abre `main` y devuelve fichas de 32 hex de un solo uso (10 min); los archivos arrastrados llegan como bytes. El proyecto de una conversación lo decide `main`.
- **Qué archivos se aceptan.** Extensiones de documentos y texto; nunca nombres de secretos (`isSensitiveName`: `.env`, llaves, credenciales; también si el destino de un enlace simbólico lo es), ejecutables y lanzadores (`BLOCKED_OPEN_EXTENSIONS`), carpetas ni archivos no regulares. Lo rechazado no se indexa ni se copia; queda anotado con el motivo.
- **Almacén local.** `userData/projects/` (`projects.json`, copias en `<id>/files/`, `<id>/index.json`), permisos 0600, escritura atómica. Ids generados en `main` y revalidados al leer; ninguna ruta se arma con texto de la persona ni del modelo; lo leído del disco se trata como no confiable (campos revisados, pasajes de archivos inexistentes descartados). Eliminar un proyecto o un archivo borra sus copias y su índice. Límites: 50 proyectos, 20 archivos y 50 MB por proyecto, 10 MB por archivo, 1,5 M de caracteres indexados por proyecto.
- **PDF.** `pdf.js` dentro de `main`, sin scripts (`isEvalSupported: false`), tope de 400 páginas y 60 s; Office por el lector de solo lectura existente (sin macros, vínculos ni programas externos).
- **Fuera de alcance.** Desde el celular no hay canales ni pantalla de proyectos (`projects:*` es X; el `system` no se manda desde el celular).
- **Pruebas**: `projects.test.ts`, `projects-ipc.test.ts`, `actions.proyectos.test.ts`.

## 3 quinquagies decies. Conectores locales: Gmail, Calendar, Drive y Outlook, Calendario, OneDrive (F8-B186)

**Cambia a propósito el contrato «añadir un conector no ejecuta nada».** Los conectores REMOTOS siguen igual. Las fichas con `transport: "local"` instalan y ejecutan en el equipo un programa de un tercero (hoy dos: `workspace-mcp` de Taylor Wilsdon, MIT, y `@softeria/ms-365-mcp-server`, MIT). La ficha lo dice con todas las letras («Instala y ejecuta un programa en tu equipo») y exige DOS casillas distintas: «Entiendo que esto instala un programa de un tercero» y «Entiendo que … podrá ver mis datos». Sin las dos, «Seguir» no se habilita, y el canal rechaza cualquier cosa que no sea `true` en ambas.

- **Qué corre y bajo qué aislamiento (dicho sin adornos).** El motor lanza el programa como servidor MCP local de OpenCode, hijo del `opencode serve` del Chat/Code. Ese motor NO corre en el sandbox de Seatbelt (Mac) ni en WSL2 (Windows): solo se desvincula de los permisos TCC y se le da un entorno mínimo (`minimalEnv`). Por tanto el programa corre con los permisos de tu usuario, puede leer tus archivos y hablar con cualquier sitio. **No hay aislamiento** y la ficha lo dice. Lazunox no auditó su código. Se compensa con: versión y hashes fijados, solo consulta, secretos fuera de `opencode.json`, y que NUNCA se ofrecen en Overdrive (`tasksMcpContribution` los deja en `blocked`, con o sin sandbox; un conector local con variables de entorno ya se bloqueaba en el sandbox por poder leerse con `ps eww`).
- **Instalación sin shell y verificable.** `src/main/extras/local-connectors.ts`: `execFile` con lista de argumentos (nada de shell), entorno mínimo, límite de 15 minutos. `uv`: `--no-config --no-cache --managed-python venv` y `pip install --require-hashes --only-binary :all: --no-deps -r requirements.lock` (cada una de las ~100 dependencias lleva su SHA-256; solo ruedas ya compiladas: ninguna instalación ejecuta código de terceros). `npm`: `npm ci --ignore-scripts` con `.npmrc` vacíos y el registro oficial (cada paquete con integridad sha512 en `package-lock.json`). Los archivos de bloqueo viajan DENTRO de la app (`?raw`), su SHA-256 va en la ficha y se comprueba ANTES de tocar el disco; después se comprueba que la versión instalada es la fijada. Si algo falla se borra la carpeta entera. El instalador (`uv` o `npm`+`node`) debe existir en el equipo: se confía en el que ya tiene la persona (no se descarga ninguno). Lo que no se verifica: que PyPI/npm no hayan retirado un archivo (la instalación falla cerrado) ni lo que hay DENTRO de los paquetes fijados.
- **Nada de la persona entra en comandos.** `validateCatalog` rechaza en una ficha local: versión con rango, `--read-only` ausente, argumentos con caracteres de shell o intérpretes (`-c`, `-e`, `--eval`…), variables de entorno que alteran la carga (`PATH`, `NODE_OPTIONS`, `LD_*`, `DYLD_*`, `PYTHON*`, `UV_*`, `NPM_*`), rutas con `..`, entradas de texto (`inputs`) o `writes: true`. El único dato de la persona es el nombre del servidor (`MCP_NAME_RE`), que solo nombra una carpeta y las claves de permisos.
- **Credenciales.** La app y la IA no ven contraseñas ni tokens. La persona entra a su cuenta en su navegador: Google, con SU PROPIO cliente OAuth (tipo «Aplicación de escritorio») cuyo archivo `.json` elige en el diálogo del sistema (`mcp:localPickClient`, X): el contenido NO pasa por la pantalla (solo vuelve el comienzo del identificador); main lo valida, lo reescribe con las direcciones de Google fijas (un archivo manipulado no puede desviar el token) y lo guarda con 0600 en la carpeta del conector; el motor solo recibe la RUTA en una variable de entorno. Microsoft: inicio de sesión por código de dispositivo con la aplicación de Microsoft que registró el autor del programa (sin secreto), solo cuentas personales (`MS365_MCP_TENANT_ID=consumers`). **Dónde queda cada cosa** (todo bajo `userData/conectores-locales/<nombre>/`): el programa; `credenciales/` (Google: lo que guarde `workspace-mcp`; Microsoft: `token-cache.json` y `cuenta-elegida.json`); `registros/`; `client_secret.json` (solo Google). Esos tokens los guarda el propio programa en archivos de su carpeta: **no están cifrados con el Llavero** (lo que el programa necesita leer él mismo). El secreto del cliente tampoco va en el Llavero ni en `opencode.json` ni en el entorno (`ps eww` no lo ve): se eligió un archivo 0600 en lugar de una variable de entorno justamente por eso. Cualquier proceso de tu usuario (incluido un agente con permiso de `bash`) podría leer esos archivos: es el límite de un programa local sin sandbox. **Quitar** borra la carpeta entera (programa, tokens, secreto del cliente, registros), el servidor, las reglas de permisos y la procedencia; la persona puede además revocar el acceso en la página de seguridad de su cuenta Google/Microsoft. Además `cwd` es esa carpeta: un `.env` de la carpeta del proyecto no puede cambiar el cliente de OAuth del programa.
- **Solo consulta, con dos candados.** (1) `--read-only` del propio programa (en Google además pide únicamente `gmail.readonly`, `calendar.readonly`, `drive.readonly`; comprobado en la dirección de autorización real; en Microsoft, `--preset mail,calendar,files` pide solo `Mail.Read`, `Calendars.Read`, `Files.Read`, `MailboxSettings.Read`, `User.Read`). (2) El motor lo respalda con `permission["<servidor>_<herramienta>"] = "deny"` para TODA herramienta que el programa publica en modo completo y no está en la lista de uso (Google 21: las 20 que escriben más `get_gmail_attachment_content`, que guarda archivos en el equipo; Microsoft 60: las 57 que escriben más `logout`, `remove-account` y `download-bytes-to-file`), escritas DESPUÉS de «preguntar antes de cada uso» porque en el motor gana la última regla. Verificado con el motor real: el modelo ve exactamente las 17 herramientas permitidas de Google y ninguna de las 21 negadas (incluida `get_gmail_attachment_content`, que el programa sí expone). Las únicas permitidas que no consultan datos son las de entrar a la cuenta (`start_google_auth`; `login`, `verify-login`, `select-account`).
- **Editar o quitar por la vía general.** `mcp:save` rechaza editar un conector local (le quitaría el solo-consulta); `mcp:remove` los borra por completo. Si alguien edita `opencode.json` a mano, la ficha pasa a «modificado» (se compara la entrada exacta).
- **Canales nuevos**: `mcp:localPickClient` y `mcp:installLocal`, ambos clase **X** (solo desde el Mac, nunca desde el celular), con esquema estricto (`literal(true)` en las dos confirmaciones). `mcp:catalog` (R) ahora informa si hay `uv`/`npm` y la plataforma; no lleva secretos.
- **No verificado**: ninguna autorización con una cuenta real (las dos fichas llevan «Aún sin probar con una cuenta real» hasta que Ben las pruebe: `docs/conectores-locales-prueba.md`); Windows (las fichas dicen `platforms: ["darwin"]`); que Google acepte `http://localhost:8765/oauth2callback` con un cliente de escritorio (lo esperable, pero sin cuenta no se vio).

## 3 quinquagies undecies. Recetas de Rutinas y pantalla de Uso (F8-B188, F8-B189)

- **Recetas**: solo datos empaquetados (`resources/rutinas/recetas.json`); no hay canales IPC nuevos, descarga ni servidor. Elegir una receta solo rellena el formulario del renderer; la rutina se crea por `routines:save` (esquema estricto, clase de siempre) cuando la persona pulsa «Crear rutina», y pasa por las mismas puertas: aviso de términos de Rutinas, carpeta aprobada (`tasks:approveFolder`), límites del disparador por archivo (como mucho 10 por hora en recetas) y resultado a la bandeja de «Resultados por revisar».
- **Qué garantiza el validador** (`validateRecipes`, probado con mutaciones): sin `fullAccess`, sin sitios extra, `onAsk: reject`, permisos «sin preguntar» solo de lectura (`read/list/glob/grep`, `ls`, `git log/show/diff/status/shortlog/blame`), nada de edición ni borrado, y las instrucciones con carpeta piden no modificar y dejar el resultado en la respuesta final. La respuesta del usuario a una pregunta se limpia (una línea, sin llaves) antes de entrar en la instrucción.
- **Lo que NO es un candado**: «solo propone» en Overdrive y Code es una instrucción a la IA. El agente de Overdrive permite `edit` y `bash` dentro de su carpeta sin preguntar (excepto `rm`, `rmdir`, borrados, que preguntan y en una rutina se rechazan); en Code el planificador descarta las reglas «sin preguntar». Un archivo de entrada o una página web hostil podría intentar desviar a la IA; el disparador por archivo ya declara los nombres como datos (`buildFilePrompt`). La interfaz no lo promete: dice «se le pide / se le indica».
- **Uso**: lee solo del motor local (`experimental.session.list`, 300 sesiones, bajo demanda) y de las sesiones ya en memoria; no escribe nada en disco ni envía nada fuera. Muestra modelos y títulos solo en pantalla.

## 3 quinquagies duodecies. Puente con Telegram: avisos y permisos con botones (F8-B187)

**Qué cambia el modelo de confianza.** Hasta ahora lo que aprobaba un permiso era la persona **delante del Mac**. Con Telegram activado, también puede hacerlo quien controle una cuenta de Telegram vinculada. Por eso la función es opt-in en cuatro pasos (activar el interruptor, crear el bot, pegar su clave, escribir un código), está **apagada por defecto**, y se puede cortar al instante («Detener todo ahora»). Diseño completo, investigación y pruebas: `docs/telegram.md`.

- **Un solo dueño.** El chat vinculado es la única entidad que el bot atiende: chats privados ajenos, grupos, canales, bots, ediciones y cualquier otro tipo de mensaje se **ignoran sin responder**. Los botones valen solo para ese chat (`from.id` y `message.chat.id` iguales al dueño).
- **Vinculación.** Código de 6 dígitos que muestra la app (nunca viaja por Telegram), generado con `crypto.randomInt`, 10 min de vida, un solo uso, comparación en tiempo constante, 5 intentos y bloqueo de 15 min (no se puede pedir otro código durante el bloqueo). El polling solo corre con un código vigente o con un chat vinculado: sin eso, ninguna llamada de red.
- **Token.** Cifrado con el mismo almacén seguro que los celulares vinculados (`KeyboxSafeStorage` en macOS empaquetado, `safeStorage` en el resto); si no hay cifrado disponible **no se guarda** (sin respaldo en claro). Archivo propio `userData/telegram-token.bin`: jamás en `opencode.json`, `settings.json`, registros ni auditoría. La ventana solo recibe `botConfigured` y los últimos 4 caracteres; el token entra una vez por `telegram:saveToken` y no vuelve. Los errores de red y de la API pasan por `scrubToken` antes de ir a cualquier registro. «Quitar el bot» borra el archivo.
- **Destino fijo.** `https://api.telegram.org`. Un servidor de Telegram falso solo se admite si la app NO está empaquetada, por la variable de entorno `LAZUNOX_TELEGRAM_API_BASE`, y solo con direcciones `http://127.0.0.1|localhost|[::1]`; ningún ajuste, archivo ni mensaje de la ventana lo cambia (`resolveApiBase`, con prueba de URLs hostiles).
- **Botones.** `callback_data` = `p:<12 caracteres aleatorios>:<a|r>` (16 bytes; el id no contiene ni deriva del id del permiso), vigencia 30 min, un solo uso (se reabre solo si el motor no pudo responder), ligados al chat dueño y a un permiso. Solo «Permitir una vez» y «Rechazar»: **no hay «siempre»**. Tope de 30 «Permitir» por hora.
- **Dos respondedores.** El motor decide (404 a la segunda respuesta); el puente edita el mensaje de Telegram si ganó la pantalla y responde «ya respondido en el computador» a un botón tardío; la tarjeta de la pantalla se quita sola cuando Telegram gana.
- **Lo que sale.** Tapar secretos (`maskSecretPatterns` + tokens de bot + llaves privadas) → quitar caracteres de control y de dirección → recortar (comando completo hasta 2400 caracteres; si pasa, inicio y final con aviso) → escapar HTML, siempre en este orden; el mensaje ya escapado cabe en 4096.
- **Lo que entra.** Tres comandos fijos (`/start`, `/estado`, `/desvincular`) y botones. **Ningún texto de Telegram se reenvía al motor** (el módulo no tiene ninguna llamada que mande texto del chat al motor); las instrucciones en lenguaje natural son la entrega 2 y tendrán su propia auditoría. Límite de 30 mensajes entrantes por minuto.
- **IPC.** Ocho canales `telegram:*` (clase **X**, esquema estricto, solo ventana principal) y el evento `telegram:state-changed` (`deny`): nada es accesible desde el control remoto ni la PWA.
- **Auditoría local** (`userData/telegram-audit.jsonl`, rotada a 256 KB): vinculación, desvinculación, activar/desactivar, «Detener todo», permiso enviado, respondido por Telegram o por la pantalla, caducado. Solo tipo, hora, motivo fijo, tipo de permiso y una **huella** de 8 hex del chat; nunca comando, token ni número de chat.
- **Aviso en la interfaz**: «Telegram no cifra de extremo a extremo los mensajes de los bots y puede ver su contenido. El computador debe estar encendido con Lazunox abierto.»
- **No cubierto (dicho sin adornos).** (1) Quien controle la cuenta de Telegram de la persona puede aceptar permisos pendientes. (2) No se reutiliza la lista de denegación de comandos del remoto (sin auditar); la persona lee el comando completo. (3) El modo Tareas (Overdrive) no está conectado. (4) Nada probado contra Telegram real ni en Windows.

## 3 quinquagies terdecies. Rama, subida y pull request desde Code (F8-B190)

- **Canales**: `pr:status`, `pr:gh`, `pr:createBranch`, `pr:pushPlan`, `pr:push`, `pr:changes`, `pr:workDiff`, `pr:view`, `pr:create`, `pr:reviewInfo`, `pr:postReview` (contrato en `ipc-code.ts` / `ipc-pr.ts`, esquema estricto en `schemas.ts`, handlers en `src/main/pr/handlers.ts`). Clase **X** para el celular (`src/main/remote/policy.ts`; la ventana no existe en la PWA: `swaps.ts`). Solo la ventana principal, y solo carpetas abiertas en ella o recientes (misma regla que los archivos del proyecto).
- **Qué sale del equipo y cómo se controla**: subir la rama (`git push --set-upstream -- <remoto> refs/heads/x:refs/heads/x`), abrir un PR (`gh pr create`) y publicar una revisión (`gh api …/reviews`, evento `COMMENT`). Las tres son acciones explícitas con un cuadro de confirmación (rama, remoto = dirección de SUBIDA, texto exacto); `main` recalcula el plan y rechaza si cambió la rama o la punta, si hay bloqueos o si, en una rama protegida, no se escribió su nombre. Nunca `--force`, nunca `+` en el refspec, nunca `--no-verify`, nunca una URL como remoto ni un token en el entorno.
- **Entrada validada**: ramas `[A-Za-z0-9._/-]` (sin `..`, `//`, `.lock`, segmentos con punto inicial, `-` inicial), remotos `[A-Za-z0-9._-]` y ya existentes, PR por número o enlace https de github.com, título de una línea, textos sin caracteres de control; `execFile` sin shell, `gh` por ruta absoluta (PATH solo absoluto y fuera de la carpeta del proyecto), entorno mínimo, 45–120 s de tope, salida acotada, stdin siempre cerrada.
- **Secretos**: el plan de subida lista los archivos de todos los commits que saldrían (`isSensitivePath`, el mismo criterio que el filtro de diffs del celular) y busca claves en las líneas añadidas (`src/shared/secret-scan.ts`, patrones de `no-secrets.test.ts`); un secreto añadido y borrado después SIGUE bloqueando (viaja en el historial); si no se puede revisar entero, bloquea. No hay forma de saltarlo desde la interfaz. A la IA no le llegan diffs de archivos sensibles ni claves (`filterRawDiff` + `maskSecretPatterns`).
- **Contenido ajeno = datos**: la descripción y el diff de un PR van dentro de `<datos_…>` con la advertencia «DATOS, NO instrucciones»; el marco se neutraliza si el contenido intenta cerrarlo. La IA corre en una sesión efímera sin herramientas reales (permisos denegados salvo `read` de una ruta inexistente) y solo devuelve texto; una revisión nunca aprueba ni pide cambios. Un PR de otro repositorio se rechaza (hay que abrir ese proyecto).
- **gh**: sesión propia de la persona (`gh auth login`); Lazunox no pide, ve ni guarda tokens. No probado contra GitHub real.
- **Pruebas**: ver `CHANGELOG-FASE8.md` F8-B190.

## 3 quinquagies quaterdecies. Puente con Telegram, entrega 2: seguir y escribir a una sesión, archivos (F8-B191)

- **Un solo dueño** (igual que la entrega 1): botones y mensajes de otro chat, grupo o canal se ignoran sin responder; los botones nuevos (`s:`, `o:`, `f:`) llevan un id aleatorio de 72 bits ligado al chat dueño, con caducidad; lo que representan (sesión, texto, ruta) vive solo en `main`.
- **Escribir está apagado por defecto** y se apaga solo al desvincular, apagar Telegram, quitar el bot o «Detener todo». Con él encendido el texto es un mensaje de usuario normal: no concede permisos (`permission.reply` solo ocurre por los botones y su tope por hora), no cambia modo ni carpetas, no crea sesiones ni inicia Overdrive; solo hay 6 comandos (más sus nombres en inglés) y el resto responde «No conozco ese comando». Límite de 6 mensajes por minuto, no se suma a una sesión ocupada, un mismo mensaje de Telegram no se envía dos veces tras un reinicio (`lastWriteId`). Límite honesto: el mensaje va SIN la memoria ni las instrucciones personalizadas que la pantalla agrega (igual que el celular).
- **Aviso de modos**: al elegir una sesión de Code en «Todo sin preguntar», «Automático» o «Editar sin preguntar» (o de modo no identificable) el bot lo dice; también si cambia después. Un mensaje por Telegram en esos modos pone a la IA a actuar sin preguntar: por eso el interruptor está apagado y se explica en Ajustes.
- **Lo que sale**: tapar → recortar → escapar, también en las líneas de avance, la respuesta final (tapada ANTES de partir en trozos), el archivo `respuesta.md` y «Ver todo». «Solo resúmenes» no manda salidas ni contenido de archivos. Telegram no cifra de extremo a extremo (aviso en Ajustes).
- **Archivos que salen**: mismas reglas del Chat (`resolveChatFile`), solo desde las carpetas de ESA sesión, sin secretos, ejecutables ni carpetas reservadas, ≤ 50 MB, revalidado al pulsar (un enlace cambiado después no pasa).
- **Archivos que entran**: ≤ 10 MB (y los topes del Chat por clase), bytes iniciales contra el tipo, nunca ejecutables/scripts/secretos, `data:` (nunca `file://`), Office como texto con marco de «datos». Un tamaño que miente se corta en la descarga.
- **Hallazgo**: la URL de descarga (`/file/bot<clave>/…`) llevaba la clave a la caché HTTP en disco; ahora la API usa una sesión en memoria sin caché y la verificación con la app real busca la clave en todo el perfil.
- **Auditoría local** (`telegram-audit.jsonl`): sesión elegida/soltada/perdida, mensaje enviado (solo bytes), archivo enviado/recibido/rechazado (solo extensión y bytes), interruptores; huellas de 8 hex, nunca títulos, texto, rutas ni nombres.
- **No cubierto**: quien controle la cuenta de Telegram con el interruptor encendido puede escribir a la IA; Overdrive y la voz no están conectados; no probado con Telegram real ni en Windows.

## 3 quinquagies quindecies. Catálogo de modelos del servidor de Tareas en Windows (F8-B192)

- **Qué entra**: el backend WSL deja una copia de `models.json` (catálogo público de modelos, sin claves ni datos del usuario) en `<userData>\opencode-config\catalogo\models.json` y pasa `OPENCODE_MODELS_PATH` al servidor de la carpeta. Esa carpeta ya se monta de solo lectura en la distro (`noexec,nosuid,nodev,case=off`); el servidor no gana acceso a ninguna ruta nueva ni a escritura nueva.
- **Validación**: `buildWslInit` exige que `modelsFile` sea una ruta de Windows válida (`toSandboxPath`), esté dentro del montaje de la config (`fromSandboxPath`) y se llame exactamente `models.json`; cualquier otra cosa falla cerrado (`bad-path`/`models-outside`). El valor de `OPENCODE_MODELS_PATH` que venga del entorno del anfitrión se descarta (es una ruta de Windows): solo existe la reconstruida desde el montaje.
- **Sin shell ni protocolo nuevo**: no hay comando de `wsl.exe` ni trama nueva; la lista cerrada de `wsl-spec.ts` y el lanzador Python no cambian. La copia es un `copyFileSync` de `main` y nunca lanza (si falla, el servidor usa el catálogo embebido).
- **Riesgo residual**: un catálogo manipulado en esa carpeta podría describir modelos o URLs distintas, pero la red del servidor sigue limitada por el proxy de salida y `provider-egress` (solo proveedores del usuario, deny-by-default) y las claves reales no entran al servidor; el archivo lo escribe solo la app, fuera del alcance del agente (montaje de solo lectura).

## 3 quinquagies sedecies. Lecturas denegadas del sandbox de Tareas en macOS: endurecimiento (F8-B194)

**Hallazgo.** El perfil Seatbelt (`(allow default)` + denegaciones) solo negaba una lista cerrada de rutas. Medido con
`sandbox-exec` y el perfil real, un agente de «Solo en tu carpeta» podía LEER archivos que suelen guardar claves
(`~/.zshrc`, `~/.zprofile`, `~/.gitconfig`, `~/.claude*`, `~/.codex`, `~/.config/*`, `~/.npm`, `~/.cache`,
Group Containers, HTTPStorages…). Una inyección de instrucciones podría intentar sacarlos (la red solo sale por el proxy
con lista blanca, pero un sitio permitido o la propia carpeta de trabajo bastan para exfiltrar).

**Cambio** (`defaultDeniedReadPaths`, `sandboxEnv` en `src/main/tasks/sandbox-profile.ts`; zona intocable, con decisión
del dueño). Lectura Y escritura denegadas, además de lo que ya había (SSH, nube, gh, OpenCode del usuario, navegadores,
Llavero, Mail, Mensajes, userData):

- _Shell y git:_ `.zshrc .zprofile .zshenv .zlogin .zlogout .bashrc .bash_profile .bash_login .bash_logout .profile
.envrc .env .gitconfig`, y más historiales (`.zhistory .sh_history .irb_history .mysql_history .psql_history
.sqlite_history .rediscli_history .lesshst .viminfo`).
- _Configuración y cachés del usuario:_ `~/.config` entera, `~/.cache`, `~/.npm`.
- _Otros agentes y editores:_ `.claude`, `.claude.json(.backup)`, `.codex`, `.cursor`, `.vscode`, `.windsurf`, `.codeium`,
  `.gemini`, `.continue`, `.zed`, `.aider*`, `.mcp.json`, `.mcp-auth`, `.ms-365-mcp-server`.
- _Nube y CLIs:_ `.oci .ibmcloud .vault-token .boto .s3cfg .databrickscfg .colima .lima .terraformrc .pgpass .my.cnf
.mylogin.cnf .m2/settings.xml .gradle/gradle.properties .composer/auth.json .bundle/config .cloudflared .wrangler
.vercel .netlify .fly .railway .stripe .supabase .expo .eas .firebase .yarnrc.yml`.
- _Library:_ `Group Containers` entera, `HTTPStorages`, `WebKit`, `Accounts`, `IdentityServices`, y en
  `Application Support`: `Google` (entera, no solo Chrome), `Claude`, `Code`, `Cursor`, `Windsurf`, `Zed`, `Slack`,
  `discord`, `Microsoft`, `Notion`, `1Password`, `Bitwarden`, `Dropbox`, `zoom.us`, `Signal`, `Telegram Desktop`,
  `WhatsApp`, `Postman`, `MobileSync` (copias del iPhone), `AddressBook`, `CallHistoryDB`, `com.apple.TCC`.

**Lo que NO se niega (y por qué).** La carpeta elegida y las adicionales; el directorio privado del servidor
(`userData/tasks-sandbox/<hash>`: sus `XDG_*`, `TMPDIR` y cachés de npm/bun/pip/uv ya apuntan allí, por eso no necesita
`~/.config`, `~/.cache` ni `~/.npm`); el binario del motor y el catálogo de modelos (los copia el proceso principal, fuera
del sandbox, al directorio privado); `/usr`, `/bin`, `/System`, `/Library`, `/private/var/folders`; `~/Library/Caches` y
`~/Library/Preferences` (los frameworks del sistema los leen); `~/.local/bin`/`share` (uv, pipx); los toolchains del
usuario (`~/.cargo`, `~/.rustup`, `~/.nvm`, `~/.bun`…); `~/.opencode` (puede alojar el binario elegido con `OPENCODE_BIN`).
`~/Library/Containers` entera tampoco: solo `com.apple.Safari` (ya estaba).

**Efecto colateral resuelto: git.** Con `~/.gitconfig` denegado, `git` MUERE («fatal: unable to access … Operation not
permitted», porque el kernel devuelve EPERM y no ENOENT/EACCES). Por eso `sandboxEnv` fija `GIT_CONFIG_GLOBAL` a
`<directorio privado>/config/gitconfig` (propio, escribible, vacío al principio): git funciona y `git config --global`
queda confinado al sandbox. Consecuencia: los commits del agente no usan el nombre/correo del `~/.gitconfig` del usuario
(git caía en el nombre completo del usuario de macOS y el nombre del equipo, datos personales que acababan en el historial;
desde F8-B197 `sandboxEnv` fija `GIT_AUTHOR_*`/`GIT_COMMITTER_*` a «Lazunox» y `lazunox@localhost.invalid`; el backend WSL no
cambia por variables —su protocolo no admite `GIT_*`—: en Windows la firma se fija en `/etc/gitconfig` de la imagen, F8-B198,
ver §3 quinquagies octies). Un efecto menor: `bash -c` puede imprimir por stderr «Operation not
permitted» al intentar leer `~/.bashrc` cuando su stdin es un socket; no falla.

**Política de carpetas.** `folder-policy.ts` y `manager.ts` reutilizan la misma lista: ya no se puede autorizar como
carpeta de trabajo nada dentro de las rutas nuevas (p. ej. `~/.config/algo`, `~/.claude`), ni las funciones de la
interfaz de Control total las leen.

**Pruebas.** `sandbox-profile.sentinels.test.ts`: estructura de la lista (qué sí y qué no) y, solo en macOS (omitida en
otras plataformas), `sandbox-exec` real sobre un HOME TEMPORAL con archivos centinela falsos (nunca se lee el HOME real):
cada ruta endurecida da «Operation not permitted» al leer, listar y escribir, y siguen funcionando la carpeta elegida, el
directorio privado, zsh/bash/python/curl y `git` con el `GIT_CONFIG_GLOBAL` privado (y muere sin él). Los snapshots de
`sandbox-profile.test.ts` y el fixture `seatbelt-before.json` se actualizaron de forma deliberada (diff = solo estas
rutas y `GIT_CONFIG_GLOBAL`). Verificado además contra el binario real del motor (`/global/health` sano con el HOME real y
con uno temporal) y en la app (ver CHANGELOG-FASE8, F8-B194).


## 3 quinquagies septendecies. Node.js y uv de la app para los conectores locales (F8-B195)

Los conectores locales (Gmail/Calendar/Drive con `uv`, Outlook/Calendario/OneDrive con `npm`) ya no piden que la persona instale nada a mano:
Lazunox descarga **Node.js** y **uv** a su propia carpeta, con versión, tamaño y SHA-256 fijados. Esto significa **ejecutar programas
descargados de internet**; por eso todo es cerrado.

**Dónde se fija.** Un solo archivo: `resources/runtimes/pin.json` (versión, URL oficial exacta, formato, tamaño, SHA-256, límites de
descompresión, fecha y fuente). Hoy: Node.js 24.22.0 (LTS «Krypton», `nodejs.org/dist/v24.22.0/`) y uv 0.13.1 (`github.com/astral-sh/uv`),
para `darwin-arm64` y `win32-x64`. `parseRuntimePin` es estricto (host y ruta de la release oficial de ESA versión, tamaño entero positivo, SHA-256
de 64 hex en minúsculas, rutas sin `..`): un activo sin huella invalida todo el pin (prueba `runtime-pin.test.ts`). Para cambiar versiones:
editar el pin con los datos de las sumas oficiales y correr `node scripts/runtimes/verify-pin.mjs --download` (con red; también
`npm run check:runtimes-pin` sin `--download`), que compara cada hash con `SHASUMS256.txt` de nodejs.org y con el `.sha256` de la release de uv, y el
tamaño con la descarga real. Los hashes actuales se verificaron así el 2026-10-18 (suma oficial = archivo descargado y calculado = pin).

**Qué hace la descarga** (`src/main/runtimes/runtime-install.ts`, reutiliza `pinnedDownload` de WSL): solo https, **lista de hosts por runtime** (Node:
únicamente `nodejs.org`; uv: `github.com` y su CDN de releases `objects`/`release-assets.githubusercontent.com`), cada redirección revisada, tope de
bytes exacto y SHA-256 en flujo; si no coincide se borra y **no se extrae ni se ejecuta nada**. La extracción es propia y en JS puro
(`archive.ts`, sin `tar`/`ditto`/`tar.exe` ni scripts de instalación): rechaza rutas absolutas, con `..`, con letra de unidad o `:` (zip),
enlaces duros, dispositivos, enlaces simbólicos que salgan del destino, escritura a través de un enlace y cualquier bomba (tope de bytes
descomprimidos y de entradas del pin); permisos normalizados (0755/0644, sin setuid). Se arma en una carpeta temporal y se renombra de una vez a
`userData/runtimes/<runtime>-<versión>/`; antes de darlo por bueno se ejecuta `--version` y debe devolver exactamente la versión fijada.
Sin administrador, sin tocar el PATH del sistema, sin instalar nada global ni `.pkg`/`.msi`.

**Cómo se usan.** `local-connectors.ts` lanza `uv` o `node` + `npm-cli.js` **por ruta absoluta** (el runtime de la app SIEMPRE que exista; el del
sistema solo de respaldo, buscado con rutas absolutas y sin carpetas relativas del PATH), con `execFile`, entorno mínimo y **PATH acotado** a la
carpeta del runtime más `/usr/bin:/bin` (nunca el PATH del usuario). Se mantienen `uv … --require-hashes --only-binary :all:` y `npm ci --ignore-scripts`. El servidor
instalado se lanza con el Node de la app. **Los runtimes no se usan para nada más** que los conectores locales que la persona aprobó con sus dos casillas: no hay
`npx` ni instalación de paquetes arbitrarios, y no se exponen al agente.

**Riesgos que quedan (dichos con honestidad).** (1) La confianza se apoya en el pin dentro del código firmado de la app: si el pin o las sumas oficiales
fueran manipuladas antes de fijarlas, se descargaría eso (el script de verificación y la revisión humana son el control). No se verifica la firma GPG
de `SHASUMS256.txt` ni la firma de Apple del binario (sí queda dentro del hash). (2) Node y uv corren con los permisos del usuario, fuera del
sandbox de Overdrive (igual que los conectores). (3) Las versiones fijadas se quedan viejas: hay que actualizar el pin con cada versión de la app; una versión
antigua de runtime no se borra sola (los conectores ya instalados apuntan a su ruta). (4) Quitar los runtimes desde Ajustes deja sin arrancar los conectores
instalados hasta reinstalarlos. (5) uv, al crear el entorno de Google, descarga Python de GitHub por su cuenta (ya era así; ver §3 quinquagies decies).

**IPC.** `runtimes:status|install|cancel|remove` (esquema estricto sin parámetros, clase **X** en `policy.ts`: nunca desde el celular). La instalación es siempre una acción de
la persona (botón «Instalar lo necesario», «Preparar todo» o Ajustes); nada se descarga solo.

**Qué NO bloquea.** Es un componente opcional de «Preparando Lazunox»: si la descarga falla o se deja para después, la app funciona y solo fallan los conectores locales; se reintenta desde la
misma pantalla, la ficha o Ajustes › Overdrive › «Node.js y uv». En Windows las funciones están implementadas y probadas, pero no se ofrecen (los conectores locales siguen «Solo en Mac»).


## 3 quinquagies octies. Uso de Overdrive, causas de fallo de instalación y firma de commits en Windows (F8-B198)

**Uso de Overdrive (`tasks:usage:summary`, clase X).** «Ajustes › Uso» sumaba Overdrive solo con las tareas que la app tenía cargadas
en memoria. Cada carpeta aprobada tiene su servidor aislado y, dentro de su directorio privado
(`userData/tasks-sandbox/<clave>/data/opencode/opencode.db`), su propia base de datos de sesiones, donde el motor ya guarda los
totales (tokens y costo) de cada sesión. `src/main/tasks/usage-summary.ts` los LEE sin arrancar ningún servidor (`node:sqlite`, incluido en
Electron 44). Qué sale de `main`: por sesión, id opaco, id del padre, modelo (id y servicio), costo, tokens y fecha de la última actividad; **nunca**
títulos, mensajes, rutas, carpetas ni nombres de proyecto (prueba: el JSON no contiene el título ni la ruta sembrados). El canal no tiene
parámetros (esquema `none`), la clave del directorio la calcula `main` con `sandboxKey` a partir de las carpetas aprobadas (nada que venga del
renderer decide qué archivo se abre) y es **X**: el celular nunca lo ve. **El archivo no es de fiar**: el servidor aislado puede escribir en su propio
directorio, así que un archivo manipulado es posible. Controles: solo archivos normales en la ruta fija (`lstat`, sin enlaces), apertura de solo
lectura (`readOnly` + `PRAGMA query_only`), sin extensiones, `session` debe ser una TABLA (no una vista) con las columnas esperadas, cada valor se
valida (texto corto, números finitos y no negativos) y todo tiene tope (300 sesiones por carpeta, 1000 en total). Lo peor que logra un archivo
manipulado es falsear sus propias cifras de uso. Si el archivo no se puede leer o es de otra versión del motor, la carpeta cuenta como «no leída» y la
pantalla lo dice. **Límites dichos con honestidad:** (1) en Windows las tareas viven en el disco virtual de WSL, donde la app no lee: `supported: false` y
la pantalla dice «Overdrive no se cuenta aquí todavía» en vez de un 0; (2) el esquema de `session` es del motor fijado (`opencode.db`, 1.19.0): al
actualizarlo hay que repasar `usage-summary.ts` (la lectura falla cerrada, no inventa cifras); (3) una lectura de solo lectura sobre una base en modo WAL
puede crear los archivos `-wal`/`-shm` junto al registro (inocuos; el servidor sigue escribiendo con normalidad, probado); (4) las tareas de Control total
comparten el almacén del motor principal, así que ya se contaban por su agente; (5) la consulta es síncrona en `main` (decenas de milisegundos con cientos de sesiones).

**Causas de fallo de instalación.** Node.js y uv y ArtCraft distinguen ahora `offline` (sin conexión), `hash`/`size` (huella o tamaño incorrectos),
`disk` (sin espacio), `permission` (sin permiso de escritura en la carpeta de datos de Lazunox) y `cancelled`; antes un fallo de escritura
(`EACCES`, `ENOSPC`) se mostraba como «revisa tu conexión». La clasificación mira solo el código del error del sistema (`src/main/util/fs-error.ts`),
no su texto, y `pinnedDownload` la aplica sin cambiar de contrato (los códigos nuevos son más específicos que `io`; `wsl-setup.ts` los trata como
cualquier fallo de descarga, sin cambios). No cambia ninguna garantía de verificación.

**Firma de commits en Windows (investigación; solo se implementó lo que no toca zonas intocables).** Síntoma: dentro del sandbox WSL el commit sale
como `Lazunox <lazunox@NOMBRE-DEL-PC.localdomain>`. Medido en el PC de pruebas con una distro desechable importada de la imagen incluida (2026.10.10),
usuario 1000 y Landlock aplicado con `landlock.py`/`protocol.py` reales: WSL pone a la distro el nombre del equipo (`hostname` y `/etc/hostname`
valen el del PC aunque la imagen escriba `lazunox`) y el sistema arma el correo con él. Caminos:

1. **`/etc/gitconfig` en la imagen** (`scripts/wsl-rootfs/customize.sh`, fuera de las zonas intocables). Medido: git lo lee con el usuario 1000 y
   con Landlock (`/etc` es `ro`) y los commits salen como `Lazunox <lazunox@localhost.invalid>`, igual que en macOS; el agente aún puede cambiarlo
   con `git config --global` (HOME privado), como en macOS (no es un límite de seguridad: solo evita filtrar el nombre del PC). **Implementado**, con
   la guardia `src/main/tasks/firma-commits.test.ts` (misma identidad que `SANDBOX_GIT_*`). **Falta una acción del dueño:** surte efecto solo con una
   imagen nueva (reconstruir, subir `version`, regla «solo se avanza de versión»); las distros ya instaladas no cambian. Lo que NO se probó: la
   reconstrucción real de la imagen con Docker (se verificó el mecanismo editando `/etc/gitconfig` en una distro importada de la imagen actual).
2. **`[network] hostname=lazunox` en `resources/wsl/wsl.conf`**: medido, la distro de prueba pasa a llamarse `lazunox` (el correo sería
   `lazunox@lazunox.localdomain`). Es zona intocable (`resources/wsl/*`; la imagen exige `wsl.conf` byte a byte) y también necesita imagen nueva. No implementado.
3. **Permitir `GIT_AUTHOR_*`/`GIT_COMMITTER_*` en el protocolo** (`resources/wsl/protocol.py` y `wsl-spec.ts`): funciona en las distros ya instaladas
   sin imagen nueva, pero es zona intocable y amplía la lista de variables aceptadas del anfitrión. No implementado.
4. **Un gancho `shell.env` en el plugin `lazunox-env`** (`src/main/tasks/opencode-config.ts`, zona intocable: puerta del plan): una sola implementación para
   macOS y Windows y sin imagen nueva, pero hay que distinguir bien los servidores aislados (`LAZUNOX_TASKS_FOLDER` sin `LAZUNOX_FULL_ACCESS`) para no firmar con la
   identidad fija los commits de Chat/Code ni de Control total. No implementado.

Recomendación mínima: el camino 1 (ya hecho) en la próxima imagen; si no se quiere esperar a una imagen, el camino 4 con la condición anterior.
