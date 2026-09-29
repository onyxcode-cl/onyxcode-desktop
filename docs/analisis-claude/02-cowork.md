# 02 — Cowork en Claude Desktop (producto y UX) y comparación con OnyxCode

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
- OnyxCode cubre bien el núcleo local (carpeta + sandbox Seatbelt + plan + entregables + aprobaciones
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
Prioridad baja para OnyxCode.

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

## Comparación con OnyxCode

> Nota (2026-09-28): el párrafo siguiente describe OnyxCode tal como estaba al escribir este análisis (antes de los Lotes A y B). El estado actual, fila por fila, está en la «Tabla de brechas» de más abajo.

OnyxCode (`src/renderer/src/features/cowork/**`, `src/main/cowork/**`, `src/main/computer/**`,
`src/renderer/overlay/**`, agentes `cowork.md` y `computer.md`) implementa Cowork sobre
`opencode serve` por carpeta: modo **sandbox** (Seatbelt, agente `cowork`) y modo **Control total
del Mac** (sin sandbox, agente `computer` + MCP `onyxcode-computer`). Tiene home con categorías,
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

> **Actualizada el 2026-09-28** tras los Lotes A y B (`docs/COWORK-LOTE-A.md`, `docs/COWORK-LOTE-B.md`).
> La columna «OnyxCode» describe el estado real actual; el texto original de «cómo implementarlo» se
> sustituye por lo que se hizo (o por el motivo de que no se haga). Las filas marcadas con «(UI:
> Oleada 3)» tienen su lógica en main/estado verificada y su interfaz en los componentes de la
> Oleada 3 del Lote B; ver `docs/COWORK-LOTE-B.md` para lo verificado en vivo y lo que no.
>
> Leyenda de estado: ✅ hecho · ⚠️ parcial · ⏸ aplazado (técnicamente posible, pero costoso o de riesgo) ·
> ⛔ fuera de alcance · ❌ sin abordar.

| # | Función | Claude | OnyxCode (2026-09-28) | Estado | Cómo quedó / por qué |
|---|---|---|---|---|---|
| 1 | Carpeta de trabajo por tarea | Proyecto o carpeta; varias carpetas por tarea | Carpeta principal + **carpetas adicionales** vinculadas a un espacio (`rw` o `ro`) y carpetas de confianza globales; el prompt de la tarea las lista | ✅ | `folderSet`/`linkFolder` en `manager.ts`, `extraFolders` en el perfil Seatbelt (`sandbox-profile.ts`). Ampliar exige reiniciar el servidor sandbox (Seatbelt fija el perfil al lanzar) |
| 2 | Solicitud de carpeta durante la tarea | Tarjeta con motivo y «Don’t ask again» | Tarjeta «quiere trabajar en otra carpeta» (ruta, ancestros, modo, motivo «no verificado», «No volver a preguntar»); al permitir en sandbox se vincula, se reinicia el servidor y la tarea continúa sola | ✅ (UI: Oleada 3) | `answerFolderRequest` (`actions.ts`), `FolderRequestCard.tsx`. Patrones `external_directory` verificados solo leyendo el binario de 1.18.32 |
| 3 | Carpetas de confianza en Ajustes | «Trusted Cowork folders» | Lista con modo, quitar y añadir (`cowork:trusted:*`) | ✅ (UI: Oleada 3) | Sección «Cowork» de Ajustes (`CoworkSection.tsx`) |
| 4 | Borrado permanente como permiso aparte | Tarjeta dedicada, modo `rwd` en la VM | Seatbelt deniega `unlink`/`rmdir`/`rename` en la carpeta principal salvo la concesión **«Permitir borrar, mover y renombrar»**; verificado con `sandbox-exec`: `mv`, mover, sobrescribir y `rm` dan EPERM. **Truncar no está protegido** (mitigación: `session.revert`) | ✅ | En carpetas `rw` adicionales el borrado se deniega siempre; `.cowork/` permite borrar (scratch). Renombrada por el hallazgo de que mover/renombrar requiere el mismo permiso |
| 5 | Preguntas estructuradas | Opciones, Skip/Submit/Next | `question: allow` en ambos agentes; `QuestionPrompt`; estado «Tiene una pregunta para ti…» en la píldora | ✅ | Lote A. Sin reordenar prioridades por arrastre |
| 6 | Estados de tarea | Awaiting input/answer, Running, Using the browser, Unread, Idle, Done, Archived, Plan ready | `running`, `using_computer` («Usando el Mac»), `plan_ready`, `waiting`, `question`, `done`, `error`, `idle`, `archived` | ✅ | `taskStatus` en `util.ts` (vocabulario en un solo módulo) |
| 7 | Gestión de lista: pin, rename, delete, marcar leído, mover | Todo, más grupos y arrastrar | Fijar, renombrar, eliminar, marcar no leída, archivar/**restaurar**, **grupos** («Mover a grupo…»); metadatos persistidos en main (`cowork-tasks.json`) | ✅ (UI: Oleada 3) | Sin arrastrar y soltar. Restaurar usa `session.update({time:{archived:0}})` con respaldo `metadata.unarchivedAt` (por verificar en vivo) |
| 8 | Vista unificada Pinned / Active / Scheduled | Barra única Chat+Cowork+Code | Secciones transversales **Fijadas / Activas / Programadas** (de todas las carpetas) sobre la lista por carpeta | ✅ (UI: Oleada 3) | `SidebarSections.tsx`; «Activas» sale del monitor de main (`cowork:activity`) |
| 9 | Búsqueda en transcripciones | Búsqueda de texto completo | Títulos + transcripciones (≥ 3 caracteres, sin acentos, con fragmento y salto al mensaje) | ✅ (UI: Oleada 3) | `search.ts` (`useTranscriptSearch`). No es un índice: recorre los mensajes de la carpeta |
| 10 | Archivado automático | Auto-archive por inactividad | Implementado en el monitor; **desactivado por defecto** (decisión), con opciones 7/14/30/90 días y tope de la política gestionada | ✅ | Nunca archiva fijadas ni en curso/en espera; revoca el plan de la tarea archivada |
| 11 | Proyectos | Instrucciones, contexto, memoria, programadas | Por carpeta: nombre, instrucciones (contador n / 20.000), **enlaces**, interruptor **«Usar memoria»**, `AGENTS.md`, skills disponibles, permisos recordados | ⚠️ | Sin documentos de Drive ni proyectos de Chat vinculados (no aplican a OnyxCode); las rutinas usan el mismo prompt (`buildCoworkSystemPrompt`) |
| 12 | Instrucciones globales y por carpeta | Editor con contador | Instrucciones globales (Ajustes) + instrucciones del proyecto + editor del `AGENTS.md` de la carpeta | ✅ (UI: Oleada 3) | `cowork:agentsMd:*`, validado con `assertInsideApproved` |
| 13 | Memoria de Cowork | Archivos locales que Claude lee/escribe | `.onyxcode/memoria.md` por carpeta, editable en el panel, con interruptor (el prompt indica al agente que no la lea ni escriba si está desactivada); no aparece en Entregables | ✅ | Ya no se pisa lo que escribe el agente (Lote A) |
| 14 | Panel Context (herramientas y archivos usados, con salto al mensaje) | Sí | «Actividad» agrupada por paso, sin índice por tipo | ❌ | No entró en el Lote B |
| 15 | Entregables | Outputs con preview, Download all, Show in folder | Vista previa md/csv/txt/imágenes + **docx/doc/rtf/odt** (`textutil`), **Descargar todo** (zip), **Vista rápida** (QuickLook), **Abrir como artifact** y **Guardar como PDF** para HTML, agrupación por carpeta | ✅ (UI y handlers: W3-D) | Handlers `cowork:zip/quickLook/exportMarkdown/htmlToPdf` en `cowork-files-handlers.ts`; el PDF se genera con `renderHtmlToPdf` (`extras/artifact-window.ts`, ventana oculta aislada) |
| 16 | Plan / progreso | Progress «Step X of Y» | `todowrite` en vivo + «Paso X de Y» | ✅ (UI: Oleada 3) | Sin modo «planificar primero» con el agente `plan` |
| 17 | Aprobaciones humanizadas por herramienta | Frase por acción, campos formateados, «not verified», caracteres ocultos | Frases por tipo; el comando literal es lo primario; aviso de caracteres de control/invisibles; tarjeta de MCP con el JSON literal; motivo del agente marcado «no verificado» (UI: Oleada 3) | ⚠️ | Sin plantillas por conector conocido |
| 18 | Alcances de permiso | Once / session / always / por web | Una vez / siempre / rechazar; «siempre» se **persiste por carpeta** (`cowork-rules.json`) y se ve y revoca en Ajustes y en el panel de proyecto (UI: Oleada 3) | ✅ | No se recuerdan `external_directory`, `doom_loop`, `computer_*` ni borrados. Por verificar si `reply 'always'` sobrevive a un reinicio de OpenCode |
| 19 | Modo auto (clasificador) | Opcional por política | Interruptor maestro apagado por defecto (kill switch) + opt-in por carpeta o tarea; aprueba solo bash de solo lectura, MCP de solo consulta y «Solo ver» efímero de una lista cerrada de apps; registro con «Revocar» y «Vaciar registro»; política `disableAutoMode` | ✅ (Lote C) | **Solo motor de reglas, sin modelo clasificador** (decisión del usuario, 2026-09-28): añadir un modelo que decida sobre texto de la pantalla solo aumentaría el riesgo de inyección y el coste, sin necesidad real hoy (`auto-mode.ts`/`auto-approver.ts`) |
| 20 | Conectores (MCP) dentro de Cowork | Con aprobación, sugeridos | Los MCP del usuario marcados **«Disponible en Cowork»** (con «Preguntar en cada uso»); locales con `env -u`; hosts remotos añadidos a la red | ✅ | Los remotos con OAuth no funcionan en el sandbox (XDG privado sin tokens): se avisa. Sin catálogo |
| 21 | Skills | Selector, «Create a skill…», skills incluidas | Skills `docx`, `xlsx`, `pdf`, `pptx` en español (`resources/opencode/skills`), lista de skills instaladas en el proyecto y **«Crear skill de esta tarea»** (`.opencode/skills/<nombre>/SKILL.md`) | ✅ | Comandos comprobados dentro del perfil Seatbelt; `pdf` no puede maquetar (`textutil` y `cupsfilter` no lo permiten): «Guardar como PDF» en Entregables |
| 22 | Plugins | Marketplace | Solo la lista de skills instaladas | ⏸ | Marketplace/paquetes: fase posterior |
| 23 | Modelo y esfuerzo por tarea | Modelo por tarea, effort | Modelo y variante por tarea (`taskModel`), guardados en `extras.modelsByMode.cowork` (ya no tocan el modelo de Chat); `EffortPicker`; `UsageMeter` | ✅ (UI: Oleada 3) | `currentCoworkModel()` / `setTaskModel()` |
| 24 | Side chat | Pregunta lateral | **Consulta lateral**: sesión hija con agente `chat` y el contexto de la tarea; no aparece en la lista | ✅ (UI: Oleada 3) | `openSideChat`/`sendSideChat` (`actions.ts`) |
| 25 | Seguimiento / reintento | Edit and retry | «Editar y reintentar» (`session.revert` + reenvío), «Continuar en una tarea nueva», «Exportar a Markdown» | ✅ (UI: Oleada 3) | Deshace también los cambios de archivos posteriores (avisa antes) |
| 26 | Notificaciones configurables | Por tipo, push móvil, Dock bounce, email/Slack | Por tipo (terminó / aprobación / pregunta / error) desde **main** para carpetas que no se están mirando; la de `request_access` respeta `prefs.notify.approval`; clic abre la tarea | ⚠️ | Sin badge ni rebote del Dock; push/email/Slack fuera de alcance |
| 27 | Mantener el equipo despierto | «Prevents sleep…» | `KeepAwakeService` con OR entre la señal del renderer y la del monitor | ✅ | El estado `busy` congelado de otras carpetas se purga |
| 28 | Tareas programadas desde Cowork | Editor completo, permisos, notificación, runs | Rutinas: lista **«Permitir sin preguntar»**, «Rechazar y seguir / Esperar mi aprobación», sitios permitidos, «Empezar de cero / Continuar la misma tarea», historial con lo rechazado/aprobado/hosts bloqueados, **Control total** con consentimiento explícito + aprobación humana del plan en cada ejecución | ✅ | Ya no fallan en silencio. Sin «dónde corre» (solo local) |
| 29 | Dispatch | Hilo orquestador + push | — | ⛔ | Requiere relay/móvil |
| 30 | Cowork en la nube | Ejecución remota | — | ⛔ | Fuera de alcance |
| 31 | Aislamiento del sandbox | VM Linux + proxy MITM | Seatbelt endurecido (S1–S3, `(deny network*)` salvo proxy local con lista blanca deny-by-default, borrado/renombrado denegado, carpetas `ro`/`rw`) | ⚠️ | Sin VM: Virtualization.framework queda como opción futura |
| 32 | Allowlist de red visible | «not on the network allowlist…» | Tarjeta «El agente quiere acceder a X» (una vez / siempre), Ajustes → Red de Cowork; búsqueda web (`mcp.exa.ai`) activable; hosts de MCP remotos visibles | ✅ | Con `disableCustomHosts` no se pueden añadir sitios |
| 33 | Carpetas de solo lectura | Política `ro` | Carpetas adicionales `ro` (`deny file-write*` al final del perfil) | ✅ | La lectura la da `(allow default)`; la escritura la impone Seatbelt |
| 34 | Carpetas prohibidas y mensajes | Home, raíz, datos de la app, red, protegidas | `folder-policy.ts`: raíz/home, sistema, `/Volumes`, redes (`smbfs`…), userData, `~/Library` (iCloud aparte), Papelera, rutas de secretos, raíces de la política — con mensajes accionables | ✅ | |
| 35 | Computer use: modo Background | Controla apps sin tomar la pantalla | Herramientas MCP `app_tree`/`app_find`/`app_press`/`app_set_value`/`app_action`/`app_screenshot` sobre el árbol de accesibilidad (`cu-helper ax-*`), sin mover el ratón ni activar la app; `request_full_control` para pasar a control real cuando de verdad hace falta; **modo por defecto** (`DEFAULT_COMPUTER_PREFS.mode = 'background'`) | ✅ (Lote C) | Recompilar el helper (una sola vez, C1) no obligó a volver a conceder Accesibilidad/Grabación de pantalla: macOS atribuye el permiso al proceso responsable (la terminal o la app empaquetada), no al binario del helper |
| 36 | Concesión por app con niveles | View / Click / All; denegadas | `request_access` con `levels`, niveles por app, denegadas, aprobar nunca baja un nivel, plan por sesión | ✅ | Lote A |
| 37 | Ocultar/enmascarar apps no permitidas | Oculta ventanas y enmascara capturas | Enmascarar ya existía (`screenshot-sck` excluye las apps sin concesión); «Ocultar las demás apps mientras controla» (activado por defecto) usa `hide-apps`/`unhide-apps` (`NSRunningApplication.hide()`, sin TCC) y se recupera sola tras un crash | ✅ (Lote C) | `app-visibility.ts`; conserva las apps con concesión, las del sistema y Finder; Ajustes › Control del Mac |
| 38 | Indicador en pantalla y parada | Borde, Esc global | Borde, etiqueta, píldora con Detener, ⌘⇧Esc (kill-switch en main) | ✅ | |
| 39 | Vista «Live» en la tarea | Stream de pantalla | Sección «En vivo» con la última captura mientras se usa el Mac | ✅ (UI: Oleada 3) | Última imagen de las partes de herramienta, no un stream |
| 40 | Retención de capturas | Aviso explícito | Se borran al Detener, al cerrar la app y a los 60 s sin tareas de Control total; el diálogo de Control total explica la retención | ✅ (diálogo: Oleada 3) | `ComputerService.cleanScreenshots()` |
| 41 | Activación guiada de computer use | Advertencias + permisos macOS | `ComputerPermissionsCard` + `FullAccessDialog` | ✅ | |
| 42 | Herencia TCC | Helper firmado aparte | S6 corregido con `onyxcode-disclaim` y MCP en `utilityProcess`; el `cu-helper` sigue sin bundle propio | ⏸ **omitido** | No hay ninguna identidad de firma de Apple Developer disponible en esta máquina (`security find-identity` devuelve 0 identidades): un helper firmado aparte necesitaría un Developer ID que no existe aquí. `build.sh` sigue firmando ad-hoc, que TCC no usa para atribuir el permiso |
| 43 | Teach mode | Tooltips paso a paso | Globo propio (ventana `assist`, rol y preload aparte) junto al elemento, con «Siguiente»/«Salir de la guía»; el agente solo señala (`teach_step`) y nunca hace clic; pide solo el nivel «Solo ver» | ✅ (Lote C) | `helper.swift ax-frame`, `computer/assist-window.ts`, `overlay/assist.ts` |
| 44 | Record a skill | Grabación con micro | Se registran eventos ordenados (clic, tecla, texto, cambio de app, scroll) con capturas por paso y, si el usuario quiere, narración por voz transcrita en el dispositivo; tarjeta de revisión (pasos, transcripción, «Incluir el texto que tecleé» desactivado) antes de proponer la skill con `question` | ✅ (Lote C) | `cu-helper record`/`transcribe`, `computer/recorder.ts`, `RecordSkill.tsx`. No es un vídeo: es exactamente lo que se le manda al modelo |
| 45 | Navegador en Cowork | Chrome / navegador integrado | Navegador propio de Cowork (`chrome-devtools-mcp` detrás de una pasarela propia, `browser-mcp.js` (histórico: eliminado en la fase 3 del refactor)) con permiso previo por sitio (diálogo nativo), perfil aislado y **solo en Control total del Mac**; desactivado por defecto | ✅ (Lote C) | `main/browser/{gateway,service,sites}.ts` (histórico: eliminado en la fase 3 del refactor); Playwright se descartó (~150 MB de Chromium); en Sandbox no aparece (correría fuera de Seatbelt y del proxy de egress) |
| 46 | Artifacts / live artifacts | Páginas interactivas con conectores | Los bloques ```html y los **archivos HTML entregables** abren en la ventana de artifacts (aislada, CSP estricta, sin red) | ⚠️ | Sin live artifacts (puente a MCP) |
| 47 | Simuladores/emuladores | iOS/Android | — | ⛔ | No prioritario |
| 48 | Hardware Buddy (BLE) | Emparejamiento BLE | — | ⛔ | No prioritario |
| 49 | Onboarding de Cowork | Meet Cowork, prompts guiados | Tarjeta de primer uso de 3 pasos + enlace «Cómo usar Cowork de forma segura» | ✅ (UI: Oleada 3) | `Onboarding.tsx`, `localStorage cowork.onboarded` |
| 50 | Sugerencias de la home | Por intención, «escanea → propone → actúa» | 5 categorías, plantillas con el patrón «primero revisa… luego propón… cuando lo apruebe…»; «Ocultar/Mostrar sugerencias» | ✅ (UI: Oleada 3) | |
| 51 | Estados vacíos / errores | Específicos y accionables | Sin cambios sistemáticos | ⚠️ | Los mensajes de carpetas y de política son accionables; no se unificó el formato «No se pudo X. Inténtalo de nuevo.» |
| 52 | Almacenamiento y limpieza | «Free Up Cowork Disk Space» | Informe por carpeta-servidor (`du -sk`), «Limpiar caché» (servidor parado), «Borrar todo» (con aviso: se pierde el historial de tareas en sandbox), «Borrar capturas temporales» | ✅ (UI: Oleada 3) | `storage.ts` + `cowork:storage:*`; rechaza si el servidor está vivo |
| 53 | Límite de concurrencia | Tareas simultáneas limitadas por plan | Parada por inactividad (15 min por defecto) y máximo de servidores (4); nunca mata trabajo en curso | ✅ | Decisión: valores por defecto 15 min / 4. Sin cola de sesiones |
| 54 | Políticas gestionadas | Muchas | `managed.json` mínimo: `disableFullAccess`, `allowedFolderRoots`, `disableCustomHosts`, `extraAllowedHosts`, `disableAlwaysAllow`, `disableRoutines`, `maxAutoArchiveDays`; validación fail-closed | ⚠️ | Sin perfil MDM ni retención/egress por organización |
| 55 | Exportar/compartir tarea | Export transcript | «Exportar a Markdown» (`cowork:exportMarkdown`, con diálogo de guardar) | ⚠️ (UI y handler: W3-B/W3-D) | Sin `session.share` ni compartir artifacts |
| 56 | Coherencia de modo y glosario | Vocabulario fijo | `src/shared/cowork-glossary.ts`: Sandbox, **Control total del Mac**, Carpetas de Cowork, Carpetas de confianza, Carpetas adicionales, Solo lectura, Lectura y escritura, «Permitir borrar, mover y renombrar», Consulta lateral, Rutina. Prohibido: «Acceso total», «acceso completo», «Carpetas autorizadas» | ✅ | Barrido final de W3-F en las cadenas de main; los comentarios de código pueden conservar términos antiguos |

### Lo que sigue aplazado o fuera de alcance (y por qué)

- **Requieren cambiar `resources/computer-use/helper.swift`** (#35 Background por AX, #42 helper firmado aparte,
  #43 Teach, #44 Record a skill, «ocultar otras apps» de #37): recompilar cambia la firma del helper y macOS olvida los
  permisos TCC (Accesibilidad, Grabación de pantalla). No hay una vía solo-TS segura. Se hacen todos juntos en un lote
  con un plan de migración de permisos.
- **#45 Navegador propio**: Playwright descarga unos 150 MB de Chromium y Chrome dentro de Seatbelt choca con su
  propio sandbox, perfiles y proxy. Alternativa mínima ya cubierta por #20 (MCP `chrome-devtools-mcp` en Control total).
- **#19 Modo auto**: un modelo clasificador por cada permiso, con riesgo de inyección; no es trivial ni barato.
- **#22 Marketplace de plugins**: fase posterior.
- **Snapshots APFS («punto de restauración») antes de conceder borrado**: aplazado; la red de seguridad actual es
  `session.revert` (deshace también cambios de archivos, pero **no** cubre truncados fuera de los snapshots de OpenCode).
- **Fuera de alcance**: #29 Dispatch, #30 Cowork en la nube, #47 simuladores, #48 Hardware Buddy (BLE).
- **Sin abordar**: #14 panel Context; badge y rebote del Dock (#26); formato unificado de errores (#51).

### Top 10 (orden recomendado) — estado

1. **#36 Concesión de computer use por app con niveles** — ✅ (Lote A).
2. **#31/#32 Red del sandbox con allowlist y proxy** — ✅ (proxy con lista blanca deny-by-default; búsqueda web activable).
3. **#4 Borrado permanente enforzado por el sandbox** — ✅ y ampliado a mover/renombrar (truncar sigue sin protección).
4. **#17 Aprobaciones con datos literales** y «no verificado» — ⚠️ hecho salvo plantillas por conector.
5. **#5 Preguntas estructuradas** — ✅.
6. **#11/#12 Proyectos e instrucciones** — ✅ (enlaces, memoria on/off, `AGENTS.md`).
7. **#20/#21 Conectores MCP y skills dentro de Cowork** — ✅.
8. **#1/#2 Varias carpetas por tarea y petición de carpeta durante la tarea** — ✅ (reinicio del servidor para ampliar el perfil).
9. **#28 Programar desde la tarea** — ✅ (lista blanca, esperar aprobación, Control total con aprobación humana).
10. **#7/#26/#27 Gestión de lista + notificaciones en main + evitar reposo** — ✅ (notificaciones sin badge del Dock).
