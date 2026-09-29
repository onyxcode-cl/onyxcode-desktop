# 01 — La pestaña **Code** de Claude Desktop (Claude Code for Desktop), detalle por detalle

> Análisis funcional de `/Applications/Claude.app` v2.9939.2. **No se copia código de Anthropic**:
> se describe el comportamiento con nuestras palabras. Las citas son cadenas de UI cortas (<15
> palabras) y se indica el bundle donde aparecen. Método: índice `id i18n → bundle` construido sobre
> `ion-dist/i18n/en-US.json` (31 680 cadenas) y los 3 292 JS de `ion-dist/assets/v1/`, más
> `Contents/Resources/en-US.json` (cadenas del shell de escritorio) y el `app.asar` extraído
> (proceso main + workers). Todo el material intermedio está en el scratchpad
> (`…/scratchpad/claude-analysis/code/`), no en el repo.

## 0. Bundles de referencia (alias usados en este documento)

Todos bajo `Contents/Resources/ion-dist/assets/v1/` salvo indicación.

| Alias | Archivo | Contenido principal |
|---|---|---|
| **SES** | `c1c1ec7b9-BpMPRL5q.js` | Transcript de sesión: permisos, plan, preguntas, worktrees, PR, costes, rewind |
| **NEW** | `cc43287c9-BAqI9kMU.js` | Pantalla "nueva sesión", composer, SSH, presets, git requerido, rewind |
| **SSH** | `cf6ae6197-H7y9eJvd.js` | Diagnóstico SSH, auto-merge, Remote Control, stats |
| **TOOLS** | `cb6930dae-j25SuahN.js` | Etiquetas de tarjetas de herramientas ("Running…/Ran…/Failed to…") |
| **ERR** | `shared-19-DLVjgyVe.js` | Estados de error de sesión (arranque, red, git, sandbox, org) |
| **KEYS** | `shared-23-Ck8pHsKe.js` | Diálogo de atajos + mapa `command→key` |
| **NEWS** | `cb63ed069-ZKFCy6zo.js` | Notas de versión integradas ("What’s new") |
| **PANES** | `cccc2cf0a-DQ0jF1XG.js` | Paneles: archivos, diff, terminal, tareas, plan, side chat, artifacts |
| **MSG** | `c63275c0a-Bu1lgnfE.js` | Menú de mensaje, cola, mensajes entre sesiones/subagentes |
| **QUEUE** | `cf74bc599-YPQxWtev.js` | Cola de mensajes, rail de sesión, capítulos, sleep, estado PR |
| **SIM** | `c49d37e5f-DcUImC2W.js` | iOS Simulator / Android Emulator |
| **DEV** / **PREV** | `cf580efe9-W6QKUe5D.js` / `c58115fda-e-9Kz8Mr.js` | Dev servers (`.claude/launch.json`) y pane Preview/Browser |
| **PR** / **PRBAR** | `ca9ee6f68-BaNR-3Gw.js` / `c219730b0-BhybEync.js` | Vista de PR (checks, review, merge) y barra de PR |
| **SIDE1/2/3** | `shared-24-…`, `shared-25-…`, `shared-22-…` | Sidebar: filtros, grupos, carpetas, bulk, nested sessions |
| **SET1** / **SET2** | `c7357c32b-DZ5f3TY1.js` / `c71860c77-ClFJTnyq.js` | Ajustes → Claude Code / General |
| **STORE** | `c71860c77-BO4rFC63.js` | Ajustes → Almacenamiento / limpieza de worktrees |
| **ADMIN** | `c71860c77-Br5t46EQ.js` | Consola de organización para Claude Code |
| **MODES** | `shared-15-KGWycdaF.js` | Selector de modo de permisos, modelo, dictado |
| **COMP** | `c099c328d-B_i6zFP6.js` | Composer: bash mode, historial, imágenes, send options |
| **SLASH** | `cc183b3ab-CvrQcdar.js` | Catálogo de slash commands de la app |
| **CTX** | `c2d611398-DuZp25Ut.js` | Medidor de contexto / uso |
| **PAL** | `c2771e1f6-bJ90W17j.js` | Paleta de comandos (⌘K) |
| **ONB** | `c3854002e-DeXVqsc7.js` | Checklist de onboarding de Code |
| **IMP** | `c432d56b4-D0IUK-LE.js` | Importar/exportar sesiones |
| **ROUT** | `c29d48294-DXpkGzsO.js` | Rutinas (triggers GitHub, API, cron) y entornos cloud |
| **DESK** | `Contents/Resources/en-US.json` | Menús nativos, Remote Control, pinned git origins, import CLI |

Arquitectura (resumen; detalle en `03-motor-interno.md`): el renderer es claude.ai empaquetado; el
main lanza el CLI `claude` por el Agent SDK (NDJSON por stdio); workers dedicados en el asar:
`pty-host/ptyHostWorker.js` (node-pty fuera del hilo principal), `file-index-worker` (índice de
archivos con `git ls-files --exclude-standard` + ripgrep, alimenta `@` y el pane Files),
`transcript-search-worker` (búsqueda full-text en transcripts para ⌘K), `shell-path-worker`
(resolver PATH del login shell), `stall-sampler-worker`.

---

## 1. Arquitectura de información

### 1.1 Estructura de la ventana

- **Sidebar izquierda** con pestañas de producto (Chat / Cowork / Code), navegación entre ellas con
  `⌘⌥←/→` ("Next sidebar tab", **KEYS**). Redimensionable ("Resize sidebar", **SIDE1**) y editable
  ("Edit sidebar…" — elegir qué ítems aparecen, **SIDE2**).
- **Área principal**: una o varias sesiones (split view) con **transcript + composer**, y **panes
  laterales** acoplables (Changes/diff, Terminal, Files, Preview/Browser, Tasks, Plan, PR, Artifacts,
  simulador). Hay "Primary pane"/"Secondary pane" y redimensionado por filas/columnas ("Resize pane
  columns/rows", **SIDE2**).
- **Rail de sesión** plegable ("Show session rail"/"Hide session rail", **QUEUE**) con **capítulos**
  ("Session chapters", "Pin as chapter", "Chapter title" — **QUEUE/MSG/SES**): el usuario puede fijar
  un mensaje como capítulo y navegar la sesión por capítulos.
- **Barra de título**: badge de Remote Control clicable ("Remote Control shows as a badge in the title
  bar", **NEWS**), barra de PR con PRs relacionados/stacked ("See related and stacked PRs together in
  the PR bar", **NEWS**).
- **Ventanas extra**: abrir una sesión en su propia ventana ("drag it out from the sidebar, or ⌘+click",
  **NEWS**; menú nativo "New Session in New Window", **DESK**). Side chat flotante (⌘;) que recuerda
  posición y tamaño.

### 1.2 Lista de sesiones (sidebar de Code)

- **Secciones**: "Pinned", "Recents"/"Recent", "Projects", "Archived", "Pull requests", "Routines"
  (**SIDE1/SIDE2**). "Every folder you’ve worked in appears under Recent" con un `+` para iniciar ahí
  (**NEWS**). Filas de proyecto expandibles con botón "View project" al hover (**NEWS**).
- **Agrupación** ("Group and sort", "Group by", **SIDE2**): por fecha (Today/Yesterday/Older), por
  **estado de PR** ("Group sessions by PR state from the filter icon", **NEWS**) con contadores
  "Approved / Changes requested / Conflict / Draft / Merged / Queued / Ready" (**SIDE1**), por
  **carpeta**, por **preset** y **grupos personalizados** ("Create and group by custom/folder/preset",
  **SIDE3**). Opciones "Show PR status", "Show empty groups", "Ungrouped" (**SIDE2**).
- **Orden**: "Sort by" → "Date created", "Last activity", "Name", ascendente/descendente (**SIDE2**).
- **Filtros**: por entorno ("All environments"), proyecto ("All projects"), estado ("Active",
  "Idle", "Needs input", "Unread", "Ready"), "Clear filters", "Filter (active)" (**SIDE2**).
  Estado vacío con filtros: "No sessions match the current filters" (**SIDE1**).
- **Grupos/carpetas**: "New group…", "Rename group", "Delete group?", "Move to group", "Ungroup",
  "Move {count} to group" y arrastrar sesiones a un grupo ("Drag or move sessions here", **SIDE2**).
  Al borrar un grupo las sesiones vuelven a "Ungrouped" ("Its sessions stay and move back to
  Ungrouped", **SES**). Indicador "A session in this group is waiting on you" (**SIDE3**).
- **Pin / estrella**: "Pin session", "Unpin session", "Drag to pin", "Release to unpin" (**SES/KEYS/SIDE2**);
  "Star/Unstar" para proyectos (**SIDE3**). Pins sobreviven al cierre de sesión ("Sidebar pins and
  starred sessions survive sign-out", **NEWS**). Una sesión fijada no se autoarchiva ("This session is
  pinned, so it won’t be archived automatically", **SES**).
- **No leídos / estados**: punto amarillo cuando espera al usuario; "Mark as unread", "Mark all as
  read", "Unread response" (**SIDE1/SIDE3**); "Mark a waiting session as completed … clears the yellow
  dot" (**NEWS**). Estados de pestaña accesibles: "{tab}, awaiting your input / unread activity /
  working" (**SIDE1**). Unread con matices ("Unread until the current turn ends", "Unread. Claude
  needs your approval first.", **MSG**). Clasificación automática opcional de sesiones en
  **bloqueada / lista para revisión / hecha** ("Classify session states", **SET2**) con sugerencias
  contextuales ("This work has landed; the session can be archived.", **QUEUE**).
- **Sesiones anidadas**: sesiones iniciadas por otra sesión se anidan bajo su padre ("Nested
  session", "Show nested sessions", "{count} nested sessions need input", **SIDE1**; "Go to parent
  session", **SES**).
- **Menú contextual de sesión**: renombrar in-place, pin, marcar leído/no leído, marcar completada,
  mover a grupo/carpeta, "Open in split view", "Open in new window", "Fork session", "Move to cloud",
  "Open in editor", "Copy session link", archivar, borrar (**NEWS/KEYS/SIDE3**).
- **Archivo**: "Archive session", archivado automático por inactividad ("Archive inactive sessions",
  **SET1**) y tras merge/cierre del PR ("Auto-archive after PR merge or close", **SET2**). Reglas
  explicadas en la propia sesión: no se archiva si hay trabajo vivo, cola pendiente, Remote Control,
  keep-awake, hijas sin archivar, espera de respuesta (≤1 día) (**SES**, grupo "This session will be
  archived automatically…"). Archivar con cambios sin commitear pregunta ("Archive session with
  uncommitted changes?", **KEYS**) y el worktree queda en disco ("The worktree is still on disk.",
  **SIDE2**). "Delete worktree … discards whatever uncommitted changes" (**SES**).
- **Acciones masivas**: "Select all", "Archive selected ({count})", "Delete selected", "Archive all
  in {group}", "Archive/Delete older sessions?" (más de una semana; los pins no se tocan) (**SIDE1/SIDE2**).
- **Búsqueda**: `⌘K` ("finds sessions you started since opening the app, and searches branches inside
  folders", **NEWS**); "Search by title, folder, or branch" (**NEW**); "Archived sessions are searched
  too." (**SES**); búsqueda en transcripts vía worker.
- **Cabecera de estado**: "{count} working", "{count} new", "{activeCount} of {maxSessions} sessions"
  (límite de sesiones simultáneas, **SIDE1/NEW**). Estado vacío: "Sessions you start will show up here."

### 1.3 Split view

"Split view now tiles into an adaptive grid" (**NEWS**). Acciones (**KEYS**, menú nativo **DESK**):
"Open session in split view" (`⌥+click`), "New Session on the Right / Below", "Move split view
left/right/up/down/to new column/to top left/to bottom left", "Focus next/previous split view"
(`⌃]` / `⌃[`), "Close split view", "Swap" (**SIDE2**). Side chat sólo en el pane primario ("Side chat
is only available in the primary pane.", **NEW**). Si un pane muestra algo ya abierto en otro:
"Showing in another pane/window" (**QUEUE**).

### 1.4 Panes

| Pane | Qué hace (evidencia) |
|---|---|
| **Changes / diff** | Árbol de archivos cambiados ("Group files by folder", "Separate test, build, and generated files"), alcance del diff ("Diff scope: {label}": "All changes", "Uncommitted changes", commits concretos, "Compare against … vs {base}"), "Hide whitespace changes", "Highlight changed words", "Word wrap", "Expand/Collapse all files", "Search changed files", "Search commits" (**PANES**). Comentarios inline para Claude ("Select any text to leave a comment for Claude", "{count} inline comments will be sent", **PANES/SES**). Revisión de código con hallazgos ("Next finding", "Apply fixes", "Re-run review", "Stop review", **PANES**). Ramas: "Walk through in diff", "View this turn’s changes" (**SES**). Clic derecho en archivo: Open, Copy path, Attach as context (**NEWS**). Estados de archivo: binario, "Whitespace only", "Too large to show", "Made executable", "Renamed from {path}" (**PRBAR**). |
| **Terminal** | Varias pestañas ("New terminal", "Terminal {n}", "Rename terminal", "Close other terminals", **PANES**); aviso si hay proceso vivo al cerrar; "Clear terminal"; adjuntar salida al chat ("Terminal output attached to chat", ⌘⇧L). Abrir en terminal desde árbol/carpetas ("Open in terminal"). |
| **Files** | Árbol + tabs de archivos abiertos ("Files you open line up here as tabs"), fuzzy find por nombre y `?` para buscar contenido ("Filter files… (? for contents)"), ⌘F dentro del archivo, edición in-place y guardado ⌘S ("Click any file in the file panel to edit it in place", **NEWS**), preview Markdown, enlaces `#L5-L20` resaltan líneas, "Reveal in file tree", dotfiles visibles (**PANES/NEWS**). Archivos fuera del proyecto: aviso de que Claude también los ve (**SES**). |
| **Preview / Browser** | Navegador integrado con pestañas, dev servers, selección de elementos, anotación (§6). |
| **Tasks** | Tareas en segundo plano: shells, subagentes, monitores, loops, prompts programados, workflows ("Background tasks appear here", "Clear finished tasks", "Stop this task", "View transcript", **PANES**); `⌃B` / `/tasks`. |
| **Plan** | "Claude writes the plan here as it explores. Keep chatting." (**PANES**); "Copy plan", "Plan comment" (comentarios sobre el plan). |
| **PR** | Vista de PR completa (§5). |
| **Artifacts** | "Artifacts published in this session appear here." (**PANES**). |
| **Side chat** | "Chat about this session without touching the main thread" (**PANES**), ⌘; o `/btw`. |
| **Simulador** | iOS Simulator / Android Emulator en vivo (§6). |

Atajos de panes: `⌘\` cerrar pane, `⌘⇧\` expandir/colapsar, `⌘⇧Y` mostrar/ocultar lista de archivos
en changes/files, `⌘P` ir a archivo en changes. "The Files panel stays open when you switch between
sessions" (**NEWS**).

### 1.5 Paleta de comandos (⌘K)

**PAL**: "Search or start a session", modos "Search mode" / "Actions mode" ("Quick actions",
"Search actions"), filtros por tipo y fecha ("Past hour/week/month/year"), resultados de sesiones,
proyectos, PRs ("PR #{prNumber}"), artifacts y **atajos a ajustes** ("Settings → {group} → {section}").
También la entrada de menú "Quick chat or search" (**KEYS**).

### 1.6 Atajos de teclado (lista completa encontrada)

Fuente: mapa `command→key` y diálogo "Keyboard shortcuts" en **KEYS**; menús nativos en el asar
(`index.chunk-DzZc-q0x.js`) y **DESK**; **NEWS**.

**General / sesiones**
| Acción | Atajo |
|---|---|
| Nueva sesión | `⌘N` (en app nativa; `⌘⇧O` en web) |
| Cerrar tab/pane/sesión | `⌘W` |
| Reabrir sesión cerrada | `⌘⇧T` |
| Saltar a sesión 1…9 | `⌘1…9` |
| Sesión siguiente/anterior | menú nativo "Next/Previous Session" |
| Archivar sesión | `⌘⇧⌫` (y `⌘⌥A`) |
| Abrir en split view | `⌥+click` |
| Pin/unpin sesión | `⌘⌥P` |
| Renombrar sesión | `⌘⌥R` |
| Marcar leída/no leída | `⌘⌥U` |
| Abrir PR de la sesión | `⌘⌥G` |
| Fork session | `⌘⌥O` |
| Toggle sidebar | configurable (hay acelerador nativo `⌘B`, etiqueta no confirmada) |
| Pestaña de sidebar siguiente/anterior | `⌘⌥→` / `⌘⌥←` |
| Paleta / búsqueda | `⌘K` |
| Foco split siguiente/anterior | `⌃]` / `⌃[` |
| Ajustes | `⌘,` |

**Transcript**
| Acción | Atajo |
|---|---|
| Detener respuesta | `Esc` |
| Editar último mensaje | `Esc Esc` |
| Ciclar vista Normal/Verbose/Thinking | `⌃O` |
| Tareas en segundo plano | `⌃B` |
| Prompt anterior/siguiente | `⌘⌥↑/↓` o `⌥↑/↓` |
| Scroll con flechas y PgUp/PgDn | (NEWS) |
| Elegir opción de pregunta | teclas `1…9` |

**Panes**
| Acción | Atajo |
|---|---|
| Toggle changes (diff) | `⌘⇧D` (`⌃⇧D` en web) |
| Toggle terminal | `⌘J` (app) / `` ⌃` `` |
| Toggle preview | `⌘⇧P` / `⌘⇧B` (app), `⌘⌥P` (web) |
| Toggle Files | `⌘⇧F` |
| Cerrar pane | `⌘\` |
| Expandir/colapsar pane | `⌘⇧\` |
| Toggle side chat | `⌘;` |
| Toggle lista de archivos | `⌘⇧Y` / `⌃⇧Y` |
| Ir a archivo (changes) | `⌘P` |
| Guardar archivo | `⌘S` |
| Buscar en archivo | `⌘F` |
| Adjuntar selección / salida de terminal | `⌘⇧L` |
| Browser: nueva pestaña / reabrir / siguiente / anterior | `⌘T` / `⌘⇧T` / `⌃Tab` / `⌃⇧Tab` |
| Browser: foco barra de direcciones | `⌘L` |
| Browser: seleccionar elemento | `⌘⇧S` |
| Browser: modo boceto/anotación | `⌘⇧X` (undo `⌘Z`, redo `⌘⇧Z`, borrar `⌫`, deseleccionar `Esc`) |
| Toggle activity sidebar | `⌘⇧S` (listado; compartido con Cowork) |
| Simulador iOS: Home / Lock / Shake / apariencia / teclado / screenshot / grabar | `⌘⇧H` / `⌘L` / `⌘⌃Z` / `⌘⇧A` / `⌘K` / `⌘S` / `⌘R` (con foco en el simulador) |

**Composer**
| Acción | Atajo |
|---|---|
| Enviar | `Enter` |
| Nueva línea | `⇧Enter` |
| Enviar ahora (saltando la cola) | `⌘Enter` |
| Menú de modo de permisos | `⌘⇧M` (app) / `⌘⌥M` |
| Menú de modelo | `⌘⇧I` |
| Selector de esfuerzo | `⌘⇧E` |
| Toggle fast mode | `⌘⌥F` |
| Toggle thinking | (listado "Toggle thinking") |
| Elegir ítem de menú | `1…9` |
| Adjuntar archivo | `⌘U` (NEWS) |
| Restaurar borrador | `↓` ("↓ to restore your draft", **COMP**) |
| Bash mode | prefijo `!`; `Esc` o `⌫` en vacío vuelve a chat (**COMP/NEW**) |
| Dictado | atajo global configurable ("Dictation shortcut", **SET1**) |

Globales del sistema (**SET1/STORE**): "Quick Entry keyboard shortcut" (p. ej. doble Option, `⌥Space`),
"Voice shortcut".

---

## 2. Ciclo de vida de la sesión

### 2.1 Nueva sesión

La pantalla "nueva sesión" (**NEW**) es un composer grande con saludo ("What’s up next, {name}?",
"Welcome back") y placeholders "Describe a task or ask a question" / "Describe something to build,
change, or fix". Debajo, controles de arranque:

- **Dónde corre** ("Where Claude runs"): **Local**, **Remote/SSH** (hosts guardados, Coder
  workspaces, WSL), **Cloud** (entornos Anthropic o self-hosted) (**NEW**).
- **Carpeta**: "Choose a folder to work in", "Recent", "Select folder…", "Browse remote folder…",
  "Add another folder" / "Additional folders" (multi-root, `/add-dir`), "Folder must be inside the
  WSL distribution". Validaciones: raíz del FS prohibida, ruta demasiado larga, segmentos `..`,
  caracteres invisibles (**NEW**). Opción "Start without a folder" existe (hay error "Starting
  without a folder didn’t work", **ERR**).
- **Confianza de carpeta** (workspace trust): diálogo "Trust this workspace?" con "Claude Code may
  read, write, or execute files in this folder." (`c165c93f1-*.js`). Si no se confía, la sesión no
  arranca ("Folder isn’t trusted, so the task wasn’t started.", **SES**). Desde el menú nativo:
  "Trust {cwd} and start a code session?" (**DESK**). Confiar también añade la carpeta a Remote Control.
- **Worktree**: toggle "Work in an isolated copy of the repository" (**NEW**), con "Start with
  worktree…", "Creating worktree…", "Checking out worktree files… (large repositories may take a
  while)". Ubicación configurable ("Worktree location": dentro del proyecto `.claude/worktrees` o
  carpeta propia, también por host SSH, **SET1/NEW**). Hooks `WorktreeCreate`/`WorktreeRemove`
  soportados ("Running your WorktreeCreate hook…", **NEW**; jj/Sapling, **NEWS**). Comprobación de
  disco ("A worktree needs at least {requiredGb} GB", **ERR**).
- **Rama**: "Branch to start from", "Search branches…", "Default branch", "Continue on {branch}"
  (prompt prefabricado para retomar cambios sin commitear), "Branch for this session", prefijo
  configurable ("Branch prefix", 1-40 caracteres, "This prefix is reserved for protected branches",
  **SET2**). Cambio de rama con cambios sin commitear: "Stash changes", "Commit as WIP", "Discard
  changes" y advertencia si otras sesiones usan la misma carpeta (**NEW**).
- **Presets**: guardar entorno+ajustes como preset ("Save as new preset…", "Preset: {value}, edited",
  "Update preset", "Delete preset?", **NEW**); modelo/permisos/esfuerzo "for this session (preset:
  {value})".
- **Entorno**: "Environment variables" en formato `.env` ("stored securely and passed to Claude
  sessions"), "Edit local environment", "Local sandbox" (**NEW**).
- **Importar trabajo**: "Import GitHub issue", "Import Linear issue" desde el composer (**COMP/NEW**)
  con búsqueda "Search by issue number or title".
- **Continuar/reanudar**: menú nativo "Continue Last Claude Code Session" y "Last Session" (**DESK**);
  `/resume` "Search and continue a Claude Code session from this computer" (**SLASH**); "Resume a
  session", "Where you left off" (**NEW**).
- **Importar sesiones de la CLI**: "Import Claude Code CLI Sessions…" (**DESK**) — detecta sesiones de
  terminal no listadas, conserva historial y modo de permisos pero no archivo ni grants; no duplica.
  Aviso de seguridad al reanudar una importada ("Resuming lets Claude act on this session’s
  history.", **ERR**). Wizard completo en **IMP** (export/import zip entre equipos).
- **Deep links**: enlaces que abren carpeta local o host SSH ("You opened a link to a folder on
  {name}. Nothing connects until you use the connection.", `c11959232-*.js`), con prompt precargado.
- **Sugerencias**: "Suggested tasks" y "Suggested follow-up" que Claude propone y se pueden lanzar
  en su propia sesión ("Start this in its own session?", **SES/NEW**). Ajuste "When you ask for an
  unrelated task": preguntar / hacerlo aquí / nueva sesión enlazada (**SET1**).

### 2.2 Sesiones remotas (SSH, WSL, Coder)

- Alta: "Add SSH connection…", campos host (`user@hostname` o alias de `~/.ssh/config`), puerto,
  clave privada (convierte `.ppk` de PuTTY), nombre, carpeta de worktrees remota; "Test connection"
  (**NEW**). Conexiones gestionadas por la organización o auto-descubiertas de Coder no editables.
- Confirmación de clave de host ("Confirm it’s {host} to connect", "Review new key", **SSH**).
- Instalación automática de Claude Code en el host ("Setting up Claude Code on {host}…",
  "Restarting Claude Code on {host}…"), reconexión tras sleep/red ("Remote sessions reconnect on
  their own", **NEWS**) con backoff visible ("Reconnecting to {host}… next try {time}", **NEW**).
- **Diagnóstico SSH extremadamente detallado** (~250 cadenas en **SSH**): agente sin claves,
  `IdentitiesOnly`, clave con permisos abiertos (ofrece "Make key private"), RSA no aceptado, OpenSSH
  < 7.6, SFTP deshabilitado, disco lleno/solo lectura, proxy command, macOS TCC bloqueando la clave,
  host key cambiada. Cada error trae causa + acción, y mensajes retenidos se envían solos cuando se
  resuelve ("your message goes as soon as Claude sees one appear", **NEW**).
- Limitaciones explícitas: "Memory files aren’t available for SSH or cloud sessions.",
  "Auto-merge isn’t available in SSH sessions yet." (**NEW/SSH**).

### 2.3 Sesiones cloud

- Entornos cloud: "Select a cloud environment", Anthropic-hosted o self-hosted, "Add cloud
  environment…", setup script ("Add a setup script to install dependencies", **SES**), variables,
  dominios de red permitidos (admin). Cola de runners ("Waiting for a runner — {ahead} ahead of you",
  "Starting a runner (~{eta})", **SES**).
- Requisitos: remoto GitHub ("No GitHub remote configured — cloud sessions need a repository URL.",
  **SES**) + GitHub App instalada ("Install GitHub App", "Reconnect GitHub App").
- **Mover a la nube** ("Move a local session to the cloud from its ••• menu", **NEWS**; "Send to
  cloud", "Continue in cloud…"): el diálogo explica exactamente qué se empuja ("Pushes {branch} to
  {repo}, then starts a cloud session on it", "Anything not on origin, such as uncommitted changes,
  stays on this computer.", **SES**). Beneficio: "Cloud sessions keep running, even with the lid
  closed." (**QUEUE**). Pausa por runner liberado: "Session paused — the runner was released."
- **Ultrareview**: revisión multi-agente en la nube ("Finds and verifies bugs using a multi-agent
  review fleet.", **NEW**; `/ultrareview`).

### 2.4 Remote Control

- Permite seguir/controlar una sesión local desde claude.ai o la app móvil ("You can then follow and
  steer it from claude.ai and the Claude mobile app.", **SES**). Toggle por sesión ("Turn on/off
  Remote Control"), badge en título, y ajuste global "Connect new sessions to Remote Control"
  (**SET1**). Las carpetas confiadas forman la lista de Remote Control ("Add this folder to Remote
  Control?", "Folder limit reached", **DESK**).
- Aprobaciones cuando el mensaje vino de otro dispositivo: "commands in your terminal need your
  approval here" (**SES**); opción "Turns off Remote Control for this session only" (**SES**).
- Errores dedicados (`cbe8e060f-*.js`): red bloqueada, requiere suscripción, desactivado por la org.

### 2.5 Modos de permisos

Etiquetas y descripciones (**MODES**, función de mapeo de modo→label):

| Modo interno | Etiqueta en Code | Descripción |
|---|---|---|
| `default` | **Manual** | "Always ask before making changes" |
| `acceptEdits` | **Accept edits** (compacto "Accept") | "Automatically accept all file edits" |
| `plan` | **Plan** | "Create a plan before making changes" |
| `auto` | **Auto** | "Claude handles permission decisions" (clasificador de riesgo + prompt injection) |
| `bypassPermissions` | **Bypass permissions** (⚠) | "Accepts all permissions" |
| `dontAsk` | **Don’t ask** | "Deny actions that aren’t pre-approved, without prompting" |

- Disponibilidad por tipo de sesión: local/bridge = default, acceptEdits, plan (+auto, +bypass si
  habilitados); remote (cloud) = default, plan (**MODES**).
- **Auto mode**: pasó a ser el modo por defecto ("Auto mode is now Claude Code’s default permission
  mode", **NEW**) con aviso de facturación del clasificador; algunos modelos lo exigen ("This model
  requires auto mode."); fallback automático si el modelo no lo soporta ("Auto mode isn’t available for
  the selected model. Switched to {newMode}.", **SSH**). Cuando bloquea: "Blocked by auto mode" con
  opción "Allow and switch to Auto" (**SES**).
- **Bypass**: requiere ajuste "Allow bypass permissions mode" (**SET1**); advertencia de riesgo; no
  funciona como root; si la org lo prohíbe cae a Accept edits ("Bypass permissions isn’t allowed here,
  so this session switched to Accept edits.", **ERR**).
- Cambio de modo en caliente vía menú (⌘⇧M), `/permissions`, o desde la tarjeta de plan ("Accept and
  allow edits / auto mode / bypass permissions", **SES**). Modo por sesión y por preset.
- Cambiar modelo/esfuerzo avisa del coste de caché ("Switching to {next} means Claude re-reads the
  whole session", **NEW**).

### 2.6 Modelo, esfuerzo, fast mode, advisor

- Selector de modelo (`⌘⇧I`, `/model` a mitad de sesión), "Favorite model", modelo por defecto del
  `settings.json` del proyecto ("Your project’s settings.json model is used by default", **NEWS**).
  Cambio con ventana de contexto menor avisa pérdida de historia (**MODES**). Modelos sobrecargados:
  cambiar desde la tarjeta de error ("Switch model and retry", **SSH**).
- **Esfuerzo**: slider junto al selector (`⌘⇧E`, `/effort`), niveles low / medium / high / extra-high
  / max ("Claude thinks longer with Max effort and uses your limits faster", **MODES**).
- **Fast mode**: toggle en el selector (`⌘⌥F`, `/fast`), "Faster replies … billed at fast-mode
  rates" (**SES**); etiqueta "{effort} · Fast".
- **Advisor**: "Let Claude consult a stronger model at key moments" (`/advisor`, **NEW/SLASH**).
- **Output style** por sesión (`/output-style`) y por defecto en ajustes.

### 2.7 Durante y después

- **Rewind**: "Rewind to here" en cualquier mensaje, "Restore the session to an earlier message", con
  opciones "Code and conversation / Conversation only / Code only" (**NEW**); "Undo rewind"/"Redo
  rewind" (**SES**); limitaciones explicadas ("Changes made through shell commands aren’t reverted.",
  **NEW**).
- **Fork**: "Fork from here", "Fork session", "Send in a forked session", "Fork with this prompt"
  (**MSG/COMP/KEYS**); "Forked from {title}" en la cabecera; conteo "{count} forks from here".
- **Clear**: "The transcript starts over empty; files, folder and settings stay" + "Resume previous
  session" (**SES**). **Compact**: manual (`/compact`) y automático ("{tokens} until auto-compact"),
  con marcador en el transcript ("Compacted session · saved {tokens} tokens", `c71ec5fd2`). Consejos
  de coste ("Compact first so later replies run on a short summary", **SES**).
- **Keep computer awake**: por sesión ("keep this computer awake until this turn ends", **SES**) y
  global ("Keep computer awake while Claude works", "Keep awake on battery power", **SET1**). Si el Mac
  se duerme: "Claude was interrupted when your computer went to sleep." + retoma (**QUEUE**).
- **Límites**: "Auto-continue when limits reset", "Auto-resuming at {time}" (**SES**); desglose de
  uso ("What’s using your limits?" con heurísticas: caché >100k, sesiones 8h+, 4+ paralelas, >150k
  contexto, subagentes) (**SES**).
- **Info de sesión**: "Copy session ID", "Copy session info", `/status` (versión, modelo, entorno,
  cuenta), "Export this session’s transcript" (`/export`, zip "nothing is uploaded"), "Rate this
  session" (feedback Good/Bad/Fine) (**SES/SLASH**).
- **Terminar**: "End session", "Stop", archivar, eliminar (con worktree: "Deletes the folder and its
  branch" vs "Keeps the worktree and its branch", **SES**).

---

## 3. Composer

- **Placeholder**: "Type / for commands" (**NEW**), "Describe a task or ask a question".
- **Adjuntos**: botón "+" ("Add files, connectors, and more", **MODES**) con "Add files or photos",
  "Add folder to session", "Add connectors", "Add plugins", "Import GitHub/Linear issue" (**COMP**).
  Arrastrar y soltar ("Drop files or a folder here"), pegar imágenes, `⌘U`. Límites: 20 imágenes en
  local ("Attach up to 20 images", **NEWS**), 30 MB por archivo, 50 MB por mensaje remoto, PNG/JPEG/
  GIF/WebP, vídeo con lightbox (**NEW/COMP/NEWS**). Mensajes muy largos se envían como archivo ("That
  message was too long to send as text, so it went as an attached file.", `ceeb23eca`).
- **@ menciones**: archivos (incluye dotfiles), carpetas, **agentes** de `.claude/agents` (sin
  reiniciar) (**NEWS**); los `@` se muestran como chips en el transcript. No se permiten en bash mode
  salvo archivos (**COMP**).
- **Contexto desde la UI**: "Attach as context" desde mensajes, selección de texto, archivos del
  diff, terminal, simulador, elementos del preview (**MSG/PANES/SIM/PREV**).
- **Slash commands** (catálogo de la app, **SLASH**): `/schedule`, `/btw`, `/ultrareview`, `/rewind`,
  `/fork`, `/mcp`, `/plugin`, `/feedback`, `/model`, `/effort`, `/fast`, `/plan`, `/permissions`,
  `/skills`, `/output-style`, `/rename`, `/export`, `/add-dir`, `/cd`, `/diff`, `/tasks`,
  `/workflows`, `/status`, `/usage`, `/usage-credits`, `/context`, `/autocompact`, `/memory`,
  `/config`, `/storage`, `/sandbox`, `/theme`, `/reload-plugins`, `/logs`, `/reset-limits`,
  `/create-pr`, `/auto-mode-setup`, `/resume`, `/advisor`, `/login`, `/help`, `/clear`, `/compact`;
  más los de skills/plugins/proyecto. Validación con mensajes específicos ("/{commandName} only works
  in Claude Code in a terminal.", "doesn’t take arguments here", **NEW**) y sugerencia por cercanía
  ("Your last message isn’t a command here, but it’s close to one.", **QUEUE**).
- **Bash mode**: `!` para ejecutar un comando en la terminal y enviar la salida a Claude ("Run a
  shell command in the terminal and send the output to Claude", **NEW**; "Bash mode. Press Escape to
  return to chat.", **COMP**).
- **Historial**: navegación y búsqueda en prompts anteriores ("Search history: {query}", "History
  {index}/{total}", **COMP**); borradores guardados por sesión ("Saved draft · {count} characters",
  "Remove saved draft?").
- **Dictado/voz**: botón "Dictate", "Hold to record", atajo global, errores de micrófono detallados
  por plataforma (**MODES/SET1**).
- **Cola de mensajes**: mientras Claude trabaja, los mensajes se encolan ("Queue follow-up messages
  while Claude is still working", **NEWS**; "Queued. Claude will read this after the current turn.",
  **MSG**); pila colapsable, reordenable por drag/teclado ("Reorder queued message"), "Send now"
  (`⌘Enter`), "Remove from queue", "Withdraw message" (vuelve al composer), "Queue for later",
  "Send and stay here" (**QUEUE/COMP/MSG**). Cancelar un encolado no interrumpe el turno (**NEWS**).
  Mensajes retenidos por desconexión: "Couldn’t send — your messages are still being held.",
  "Send anyway" (**NEW**).
- **Side chat (`/btw`, ⌘;)**: pregunta lateral con todo el contexto sin tocar el hilo ("Ask a quick
  side question without adding to the session", **SLASH**), flotante, "Send to side chat", "Clear
  side chat".
- **Interrumpir**: `Esc` / botón Stop ("Stop Claude’s response"), `Esc Esc` edita el último mensaje;
  "Cancel and edit message" para el último enviado (**MSG**); `⌘Enter` "Send now" interrumpe y envía.
- **Sugerencia de siguiente prompt** tras cada respuesta ("Prompt suggestions", **SET2**) navegable
  ("Show next/previous suggestion", **QUEUE**).
- **Seguridad de texto**: aviso de caracteres invisibles/bidi ("This text contains hidden or
  direction-changing characters", **COMP**).

---

## 4. Renderizado del transcript

### 4.1 Vistas

"Default transcript view": **Normal**, **Verbose**, **Thinking** (**SET1**), por sesión desde el menú
"Transcript view" o `⌃O`. En vista Thinking se ve un recap de una línea del razonamiento encima de
cada grupo de herramientas (**NEWS**). Ajustes de tamaño/anchura del transcript ("Transcript text
size", "Transcript width": Narrow/Medium/Wide), fuente de interfaz y fuente/tema de código (**SET1/SET2**).
El scroll se mantiene donde lo dejó el usuario y se recuerda por sesión (**NEWS**). Sesiones enormes:
"Earlier messages aren’t shown. This session is too large to load in full." (**SES**).

### 4.2 Tarjetas de herramientas

Cada herramienta tiene verbo en progreso / pasado / error (**TOOLS**), agrupadas con resumen tipo
"read {n} files, ran {n} commands" (`c95649efe`: "read", "edited", "ran", "searched", "fetched"…).
Categorías con verbos específicos:

- **Archivos**: Read / Edited / Created ("{n} Edited # files", "and # more edits in this file", **SES**);
  clic en el nombre abre el archivo en el diff pane (**NEWS**); diffs enormes: "Too many changes to
  show as a diff. Showing the removed and added text separately." (**TOOLS**); preview de permiso
  hasta 200 000 caracteres (**SES**).
- **Shell**: "Ran" con syntax highlighting del comando (**NEWS**), salida plegable, "Exit code {code}",
  "Run in background" / "Keeps running in the background." y "Watching background command".
- **Búsqueda/web**: Searched, Fetched, "Searched web".
- **Git**: Committed, Amended commit, Pushed, Cherry-picked, "Rebased onto", "Merging base branch",
  "Merge left conflicts to resolve", "Abandoned merge", "Created a worktree", "Entered/Left the
  worktree" (con banner "<lead>Entered worktree</lead> {name}", **SES**).
- **PR**: Created/Edited/Merged/Closed PR, "Commented on PR", "Marked PR draft/ready",
  "Enabled/Disabled auto-merge" (**TOOLS**).
- **Tareas/TODO**: "Updated todos", "Added/Completed/Started/Stopped task", "Reset task to pending",
  progreso "{completed}/{total} tasks" (**TOOLS/SES**).
- **Plan**: "Proposed plan", "Plan approved", "Making a plan" (**TOOLS**).
- **Agentes**: "Ran agent", "Messaged @{to}", "Approved plan from @{to}", "Asked @{to} to shut down"
  (equipos de agentes), "Message from subagent / team lead / another session" (**TOOLS/MSG**).
- **Workflows dinámicos**: fases, "{done} of {total} agents done, {running} running, {stalled}
  stalled", "Stop this workflow", aviso de coste (**SES**).
- **Sesiones/app**: tools de gestión expuestas al modelo (archivar, renombrar, pin, mover, abrir
  panes, split view, cambiar modo/modelo/esfuerzo, Remote Control, rutinas…), cada una con verbo
  ("Renamed session", "Archived session", "Failed to open session in split view"…).
- **Memoria/Skills/MCP**: "Checked/Read/Updated memory", "Ran skill", "Used {label}", "Loaded
  connectors", widgets MCP ("Widget from {server}", **MSG**).
- Detalles expandibles "Tool call details", "Tool output"; imágenes "View screenshot" (**TOOLS**).

### 4.3 Plan

Tarjeta "Claude proposed a plan" con "Open plan" (pane Plan) y respuestas: **Accept** / "Accept and
allow edits" / "Accept and auto mode" / "Accept and bypass permissions", **Revise…** con "What should
change? (optional)", "Plan feedback" (**SES**). Comentarios sobre líneas del plan ("You can comment on
the plan in plan mode, or when Claude asks you to approve it.", **PANES**). En Remote Control: "Claude
is in plan mode, so only you can approve this." (**SES**). "Plan from before your last message" (**QUEUE**).

### 4.4 Permisos (variantes)

Cabecera "Allow Claude to <b>{action}</b> …?" con variantes por metadatos/app/computadora/sesión
(**SES**). Botones y alcances: **Allow once**, **Allow for this session**, **Always allow**, "Allow for
all tasks", "Always allow reads on this host", **Deny**, "Don’t ask again for this tool", menús "More
allow options" / "More accept options". Dónde se guarda la regla: "Saves to local project settings",
"Saves to project settings", "Saves to user settings (all projects)", "Saves for this SSH host",
"Saves to your connector settings" (**SES**). Protecciones: "Scroll through the whole command to allow
it." (debe verse el comando completo), avisos de symlinks, rutas de red, lo que se envía, reglas de
admin ("Your admin requires approval each time for this tool."), "Tools that can delete or overwrite
data require approval each time." (**SES**). Estado accesible "Permission requested: {action}".
Variantes específicas: computer use (apps, pantalla completa), navegador (sitios financieros, red
privada, credenciales en URL), artifacts, portapapeles, folder access ("Claude gets access to the
folder now; the session’s working directory moves there when this turn ends.").

### 4.5 Preguntas (AskUserQuestion)

Tarjeta con opciones numeradas (teclas 1-9), "Other option" / "Type your own answer here", "Skip",
paginación "Show next/previous question", "Question {n} is unanswered", "Dismiss question",
"Submit" (**SES/NEWS**). Estado de sesión "Needs input"/"asked a question".

### 4.6 Thinking

"Thinking…", "Still thinking…", "Thinking more…", "Almost done thinking…", "Thought for {seconds}s",
"Thought process" plegable, "Thinking summaries will appear from the next response." (**SES**).

### 4.7 Subagentes y tareas en segundo plano

Subagentes con su prompt y resultado expandibles ("See what each background agent was asked and what
it returned", **NEWS**), "Report from subagent", "All background agents stopped" (**MSG**). Tareas en
background con conteos ("{count} running tasks", "{count} tasks finished", **SES**), loops ("Recurring
loop", "Loop stopped"), prompts programados, check-ins ("Scheduled check-in … no change reported",
**MSG**), y mover una tool call a background (**`c6b8adeaf`**).

### 4.8 Notificaciones

Tipos configurables: "Permission requests", "Questions", "Task complete" con nivel (banners / solo
badge / off) (**SET1/SET2**), "Notification sound", "Draw attention on notifications" (rebote del Dock
/ parpadeo de barra de tareas). "Get a desktop notification when Claude finishes while you’re in
another app" (**NEWS**). Menú nativo "Sessions Waiting for You" (**DESK**). Push/email al móvil vía
Remote Control ("Push and email notifications", **SES**). Sugerencias de seguimiento como
notificación arriba a la derecha (**NEWS**).

### 4.9 Monitorización CI/PR en el transcript

Eventos agrupados "Received # CI events", "Received # GitHub events", "Code review event", "PR Steward
event" (**MSG**); auto-fix despierta a Claude ("Auto-fix wakes Claude in this session to fix failing
checks, merge conflicts and review comments.", **SES**). Estado del PR resumido en la sesión ("Checks
are failing on the pull request for this branch.", "The pull request is approved and its checks are
green.", **QUEUE**).

### 4.10 Errores

Tarjeta de error con título + causa + acción + "View details"/"Copy error log" y reintento. Catálogo
en **ERR**: rate limit y servicio ocupado (con cambio de modelo), contexto lleno ("Rewind to an earlier
message or clear the session to continue."), respuesta cortada, crash del proceso con back-off,
sleep del equipo, gateway/proxy, carpeta no confiable, carpeta inexistente, git ausente/bloqueado por
EDR/licencia Xcode, worktree roto ("Press Enter in the terminal to repair this worktree."), rama
en otra carpeta, WorktreeCreate hook fallido, sandbox requerido no disponible, políticas de la org,
cuenta cambiada, macOS TCC, rutas >260 en Windows. Mensajes "Retrying ({attempt}/{maxRetries})",
"Failed after {n} attempts. Send a new message to retry." (**SES**). Hook que bloquea el prompt: "A
UserPromptSubmit hook stopped this prompt before it reached Claude." (**SES**). Paquete de logs
"/logs" (zip + resumen al portapapeles).

---

## 5. Integración Git / PR

- **Worktrees**: creación por sesión, ubicación configurable, limpieza ("clean up inactive worktrees",
  "Worktrees kept ready for new sessions" — hay un pool precreado, **STORE**), mantener o borrar al
  archivar, "Worktree actions", mover sesión a worktree a mitad ("Moved to a worktree", "Work on a
  separate branch?", "Recommended: your current branch keeps its history until you merge.", **SES**),
  "Move session back to {repo}". Aislamiento `.git` separado en datos de la app (**ERR**).
- **Sincronizar con base**: "merge the base branch into this session’s branch", "Fast-forwarding
  branch…", "Refreshing origin…", "Branch already up to date", conflictos → "Merge left conflicts to
  resolve", "abandon the merge in progress" (**SES/NEW/TOOLS**).
- **Protected files / pinned git origins**: la app fija el `origin` de cada repo la primera vez y
  **solo fusiona archivos protegidos (`.claude`, `.mcp.json`…) desde la rama por defecto de ese origin**;
  si el origin cambia pide "Re-pin this Git origin?" y hay "Review Pinned Git Origins…" en el menú
  (**DESK**). Ramas protegidas: prefijos reservados (**SET2**) y aviso "Claude will push directly to
  {branch}" (**NEW**).
- **Commit/PR**: "Commit changes", "Create PR", "Create draft PR", "Manually create PR", `/create-pr`
  (**SES**); si falta la GitHub App: "Install GitHub App" con explicación; vía `gh` CLI con errores
  guiados ("GitHub CLI isn’t signed in. Run gh auth login", **SSH**).
- **Barra/vista de PR** (**PR/PRBAR**): pestañas Overview / Files / Commits / Checks / Activity;
  checks con "Re-run failed checks", detalles de fallos inline, "Send to Claude"/"Ask Claude to fix";
  revisión: "Approve", "Request changes", "Comment", responder/resolver hilos, "Resolved review
  comments collapse" (**NEWS**); editar título/descripción, labels, reviewers; "Mark ready for review";
  "Merge", "Merge when ready", merge queue ("In merge queue", "Position {position}"), "Cancel
  auto-merge"; PR stacked y relacionados. Abrir en navegador opcional ("Open pull requests in browser",
  **SET2**). Configurar "Answer review comments on #{number}" y "Fix the failing checks on {branch}"
  como prompts prefabricados (**NEW**).
- **Monitor CI / auto-fix / auto-merge / auto-archive**: al crear un PR Claude lo vigila ("Auto-fix
  pull requests … monitors it for CI failures and review comments", **SET2**); toggles por PR "Turn on
  auto-fix", "auto-merge" (con método merge/rebase/squash y validaciones de GitHub: rama protegida,
  draft, stacked, permisos, scope `workflow`, **SSH**), "auto-archive". "Track pull request" /
  "Stop tracking pull request" (**SES**).
- **Code review en la nube** (admin): "Claude will automatically review pull requests" (**ADMIN**).

---

## 6. Preview / navegador, simulador, dev servers, artifacts

- **Dev servers** (**DEV**): lista en `.claude/launch.json` ("Edit this list in .claude/launch.json."),
  detección automática ("Detect dev server", "{framework} · port {port}"), "Run {serverName}", "Stop
  all servers", logs ("Show dev server logs"), puertos en conflicto entre sesiones, aviso al cerrar
  si siguen vivos. **Auto-verify**: "After editing code, Claude will automatically start the preview
  server, verify changes, and share proof" (toggle "Auto-verify changes").
- **Preview/Browser pane** (**DEV/PREV**): pestañas, barra de URL, back/forward/reload, viewport
  (Mobile/Tablet/Responsive/custom), esquema de color, cookies ("Keep cookies", Shared vs "Per
  session"), "Open HTML file…", "Open links in built-in browser". **Select element** envía screenshot +
  HTML + estilos + selector + componente React ("Sends Claude a screenshot plus the element’s HTML,
  styles, selector"). **Annotate/boceto**: dibujar sobre la página ("Draw directly on the preview to
  show Claude what you mean", **NEWS**). Estados de carga detallados (servidor frío, sobrecarga,
  "Nothing listening on localhost:{port}"). Sólo localhost para inspección; sitios externos limitados.
- **Simuladores** (**SIM**): iOS Simulator y Android Emulator con stream en vivo, consentimiento por
  dispositivo ("Let Claude use this simulator?"), asistentes de instalación (Xcode, SDK), botones
  hardware, teclado en pantalla, grabación/screenshot, logs del sistema filtrables, inspector de
  accesibilidad, anotación ("Tell Claude what to change"), "Attach as context". Ajuste "Mobile
  simulators" (**SET2**).
- **Artifacts**: pane de artifacts publicados por la sesión, con permisos específicos (**SES/PANES**).
- **Computer use / Claude in Chrome**: permisos por app/sitio (**SES**), ajustes "Browser use"/
  "Computer use" (**STORE**).

---

## 7. Ajustes relevantes para Code

**Ajustes → Claude Code** (**SET1/SET2**):
- Apariencia: "Code font family", "Light/Dark code theme", fuente de interfaz, tamaño y ancho del
  transcript, "Default transcript view".
- Sesiones: "Output style", "Branch prefix", "Worktree location", "Archive inactive sessions" (días),
  "Auto-archive after PR merge or close", "Auto-fix pull requests", "Open pull requests in browser",
  "Classify session states", "Prompt suggestions", "When you ask for an unrelated task" (Ask me /
  Always do it here / Always start a new session), "Dynamic workflows".
- Permisos/seguridad: "Allow bypass permissions mode", "Local sandbox" (comandos en sandbox),
  "Strict sandbox mode" (bloquea lo que no cabe en sandbox), "Allowed connector tools" por host SSH.
- Remote: "Connect new sessions to Remote Control", "Cloud sessions" (entornos), "SSH sessions".
- Energía: "Keep computer awake while Claude works", "Keep awake on battery power".
- Notificaciones: tipos Permission requests / Questions / Task complete, sonido, llamar la atención.
- Browser: "Browser tools", cookies Shared / Per session, "Allow all browser actions".
- Móvil: "iOS Simulator", "Android Emulator".
- Plugins/agentes/hooks/conectores: "Manage Claude Code plugins, agents, hooks, and connectors."
- Atajos: Quick Entry, dictado, voz.
- **Almacenamiento** (**STORE**): uso por área, "Clean up inactive sessions…" (≥N días; opción de
  borrar worktrees con cambios, confirmación explícita "I understand … can’t be recovered"),
  worktrees en uso / precreados.
- **Import & export** (**IMP**).

**Políticas enterprise/admin** (**ADMIN**, **ERR**, **DESK**):
- Activar/desactivar Claude Code Desktop, cloud sessions, Remote Control, Routines, fast mode,
  bypass/auto (moviéndose a **Managed settings** con `settings.json` subido/MDM), dynamic workflows.
- Entornos: self-hosted obligatorio ("Require self-hosted compute"), ocultar entornos Anthropic,
  proxy de agentes en VPC, egress de red (todos / package managers / lista).
- GitHub Enterprise / GitLab, code review automático, security review, team memory por grupos.
- Restricciones visibles al usuario: "Folder not allowed by your organization", "SSH isn’t allowed by
  your organization", "Code sessions are turned off by your organization", launcher corporativo,
  inference gateway, ZDR/HIPAA, dispositivos confiables, versión mínima ("Your organization’s policy
  requires a newer version of Claude.").

---

## 8. Estados vacíos, onboarding, errores y tono

- **Onboarding de Code** (**ONB**): checklist "Get started with Claude Code" / "Go further…" con
  pasos: elegir carpeta, preguntar qué hace, `/init` (CLAUDE.md), plan mode, primer PR, MCP, rutina,
  cloud, notificaciones, instalar CLI/IDE; cada paso rellena un prompt ("Put “{title}” in the message
  box"). Progreso "{completed} of {total} steps complete", "Dismiss checklist".
- **Marketing interno**: "Run parallel sessions on your real codebase—each with its own terminal,
  editor, and preview" (**SIDE1**); "Feature of the week" con créditos (**NEW**).
- **What’s new** integrado en la app (**NEWS**).
- **Estados vacíos**: "Sessions you start will show up here.", "Background tasks appear here", "No
  plan yet", "Open files appear here", "Pick a file in the tree, or click a file path in the
  conversation.", "No pull request for this branch yet.", "No dev server configured" + "Detect dev
  server", "Nothing to rewind to yet", "No usage data yet — …".
- **Tono**: frases cortas, segunda persona, sin culpar; patrón **"No se pudo X. [Causa]. Haz Y, luego
  reintenta."** ("Couldn’t…", "Try again", "Send a message to try again"); siempre dice *qué pasa con
  tus datos* ("Your files stay as they are.", "Committed work stays on its branch.", "This is the
  only copy of this text."); explica consecuencias de coste ("uses more of your limit"); variantes
  del mismo error según el contexto de reintento (enviar mensaje / reintentar / pedir a la sesión
  madre). Confirma acciones destructivas nombrando cantidades ("discards its # uncommitted changes
  for good").

---

## 9. Comparación con OnyxCode

Estado de OnyxCode leído en `src/renderer/src/features/code/**` (CodeWorkspace, Composer, store,
MessageStream, ToolCard, PermissionCard/QuestionCard, SessionList, ProjectPicker, DiffView, panels
Changes/Files/Terminal), `src/main/{pty,git,dialog}`, `src/shared/ipc-code.ts`, `DESIGN.md`,
`AUDIT.md`. Resumen de lo que **sí** hay: selector de proyecto con recientes; lista de sesiones por
proyecto (crear/borrar con `confirm()`); toolbar con carpeta, rama (ahead/behind), agente Plan/Build,
modelo, detener; panel derecho Cambios (status staged/unstaged, diff por archivo, commit, diálogo de
ramas/worktrees) · Terminal (una xterm) · Archivos (árbol, visor, búsqueda por nombre); transcript con
razonamiento, grupos de pasos, chips de edición con diff, bash, subtareas, reintentos, errores;
barra de TODOs; permisos once/always/reject con teclas 1-3 y diff; preguntas; revert/unrevert; composer
con `/` (locales + comandos del servidor) y `@` archivos; atajos ⌘1-3, Esc, ⇧Tab.

Leyenda: ✅ equivalente · ⚠️ parcial · ❌ ausente. Prioridad: **P0** crítico para paridad percibida ·
**P1** alto · **P2** medio · **P3** bajo/nicho.

### 9.1 Sidebar, navegación y layout

| Función | Claude | OnyxCode | Prioridad | Cómo implementarlo sobre OpenCode |
|---|---|---|---|---|
| Sesiones de todos los proyectos en una lista | Recents + Projects + Pinned | ⚠️ sólo proyecto activo | P0 | `client.session.list()` sin `directory` por servidor/instancia y agrupar por `session.directory`; persistir proyectos abiertos en `settings`. Resolver AUDIT B2/Pf1 antes (un store por servidor). |
| Renombrar sesión (in-place, `/rename`) | ✅ | ❌ | P0 | `session.update({title})`; input inline en `SessionList`, atajo ⌘⌥R. |
| Pin / estrella | ✅ | ❌ | P1 | Metadatos locales (`electron-store` → `code.pins[sessionID]`); sección "Fijadas". |
| Archivar / desarchivar + auto-archivo | ✅ (inactividad, PR merge) | ❌ | P1 | OpenCode tiene `session.update` con `time.archived`? si no, flag local; timer en main que archiva por inactividad y comprueba worktree sucio con `git status`. |
| No leídos / "espera tu respuesta" (punto amarillo) | ✅ | ❌ | P0 | En el store: marcar `unread` en `session.idle`/`permission.asked`/`question.asked` si la sesión no está visible; badge en fila y en Dock (`app.dock.setBadge`). |
| Grupos personalizados / por carpeta / por estado PR | ✅ | ❌ | P2 | Modelo local `groups: {id,name,sessionIDs}`; DnD con `@dnd-kit`; agrupar por PR cuando exista integración `gh`. |
| Filtros y orden (estado, entorno, fecha, nombre) | ✅ | ❌ | P2 | Selector en cabecera de `SessionList`; estado derivado de `runState`/pendientes. |
| Acciones masivas (seleccionar, archivar/borrar antiguas) | ✅ | ❌ | P3 | Modo selección + `session.delete` en lote con confirmación con recuento. |
| Sesiones anidadas (subagentes / hijas) | ✅ | ⚠️ (subagentes se adoptan para permisos) | P2 | `session.children()` + `parentID` → árbol plegable en la lista. |
| Búsqueda de sesiones y transcripts (⌘K) | ✅ worker full-text | ❌ | P1 | Paleta ⌘K (cmdk) sobre títulos + `find.text` no aplica a transcripts: indexar mensajes en un worker de main (SQLite FTS5 o MiniSearch) alimentado por eventos `message.updated`. |
| Paleta de comandos con acciones y ajustes | ✅ | ❌ | P1 | cmdk con registro central de acciones (mismo registro que atajos y slash). |
| Split view de sesiones (grid adaptativo) | ✅ | ❌ | P2 | Layout con `react-resizable-panels`; cada celda instancia `ChatColumn` con `sessionID` propio (el store ya indexa por sesión). |
| Sesión en ventana propia | ✅ | ❌ | P3 | `BrowserWindow` con ruta `#/code/session/:id`; compartir store vía eventos del sidecar. |
| Rail de capítulos / navegación por prompts | ✅ | ❌ | P3 | Índice de mensajes de usuario + "fijar capítulo" local; ⌥↑/↓ salta entre prompts. |
| Diálogo de atajos + atajos completos | ✅ (~60) | ⚠️ (⌘1-3, Esc, ⇧Tab, 1-3) | P1 | Registro de keybindings (tabla §1.6) con `when`; diálogo "Atajos" (⌘/). |
| What’s new integrado | ✅ | ❌ | P3 | Markdown de changelog empaquetado mostrado tras actualizar. |

### 9.2 Ciclo de vida de sesión

| Función | Claude | OnyxCode | Prioridad | Cómo implementarlo sobre OpenCode |
|---|---|---|---|---|
| Pantalla "nueva sesión" con composer + carpeta/rama/worktree | ✅ | ⚠️ (ProjectPicker + sesión vacía) | P0 | Vista "Nueva sesión": composer grande + chips Carpeta · Rama · Worktree · Modelo · Modo; crea la sesión al enviar (`session.create` + `promptAsync`). |
| Confianza de carpeta (trust) | ✅ obligatoria | ❌ | P0 | Diálogo al abrir carpeta nueva; guardar `trustedFolders`; negarse a arrancar sidecar/`git status` en no confiadas (AUDIT: `core.fsmonitor`/hooks ejecutan código). |
| Worktree por sesión al iniciar | ✅ | ⚠️ (diálogo manual en Cambios) | P0 | Usar `client.worktree.create/list/remove` de OpenCode o `git:createWorktree`; carpeta `userData/worktrees/<repo>/<slug>` o `.onyxcode/worktrees`; la sesión se crea con `directory` = worktree. |
| Prefijo y nombre de rama automático | ✅ `Branch prefix` | ❌ | P1 | Ajuste `code.branchPrefix` (p.ej. `onyxcode/`) + slug del primer prompt; validar con `check-ref-format`. |
| Elegir rama base / continuar en rama | ✅ | ⚠️ (diálogo de worktree) | P1 | Combobox de ramas (`git:branches`), "Continuar en {rama}" con prompt prefabricado. |
| Cambiar de rama con cambios sucios (stash/WIP/descartar) | ✅ | ❌ | P2 | `git stash push -u`, commit WIP, `git checkout -- .` con confirmación. |
| Presets de sesión | ✅ | ❌ | P3 | Guardar `{model, variant, agent, env}` en settings. |
| Variables de entorno por proyecto | ✅ | ❌ | P3 | OpenCode lee `.env`? pasar `env` al sidecar por proyecto o `opencode.json` `env`. |
| Continuar última sesión / reanudar | ✅ | ⚠️ (recuerda sesión por proyecto en localStorage) | P2 | Menú "Continuar última sesión" (⌘⇧R) → último `sessionID` global. |
| Importar sesiones de la CLI de OpenCode | ✅ (Claude CLI) | ⚠️ implícito (mismo storage) | P3 | Las sesiones de `opencode` TUI ya viven en el mismo storage si comparten `XDG_DATA_HOME`; mostrar badge "Terminal". |
| Fork de sesión / "Fork from here" | ✅ | ❌ | P1 | `client.session.fork({sessionID, messageID})` existe en SDK v2. |
| Rewind con elección código/conversación + undo | ✅ | ⚠️ (revert/unrevert todo junto) | P1 | Ya hay `session.revert/unrevert`; añadir "Rewind aquí" en menú de mensaje, texto claro de qué se restaura y aviso de que comandos shell no se revierten. |
| Compactar manual/auto con marcador | ✅ | ❌ | P1 | `session.summarize()`; renderizar parte `compaction` (hoy se ignora como `TRANSPARENT`) como separador "Conversación compactada". |
| Clear / nueva sesión en misma carpeta | ✅ | ✅ `/nueva` | — | — |
| Exportar transcript | ✅ zip | ❌ | P2 | Serializar mensajes a Markdown/JSON y `dialog.showSaveDialog`. |
| Info de sesión (`/status`, copiar ID) | ✅ | ❌ | P3 | Popover con ID, modelo, agente, directorio, versión de opencode (`app.get`/`health`). |
| Mantener equipo despierto | ✅ | ❌ | P2 | `powerSaveBlocker.start('prevent-app-suspension')` mientras haya sesiones `busy`; ajuste. |
| Recuperación tras sleep / reconexión | ✅ | ⚠️ (AUDIT: estado busy pegado) | P1 | Resync de `session.status` al reconectar SSE; `powerMonitor.on('resume')` → resync. |
| Sesiones SSH / WSL | ✅ muy completo | ❌ | P3 | `opencode serve` remoto por túnel SSH (`ssh -L`) y cliente apuntando al puerto; UI de hosts. |
| Sesiones cloud / mover a la nube | ✅ | ❌ | P3 | Fuera de alcance salvo servidor opencode remoto propio; documentar. |
| Remote Control (móvil/web) | ✅ | ❌ | P3 | OpenCode `session.share` da URL de solo lectura; control requeriría relay propio. |
| Límite de sesiones simultáneas / cola | ✅ | ❌ | P3 | Contador de sesiones `busy` y cola local. |

### 9.3 Modos, modelo y esfuerzo

| Función | Claude | OnyxCode | Prioridad | Cómo implementarlo sobre OpenCode |
|---|---|---|---|---|
| Modos de permiso (Manual/Accept edits/Plan/Auto/Bypass/Don’t ask) | ✅ 6 modos | ⚠️ Plan/Build (agentes) | P0 | Mapear a reglas `permission` de OpenCode por sesión: Manual = `edit/bash: ask`; Accept edits = `edit: allow, bash: ask`; Plan = agente `plan`; Bypass = todo `allow` (con advertencia y ajuste que lo habilite); Don’t ask = `ask→deny`. Aplicar vía agente dinámico en config o respondiendo automáticamente `permission.asked` según el modo. |
| Auto mode con clasificador | ✅ | ❌ | P2 | Auto-responder `permission.asked` con un modelo pequeño que clasifique riesgo (comando + diff) y denegar lo dudoso; mostrar "Bloqueado por auto". |
| Selector de modo con ⌘⇧M y en tarjeta de plan | ✅ | ⚠️ (⇧Tab alterna) | P1 | Menú de modo en composer con descripciones §2.5. |
| Esfuerzo (low…max) | ✅ slider | ❌ | P1 | `variant` en `session.prompt` (SDK v2 lo admite) según variantes del modelo (`provider.list` → `variants`). |
| Fast mode | ✅ | ❌ | P3 | Variante/modelo rápido si el proveedor lo ofrece. |
| Modelo por sesión persistente + default del proyecto | ✅ | ⚠️ (en memoria, AUDIT) | P1 | Guardar `model` por sesión (último `message.info.model`) y leer default de `opencode.json` del proyecto. |
| Aviso de coste al cambiar modelo/esfuerzo (caché) | ✅ | ❌ | P3 | Tooltip informativo. |
| Output style | ✅ | ❌ | P3 | Agentes/`instructions` alternativos en OpenCode. |

### 9.4 Composer

| Función | Claude | OnyxCode | Prioridad | Cómo implementarlo sobre OpenCode |
|---|---|---|---|---|
| Adjuntar imágenes/archivos (drag, pegar, ⌘U) | ✅ | ❌ (AUDIT #2) | P0 | Partes `file` con `mime` + `url` `data:` o `file://` en `session.prompt`; validar tamaño/tipo; chips con preview. |
| `@` archivos | ✅ (+carpetas, agentes, dotfiles) | ⚠️ sólo archivos | P1 | `find.files({dirs:'true'})` para carpetas; `agent.list()` para `@agente` → parte `agent`. |
| Slash commands | ✅ ~45 + skills | ⚠️ 4 locales + servidor | P1 | Ampliar locales: `/compact`(summarize), `/fork`, `/rename`, `/model`, `/effort`, `/diff`, `/tasks`, `/export`, `/init` (`session.init`), `/skills` (`skill.list`), `/mcp`. Validación con mensajes específicos. |
| Bash mode (`!`) | ✅ | ❌ | P1 | `client.session.shell({command})` ejecuta y añade la salida al contexto. |
| Cola de mensajes mientras trabaja | ✅ (reordenar, enviar ya, retirar) | ❌ | P0 | Cola local por sesión; en `session.idle` enviar el siguiente; "Enviar ahora" = `abort` + enviar. |
| Historial de prompts (↑) y borradores por sesión | ✅ | ❌ | P2 | Guardar borrador por `sessionID` (localStorage); ↑ en composer vacío recorre prompts previos. |
| Dictado | ✅ | ❌ | P3 | Web Speech API / Whisper local; permiso de micrófono. |
| Side chat (`/btw`, ⌘;) | ✅ | ❌ | P2 | `session.fork` efímero o sesión hija oculta con el mismo contexto; panel flotante; descartar al cerrar. |
| Importar issue GitHub/Linear | ✅ | ❌ | P3 | `gh issue view --json` → prompt prefabricado. |
| Sugerencia del siguiente prompt | ✅ | ❌ | P3 | Llamada barata al final de cada turno; chip en composer. |
| Aviso de caracteres invisibles/bidi | ✅ | ❌ | P3 | Regex Unicode antes de enviar. |
| Editar último mensaje (Esc Esc) | ✅ | ❌ | P2 | `revertTo(lastUser)` + rellenar composer con su texto. |

### 9.5 Transcript

| Función | Claude | OnyxCode | Prioridad | Cómo implementarlo sobre OpenCode |
|---|---|---|---|---|
| Tarjetas por herramienta con verbo progreso/pasado/error | ✅ | ✅ (ToolRow/StepGroup) | — | Añadir verbos git/PR cuando existan. |
| Vistas Normal / Verbose / Thinking (⌃O) | ✅ | ❌ | P2 | Estado `transcriptView` que controla si se expanden tools y razonamiento. |
| Clic en archivo editado → abre diff/archivo | ✅ | ⚠️ | P1 | En `EditChip`/`read` abrir `FilesPanel`/`ChangesPanel` en ese archivo; enlaces `path:Lx-Ly`. |
| Resaltado de sintaxis de comandos bash | ✅ | ⚠️ | P3 | `highlight.js` bash en la cabecera de la fila. |
| Menú de mensaje (copiar MD, fork, rewind, adjuntar como contexto) | ✅ | ❌ | P1 | Menú contextual por mensaje con esas acciones. |
| Tarjeta de plan con Aceptar (+modo) / Revisar | ✅ | ⚠️ (agente plan escribe texto) | P0 | Detectar salida de plan (herramienta `plan_exit`/texto del agente plan) y mostrar tarjeta "Aprobar y construir" (cambia a build + envía "procede"), "Aprobar con edición automática", "Revisar…" con feedback. |
| Pane de plan con comentarios | ✅ | ❌ | P3 | Renderizar el plan en panel y permitir comentarios por línea que se envían como mensaje. |
| Permisos: once / sesión / siempre / denegar + dónde se guarda | ✅ | ⚠️ once/always/reject | P1 | "Siempre" en OpenCode persiste por sesión; añadir "Siempre en este proyecto" escribiendo regla en `opencode.json` del proyecto (con confirmación) y mostrar el comando completo (AUDIT: no confiar en `description`). |
| Preguntas con teclas numéricas, "Otro", saltar | ✅ | ✅ QuestionCard | — | Verificar teclas 1-9 y paginación. |
| Thinking con duración ("Thought for Ns") | ✅ | ⚠️ (Reasoning) | P3 | Usar `time.start/end` de la parte `reasoning`. |
| Subagentes expandibles con prompt/resultado | ✅ | ⚠️ (subtask) | P2 | `session.children` + mensajes de la hija en acordeón. |
| Pane de tareas en segundo plano | ✅ | ❌ | P2 | Listar subagentes activos y ptys de Claude; OpenCode `session.background`? + `pty.list()` del servidor. |
| Notificaciones del sistema (terminó / permiso / pregunta) | ✅ | ❌ (AUDIT 4.5) | P0 | En main: `Notification` cuando llega `session.idle`/`permission.asked`/`question.asked` y la ventana no está enfocada; clic abre la sesión; ajustes por tipo + sonido + rebote de Dock. |
| Medidor de contexto / uso (`/context`) | ✅ | ❌ | P1 | `message.info.tokens` del último assistant vs `model.limit.context`; anillo en composer + popover con desglose. |
| Coste/uso por sesión | ✅ | ❌ (existe UsageSection global) | P3 | Sumar `cost` de mensajes assistant. |
| Estados de error con causa + acción + detalles/copiar | ✅ | ⚠️ (línea truncada, AUDIT) | P1 | Componente `ErrorCard` con título, explicación, acción ("Reintentar", "Cambiar modelo"), "Ver detalles" y "Copiar". Catálogo mapeando `session.error` (ProviderAuthError, APIError, contexto lleno…). |
| Reintento automático visible | ✅ | ✅ (retry) | — | — |
| Scroll persistente por sesión / no saltar al fondo | ✅ | ⚠️ | P2 | Guardar `scrollTop` por sesión; auto-scroll sólo si el usuario está al fondo. |
| Sesiones enormes (paginación) | ✅ | ❌ | P3 | `session.messages({limit, before})` y carga incremental. |

### 9.6 Git / PR

| Función | Claude | OnyxCode | Prioridad | Cómo implementarlo sobre OpenCode |
|---|---|---|---|---|
| Diff pane con alcance (sin commitear / todo / por commit / vs base) | ✅ | ⚠️ (staged/unstaged) | P1 | `git diff <base>...HEAD`, `git show <sha>`; selector de alcance; OpenCode `session.diff` para "cambios de este turno". |
| Opciones de diff (ocultar espacios, palabras, wrap, agrupar por carpeta) | ✅ | ❌ | P2 | Flags `-w`, word-diff con `diff` lib; toggles en cabecera. |
| Comentarios inline en el diff para Claude | ✅ | ❌ | P1 | Selección de líneas → comentario → se envían como mensaje con `path:line` y extracto. |
| Commit desde UI | ✅ (Claude lo hace) | ✅ CommitBox | — | Añadir "Commit as WIP". |
| Crear PR / draft PR | ✅ | ❌ | P1 | `gh pr create --fill [--draft]` vía `execFile` en main; detectar `gh auth status`; o pedir al agente con prompt prefabricado. |
| Barra/vista de PR (checks, reviews, merge) | ✅ | ❌ | P2 | `gh pr view --json state,statusCheckRollup,reviews,mergeable`; polling cada 30-60 s; pestaña "PR" en panel derecho. |
| Monitor CI + auto-fix | ✅ | ❌ | P2 | Poll de checks; al fallar, notificación + botón "Pedir a Claude que lo arregle" (prompt con logs `gh run view --log-failed`). Auto-fix opcional. |
| Auto-merge | ✅ | ❌ | P3 | `gh pr merge --auto --squash`. |
| Sincronizar con rama base | ✅ | ❌ | P2 | `git fetch` + `git merge origin/<base>`; conflictos → prompt al agente. |
| Worktrees: limpieza, mantener/borrar al archivar | ✅ | ⚠️ (crear/eliminar manual) | P1 | Al archivar/borrar sesión con worktree: diálogo "Mantener / Borrar (y rama)" con recuento de cambios sin commitear; limpieza por inactividad en Ajustes → Almacenamiento. |
| Pinned git origins / archivos protegidos | ✅ | ❌ | P2 | Guardar `origin` por repo al confiar; si cambia, avisar antes de cargar `.opencode/`, `opencode.json`, `.mcp.json` del worktree (vector de inyección de config). |
| Hooks de creación de worktree | ✅ | ❌ | P3 | Script opcional `.onyxcode/worktree-setup.sh` tras crear (instalar deps), ejecutado con confirmación. |

### 9.7 Preview, simulador, dev servers

| Función | Claude | OnyxCode | Prioridad | Cómo implementarlo sobre OpenCode |
|---|---|---|---|---|
| Dev servers con `launch.json` y detección | ✅ | ❌ | P1 | Leer `.claude/launch.json` (compatibilidad) o `.onyxcode/launch.json`; detectar `package.json` scripts (`dev`, `start`) y puerto; lanzar con `pty` en main y mostrar logs. |
| Pane Preview/Browser (pestañas, URL, viewport) | ✅ | ❌ | P1 | `WebContentsView` en partición aislada por proyecto; restringir a `localhost` (reutilizar la política de artifacts). |
| Seleccionar elemento → contexto | ✅ | ❌ | P2 | Script inyectado en la vista (preload del preview) que devuelve `outerHTML`, estilos computados, selector y captura `capturePage(rect)`; adjunta como parte `file` imagen + texto. |
| Anotar/dibujar sobre la página | ✅ | ❌ | P3 | Canvas overlay sobre `capturePage()`, exportar PNG como adjunto. |
| Auto-verificación con preview | ✅ | ❌ | P3 | MCP local de navegador (Playwright) registrado en el sidecar sólo para Code. |
| iOS Simulator / Android Emulator | ✅ | ❌ | P3 | `xcrun simctl io booted screenshot` + MCP; fuera de alcance inicial. |
| Terminal con varias pestañas + adjuntar salida | ✅ | ⚠️ (una terminal) | P1 | Array de ptys por proyecto (IPC ya soporta varios ids), tabs, "Adjuntar salida al chat" (⌘⇧L) leyendo buffer de xterm. |
| Panel de archivos: tabs, editar/guardar, búsqueda de contenido (`?`) | ✅ | ⚠️ (visor + búsqueda por nombre) | P2 | CodeMirror 6 para editar; `find.text` para `?`; tabs de archivos abiertos; guardar vía IPC `fs:write` restringido al proyecto. |
| Abrir en editor externo | ✅ (VS Code/Cursor/Zed…) | ✅ `dialog:openInEditor` | — | Añadir elección de editor y línea (`code -g file:line`). |

### 9.8 Ajustes, políticas, onboarding, microcopy

| Función | Claude | OnyxCode | Prioridad | Cómo implementarlo sobre OpenCode |
|---|---|---|---|---|
| Sección "Ajustes → Code" | ✅ (~30 toggles) | ❌ | P1 | Nueva sección: prefijo de rama, ubicación worktrees, vista de transcript por defecto, fuente/tema de código, auto-archivo, notificaciones, mantener despierto, permitir bypass, sandbox de comandos. |
| Sandbox de comandos para Code | ✅ Local/Strict sandbox | ❌ (sólo Cowork tiene sandbox) | P2 | Reutilizar el perfil `sandbox-exec` de Cowork como opción para Code (AUDIT S6: bash de Code hereda TCC). |
| Almacenamiento y limpieza | ✅ | ❌ | P3 | Calcular tamaño de worktrees/`userData`; limpiar inactivos. |
| Políticas gestionadas (MDM/managed settings) | ✅ | ❌ | P3 | Leer `/Library/Application Support/OnyxCode/managed.json` que fuerce/oculte ajustes. |
| Onboarding de Code (checklist con prompts) | ✅ | ⚠️ (4 sugerencias en sesión vacía) | P1 | Checklist persistente: elegir carpeta, `/init` (AGENTS.md vía `session.init`), plan, primer commit/PR, MCP, notificaciones. |
| Detección de git ausente / bloqueado | ✅ | ⚠️ | P2 | `git --version` al abrir proyecto; errores guiados (xcode-select). |
| Microcopy: causa + acción + qué pasa con tus datos | ✅ | ⚠️ | P1 | Guía de estilo en DESIGN.md; revisar `alert()`/`confirm()` nativos (AUDIT) → diálogos propios con recuentos. |

### 9.9 Top 10 brechas (orden sugerido de implementación)

1. **Notificaciones del sistema + no leídos/"espera tu respuesta"** (P0): sin ellas una tarea larga
   queda bloqueada en un permiso sin que el usuario lo sepa.
2. **Cola de mensajes** mientras el agente trabaja (P0): hoy el composer no permite encadenar.
3. **Adjuntar imágenes/archivos** en el composer (P0): partes `file` de OpenCode.
4. **Modos de permiso reales** (Manual / Aceptar ediciones / Plan / Bypass) + **tarjeta de aprobación
   de plan** (P0): Plan/Build no cubre "aceptar ediciones pero preguntar bash".
5. **Nueva sesión con worktree automático + confianza de carpeta** (P0): aislamiento por sesión y
   defensa contra repos no confiables.
6. **Lista de sesiones global** con renombrar, pin, archivar y búsqueda ⌘K (P0/P1).
7. **Fork, rewind granular y compactar** (`session.fork`, `revert`, `summarize`) con marcadores (P1).
8. **Medidor de contexto + selector de esfuerzo** (`variant`) (P1).
9. **Dev servers + pane Preview** (`launch.json`, `WebContentsView` localhost) (P1).
10. **Flujo PR con `gh`**: crear PR/draft, estado de checks, "pedir a Claude que lo arregle" (P1/P2),
    junto con terminal multi-pestaña y comentarios inline en el diff.
