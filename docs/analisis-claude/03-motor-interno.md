# 03 — Motor interno de Claude Desktop (Code y Cowork)

> Análisis de arquitectura de `/Applications/Claude.app` v2.9939.2 (Electron). Solo describimos
> mecanismos con nuestras palabras; no se copia código de Anthropic. Evidencia = nombres de
> archivos, identificadores y cadenas observadas en el bundle minificado extraído en el scratchpad.
>
> Análisis estático (strings, símbolos, bundle minificado); nada observado en ejecución. Lo que no se
> pudo confirmar se marca «No verificado».

## 0. Mapa del paquete

- `app.asar` → `package.json` `main: .vite/build/index.pre.js`. Bundle Vite dividido en ~300 chunks;
  el principal (`index.chunk-DzZc-q0x.js`, 6,6 MB) contiene casi todo el proceso main.
- Scripts separados: preloads por ventana (`mainView.js`, `mainWindow.js`, `quickWindow.js`,
  `aboutWindow.js`, `findInPage.js`, `coworkArtifact.js`, `claudePagePreview.js`, `designWindow.js`,
  `buddy.js`, `computerUseTeach.js`, `computerUseWatchRecord.js`, `watchRecordChooser.js`,
  `localExecConsent.js`) y workers (`pty-host/`, `mcp-runtime/directMcpHost.js` + `nodeHost.js`,
  `heavy-work-worker/`, `file-index-worker/`, `transcript-search-worker/`, `shell-path-worker/`,
  `stall-sampler-worker/`).
- Dependencias declaradas relevantes: `@anthropic-ai/claude-agent-sdk` (0.3.281, más un canal
  «future»), `@anthropic-ai/mcpb`, `@ant/claude-ssh`, `@ant/ssh-askpass`, `@ant/cowork-win32-service`,
  `@ant/app-cu-helper`, `@ant/session-halo-helper`, `@ant/managed-config`, `@ant/ipc-codegen`,
  `@ant/dxt-registry`, `@ant/chrome-native-host`, `@ant/rfb-client` (VNC), `@ant/security`.
- Nativos (`app.asar.unpacked`): `@ant/claude-swift` (`swift_addon.node` 24 MB, `computer_use.node`),
  `@ant/claude-native`, `node-pty`, `github-mcp-server` (binario Go, 40 MB), office365-mcp (con MSAL
  broker `libmsalruntime`).
- Helpers en `Contents/Helpers/`: `app-cu-helper`, `chrome-native-host`, `disclaimer`,
  `permission-fixer`, `Claude iOS Sim.app`.
- Imágenes VM: `smol-bin.arm64.img` / `smol-bin.x64.img`.

## 1. Sesiones de Claude Code

**Modelo de procesos.** El main usa `query()` del Agent SDK, que **lanza el CLI nativo `claude` como
proceso hijo** (no corre el agente dentro de Electron). Transporte: stdio con NDJSON
(`--input-format/--output-format stream-json --verbose`) más el protocolo de control del SDK: las
aprobaciones de herramientas (`canUseTool`) y los hooks por callback vuelven como peticiones de
control. Para SSH y para la VM de Cowork la app sustituye el spawn del SDK por su propia función
(`spawnClaudeCodeProcess`), de modo que el mismo protocolo viaja por otro canal.

**Origen del binario.** No va dentro del paquete: se descarga de un CDN de releases según un
manifiesto embebido (versión fijada, checksum sha256 por plataforma, binario comprimido `zst`), se
instala por versión en `userData/claude-code` (y `claude-code-vm` para la VM), admite parches delta y
verifica la firma del manifiesto con una clave raíz embebida. Cada sesión puede fijar su versión
(`cliBinaryPin`) y las capacidades se activan por versión mínima. Entorno: `CLAUDE_CODE_ENTRYPOINT`,
`DISABLE_AUTOUPDATER=1`, token OAuth y etiquetas; `NODE_OPTIONS` eliminado; política pasada con
`--managed-settings`.

**Transcripts y metadatos.** Los transcripts son los JSONL del propio CLI en `~/.claude/projects`
(respeta `CLAUDE_CONFIG_DIR`). La app guarda sus metadatos aparte en
`userData/claude-code-sessions/…/local_<id>.json` (id de sesión del CLI e ids previos, fork, origen de
importación, versión fijada) con un índice de archivadas. Importación de sesiones del CLI: copia a un
área de staging con archivos temporales y exige confirmación del usuario antes de reanudar o bifurcar
una sesión importada. Al soltar una sesión deja un marcador junto al JSONL.

**Confianza.** Reutiliza la del CLI (`~/.claude.json`, `projects[ruta].hasTrustDialogAccepted`, y una
concesión de confianza remota por endpoint); diálogo temporizado cuando cambia el cwd; hosts SSH de
confianza; Cowork tiene su propia lista de carpetas de confianza que rechaza ubicaciones protegidas.

**Worktrees.** En `<repo>/.claude/worktrees/<nombre>` (o raíces externas), creados con
`git worktree add --no-checkout` + checkout; nombre = slug de la rama + hex aleatorio; rama con
prefijo configurable por cuenta. Creación perezosa: el CLI pide el worktree a la app mediante hooks
`WorktreeCreate/WorktreeRemove` inyectados por el SDK; un **pool** mantiene worktrees listos y los
presta; hook del usuario tiene prioridad. Al archivar se conservan o eliminan (los sucios se conservan).

**SSH remoto.** Dos transportes a elegir: OpenSSH del sistema (conexión maestra con socket de control
privado, canales en `BatchMode`, askpass propio por FIFO, `StrictHostKeyChecking=accept-new` en sondas,
contraseñas/OTP solo tras confirmar la clave de host) o `ssh2` embebido (verifica la clave contra
known_hosts y rechaza claves revocadas). Despliega un demonio `claude-ssh` en `~/.claude/remote/srv`
con cliente RPC y el CLI en `~/.claude/remote/ccd-cli` (descargado en remoto o subido por sftp desde
una caché local). Reconexión con reproducción por número de secuencia y limpieza de huérfanos.

**Remote Control.** La app registra un «environment» y hace long-polling a la API de trabajo
(poll/ack/heartbeat/stop); cada trabajo trae un token de ingreso con el que el CLI se engancha (ruta
WebSocket antigua para CLIs viejos). Estado persistido en `userData/remote-control-state.json`; al
salir se marca offline y se da de baja.

**Mover a la nube (teleport).** Detiene la sesión local, resume el transcript, crea un commit
instantánea (con controles de LFS y archivos con secretos), lo empuja a una ref oculta
`refs/claude-teleport/<hash>` y crea la sesión cloud por API.

**Permisos y hooks.** Un broker traduce `canUseTool` a peticiones al renderer y respuestas; auto-allow
/ auto-deny en ejecuciones desatendidas. Modos `default/acceptEdits/plan/bypassPermissions/dontAsk/auto`.
Hooks inyectados por la app (p. ej. bloquear subagentes en background, worktrees); los hooks de
`settings.json` siguen ejecutándose en el CLI.

Incierto: valor exacto de entrypoint para Code local, papel del modo `--attach-serve`.

## 2. VM de Cowork

**Hipervisor por plataforma.**
- macOS (≥14 para Cowork): **Virtualization.framework** desde `swift_addon.node` (`CoworkVMManager`,
  `CoworkVMRPCClient`; `VZVirtualMachine`, `VZVirtioSocketDevice/Listener`, `VZSharedDirectory`,
  balloon de memoria, entropía). Entitlement `com.apple.security.virtualization`.
- Windows: **Hyper-V vía HCS** (no distros WSL): exige MSIX, Windows 10 19041+, activa
  *VirtualMachinePlatform* si falta y habla con un **servicio de sistema** por named pipe propiedad de
  SYSTEM; discos `.vhdx`; carpetas por **Plan 9 sobre sockets Hyper-V**.
- Linux: existe una rama «Linux VM helper» y códigos de error KVM/`vhost_vsock`, pero la puerta de
  soporte devuelve «no soportado» fuera de darwin/win32 ⇒ **Cowork no está activo en Linux** en esta
  versión (implementación no incluida en el asar).

**Dos imágenes.**
- `smol-bin.<arch>.img` (~24 MB, en el paquete, **exFAT**, adjuntado como virtio-blk de solo lectura):
  disco de herramientas con binarios Go del proyecto `coworkd` (`sdk-daemon`, `sandbox-helper` con
  seccomp, `claude-shim`, `cli-wrapper`, ajustes de sandbox-runtime). En el arranque el invitado lo
  monta y actualiza su demonio si cambió ⇒ el invitado se actualiza con cada release de la app **sin
  volver a descargar el rootfs**.
- **rootfs descargado** de `downloads.claude.ai/vms/linux/<arch>/<sha>`: imagen cloud de **Ubuntu**
  (GPT, ext4 `cloudimg-rootfs`, 10 GiB dispersa; ~1,2 GB comprimida con zstd) + `vmlinuz` + `initrd`.
  Manifiesto embebido `vmBundleManifest.json` por SHA de git con checksum SHA-256 comprimido y crudo,
  tamaños y **parches delta** desde versiones anteriores; descarga reanudable (`.partial`), verificación
  en streaming, directorio «warm» para precarga y barrido de restos 90 s tras arrancar. Ubicación:
  `userData/vm_bundles/claudevm.bundle/`. Arranque **directo de kernel** (fallback EFI/GRUB), consola
  por `hvc0` (demonio) y `hvc1` (kernel).
- **Disco de sesiones** `sessiondata.img` (10 GB, ext4, montado en `/sessions`, fsck en cada arranque)
  que se conserva al reinstalar.
- El CLI de Claude Code **no** está en el rootfs: el host descarga el binario Linux verificado a
  `userData/claude-code-vm/<ver>/` y el invitado lo instala en `/usr/local/bin/claude` (`installSdk`).

**Canal de control: RPC JSON sobre vsock.** Host→invitado: `spawn` (id, nombre, comando, args, cwd,
env, montajes adicionales, dominios permitidos, token OAuth…), `kill`, `writeStdin`,
`isProcessRunning`, `readFile`, `mountPath`, `installSdk`, `installCACertificates`,
`addApprovedOauthToken`, `injectSshKeys`, `getSessionsDiskInfo`, `pruneSessionCaches`,
`deleteSessionDirs`, `getMemoryInfo`, asignación de IP. Invitado→host: `stdout/stderr/exit`,
`networkStatus`, `apiReachability`, pasos de arranque, `askClaude`. Keepalive cada 30 s; si falla el
latido se reinicia la VM.

**Carpetas compartidas.** En macOS hay **un único virtiofs que comparte la raíz `/` del host**; el
invitado lo monta como root con `nosymfollow` y hace **bind mounts por sesión** solo de lo pedido
(`/sessions/<proc>/mnt/<carpeta>`, `mnt/.claude`, `mnt/uploads`…) con modos `ro/rw/rwd`, rechazando
fuentes con symlinks o fuera del recurso, y un FS FUSE «hide» que oculta entradas por patrón.
⇒ El aislamiento depende de que el demonio del invitado monte solo lo solicitado; root del invitado
podría ver todo el disco del host (decisión de diseño a **no** copiar).

**Qué corre dentro.** Ubuntu con systemd; `coworkd` enmascara red/DNS/hora del sistema (la hora se
sincroniza por RPC), crea **un usuario Linux por sesión**, un **cgroup** por sesión (detección OOM,
pico de memoria), mitigaciones de kernel, y lanza la cadena `sandbox-helper` (uid/gid + seccomp +
bubblewrap) → **sandbox-runtime (srt)** con reglas de red/archivos → wrapper → `claude`. También
procesos puntuales (p. ej. LibreOffice headless para convertir a PDF).

**Red.** Por defecto **red en espacio de usuario con gVisor** (`gvisor-tap-vsock` embebido en el
addon; el invitado usa una TAP puenteada por vsock), IP estática 172.16.10.3/24, MTU 1400, IPv6 ULA
opcional; alternativa vmnet en macOS 26+ y fallback NAT/DHCP. Dentro del invitado un **proxy MITM**
con CA efímera intercepta solo dominios de Anthropic y **inyecta el token OAuth** (el proceso nunca lo
ve en su entorno; el host lo preaprueba con `addApprovedOauthToken`). Egress: lista base (npm, PyPI,
GitHub, Ubuntu, crates…) + dominios del proveedor + `coworkEgressAllowedHosts` de la política, aplicada
por srt por proceso. Sondeo de alcance a la API y diagnóstico de conflictos con VPN.

**Ciclo de vida.** Pasos: descarga/SDK → cargar addon → parar VM previa → red → configuración → boot
→ conexión vsock → IP → CAs → listo → instalar CLI. Memoria por defecto **4 GB** (configurable),
CPUs «auto» (4 observadas). Se detiene al salir, cerrar sesión, reinstalar o fallar el latido; **no se
encontró apagado por inactividad**. Conserje de disco: si el disco de sesiones baja de ~500 MiB poda
cachés (>3 días) y borra directorios huérfanos; retención configurable por política. Metadatos de
sesión en el host en `local-agent-mode-sessions/<cuenta>/<org>/`. Existe también un modo «host loop»
(bucle del agente en el host) que la política `requireCoworkFullVmSandbox` desactiva.

No verificado: puertos vsock, nombre exacto del servicio Windows, orden exacto sandbox-helper/srt/bwrap.

## 3. Computer use (nombre interno «chicago»)

**Componentes nativos.**
- `computer_use.node` (Swift): captura con **ScreenCaptureKit** (`SCContentFilter` que excluye apps
  no concedidas; captura de pantalla, región o ventana, JPEG ~0,75), comprobación/solicitud TCC
  (Accesibilidad con `AXIsProcessTrustedWithOptions`, Grabación con `CGPreflight/RequestScreenCaptureAccess`),
  árbol AX (leer/actuar), cursor «fantasma», ocultar/mostrar apps, guardia contra robo de foco,
  event tap para Esc.
- `claude-native-binding.node` (Rust): **inyección global** con `CGEventPost` (ratón, teclado,
  scroll, texto Unicode, texto «pausado»), app frontal, apps en ejecución, rectángulos a enmascarar.
- `Helpers/app-cu-helper` (Rust, hardened runtime, JSON-RPC por stdio): **inyección por proceso**
  con SPI privadas de SkyLight (eventos dirigidos a un PID con mensaje de autenticación, activar sin
  traer al frente, mover ventanas entre Spaces).
- `swift_addon.node`: grabación Watch/Record (monitor de entrada, voz a texto), atajos, «halo».

**Dos modos.** (1) *Control total*: eventos globales; antes de cada acción oculta las apps no
concedidas de esa pantalla y las restaura después. (2) *Segundo plano por app* (herramientas `app_*`):
eventos al PID de la app sin robar el foco, con cursor fantasma, y **rechazos con código** cuando hay
entrada segura activa (campo de contraseña), el usuario está tecleando, hay menú/popup/hoja modal,
overlay ajeno encima o la acción traería otro Space al frente. `request_full_control` es otra tarjeta
de consentimiento.

**Capturas.** ScreenCaptureKit excluye en el compositor las apps fuera de la lista de la sesión;
las ventanas propias se ocultan con `setContentProtection(true)` durante la captura. Fallback:
`desktopCapturer` con enmascarado de píxeles (se niega a capturar sin máscara).

**Lista de apps y niveles.** Categorías por bundle id: navegadores y apps de trading/cripto → **read**;
terminales, IDEs, Script Editor/Automator/Atajos → **click**; resto → **full**. Denegaciones por
política y por el usuario; apps multimedia filtradas en ciertos flujos. Banderas del grant:
`clipboardRead`, `clipboardWrite`, `systemKeyCombos` (por defecto falsas).

**Aplicación de los grants.** Antes de **cada** acción (también dentro de lotes) se comprueba la app
frontal y, para clics, la app bajo el punto; el nivel limita la acción (read: sin entrada; click: sin
teclear/teclas/clic derecho/arrastre). Límites de argumentos (repeticiones, longitud de texto, ruta
de arrastre); los menús de «Compartir/Servicios» se rechazan.

**Flujo `request_access`.** Primero verifica TCC (si falta, guía a Ajustes); resuelve nombres a bundle
ids (Spotlight); muestra una **tarjeta de permiso en el chat** por el pipeline normal de permisos
(`computer:request_access`), devuelve concedidas/denegadas/no instaladas/bloqueadas por política; en
sesiones desatendidas falla (`unattended_no_approver`); revocable por sesión.

**Indicación.** Ventana panel transparente a pantalla completa, siempre encima y que ignora el ratón,
con borde luminoso y el aviso «Claude is using your computer»; notificación con botón Stop; en modo
segundo plano, cursor fantasma por ventana.

**Parada.** Mientras alguien tiene el «lock», se registra **Esc** como atajo global (y un event tap
nativo); los Esc que envía el propio modelo se descuentan en una ventana de 100 ms para no
auto-detenerse. Además botón Stop y herramientas de liberación.

**Portapapeles.** Texto multilínea se pega: guarda el portapapeles, escribe, verifica, pega y restaura.

**Teach y Watch/Record.** Teach: al aprobar, oculta la ventana principal y muestra un overlay de
tooltips paso a paso (Siguiente/Salir). Watch/Record («Grabar una habilidad»): selector con vista
previa del micrófono y retardo anti-clic accidental, píldora de grabación, muestreo de frames
(~250 ms, con compactación), narración por voz y entrega de una «trayectoria» (imágenes + transcripción)
para revisar. No verificado: duración máxima exacta.

## 4. Runtime MCP

**Lanzamiento local.** Dos caminos:
- *Node integrado*: `utilityProcess.fork` de `mcp-runtime/nodeHost.js`, que recibe un MessagePort,
  redirige stdin/stdout/stderr del servidor por ese puerto (el servidor sigue «hablando stdio») e
  importa su entrada. **Bloquea que el servidor reejecute el binario de Electron como Node**
  (parchea spawn/exec). Se usa para extensiones `server.type: node` compatibles con la versión de Node.
- *Runtime del sistema* (Python, binarios, Node del sistema, servidores del usuario): `child_process`
  sin shell envuelto por `Helpers/disclaimer`, que **solo presta la responsabilidad TCC de Claude a
  binarios del sistema**; el resto se lanza «desvinculado».
- Entorno: lista blanca mínima (`HOME, LOGNAME, PATH, SHELL, TERM, USER`) + env del servidor + proxy/CA;
  PATH del login shell obtenido por un worker.
- **Sin sandbox Seatbelt** para servidores MCP: el aislamiento es separación de procesos, TCC
  desvinculado y env filtrado (el único `sandbox-exec` es el del simulador iOS, `claude-ios-sim.sb`,
  perfil `(deny default)`).

**Extensiones `.mcpb`/`.dxt`.** Copia a staging con permisos 0600; vista previa y extracción en el
worker pesado; **firma PKCS#7 anexada al zip** verificada (digest SHA-256 + cadena validada por el SO
con `security verify-cert` en macOS) → `signed / self-signed / unsigned` con editor y huella; límites
de tamaño y colisiones al extraer; comprobación de identidad del manifiesto; política
(`isDesktopExtensionSignatureRequired`) y consulta a la organización (`can_install`, lista de
bloqueo refrescada ~cada 2 h que desactiva extensiones ya instaladas). Instalación en
`userData/Claude Extensions/<id>`; los campos `user_config` marcados `sensitive` se cifran con
**safeStorage** (Llavero).

**Conectores remotos y OAuth.**
- Conectores de claude.ai: el backend hace OAuth y guarda tokens; la desktop solo **proxifica** las
  llamadas de herramientas por la API de la organización.
- Servidores remotos gestionados por admin: un utilityProcess «MCP Host» con transportes HTTP/SSE y
  rotación de cabeceras; **el main hace OAuth** (registro dinámico, PKCE, redirección loopback
  `http://<host>:<puerto>/callback`, validación de `state` y del servidor de autorización),
  tokens cifrados con safeStorage; alternativa con broker de Entra.
- En sesiones de Code, el CLI hace el OAuth y la desktop reenvía la URL de callback.

**MCP incluidos.** Solo como integraciones configuradas por admin:
- `github-mcp-server` (Go) en modo stdio, solo lectura, con token obtenido por **device code flow** y
  guardado cifrado.
- `office365-mcp`: la desktop actúa de host MSAL (caché de tokens cifrada que el proceso hijo pide por
  mensajes; broker nativo Company Portal/WAM); herramientas de escritura por defecto en «preguntar».

**MCP internos para sesiones.** Servidores in-process del SDK (`type: "sdk"`), sin proceso aparte:
`computer-use`, `claude-in-chrome`, `ccd_session`, `ccd_session_mgmt`, `ccd_directory`,
`ccd_connectors`, `scheduled-tasks`, `terminal`, `mcp-registry`, `visualize`, `Claude Browser`…,
actualizados con la petición de control `mcp_set_servers`.

**Claude in Chrome.** Host de native messaging en Rust (`Helpers/chrome-native-host`) registrado en
cada navegador Chromium para IDs concretos de la extensión; expone un socket Unix por proceso con
comprobación de permisos del directorio, al que se conecta el MCP `claude-in-chrome`.

## 5. IPC y modelo de seguridad

**Ventanas.** Todas las `BrowserWindow`/`WebContentsView` usan `sandbox:true`,
`contextIsolation:true`, `nodeIntegration:false`, `webviewTag:false`, `navigateOnDragDrop:false`.
La UI principal es la web remota `https://claude.ai` en un `WebContentsView` con preload `mainView.js`;
las ventanas locales se sirven por un esquema propio `app://localhost` (`protocol.handle('app')`
rechaza otros hosts y `Origin` distintos, e inyecta CSP generada).

**IPC tipado con validación de origen.** Un generador (`@ant/ipc-codegen`) produce ~80 interfaces
(`AppConfig`, `ClaudeCode`, `ClaudeVM`, `MCP`, `Extensions`, `FileSystem`, `CoworkSpaces`…). Cada
canal tiene un nombre con UUID y namespace (`$eipc_message$_<uuid>_$_claude.web_$_…`), y **cada llamada
se valida en main**: (1) el emisor debe ser el frame principal (`senderFrame.parent === null`),
(2) su origen debe coincidir con el esperado (`https://claude.ai`, `app://localhost` o `file:` según la
interfaz), (3) cada argumento y el resultado pasan un validador de tipo. Errores explícitos
«did not pass origin validation». Los preloads exponen APIs pequeñas por ventana
(`claudeAppBindings`, `desktopManagedConfig`, `cowork`, `claudeDesktopArtifactPane`…), no un `invoke`
genérico.

**Navegación.** `will-navigate`/`will-redirect`/`will-frame-navigate` bloquean todo lo que no sea el
origen de la ventana; `setWindowOpenHandler` deniega o fuerza `sandbox/contextIsolation` en popups;
ventanas de consentimiento bloquean cualquier navegación.

**Permisos de sesión.** `setPermissionRequestHandler`/`setPermissionCheckHandler` deniegan todo en
particiones de artefactos, vista previa de archivos y OAuth; en la sesión por defecto solo se conceden
permisos concretos (portapapeles saneado, media) a orígenes permitidos. WebRTC en vistas de previa:
`disable_non_proxied_udp`.

**Aislamiento de artefactos.** Particiones separadas, esquemas `cowork-artifact://` / `cowork-file://`
registrados como privilegiados (`standard`, `secure`), `webRequest.onBeforeRequest` cancela cualquier
otra URL, CSP por cabecera (`connect-src 'none'`, `form-action 'none'`, `base-uri 'none'`), `no-store`,
y comprobación de rutas contra la raíz permitida (denegaciones registradas). Contenido SVG/HTML de
usuario envuelto con `<meta>` CSP propia.

**Protocolos.** `claude://` y `claude-cli://` registrados como cliente por defecto (desactivable por
MDM `disableDeepLinkRegistration`); el manejador de URL enruta por host con lista cerrada de acciones.

**Fuses de Electron** (leídos del binario): RunAsNode **off**, cookies cifradas **on**,
NODE_OPTIONS **off**, `--inspect` **off**, validación de integridad del asar **on**,
OnlyLoadAppFromAsar **on**, GrantFileProtocolExtraPrivileges **on**.

**Entitlements.** `virtualization`, `automation.apple-events`, `allow-jit`, audio/cámara/USB/bluetooth,
keychain groups para WebAuthn, clave hardware y el broker de Microsoft.

**Actualización.** `autoUpdater` nativo de Electron (Squirrel.Mac: `Squirrel.framework`, logs de
`ShipIt`), máquina de estados con telemetría; antes de instalar se detienen terminales, procesos
hijos, simulador y ventanas (`before-quit-for-update`). MDM: `disableAutoUpdates`,
`autoUpdaterEnforcementHours` (72 h por defecto), `relaunchEnforcementHours`, `dangerousMaxVersion`,
`updateViaUpdatesHost`.

**Política empresarial (MDM).** `@ant/managed-config` define ~180 claves planas (`flatKey`) con
alcance, versión mínima y UI de ayuda: modos (`isClaudeCodeForDesktopEnabled`, `coworkTabEnabled`),
extensiones y MCP, `allowedWorkspaceFolders`, `blockReadsOutsideWorkingDirectories`,
`codeAllowedRepositories`, `sshHostAllowlist`, egress de Cowork, proveedor de inferencia
(Bedrock/Vertex/Foundry/gateway), OTLP, retención de sesiones, navegador integrado. Fuentes:
plist en `/Library/Managed Preferences/…`, HKLM/HKCU `SOFTWARE\Policies\…`, `managed-settings.json`
y configuración remota del servidor, con precedencia definida.

## 6. Trucos de rendimiento

- **Caché de compilación V8 precompilada**: el build genera `compile-cache/*.{arm64,x64}.jsc`; el
  arranque (`index.pre.js`) parchea el compilador de módulos para pasar `cachedData` a `vm.Script` y
  registra hit/miss/partial. Arranque sin parseo del bundle de 6,6 MB.
- **Chunks perezosos**: ~300 chunks cargados bajo demanda.
- **utilityProcess por tipo de trabajo**, cada uno con nombre de servicio, cola/serialización
  («qos»), timeout por RPC y política al vencer (matar y relanzar), watchdog y enfriamiento de
  reinicios: PTY host, MCP host, heavy-work, worktree-copy, archive, file-index, transcript-search,
  shell-path (resuelve el PATH del login shell una vez).
- **MessagePort directo renderer↔worker** (`attachRendererPort`) para no pasar datos por el main.
- **Índice de archivos** en worker con búsqueda difusa; búsqueda de transcripts en worker con
  lectura en streaming de JSONL.
- **stall-sampler** en `worker_threads` para detectar bloqueos del main.
- Limpieza ordenada al salir/actualizar mediante registro de «cleanup tasks».

## Lecciones para OnyxCode

Estado actual de OnyxCode (según `src/main/**`, `src/preload/**`, `helper.swift`, AUDIT.md, docs/archive/PLAN.md):
sidecar `opencode serve` por HTTP local con Basic auth; Cowork con Seatbelt `(allow default)` + denegaciones;
computer use con `cu-helper` Swift (CGEvent) + `screencapture` + MCP propio lanzado con
`ELECTRON_RUN_AS_NODE`; kill-switch en main ya corregido; IPC con lista blanca de canales en preload
pero **sin validar emisor ni payload en main** (`ipc/handle.ts`); sin fuses; `will-navigate` solo
filtra http(s); renderer por `file://`.

Prioridad (esfuerzo S ≤ 2 días, M ≤ 2 semanas, L > 2 semanas). Entre corchetes, el hallazgo de
Claude Desktop que lo motiva.

**Bloque A — Electron/IPC (una semana, cierra la brecha más barata)**
1. **[S] Validación de emisor y payload en `ipc/handle.ts`**: `senderFrame.parent === null`, origen
   esperado por canal y validación de argumentos (zod generado desde `shared/ipc.ts`). [§5: cada una
   de las ~80 interfaces valida origen, argumentos y resultado.]
2. **[S] Renderer por esquema `app://`** con `protocol.handle`, CSP por cabecera, `will-navigate`/
   `will-redirect`/`will-frame-navigate` que solo permitan el origen propio,
   `setPermissionRequestHandler` que deniegue por defecto, menú propio sin DevTools; elimina `--cors null`.
3. **[S] Preloads mínimos por ventana** (Quick Entry, overlay, artifacts) en vez de `window.api` completo.
4. **[S] Fuses** (RunAsNode, NODE_OPTIONS, `--inspect` off; integridad del asar; solo cargar desde asar).
   Requiere antes el punto 5.

**Bloque B — Procesos y TCC**
5. **[M] utilityProcess para el MCP de computer use, el PTY y git pesado**, con timeout por RPC,
   watchdog, reinicio con enfriamiento y MessagePort directo al renderer donde haya volumen.
   [§6] Quita la dependencia de `ELECTRON_RUN_AS_NODE` y habilita el punto 4.
6. **[M] Helper «disclaim» para todos los hijos** (OpenCode, bash del PTY, MCP de terceros, rutinas):
   pequeño binario que aplique `responsibility_spawnattrs_setdisclaim` y solo preste la
   responsabilidad TCC a binarios del sistema. [§4: `Helpers/disclaimer`.] Cierra S6 sin reescribir
   el helper; combinado con 7 deja la Accesibilidad/Grabación solo en el helper de computer use.
7. **[M] `cu-helper` como bundle firmado propio** (bundle id y TCC independientes).
8. **[S] Entorno mínimo para servidores MCP locales** (`HOME, LOGNAME, PATH, SHELL, TERM, USER` +
   env del servidor) y secretos MCP en `safeStorage`. [§4]

**Bloque C — Computer use al nivel de Claude**
9. **[M] Grants por app con niveles read/click/full** decididos por bundle id (navegadores y
   trading → read; terminales/IDE/Script Editor/Automator/Atajos → click; resto → full), tarjeta de
   aprobación nativa en main, flags `clipboardRead/Write` y `systemKeyCombos` desactivados por
   defecto, rechazo en sesiones desatendidas (rutinas). **Comprobación en el helper antes de cada
   acción**: app frontal y, para clics, app bajo el punto (`AXUIElementCopyElementAtPosition`).
10. **[S] Rechazos de seguridad en el helper**: no teclear si hay entrada segura activa
    (`IsSecureEventInputEnabled`) o el foco es `AXSecureTextField`, ni si el usuario tecleó en los
    últimos ms; límites de repetición/longitud; bloquear menús Compartir/Servicios.
11. **[M] Capturas con ScreenCaptureKit excluyendo apps no concedidas** (`SCContentFilter` con
    `excludingApplications`), en vez de `screencapture` completo: el modelo no ve apps no autorizadas
    (menos prompt injection y privacidad).
12. **[S] Esc como parada** mientras el agente controla (atajo global solo durante el control),
    descontando los Esc que envía el propio modelo en una ventana corta; borde luminoso a pantalla
    completa + notificación con botón Detener. [§3] Complementa el ⌘⇧Esc actual.
13. *(Opcional, no recomendado)* inyección por PID con SPI privadas de SkyLight para control en
    segundo plano: frágil y no documentado; mejor quedarse con CGEvent global + ocultar apps no
    concedidas antes de actuar.

**Bloque D — Aislamiento de Cowork**
14. **[M] Proxy de credenciales en el host** (útil ya con Seatbelt): el OpenCode de Cowork recibe
    una clave «centinela» y un `HTTPS_PROXY`/baseURL local; el proxy de main sustituye por la clave real
    solo hacia el host del proveedor y aplica lista de egress. [§2: el token nunca entra al entorno
    del proceso.] Cierra la exfiltración de claves y abre la puerta a egress controlado.
15. **[L] VM real con Virtualization.framework** (sustituye Seatbelt `(allow default)`):
    - addon/helper Swift con `VZVirtualMachine`, arranque directo de kernel, rootfs mínimo descargado
      con checksum (Alpine/Ubuntu cloud) y disco de herramientas pequeño en el paquete para actualizar
      el agente invitado sin volver a descargar el rootfs;
    - **compartir solo la carpeta de la tarea** con `VZSharedDirectory` (no `/` como hace Claude);
    - control por **vsock** (spawn/kill/stdin/stdout/exit como RPC JSON) y OpenCode dentro de la VM;
    - red: NAT de VZ + proxy del punto 14 en el host como única salida (o gvisor-tap-vsock si se
      quiere control total);
    - usuario por sesión + cgroup de memoria; 4 GB por defecto; disco de sesiones separado y poda.
16. **[M] Política gestionada** mínima (plist/JSON): carpetas permitidas, MCP permitidos, prohibir
    acceso total, egress de Cowork; precedencia sobre ajustes del usuario.

**Bloque E — Code y distribución**
17. **[M] Worktrees gestionados**: en `<repo>/.claude…`-equivalente (`.onyxcode/worktrees/<nombre>`),
    nombre slug+hex, rama con prefijo, pool pre-creado, conservar los sucios al archivar; copia en worker.
18. **[S] Confianza de carpeta** antes de abrir un repo en Code (y `git -c core.fsmonitor=`), registrada
    en main.
19. **[M] Auto-update firmado** (Developer ID, notarización, `electron-updater` zip) que detenga
    sidecars/PTYs antes de instalar; **[L]** caché V8 (`cachedData`) + carga perezosa de chunks.
20. **[S] Shim `$BROWSER`** por socket Unix con clave para abrir URLs del agente en un panel propio.

**Orden recomendado:** A (1–4) → B (5–8) → 12, 10, 9, 11 → 14 → 15 como proyecto aparte → resto.
Cambio frente a la versión anterior de esta lista: el **proxy de credenciales (14)** sube de
prioridad porque aporta gran parte del beneficio de seguridad de la VM con esfuerzo M, y el
**helper disclaim (6)** resulta ser la vía que usa Claude para S6, más simple que un XPC.
