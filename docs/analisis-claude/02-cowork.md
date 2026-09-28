# 02 — Cowork en Claude Desktop (producto y UX) y comparación con Lapis

> Análisis de `/Applications/Claude.app` v2.9939.2. Solo se describe el **comportamiento** con
> nuestras palabras; no se copia código de Anthropic. Las citas de UI son cadenas cortas (< 15
> palabras) tal como aparecen en los catálogos. Complementa a `03-motor-interno.md` (VM, IPC,
> runtime MCP), que cubre las tripas; aquí el foco es producto/UX, con notas de internals cuando
> explican una decisión de UX.
>
> **Método.** Se aplanó `ion-dist/i18n/en-US.json` (31 680 cadenas, claves hash) y se indexaron los
> `defaultMessage` de los 3 292 bundles de `ion-dist/assets/v1/**` (50 325 mensajes) por archivo y
> en orden de aparición: así cada componente se reconstruye leyendo sus cadenas vecinas. Además:
> `app.asar` extraído (proceso main `index.chunk-DzZc-q0x.js`, preloads `coworkArtifact.js`,
> `computerUseTeach.js`, `computerUseWatchRecord.js`, `watchRecordChooser.js`, `buddy.js`),
> `Resources/en-US.json` (735 cadenas del shell) y `strings` de `smol-bin.*.img`.
> Nombres de bundle abreviados abajo (p. ej. `shared-22` = `shared-22-DG1cgDka.js`).

---

## 0. Resumen ejecutivo

- Cowork es **el modo "delegar una tarea"**: describes un resultado, Claude trabaja solo en
  segundo plano (en una VM local o en la nube) y vuelves a un entregable. El lema de la home:
  «Let’s knock something off your list» (`c62135ccf`). La promesa: «Describe what you need and
  come back to finished work.» (en-US.json).
- La IA de navegación está **unificada** con Chat y Code bajo el shell "epitaxy" (rutas
  `/epitaxy/*`, `/cowork/*`, `/task/*`): barra lateral única con **Pinned / Active / Scheduled**,
  agrupación por carpeta/proyecto/grupos personalizados, estados ricos por tarea y
  **proyectos** con instrucciones, contexto, memoria y tareas programadas.
- La tarea tiene un **panel de actividad** a la derecha con cuatro secciones —**Progress**
  (plan paso a paso), **Outputs** (entregables), **Working folders** y **Context** (herramientas,
  conectores, skills y archivos usados)— más navegador embebido y vista "Live" de computer use.
- Seguridad por capas: **VM Linux** (`coworkd`, montajes virtiofs/9p con modos `ro/rw/rwd`,
  proxy MITM con allowlist de red), **concesión explícita de carpetas** con «Don’t ask again»,
  **confirmación separada para borrados permanentes**, tarjetas de aprobación **humanizadas por
  herramienta** («Claude wants to send an email from Gmail»), y un abanico de políticas de
  administrador (egress, carpetas permitidas/solo lectura, retención, "Always allow" off…).
- **Computer use** con dos modos (**Background** vs **Full control**), concesión **por app** con
  niveles (*View only* / *Click only* / *All*), apps denegadas, ocultar ventanas no permitidas,
  borde luminoso + Esc global para parar, **Teach mode** (tooltips paso a paso con "Next"/"Exit")
  y **Record a skill** (grabas tu pantalla + micrófono y Claude propone una skill).
- **Dispatch**: desde el móvil mandas trabajo al escritorio; un hilo continuo que muestra "los
  destacados" mientras una **conversación de fondo** hace el trabajo. Tareas programadas con
  frecuencia/cron, permisos, notificación (push/email/Slack) y **mover a la nube**.
- Lapis cubre bien el núcleo local (carpeta + sandbox Seatbelt + plan + entregables + aprobaciones
  + overlay/kill-switch), pero le faltan: proyectos/memoria/instrucciones, varias carpetas por
  tarea, conectores MCP y skills dentro de Cowork, preguntas estructuradas, grants por app de
  computer use, confirmación de borrado de primera clase, allowlist de red, gestión de lista
  (pin/rename/delete/estados), notificaciones configurables, Dispatch/remoto y Teach/Record.

---

## 1. Puntos de entrada e arquitectura de información

### 1.1 Rutas y superficies
Rutas del router (extraídas de `path:"…"` en los bundles):
- `cowork`, `cowork/projects`, `cowork/projects/create`, `cowork/project/$uuid`,
  `cowork_sessions/$sessionId`, `cowork-artifact/$id`, `task/new`, `task/$uuid`, `task/examples`,
  `discover/cowork`.
- Shell unificado **epitaxy**: `epitaxy/sessions`, `epitaxy/search`, `epitaxy/dispatch`,
  `epitaxy/scheduled`, `epitaxy/scheduled/new`, `epitaxy/scheduled/$taskId`,
  `epitaxy/project/$projectId`, `epitaxy/projects/browse`, `epitaxy/artifact/$artifactUuid`,
  `epitaxy/apps`, `epitaxy/mobile`.
- Deep link: «claude://cowork/shared-artifact?uuid=…» (en-US.json).
- Menú de la app (desktop `en-US.json`): «New Task», «Next Task», «Previous Task», «Close Task».

### 1.2 Home de Cowork
Bundle `c62135ccf` (home) y `shared-12`/`shared-26` (onboarding y barra):
- Titular «Let’s knock something off your list.» y placeholder del compositor
  «Describe a task, from a quick fix to a multi-step job.» / «What can I take off your plate?».
- **Sugerencias por intención**: «Pick a task, any task» con categorías «Tidy up and get
  organized», «Plan for what’s ahead», «Turn messy data into action», «Optimize my week»; tarjetas
  como «Clean up my Downloads folder», «Prep for my next meeting», «Catch me up on Slack»,
  «Turn voice memos into a doc». Las plantillas largas (en en-US.json) siguen un patrón: **primero
  escanea y muestra un resumen, luego propone, luego actúa** («First, scan the folder and show me
  a summary…»).
- Botón «Hide suggestions», sección **plugins** («Get to work with», «Customize with plugins»,
  «Manage plugins», «See all»), «What’s new», y pie «Learn how to use Cowork safely» /
  «give us feedback».
- Tarjetas de marketing/upsell: guest pass («Gift a week of Cowork»), «Try your skill» tras
  instalar una skill.
- Onboarding "Meet Cowork" (`shared-12`): elige superficie **Chat / Cowork / Code** con textos
  «Talk it through with Claude» / «Give Claude a task to run autonomously».
- Arranques guiados como prompts precocinados (en-US.json): conectar herramientas, encontrar
  plugins por rol, crear una tarea programada, crear un **live artifact** («Explain what live
  artifacts are in Cowork, then look at my connectors…»).
- Ideas: «Customize Cowork for me», «Send me a daily briefing», «Organize my inbox» (`shared-26`).

### 1.3 Barra lateral y lista de tareas
`shared-26` y `shared-22`:
- Secciones **Pinned**, **Active** («Active tasks», «Clear active»), **Scheduled**, con
  «Show more/less». Tip: «you can drag … here to pin them».
- **Agrupación**: «Group by» (tipo, carpeta, preset, grupos personalizados). Crear carpeta/grupo
  («New folder…», «Create and group by folder»), mover sesiones («Move {count} to folder»),
  renombrar/eliminar grupos (al borrar, las sesiones vuelven «to their own folders»).
- Indicador agregado: «A session in this folder is waiting on you».
- **Estados de tarea** (vocabulario fijo): «Awaiting input», «Awaiting answer», «Running»,
  «Using the browser», «Unread response», «Idle», «Done», «Archived». Además en la cabecera:
  «Needs your approval · {tool}», «Waiting for your answer», «Plan ready for review».
- Acciones por ítem: «Mark as unread/read», «Mark all as read», Pin/Unpin, Star/Unstar,
  Rename, Edit details, Archive/Unarchive, Delete, **Move to cloud**, Run now/Pause/Enable
  (tareas programadas).
- **Búsqueda**: «Search tasks...», «Search chats and sessions...», ruta `epitaxy/search`
  (hay un worker `transcript-search-worker` en el shell → búsqueda de texto completo en
  transcripciones, no solo títulos).
- **Auto‑archivo**: si Claude espera tu respuesta, el auto‑archivo se pausa «for up to a day»; «This session is pinned, so it won’t be archived automatically.»
- Tarea archivada: «It can’t take new messages while archived.» + «Unarchive task»
  (`c21f11e6d`). Tarea finalizada: «It can’t take new messages any more.»

### 1.4 Proyectos ("spaces")
`c8ad300b7` (panel de proyecto), `shared-22` (acciones):
- Un proyecto tiene **Instructions** («Tell Claude how to work in this project (optional)»),
  **Context** (carpetas «On {deviceName}», documentos de Drive con búsqueda, enlaces «Paste a
  URL», proyectos de Chat vinculados «Projects from Chat»), **Memory** (on/off, archivos de
  memoria) y **Scheduled** («Set up recurring tasks for this project.»).
- Importar un proyecto de Chat: «Bring a project you made in Chat over to Cowork.» con la
  aclaración «Changes in Cowork won’t affect your project in Chat.»
- Archivar proyecto no borra nada: «Tasks, scheduled tasks, and files won’t be deleted.»
- Pin/Star/Report/Delete de proyectos; errores explícitos por acción («Couldn’t pin project. Try
  again.»).

### 1.5 Memoria
`c953053b7`, `c8ad300b7`, en-US.json:
- «Cowork memory» separada de «Chat memory», con vista «Across projects» y por proyecto.
- «These files are stored on this device.»: Claude guarda lo que aprende de ti y de tu trabajo
  → **memoria = archivos locales** que Claude lee/escribe.
- En el panel de contexto aparece como uso: «Read {n} memories», «Updated #».
- Toast «Added to memory, removed {fileNames}».
- Estado vacío: «Ask Claude to remember something and it’ll save it here.»

### 1.6 Instrucciones globales
`cabd7b1c1`: «Global instructions» para todas las sesiones de Cowork, editor con contador
«{count} / {max} characters», placeholder «Add instructions for Claude to follow in all Cowork
sessions...». Hay además **instrucciones por carpeta** («Folder instructions», «Use this to give
Claude instructions for working in this folder.», `ce5658dc8`).

---

## 2. Flujo de una tarea

### 2.1 Componer
- **Destino**: «Project or folder» → «Work in a project» / «Work in a folder» (`shared-22`,
  `c97b955f1`). Carpeta con dispositivo: «{folder} +N on {deviceName}».
- **Dónde corre**: badge «This task will run on your computer.» o «This task will run in the
  cloud.» (Beta). Si la nube cae: «Cowork in the cloud is temporarily unavailable.»
- **Adjuntos**: arrastrar archivos o carpetas; «More than {count} files? Bring the whole folder
  to Cowork». Si fallan: «Some folders couldn’t be added. They were removed from this message.»
- **Slash commands / skills**: «/{skill} isn’t available in Cowork» cuando no aplica; selector
  de skills/plugins en el compositor («Browse skills», «Add plugins»).
- **Modelo y esfuerzo**: selector con «Effort» («Higher effort means more thorough responses…»),
  avisos de coste de modelos grandes; algunas funciones exigen modelo («Requires Claude 4.6 or
  newer»). Si el modelo cae: «Switched to {fallback}».
- **Modo de permisos**: Ask por defecto; **Auto** (clasificador que aprueba lo de bajo riesgo)
  opcional por política (`coworkAutoModeAlwaysAllowOverride`); «Skip all approvals» solo local.
- **Side chat** («Ask on the side without touching the main chat»): una conversación lateral sin
  contaminar la tarea.

### 2.2 Acceso a carpetas (grant)
`ca44d5dae`, desktop `en-US.json`, `cabd7b1c1`:
- Cuando Claude necesita una carpeta durante la tarea: «Claude would like to **Cowork** in a
  folder» con «Claude’s reason», botones **Deny / Not now / Allow** y, en tareas programadas,
  «Allow for all scheduled runs».
- Diálogo nativo: «Allow Claude to cowork in {path}?»; primera vez: «Trust {directory} and start
  a Cowork task?».
- **Trusted Cowork folders** en ajustes: «Cowork tasks may use these folders, and folders inside
  them, without asking you first.» Los marcados con «Don’t ask again» aparecen como «Remembered».
- Carpetas prohibidas con mensajes claros: home, raíz de disco y carpetas propias de Claude
  («Choose a project folder instead.»), rutas de red, ubicaciones protegidas («protected
  location»), carpeta de datos de la app («Try a specific folder inside Documents instead»).
- Tarea vinculada al equipo: si se abrió en otro dispositivo, «Link to this computer» / «Start a
  new task here» con explicación por origen (web, phone, scheduled, desktop_unlinked).

### 2.3 Durante la ejecución: progreso y actividad
`ce5658dc8` (panel), `shared-5` (verbos de herramientas):
- **Progress**: «See task progress for longer tasks.», «Step {current} of {total}», contador
  «{count} of {count}».
- **Outputs**: «View and open files created during this task.», «Download all», «Browse files»,
  «Show in Folder», previsualización («Select a file to preview it.», «Not available to preview
  yet»), tipos reconocidos: Code, Table, Spreadsheet, Document, Image, Diagram, Presentation,
  Skill, Plugin (`c21f11e6d`).
- **Working folders** / **Instructions** (global, de carpeta).
- **Context** («Track tools and referenced files used in this task.»): agrupa por clase —
  Skills, Connectors, Commands, Memory, Uploads, Working files, Web search («# searches»,
  «# pages read», «# tabs») — con verbos (read, edited, created, invoked, ran, searched…) y
  **botones que hacen scroll al punto de la conversación** donde se usó cada cosa
  («Buttons that scroll the chat to where Claude used each one»).
- Conversación: las llamadas de herramienta se resumen con verbos humanos en gerundio/pasado
  («Reading clipboard», «Read {count} files», «Ran {count} commands», «Created a plan»,
  «Following a plan», «Plan rejected»).
- **Navegador y computer use embebidos**: «Claude is working in Chrome. You’ll see updates
  here…», «Full control · {target}» / «Background · {target}», etiqueta «Live» y «Open computer
  use activity» (vista en directo; en main hay `cu-live-preview` con fps ajustable).
- **Scratchpad** y **Runs** (ejecuciones de una tarea programada, «Unread completed run»).
- Sugerencias contextuales: «Create a skill for this kind of task» (prompt que resume la rutina
  y la generaliza en una skill), **Suggested connectors** («Request {connectorName}»).

### 2.4 Preguntas y aprobaciones ("Needs your input")
- **Preguntas estructuradas** (`shared-12`): «Type your answer», «Skip», «Submit», «Next», y
  priorización arrastrable «Drag to re-order your priorities».
- **Tarjetas de aprobación humanizadas** (`ca44d5dae`): una frase por acción concreta
  («Claude wants to take a screenshot in Chrome on your computer», «…draft an email in Gmail»,
  «…delete an event from Google Calendar»), con los campos formateados (To, Cc, Subject,
  Body…) y marca «(from Claude, not verified)» para texto generado; «Show full request»,
  «Contains hidden characters not shown above — review carefully.».
- Botones: «Allow once», «Allow for this session», «Always allow», «Deny». Tras permitir una
  vez: «Allowed once. Skip this card next time?» (`c21f11e6d`). Web fetch: «Allow Claude to
  fetch pages from {domain}?» + «Allow all for this website».
- **Borrado permanente = permiso aparte**: «Allow Claude to permanently delete files in your
  {folderName} folder during this task?» + aviso de que, una vez concedido, no se revoca sin empezar otra tarea y «Deleted files can’t be
  restored.»
- Centro de atención: «What needs your attention», «{count} sessions need input», «Needs your
  input. Scroll to the request».

### 2.5 Salidas, artifacts y seguimiento
- **Cowork artifacts** (preload `coworkArtifact.js`): páginas interactivas en la barra lateral de
  la tarea. El puente expone *askClaude*, *callMcpTool*, *runScheduledTask*, *navigateHost*,
  *openExternalUrl* → los **live artifacts** consultan conectores en vivo («stay up-to-date
  using live data from your connectors»). Aprobación al crear: «This artifact will have access
  to these connectors without approvals:». Se pueden publicar/compartir en la org; «Goes to the
  Cowork task that published this artifact»; abrir para cambios: «Claude will open the artifact
  in a new Cowork task…».
- Seguimiento: «Start this task in a new session, or do it here?», «Edit and retry with
  {original}», «Doing this every week? Set it up as a scheduled task in Cowork.».
- Feedback por sesión: «How is Claude doing this session?».

### 2.6 Notificaciones
`c0db37792` y en-US.json: «Response completions», «Scheduled tasks» («finish, can’t run, or
need your input»), «Dispatch messages» (push al móvil), rebote del Dock / parpadeo de barra de
tareas («Bounce the Dock icon when Claude needs your attention…»), «Get notified on your phone
when this task is done». Aviso de mantener el equipo encendido: «Cowork runs on your computer,
so keep it on while tasks are running.»

---

## 3. Dispatch, tareas programadas, nube y conversaciones de fondo

### 3.1 Dispatch (móvil → escritorio)
- Idea: mandar una tarea o sesión de código desde cualquier sitio, «in one continuous thread»
  (en-US.json). El hilo de Dispatch es el "jefe": «Dispatch shows you the
  highlights. This background conversation is where Claude does the thinking.» + «Go back to
  dispatch» (`shared-22`). Es decir, **una conversación orquestadora ligera** que lanza/consulta
  **sesiones hijas de fondo**.
- Ajuste por equipo: «Let Claude work on tasks from your phone using this computer.»
  (`cfea69990`); opción «Prevents sleep while Dispatch is running.»; «Dispatch can use every
  connector you’ve authenticated.» (`c752b32f8`).
- Emparejamiento: «Only pair devices that you own and trust.»; Remote Control con carpetas de
  confianza, límite de carpetas listadas, «Require trusted devices for Cowork» (admin).
- Exclusividad: «A Cowork agent is already running on {machineName}.» (un agente por cuenta).
- Notificaciones push «Dispatch messages».

### 3.2 Tareas programadas / rutinas
Editor `c97b955f1`, lista `shared-22`, confirmación `ca44d5dae`:
- Campos: Name (slug «Will be saved as…»), Description, **Instructions**, **Model**,
  **Frequency** (One-time, Manual, Hourly, Daily, Weekdays, Weekly, Monthly, Custom con cron de 5
  campos y zona horaria; en nube mínimo 1 h), Time, Day of week, «Run at exact time»,
  **Permissions** («Claude runs without asking.» / modo auto), carpeta o proyecto, **Where this
  task runs** (Cloud / This computer / «Require this computer ({name})»), **Notifications**
  (Push, Email, Slack) con «only when there’s something worth telling you».
- Plantillas: «Daily briefing», «Summarize my calendar and unread emails. Flag anything urgent.»
- Semántica de sesión: «Each run starts a fresh session» vs «Each run continues this session».
- **Aprobaciones con caducidad**: política de días que una tarea programada reutiliza un
  "always allow" de MCP (desktop strings).
- **Mover a la nube / volver**: mensajes detallados para cada caso de fallo (carpetas locales,
  Chrome, dispatch local, aprobaciones por patrón, frecuencia < 1 h).
- Una tarea local puede usar el ordenador «Only runs while your computer is awake».

### 3.3 Cowork in the cloud
- Mismo producto ejecutado en la nube de Anthropic; visible desde web/móvil («Visible from web
  and your other devices»). Sin acceso a carpetas locales salvo que la tarea "requiera" un
  ordenador enlazado. Controlado por el ajuste de organización Routines.

### 3.4 Conversaciones de fondo y paralelismo
- Tareas en paralelo con límite por plan («Run more Cowork tasks at once», upsell), sesiones
  anidadas («{count} nested sessions need input»), side chats, y reinicio de app que espera:
  «Claude is working in {count} sessions. Relaunching now will interrupt that work.» +
  «Wait for Claude».

---

## 4. Computer use en Cowork

### 4.1 Activación y permisos del SO
`ce2191564`, `c0b9fcb09`, `shared-13`:
- «Turn on computer use?» con advertencias: «Some actions can’t be undone.», «Apps you approve
  could open other apps that you haven’t approved.», «Websites and docs could contain malicious
  instructions…», «Close anything sensitive.», «This is a research preview.».
- Asistente de permisos macOS: tarjetas **Accessibility** («Required for mouse and keyboard
  tracking and control.») y **Screen recording**, estado «Granted / Not yet granted», «Open System
  Settings», y «Permissions are ready. Click Ask again to continue.»

### 4.2 Modos: Background vs Full control
- Ajuste «How Claude uses the apps you allow» (`c71860c77`): **Background** (trabaja dentro de
  las apps permitidas mientras tú sigues usando el equipo) y **Full control** (toma pantalla,
  ratón y teclado). En background pide permiso para escalar: «Take over the screen? Claude was
  working on {appName} in the background…» → «Stay in background» / «Allow».
- «Unhide apps when Claude finishes» (restaura apps ocultas).

### 4.3 Concesión por app y niveles
`c0b9fcb09` y desktop `en-US.json`:
- Diálogo: «Allow Claude to control {apps}?» / «Claude wants to use {appName}» con lista de apps
  y **nivel por app**: «View only», «Click only», «All»; advertencias por tipo («Can run
  commands on your computer», «Can change system settings»); marcas «Already allowed»,
  «(not installed)».
- Capacidades extra por separado: «Read your clipboard», «Write to your clipboard», «Use system
  shortcuts (⌘Q, ⌘Tab, and similar)».
- Alcance: «Allow for this session». Otras ventanas: «Your other windows will be hidden while
  Claude works.» (en main: se ocultan apps fuera de la allowlist y se **enmascaran** en las
  capturas —log `mask pass`).
- **Denied apps** en ajustes: «Any request Claude makes to access these apps is automatically
  rejected.» Estados «Blocked by device management».
- Internamente (herramientas MCP): `request_access`, `list_granted_applications`, `app_*`
  (click/type/key/scroll/drag/menu/ax_find/list_windows/screenshot), `request_full_control` /
  `release_full_control`, `switch_display`, clipboard.

### 4.4 Indicadores en pantalla y parada
- Main: `cu-glow` (ventana de **brillo en el borde**), `cu-app-indicator` (indicador por app
  bloqueada), `cu-side-panel` (panel acoplado), `cu-esc` (**Esc global** para detener; distingue
  Esc sintetizado por el modelo), `cu-notifications`.
- «To show your cursor, press {esc}» (el cursor se oculta durante el control).
- En la app: «Claude is using your computer» + botón **Stop** (`c15a232f0`); pasos «Releasing
  control of your screen», «Bringing {app} window to this desktop».
- Retención: «Screenshots are sent to Anthropic and kept according to your normal conversation
  retention settings.» (desktop `en-US.json`).

### 4.5 Teach mode (guía paso a paso)
`c16071ea4` + preload `computerUseTeach.js`: «Let Claude guide you step by step?» → la ventana de Claude se
oculta y aparece un globo junto a cada paso con botón «Next»; «Click Exit anytime to stop.» Botones «Deny» / «Start guide». Herramientas `request_teach_access`, `teach_step`,
`teach_batch`. Es el inverso de computer use: **Claude te enseña** señalando en pantalla.

### 4.6 Record a skill / watch-record
`shared-13`, preloads `computerUseWatchRecord.js` (píldora) y `watchRecordChooser.js`:
- Entrada «Record a skill» → «Record your screen» con permisos macOS; «Recording isn’t
  available in a remote desktop session.»
- **Selector previo** con elección de micrófono y vista previa de nivel; ventana de protección de
  entrada (~300 ms) para evitar clics accidentales.
- **Píldora de grabación**: contador de pasos, aviso de tiempo, micro on/off, «Done»/«Discard».
- Al terminar se envían eventos ordenados + capturas; el mensaje al modelo aclara que el texto
  de las capturas es **dato no confiable** y que, por defecto, debe **proponer una skill** con una
  tarjeta que el usuario aprueba (no guardarla directamente). Propósitos: `skill` o `context`.

### 4.7 Navegador
- **Claude in Chrome** (extensión) y **navegador integrado** en Cowork: «Cowork now has a
  built-in browser», «Default to the built-in browser?», «Preferred browser» en ajustes.
- Importar sesiones: «Import cookies from your browser so your sites open signed in…»;
  «Cookies only. Passwords aren’t imported.»; «Cowork’s browser always keeps you signed in».
- Permisos por sitio: «Allow once applies to this page only. Always allow saves on this
  device»; límites explícitos: no comprar, crear cuentas ni saltar captchas sin preguntar;
  «Allow all browser actions» (peligroso, con advertencia).

### 4.8 Simuladores/emuladores
«Claude will control this simulator and take screenshots of its entire screen.» (desktop);
vista en vivo con «Claude is using this device», «Claude is typing», grabar vídeo, anotar
(`c49d37e5f`). Aprobación por dispositivo. Más relevante para Code que para Cowork.

---

## 5. Hardware Buddy / dispositivos BLE
Desktop `en-US.json` + preload `buddy.js`: «Hardware Buddy & Maker Devices». Permite conectar
Cowork/Code a dispositivos por **BLE** que muestran prompts de permiso y mensajes recientes (ej.
una "mascota de escritorio" que vive de aprobaciones). Emparejamiento con PIN de 6 dígitos,
«Choose your Buddy», enviar carpeta de firmware («Pick a folder to send to your device»),
«Forget device». Política admin: «Allow pairing Hardware Buddy Bluetooth devices in Cowork.»
Prioridad baja para Lapis.

---

## 6. Seguridad

### 6.1 Sandbox VM
- `smol-bin.{arm64,x64}.img` (~24 MB, imagen MBR) con el demonio `coworkd` (Go): monta la sesión
  como disco propio, comparte carpetas vía virtiofs/Plan9 con modos **`ro`, `rw`, `rwd`** (el
  borrado es un modo aparte → encaja con la tarjeta de borrado) y opción `+hide` para ocultar
  rutas; rechaza symlinks que escapen del share; cgroups para detectar OOM; home "esqueleto".
- **Proxy MITM** en la VM con CA efímera; bloquea hosts fuera de la allowlist con mensaje «is not
  on the network allowlist. The user can add it in Settings»; zona de solo lectura que admite
  solo GET/HEAD sin credenciales.
- Dos modos (ajuste admin): **host-native** por defecto (shell en la VM; herramientas de archivo
  en el host con control por ruta) y **VM completa** («Runs tools inside an isolated VM instead of
  the host»). `secureVmFeaturesEnabled` activa aislamiento extra («Enable additional VM-level
  isolation for the Cowork sandbox.»).
- Mantenimiento: «Free Up Cowork Disk Space…», «Delete Cowork VM Bundle and Restart…», «Delete
  Cowork VM Sessions and Restart…», logs de depuración de VM y SDK.
- Requisitos con errores específicos por plataforma: macOS 14+, Apple Silicon, virtualización
  anidada, KVM/vhost_vsock en Linux, Windows 10 2004+, x64.

### 6.2 Red
- Egress configurable por org: «Sessions can reach any host» / package managers + MCP / ninguno /
  personalizado; «Allowed egress hosts»; aviso cuando un plugin no puede actualizarse por egress.
  IPv6 opcional para la VM.

### 6.3 Confirmaciones y límites
- Borrado permanente con permiso explícito no revocable dentro de la tarea (§2.4).
- «‘Always allow’ is disabled for Cowork by your organization admin.»
- Límite semanal: «You’ve reached your weekly Cowork limit. It resets {day} at {time}.»

### 6.4 Políticas de administrador (muestra)
Allow Cowork; Cowork Remote Control/Dispatch; Require trusted devices; carpetas permitidas y
**solo lectura** («Read-only folders can be viewed and searched but not modified in Cowork»);
retención («Delete Cowork tasks … after this many days without activity»); scheduled tasks
on/off; egress; built-in browser; computer use (compliance/HIPAA gate); OTel de Cowork;
instrucciones de sistema de org (3 000 caracteres); bypass mode off; "Always allow" off;
exportar/importar sesiones; plugins montados por MDM.

---

## 7. Ajustes, errores, vacíos, onboarding y tono

- **Ajustes de Cowork** (`cabd7b1c1`, `cfea69990`, `9d1818d3…`): Global instructions, navegador
  preferido, Trusted Cowork folders, ubicación de «Cowork files» («Your artifacts and scheduled
  tasks are stored at {path}.», con «Copy and restart»), Dispatch, memoria, almacenamiento
  («Cowork storage by kind»), Computer use (modo, apps denegadas, permisos SO).
- **Errores** accionables y específicos: «The Cowork VM isn’t connected. It may still be starting
  up.», «Setting up Claude’s workspace...», «Can’t reach your inference provider ({host}) from
  Claude’s workspace.», «Your session has expired for Cowork access. Sign in again…»,
  errores de cada acción con «Try again».
- **Vacíos**: «No context added yet.», «No trusted folders yet.», «No memory files yet.»,
  «Folder is empty.».
- **Tono**: segunda persona, frases cortas, verbo primero, sin culpa; siempre dice **qué pasó +
  qué hacer** («Couldn’t X. Try again.»); explica consecuencias antes de acciones destructivas
  («Deleted files can’t be restored.»); humor ligero solo en marketing («Like multi-tasking but
  less stress.»). Los estados usan un vocabulario cerrado y consistente.

---

## Comparación con Lapis

Lapis (`src/renderer/src/features/cowork/**`, `src/main/cowork/**`, `src/main/computer/**`,
`src/renderer/overlay/**`, agentes `cowork.md` y `computer.md`) implementa Cowork sobre
`opencode serve` por carpeta: modo **sandbox** (Seatbelt, agente `cowork`) y modo **Control total
del Mac** (sin sandbox, agente `computer` + MCP `lapis-computer`). Tiene home con categorías,
lista de tareas por carpeta con búsqueda y archivar, conversación con pasos agrupados, panel Plan
/ Entregables / Actividad, aprobaciones humanizadas (una vez / siempre / rechazar), adjuntos
copiados a la carpeta, seguimientos sugeridos, notificaciones del sistema al terminar o pedir
aprobación, rutinas (chat/cowork/code, cron), overlay con borde + etiqueta de acción + píldora
«La IA está controlando tu Mac» con Detener y ⌘⇧Esc (kill‑switch en main, verificado en AUDIT
S5), consentimiento de acceso total registrado en main (S7) y política de apertura de archivos
(S4).

Leyenda: ✅ equivalente · ⚠️ parcial · ❌ ausente. Prioridad: **P0** seguridad/confianza o
bloqueo del flujo básico · **P1** gran impacto de UX · **P2** mejora notable · **P3** opcional.

### Tabla de brechas

| # | Función | Claude | Lapis | Prioridad | Cómo implementarlo sobre OpenCode |
|---|---|---|---|---|---|
| 1 | Carpeta de trabajo por tarea | Proyecto o carpeta; varias carpetas por tarea; «+N on device» | ⚠️ Una carpeta global seleccionada; la tarea hereda la carpeta actual | P1 | Guardar `folders[]` por sesión (metadata en `userData/cowork-tasks.json` keyed por sessionID). El servidor sandbox puede recibir varias rutas escribibles: ampliar `buildSandboxProfile` con N `subpath` y pasar las extra como `external_directory` permitidas en la config inline del agente |
| 2 | Solicitud de carpeta durante la tarea | Tarjeta «would like to Cowork in a folder» + razón + Don’t ask again | ❌ (`external_directory: ask` genérico) | P1 | Interceptar `permission.asked` de tipo `external_directory`: tarjeta específica con ruta + motivo; al aprobar "siempre", registrar en main (lista de confianza) y **reiniciar/ampliar** el perfil Seatbelt (el sandbox actual no permitiría escribir aunque OpenCode apruebe) |
| 3 | Carpetas de confianza en Ajustes | «Trusted Cowork folders», «Remembered» | ⚠️ Carpetas autorizadas existen (`cowork.json`) pero sin pantalla de gestión en Ajustes | P2 | Sección en `SettingsView` que liste `folders`/`fullAccess` de main con quitar/añadir; marcar las de "no volver a preguntar" |
| 4 | Borrado permanente como permiso aparte | Tarjeta dedicada, irrevocable en la tarea, modo `rwd` en la VM | ⚠️ `rm *: ask` en bash, evadible (AUDIT §2.3); tarjeta "quiere borrar archivos" | **P0** | Enforzar en el sandbox: perfil Seatbelt con `(deny file-write-unlink)` en la carpeta por defecto y un segundo perfil/servidor con unlink permitido tras concesión explícita (equivale a `rw` vs `rwd`). Alternativa: papelera — interponer `trash` y bloquear unlink. UI: tarjeta con «no se puede deshacer» |
| 5 | Preguntas estructuradas ("Needs your input") | Opciones, Skip/Submit/Next, reordenar prioridades | ❌ `question: deny` en ambos agentes | P1 | Permitir la herramienta `question` de OpenCode (eventos `question.asked` / respuesta vía SDK) y renderizar tarjeta con opciones + texto libre; estado de tarea "Esperando tu respuesta" |
| 6 | Estados de tarea | Awaiting input/answer, Running, Using the browser, Unread, Idle, Done, Archived, Plan ready | ⚠️ running / waiting / error / done / idle + no leído | P2 | Extender `taskStatus` con `awaiting_answer` (question), `using_computer` (evento `computer:action` reciente), `plan_ready` (todos creados y sin avanzar); vocabulario fijo en un único módulo |
| 7 | Gestión de lista: pin, rename, delete, marcar leído, mover | Todo, más grupos/carpetas personalizados y drag | ⚠️ Solo archivar y búsqueda por título | P1 | `session.update({title})`, `session.delete`, pin/grupos como metadata local; menú contextual con `role="menu"`; "Marcar como no leído" sobre `unseen` |
| 8 | Vista unificada Pinned / Active / Scheduled | Barra única Chat+Cowork+Code | ❌ Lista por carpeta | P2 | Sección "Activas" transversal (todas las carpetas con sesión busy o waiting) + "Programadas" desde el scheduler; lista por carpeta como agrupación |
| 9 | Búsqueda en transcripciones | Worker de búsqueda de texto completo | ⚠️ Filtra títulos | P2 | Indexar mensajes de OpenCode (`session.messages`) en un worker con FlexSearch/minisearch; o SQLite FTS sobre la DB de OpenCode de cada servidor |
| 10 | Archivado automático / retención | Auto-archive por inactividad, retención configurable | ❌ | P3 | Tarea periódica en main: archivar sesiones idle > N días (nunca las que esperan input o están ancladas) |
| 11 | Proyectos (instrucciones, contexto, memoria, programadas) | Completo | ❌ | P1 | Entidad `Project` en main (`projects.json`): carpetas, instrucciones, enlaces, memoria on/off. Al arrancar el servidor, generar `AGENTS.md`/`instructions` inline en la config de OpenCode con las instrucciones del proyecto y los enlaces |
| 12 | Instrucciones globales y por carpeta | Editor con contador; «Folder instructions» | ❌ | P1 | Campo en Ajustes → escribir en la config inline (`instructions: [ruta]`) de cada servidor Cowork; por carpeta, respetar/editar `AGENTS.md` de la carpeta (OpenCode ya lo lee) con editor en el panel |
| 13 | Memoria de Cowork | Archivos locales que Claude lee/escribe; «Read N memories» en contexto | ❌ | P2 | Directorio `userData/cowork-memory/` montado como escribible en el sandbox + instrucción en el agente ("lee MEMORY.md al empezar; guarda lo aprendido"); o un MCP local `memory` con `read/write`. Mostrar en el panel Contexto |
| 14 | Panel Context (herramientas/archivos usados, con salto al mensaje) | Sí, agrupado por tipo con scroll-to | ⚠️ "Actividad" agrupada por paso | P2 | Derivar de las `ToolPart` ya parseadas en `util.ts` (`friendlyTool`) un índice por tipo (archivos leídos, webs, comandos, MCP) con `messageID` para `scrollIntoView` |
| 15 | Entregables | Outputs con preview, Download all, Show in folder, tipos ricos | ✅ Lista + preview md/csv/img/txt + abrir/mostrar | P3 | Añadir "Descargar todo" (zip en main), vista previa de .docx/.pdf/.xlsx (QuickLook `qlmanage -p` o conversión con `textutil`) |
| 16 | Plan / progreso | Progress «Step X of Y», Plan ready/approved/rejected | ✅ `todowrite` en vivo | P3 | Añadir "Paso X de Y" en la cabecera y, opcionalmente, un modo "planificar primero" (agente `plan` → aprobar → `cowork`) |
| 17 | Aprobaciones humanizadas por herramienta | Frase por acción y conector, campos formateados, «not verified», caracteres ocultos | ⚠️ Frases por tipo (bash, web, borrar, fuera de carpeta); AUDIT: la descripción la escribe el modelo | **P0** | Mostrar siempre el comando/argumentos literales como primario; descripción del modelo marcada "(según el agente, no verificado)"; detectar caracteres invisibles/bidi y avisar; plantillas por herramienta MCP conocida |
| 18 | Alcances de permiso | Once / session / always / por web; «Skip this card next time?» | ⚠️ once / always / reject (always de OpenCode = sesión o proyecto) | P2 | Mapear "siempre" a reglas persistidas en la config del agente por carpeta (permission rules) y mostrarlas/revocarlas en Ajustes |
| 19 | Modo auto (clasificador) | Auto mode opcional por política | ❌ | P3 | Agente "vigilante" pequeño que evalúa cada `permission.asked` (riesgo/inyección) y responde `once` o deja la tarjeta; desactivado por defecto |
| 20 | Conectores (MCP) dentro de Cowork | Conectores con aprobación, sugeridos, Dispatch los usa todos | ❌ Los servidores Cowork solo reciben el MCP `computer` | P1 | Inyectar en la config inline de cada servidor los MCP del usuario (`McpSection`) marcados "disponible en Cowork"; en sandbox, los MCP stdio heredan el perfil (revisar rutas de lectura necesarias) y los remotos necesitan red |
| 21 | Skills | Selector, «Create a skill for this kind of task», skills incluidas (pdf, docx, xlsx, pptx…) | ❌ | P1 | Empaquetar skills propias (docx/xlsx/pdf/pptx en español) en `resources/opencode/skills/*/SKILL.md` y exponerlas vía el soporte de skills de OpenCode (o como instrucciones cargadas bajo demanda); botón "Crear skill de esta tarea" que envía un prompt de generalización |
| 22 | Plugins | Marketplace, plugins por rol, MCP locales de plugins | ❌ | P3 | Fase posterior: paquete = carpeta con skills + mcp + agentes; instalar copiando a `userData/opencode-config` |
| 23 | Selector de modelo/esfuerzo por tarea | Modelo por tarea, effort, fallback | ⚠️ `defaultModel` global compartido con Chat (AUDIT §4.1) | P2 | Guardar modelo por sesión (metadata) y pasar `model` en cada `prompt`; variante/effort si el proveedor lo soporta; avisar si el modelo no admite visión para computer use (ya existe `VisionModelHint`) |
| 24 | Side chat | Pregunta lateral sin contaminar la tarea | ❌ | P3 | `session.fork` o sesión hija efímera con el contexto resumido; cajón lateral |
| 25 | Seguimiento / reintento | Edit and retry, nueva sesión o aquí | ⚠️ Chips de seguimiento; sin editar/reintentar | P2 | `session.revert` hasta el mensaje + reenvío editado; "Continuar en nueva tarea" = nueva sesión con resumen |
| 26 | Notificaciones configurables | Por tipo, push móvil, Dock bounce, email/Slack | ⚠️ Notificación del sistema al terminar/aprobar (solo si la ventana no tiene foco) | P2 | Mover la notificación a main (funciona con la vista cerrada), badge del Dock con número de tareas que esperan, `app.dock.bounce`, preferencias por tipo en Ajustes |
| 27 | Mantener el equipo despierto | «Prevents sleep while Dispatch is running» | ❌ | P2 | `powerSaveBlocker.start('prevent-app-suspension')` mientras haya tareas Cowork busy o rutinas en curso |
| 28 | Tareas programadas desde Cowork | Editor completo, permisos, dónde corre, notificación, runs, "fresh vs continue" | ⚠️ Rutinas (modo cowork, cron, catch-up, notifica) en otra vista; AUDIT: IPC `scheduler:*` sin registrar | P1 | Arreglar registro IPC; botón "Programar" en la tarea (prefill con prompt/carpeta/modelo); opción "continuar la misma sesión"; historial de runs dentro de la tarea; aprobaciones: rechazar por defecto con lista blanca explícita por rutina |
| 29 | Dispatch (móvil → escritorio) | Hilo orquestador + sesiones de fondo, push | ❌ | P3 | Requiere relay: exponer servidor local por túnel autenticado (p. ej. Cloudflare Tunnel/Tailscale) + PWA mínima; o bot de Telegram/WhatsApp que crea tareas vía SDK. Orquestador = sesión con herramienta `task` que lanza subsesiones |
| 30 | Cowork en la nube | Ejecución remota con mover-a-nube | ❌ | P3 | Fuera de alcance; alternativa: rutinas en un servidor remoto `opencode serve` (VPS) con la misma UI |
| 31 | Aislamiento del sandbox | VM Linux + proxy MITM + montajes ro/rw/rwd | ⚠️ Seatbelt (`sandbox-exec`) con lecturas denegadas y escritura limitada; red abierta | **P0** | Mantener Seatbelt pero: `(deny network*)` salvo `localhost:<proxy>`; proxy HTTP(S) CONNECT en main con allowlist (dominios del proveedor LLM, búsqueda, package managers opcionales); variables `HTTPS_PROXY` en el entorno del servidor. A futuro: VM con Virtualization.framework (Lima/`vfkit`) |
| 32 | Allowlist de red visible para el usuario | «not on the network allowlist… add it in Settings» | ❌ | P1 | Cuando el proxy bloquea, emitir evento → tarjeta "El agente quiere acceder a X. ¿Permitir?" (una vez / siempre) y persistir en Ajustes |
| 33 | Carpetas de solo lectura | Política `ro` | ❌ | P2 | Segundo tipo de concesión: añadir la ruta a lecturas permitidas pero no a escrituras en el perfil Seatbelt; UI "Solo lectura" en el selector de carpeta |
| 34 | Carpetas prohibidas y mensajes | Home, raíz, datos de la app, red, protegidas — con mensajes accionables | ⚠️ Raíz y home bloqueadas | P2 | Extender `forbiddenFolderReason`: volúmenes de red (`/Volumes` con `statfs` remoto), `~/Library`, userData de Lapis, carpetas del sistema; mensajes "Elige una carpeta de proyecto…" |
| 35 | Computer use: modo Background | Controla apps sin tomar la pantalla, pide escalar | ❌ Solo control total del escritorio principal | P2 | Con AX API (Swift helper): acciones por `AXUIElement` en la app objetivo sin mover el cursor (`AXPress`, `AXValue`); capturas por ventana con `CGWindowListCreateImage` / ScreenCaptureKit; escalar a control total con tarjeta |
| 36 | Concesión por app con niveles | View only / Click only / All; clipboard y atajos aparte; Denied apps | ❌ Acceso total = todo el Mac | **P0** | Herramienta `request_access(apps[])` en `lapis-computer` que bloquea hasta aprobación en UI (vía `COMPUTER_EVENTS_URL`); antes de cada acción comprobar app en primer plano (`NSWorkspace.frontmostApplication`) contra el grant y nivel; navegadores = solo ver, terminales = solo clic; lista de denegadas en Ajustes |
| 37 | Ocultar/enmascarar apps no permitidas | Oculta ventanas y enmascara capturas | ❌ | P1 | Capturar con ScreenCaptureKit `SCContentFilter` excluyendo apps no concedidas (y Lapis); opción "ocultar otras apps" con `NSRunningApplication.hide()` y restaurar al terminar |
| 38 | Indicador en pantalla y parada | Borde luminoso, indicador por app, Esc global, cursor oculto | ✅ Borde, etiqueta, onda de clic, píldora con Detener, ⌘⇧Esc (con aviso si no se registra) | P3 | Opcional: Esc simple mientras controla (como Claude) además de ⌘⇧Esc, filtrando Esc sintetizados por el propio helper |
| 39 | Vista "Live" dentro de la tarea | Stream de la pantalla en el panel | ⚠️ Miniaturas de capturas (`ScreenshotThumbs`) | P3 | Mostrar la última captura del MCP a ~1 fps en el panel mientras hay control activo |
| 40 | Retención de capturas | Aviso explícito de retención | ⚠️ Últimas 20 en `$TMPDIR`, no se borran al salir (AUDIT §1.4) | P1 | Borrar el directorio al terminar la sesión/al salir; texto en el diálogo de acceso total: las capturas se envían al proveedor del modelo y se guardan temporalmente |
| 41 | Activación guiada de computer use | Advertencias + tarjetas de permisos macOS con estado | ✅ `ComputerPermissionsCard` + `FullAccessDialog` | P3 | Añadir las advertencias clave (acciones irreversibles, apps que abren otras, inyección por webs/documentos, cerrar lo sensible) |
| 42 | Herencia TCC | VM + helper separado firmado (`app-cu-helper`) | ⚠️ Riesgo S6 abierto | P1 | Mover el control a un helper con bundle propio que tenga los permisos TCC, llamado solo por el MCP con token; que ni la app ni el bash del agente los hereden |
| 43 | Teach mode | Tooltips paso a paso con Next/Exit | ❌ | P3 | Herramienta MCP `teach_step({x,y,text})` que muestra un globo en el overlay y espera "Siguiente" (IPC de la píldora); oculta la ventana de Lapis |
| 44 | Record a skill (watch-record) | Grabación con micro, píldora, propuesta de skill | ❌ | P3 | Grabar eventos con `CGEventTap` + capturas por evento (helper Swift) y audio (Whisper local o del proveedor); enviar como mensaje con la instrucción "propón una skill"; guardar SKILL.md tras aprobación |
| 45 | Navegador en Cowork | Chrome (extensión) o navegador integrado con cookies importadas, permisos por sitio | ❌ (solo `webfetch`/`websearch`; Safari vía control total) | P2 | MCP de Playwright/Chrome DevTools en perfil dedicado dentro de Lapis (`WebContentsView`), con allowlist por sitio y tarjetas "Permitir una vez/siempre"; import de cookies descartado por riesgo o solo bajo confirmación |
| 46 | Cowork artifacts / live artifacts | Páginas interactivas en la barra, con conectores y re-ejecución | ⚠️ Lapis tiene ventana de artifacts aislada (CSP estricta) pero no ligada a Cowork | P3 | Abrir HTML entregable en la ventana de artifacts existente; "live" = puente con permisos explícitos a MCP (mantener CSP y sin red) |
| 47 | Simuladores/emuladores | iOS Simulator / Android Emulator | ❌ | P3 | No prioritario para Cowork |
| 48 | Hardware Buddy (BLE) | Emparejamiento BLE, prompts en dispositivo | ❌ | P3 | No prioritario |
| 49 | Onboarding de Cowork | Meet Cowork, prompts guiados (conectar herramientas, programar, crear skill), seguridad | ⚠️ Home con categorías y textos de sandbox | P2 | Primer uso: tarjeta de 3 pasos (elige carpeta → qué puede/no puede hacer → prueba una tarea); enlace "Cómo usar Cowork de forma segura" |
| 50 | Sugerencias de la home | Por intención, con prompts "escanea → resume → propone → actúa" | ✅ 5 categorías, 20 plantillas | P3 | Reescribir plantillas con el patrón "primero escanea y resume, luego propone, luego actúa"; permitir ocultar sugerencias |
| 51 | Estados vacíos / errores | Específicos y accionables | ✅ Buenos en general; "Reintentar" en caída del servidor | P3 | Unificar formato "No se pudo X. Inténtalo de nuevo." y errores de arranque del sandbox con causa (p. ej. `sandbox-exec` ausente) |
| 52 | Almacenamiento y limpieza | «Free Up Cowork Disk Space», borrar sesiones/VM, cambiar ubicación de datos | ❌ Servidores/estados en `userData/cowork-sandbox/<hash>` sin gestión | P2 | Sección "Almacenamiento" con tamaño por carpeta-servidor, borrar cachés de servidores parados, y parar servidores inactivos (AUDIT: nunca se detienen) |
| 53 | Límite de concurrencia | Tareas simultáneas limitadas por plan | ⚠️ Sin límite; un servidor por carpeta+modo | P2 | Cola en main: máx. N sesiones busy; parar servidores idle > 10 min |
| 54 | Políticas gestionadas (admin) | Muchas (egress, carpetas, retención, always-allow off…) | ❌ | P3 | Leer un `managed.json` opcional (o perfil MDM) en main y aplicarlo a Ajustes; útil si Lapis se distribuye en empresas |
| 55 | Exportar/compartir tarea | Export transcript, compartir artifacts | ❌ | P3 | `session.messages` → Markdown en Descargas; `session.share` de OpenCode si se usa su servicio (opcional, con confirmación) |
| 56 | Coherencia de modo y glosario | Chat/Cowork/Code con vocabulario fijo | ⚠️ Mezcla inglés/español (AUDIT §4.1) | P3 | Glosario: "Tarea", "Entregables", "Plan", "Control total", "Carpeta de confianza"; mantener "Cowork" como nombre propio |

### Top 10 (orden recomendado)
1. **#36 Concesión de computer use por app con niveles** (+ apps denegadas) — hoy "Control total" es todo o nada.
2. **#31/#32 Red del sandbox con allowlist y proxy** — cierra la exfiltración pendiente (AUDIT S3: red abierta).
3. **#4 Borrado permanente enforzado por el sandbox** (no por patrones de bash).
4. **#17 Aprobaciones con datos literales** y marca "no verificado" para textos del modelo.
5. **#5 Preguntas estructuradas** (`question`) con estado "Esperando tu respuesta".
6. **#11/#12 Proyectos e instrucciones** (globales, de carpeta, de proyecto) vía `AGENTS.md`/`instructions`.
7. **#20/#21 Conectores MCP y skills dentro de Cowork** (docx/xlsx/pdf/pptx en español).
8. **#1/#2 Varias carpetas por tarea y petición de carpeta durante la tarea** con ampliación del perfil Seatbelt.
9. **#28 Programar desde la tarea** (arreglar IPC `scheduler:*`, runs dentro de la tarea, aprobaciones seguras).
10. **#7/#26/#27 Gestión de lista + notificaciones en main + evitar reposo** mientras hay tareas.
