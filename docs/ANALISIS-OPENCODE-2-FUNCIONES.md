# Análisis del código fuente de OpenCode 2.x: qué funciones nos sirven y cómo traerlas

Fecha: 2026-10-22. Autorizado por Ben en el chat. Complementa `docs/INVESTIGACION-OPENCODE-2.md` y `docs/SPIKE-OPENCODE-2.md`.
**Solo lectura**: se clonó el repo oficial y no se ejecutó nada de él (ni install, ni scripts, ni build, ni binarios). El clon se borró al terminar.

| Copia  | Origen                                                              | Revisión                                                                                                                          |
| ------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `v2`   | `github.com/anomalyco/opencode`, rama por defecto, `--depth 1`      | `e965774fa0e2a8ffb27bf02827a2c3c6a8c0f45b` (2026-10-22, «sync release versions for v2.1.3»; `packages/core/package.json` = 2.1.3) |
| `v119` | mismo repo, tag `v1.19.0` (el de `resources/opencode-bin/pin.json`) | `733b2c627e5aec39cb33cc22373bdce33053ef2c` (2026-10-11)                                                                           |

Las citas usan `v2:` o `v119:` seguidos de la ruta dentro del repo y la línea.

## 0. Hallazgo principal

**Dos de las tres funciones ya vienen en nuestro 1.19.0, apagadas tras variables de entorno experimentales:**

- Subagentes en segundo plano: `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` (`v119:packages/opencode/src/effect/runtime-flags.ts:43`; la tool `task`
  rechaza `background=true` sin ella, `v119:packages/opencode/src/tool/task.ts:97-102`). También trae la ruta
  `POST /experimental/session/:sessionID/background` («mandar al fondo» los subagentes que bloquean,
  `v119:packages/opencode/src/server/routes/instance/httpapi/handlers/experimental.ts:159-172`), que ya figura en nuestro `api-routes.json`.
- Code Mode (solo MCP, **sin `fetch`**): `OPENCODE_EXPERIMENTAL_CODE_MODE` (`runtime-flags.ts:48`; se carga en `v119:packages/opencode/src/tool/registry.ts:118-119`).
- Ojo: `OPENCODE_EXPERIMENTAL` a secas enciende todas las experimentales (`runtime-flags.ts:10-14`); hay que usar solo las específicas.

Comprobado sin ejecutar: `grep -a` sobre `resources/opencode-bin/bin/opencode` encuentra las dos cadenas de variables y la ruta `/experimental/session/:sessionID/background`.
`src/main` no define hoy ninguna `OPENCODE_EXPERIMENTAL*`.

Lo que **no** existe en 1.19 es el **shell en segundo plano**: `v119:packages/opencode/src/tool/shell.ts` solo tiene tiempo límite (por defecto 2 min, `:347`, mata al vencer `:540-564`).

## 1. Cómo lo implementa 2.x

### 1.1 Registro de trabajos (`Job`), base común de subagentes y shell

`v2:packages/core/src/job.ts` (491 líneas) es un registro de trabajos por proceso, global (no por carpeta, `:491`):

- `Info` = `id`, `type`, `status` (`running|completed|error|cancelled`), tiempos, `output`/`error`, `notificationID` (`:40-51`).
- `start` crea un ámbito hijo y corre el efecto en una fibra; si ya hay uno `running` con ese id, se une a él (`:253-298`). `settle` decide el estado por el `Exit` (`:211-245`).
- `block` = esperar en primer plano; compite entre «terminó» y «lo mandaron al fondo» (`:329-356`). `background`/`backgroundAll` cambian el modo de un trabajo vivo (`:372-410`).
- `cancel` cierra el ámbito (interrumpe la fibra) y lo marca `cancelled` (`:412-440`).
- **Persistencia**: solo los trabajos «recuperables» y ya en segundo plano dejan un marcador en el KV (`job.background/<notificationID>`, `:199-209`), que se borra al entregar el aviso (`completeBackground`, `:462-473`). Historial en memoria de 25 terminados (`:38`, `:186-197`).
- No emite eventos de bus propios; lo visible son los eventos de shell/sesión y la «progress» de la herramienta.

### 1.2 Subagentes (`subagent`, antes `task`)

`v2:packages/core/src/tool/plugin/subagent.ts` (311 líneas):

- Entrada: `agent`, `description`, `prompt`, `model?`, `sessionID?` (continuar un hijo), `background?` (`:29-48`). `options: { codemode: false }` (`:104`): no se puede llamar desde Code Mode.
- Límite de profundidad `experimental.subagent_depth`, por defecto 1 (`:117-133`). Rechaza agentes `primary` (`:136`).
- Permiso: `permission.assert({ action: "subagent", resources: [agent.id], save: [agent.id] })` (`:138-151`).
- Crea una sesión hija con `parentID` (`:185-198`) y le manda el prompt («You are a subagent spawned by another session.», `:205-218`).
- `SubagentJob.start` registra el trabajo con `recovery` `{kind:"subagent", parentSessionID, childSessionID, agent, description}` (`:220-227`; `v2:packages/core/src/session/subagent-job.ts:45-63`).
- Segundo plano: `subagents.background` y respuesta inmediata con el texto «DO NOT sleep, poll…» (`subagent.ts:19-27`, `:229-232`).
- Primer plano: `jobs.block`; si el turno padre se interrumpe, interrumpe al hijo y cancela el trabajo (`:234-240`). Si el usuario lo manda al fondo mientras espera, devuelve `running` y programa el aviso (`:241-244`).
- **Aviso de fin**: `SubagentCompletion.deliver` mete en la sesión padre un mensaje `synthetic` `<subagent sessionID=… state=…>texto</subagent>`
  (`v2:packages/core/src/session/subagent-completion.ts:21-46`). `Session.synthetic` lo admite en el buzón con `delivery: "steer"` y **despierta** la sesión padre
  (`v2:packages/core/src/session/session.ts:283-322`, `execution.wake` en `:319`), así que el padre arranca otro turno solo.
- «Mandar todo al fondo» (lo que haría un botón): `Session.background` → `jobs.backgroundAll` + mensaje sintético explicativo (`session.ts:474-490`).
- **Tras reiniciar el servidor**: `resumeSuspendedSessions` lee `pendingBackground` y reanuda el hijo con un presupuesto de 10 intentos, o avisa al padre con error
  (`v2:packages/core/src/session/execution/restart.ts:136-188`, `:192-236`, `DEFAULT_MAX_ATTEMPTS` en `:33`).
- La lista de subagentes visibles se inyecta en la descripción de la herramienta filtrando con `Permission.evaluate(...) !== "deny"` (`subagent.ts:282-309`).

En **1.19** (`v119:packages/opencode/src/tool/task.ts`, 371 líneas) el diseño es el mismo en pequeño: `BackgroundJob` en memoria por instancia
(`v119:packages/opencode/src/background/job.ts:17-34`, motor `v119:packages/core/src/background-job.ts`, 365 líneas, sin persistencia),
`promote` en vez de `background`, profundidad `subagent_depth` (`task.ts:106-115`), permiso `ctx.ask({permission: "task"})` (`:120`), y el aviso se
inyecta con `ops.prompt` de una parte de texto `synthetic: true` (`task.ts:226-253`, `notify` en `:256-265`). Sin recuperación tras reinicio.

### 1.3 Shell en segundo plano (`shell`, antes `bash`)

- Herramienta: `v2:packages/core/src/tool/plugin/shell.ts` (293 líneas). Entrada `command`, `workdir?`, `timeout?`, `background?` (`:48-61`).
  Tiempo límite por defecto 2 min en primer plano y **ninguno en segundo plano** (`:24`, `:201`).
- Antes de lanzar: resuelve la carpeta, analiza el comando con un parser (wasm de tree-sitter o escáner portátil) y pide permiso por cada subcomando
  (`:117-155`, `permission.assert` en `:137-145`); revalida la carpeta justo antes de lanzar (`:146-153`). Marca el entorno `AGENT=1`, `OPENCODE=1`, `OPENCODE_SESSION_ID` (`:211-219`).
- Servicio `Shell` (`v2:packages/core/src/shell.ts`, 473 líneas, por carpeta `:459-473`): cada `create` lanza un proceso, vuelca stdout+stderr a
  `<estado>/shell/sh_<id>.out` y devuelve un id (`:63-68`, `:264-300`). Aplica `hooks.trigger("shell","create.before", invocation)` con `env` mutable (`:284`).
  Tiempo límite cambiable en vivo (`timeout`, `:201-205`; mata con `forceKillAfter` 3 s, `:371-393`). Retiene 25 terminados en memoria y borra archivos de más de 7 días cada hora (`:30-34`, `:91-114`, `:118`).
  Eventos efímeros `shell.created`, `shell.exited` (`exit`, `status`), `shell.deleted` (`v2:packages/schema/src/shell.ts:58-61`; publicados en `shell.ts:178-179`, `:423`, `:442`).
- Trabajo: `jobs.start({ id: shellID, type: "shell", recovery: {kind:"shell", sessionID, shellID, command} })` (`tool/plugin/shell.ts:239-252`).
  En segundo plano responde «Command moved to the background (shell ID …). Output is streaming to: <archivo>» (`:96-101`, `:254-258`).
- Aviso de fin: `notifyWhenDone` → mensaje sintético `<shell id=… state=… command=…>salida</shell>` que despierta la sesión (`:157-189`; formato en `v2:packages/core/src/shell/result.ts:45-62`).
- Cancelación: interrumpir el turno en primer plano cancela el trabajo y `shell.remove` mata el proceso (`tool/plugin/shell.ts:237`, `:260-262`). Pasar de primer a segundo plano quita el tiempo límite (`:263-266`).
- Tras reiniciar: los shell que seguían corriendo se dan por **cancelados** («Command cancelled because the server restarted») y se avisa sin despertar a la sesión (`restart.ts:100-134`).
- Mientras haya trabajos de fondo, la carpeta no se descarga por inactividad (`v2:packages/core/src/location-activity.ts:77-88`).

**PTY** (terminal interactiva, otra cosa): `v2:packages/core/src/pty.ts` (321) con tickets de conexión de 60 s (`pty/ticket.ts:9-10`) y un **demonio PTY persistente**
(`persistent-pty/daemon.ts`, 693; `index.ts`, 419) que es un binario nativo aparte `opencode-pty` verificado por sha256 (`persistent-pty/binary.bun.ts:8-29`; paquete `@opencode-ai/pty-*`, `v2:packages/cli/script/opencode-pty.ts:18-30`).
Lazunox ya tiene su propio PTY (`src/main/pty/`); no conviene traer este.

### 1.4 Code Mode

- Paquete `v2:packages/codemode` (MIT, ~11 000 líneas TS, dependencia `acorn` 8.15.0 y `effect`; `package.json`). Es un **intérprete propio** de un subconjunto de JavaScript:
  `acorn` parsea (`src/interpreter/execute.ts:1`, `:115`) y el intérprete recorre el AST; no hay `eval`, `Function`, `vm` ni workers. Sin imports, timers, `process` ni sistema de archivos
  (`README.md`, «How it differs»). Corre **dentro del proceso del servidor** de OpenCode.
- Límites: `timeoutMs`, `maxToolCalls`, `maxOutputBytes`, **sin valores por defecto** (README, «Execution Limits»; validación `src/codemode.ts:134-135`). Topes duros por paso:
  cadenas 16 Mi, arreglos 10 M, 10 000 promesas, 32 niveles (`src/interpreter/limits.ts:6-13`). Ni 2.x ni 1.19 pasan límites al crear el runtime.
- Integración 2.x (`v2:packages/core/src/codemode/tool.ts`, 365): una herramienta `execute` con `{ code }` (`:80-152`). Toda herramienta con `codemode !== false` entra al
  catálogo (MCP por defecto `v2:packages/core/src/tool/mcp.ts:52`; `shell`, `subagent`, `edit`, `write`, `read`… quedan fuera, `tool/plugin/*.ts`).
  Cada llamada anidada pasa por `beforeExecute` → gancho `tool.execute.before` y luego `executeTool` (`v2:packages/core/src/tool.ts:246-250`), y las MCP piden su permiso dentro (`tool/mcp.ts:58`).
  Desactivar: regla `deny` sobre `execute` (`tool.ts:239`).
- **`fetch` sin permiso en 2.x**: la extensión `web` expone `fetch` global (`v2:packages/core/src/codemode/web.ts:14-41`, registrada en `codemode/tool.ts:253`). Solo bloquea `file:` y tiene 30 s.
  Las extensiones **no** disparan `tool.execute.before` ni piden permiso; sus ganchos solo pintan progreso (`codemode/tool.ts:177-186`). Es un canal de red que salta `webfetch` y la puerta del plan.
- MCP por defecto en Code Mode: `v2:packages/core/src/plugin/mcp-codemode-defaults.ts:20-40` (lo apaga solo para servidores que ya son Code Mode).
- **1.19** (`v119:packages/opencode/src/tool/code-mode.ts`, 310; paquete `v119:packages/codemode`, ~6 900 líneas): solo herramientas **MCP**; por cada llamada dispara
  `tool.execute.before` con `tool = clave MCP` y `callID = <padre>/<n>` (`:134-144`, `:219-229`) y pide `ctx.ask({ permission: clave, always: ["*"] })` (`:147`); además `tool.execute.after` (`:180`).
  El catálogo se filtra por permisos (`:209-212`). **No hay `fetch`**: el propio runtime lo declara no disponible (`v119:packages/codemode/src/tool-runtime.ts:609`).

## 2. Servicio compartido, ubicación, permisos, plugins y credenciales (2.x)

- **Servicio compartido**: un proceso por usuario que se anuncia en un archivo de registro (`url`, `pid`, `version`, `password`) bajo XDG de estado
  (`v2:packages/client/src/service.ts:11-56`), escrito atómicamente con modo `0600` (`v2:packages/cli/src/services/service-registration.ts:39`); el cliente reinicia por `version-mismatch` (`service.ts:25`).
- **Ubicación**: cada petición elige carpeta con `location[directory]` o la cabecera `x-opencode-directory`; si falta, `process.cwd()` (`v2:packages/server/src/location.ts:73-77`).
  `Location` = `{ directory, workspaceID?, project{id, directory, canonical} }` (`v2:packages/schema/src/location.ts:20-28`; `core/src/location.ts:18-31`). Los servicios por carpeta
  (Shell, Permission, Tool) son «location nodes»; Job y SubagentJob son globales (`job.ts:491`, `subagent-job.ts:72-76`).
- **Permisos**: `evaluate(action, resource, ...rulesets)` = última regla que casa por comodín, por defecto `ask` (`v2:packages/core/src/permission.ts:74-84`).
  Orden: reglas del agente + de la sesión; si alguna `deny` → denegado; si no, se suman las «guardadas» (`allow`) (`:135-176`). El gancho `permission.evaluate` puede cambiar el efecto (`:166-174`).
  `reply`: `reject` falla ese pedido **y todos los pendientes de la misma sesión** (con `message` → `CorrectedError` con la corrección) (`:267-288`); `once` solo suelta ese;
  `always` guarda `save[]` **en la base, por proyecto** (`saved.add({projectID…})`, `:290-297`) y libera los pendientes que ahora pasan (`:299-312`).
  En 1.19 `always` vive **en memoria de la instancia** (`v119:packages/opencode/src/permission/index.ts:143-166`). Cambio importante para Lazunox: en 2.x un «siempre» sobrevive reinicios y afecta a todas las sesiones del proyecto.
- **Plugins v2**: `{ id, setup(ctx) }` que devuelve limpieza opcional (`v2:packages/plugin/src/promise/plugin.ts:59-66`). `ctx` trae `location`, `tool`, `shell`, `permission`, `session`, `mcp`,
  `credential: Pick<…, "activate">` (solo activar, no leer), `storage`, `rpc`… (`:26-56`). Ganchos: `ctx.tool.hook("execute.before", e)` con `e.input` mutable (`promise/tool.ts:38-46`);
  `ctx.shell.hook("create.before", e)` con `command`, `cwd`, `timeout`, `shell`, `env` mutables (`promise/shell.ts:3-15`); `ctx.permission.hook("evaluate")` y `assert` (`promise/permission.ts:20-31`).
  `shell.create.before` es el sustituto de nuestro `shell.env` (`lazunox-env.js`).
- **Credenciales**: tabla SQLite `credential` (`v2:packages/core/src/credential/sql.ts:5`) con el valor en JSON; no vi cifrado (`core/src/credential.ts:79`, `:137-142`). Coincide con el spike: ya no hay `auth.json` ni `OPENCODE_AUTH_CONTENT`.

## 3. Qué portar y qué hacer en Lazunox

Licencia: **MIT**, `Copyright (c) 2025 opencode`, idéntica en ambas copias (`LICENSE`, 21 líneas); `packages/codemode` y `packages/core` declaran `"license": "MIT"`. No hay `NOTICE` ni cabeceras
de copyright por archivo. Si copiamos código hay que conservar el texto de la licencia MIT con ese copyright (p. ej. `THIRD-PARTY-NOTICES` o cabecera en los archivos portados) y,
si va `acorn`, su licencia MIT. El README de Code Mode cita a Cloudflare solo como idea, no hay código suyo.

### 3.1 Subagentes en segundo plano — **no portar: encender la variable en 1.19**

- Motor: añadir `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` (y nada más) al entorno del sidecar. Coste en motor: 0 líneas.
- Lo que falta está en **Lazunox (Electron)**: lista de trabajos de fondo por sesión (las hijas se ven por `parentID`; el resultado llega como mensaje con parte `synthetic`),
  botón «mandar al fondo» → `POST /experimental/session/{id}/background`, botón cancelar (abortar la sesión hija), mostrar los permisos que pidan las **sesiones hijas**.
- Si algún día hiciera falta la versión 2.x: `job.ts` (491) + `subagent-job.ts` (76) + `subagent-completion.ts` (46) + `restart.ts` (240) + `subagent.ts` (311) ≈ 1 160 líneas,
  pero arrastran `Session.synthetic`/buzón (`session/inbox.ts`, 559), `KV`, `effect` 4 y la capa de nodos `@opencode/util/effect/app-node`. No compensa: la única ganancia real es sobrevivir a reinicios.

### 3.2 Shell en segundo plano — **reimplementar en Lazunox**, no en el motor

1.19 no lo tiene. Portarlo al motor exigiría compilar y firmar **nuestro propio binario** de OpenCode (bun, por plataforma) y mantener un fork:
`shell.ts` de 2.x (473) depende de `Environment`, `SessionEnvironment`, `ShellSelect`, `FileRetention`, `PluginHooks`, `Bus`, `Location` y del `Job` de 2.x; la herramienta (293) del parser wasm.
Sobre 1.19 sería más corto (reusar `BackgroundJob.start/wait` de `v119:packages/core/src/background-job.ts` + archivo de salida + aviso como en `task.ts:226-265`): **~250-400 líneas**, más el fork.

Mejor en Lazunox: un servidor MCP propio (como los de `computer`/`browser`) con `shell_start`, `shell_status`, `shell_output(cursor)`, `shell_stop`, que lance el proceso **dentro del mismo
sandbox Seatbelt/WSL** de la sesión, con:

- salida a archivo en `userData` con tope de tamaño y retención (copiar la idea de `shell.ts:30-34`, `:91-114`);
- tiempo máximo por defecto también en segundo plano (2.x no pone ninguno) y matar el **grupo de procesos** al parar el sidecar, cerrar la sesión o la app;
- aviso de fin: al terminar, Lazunox envía un `prompt_async` con texto marcado (formato `<shell id state command>` de `shell/result.ts:45-62`) a la sesión dueña, o solo una notificación en la UI si la sesión está cerrada;
- permiso: el comando pasa por la misma clasificación que `bash` (no menos estricta), y por la puerta del plan (su nombre MCP no estará en `PLAN_GATE_ALLOWED_TOOLS`).
  Ventaja: funciona igual en 1.19 y en 2.x, y no depende de contratos experimentales.

### 3.3 Code Mode — **encender la variable en 1.19 para pruebas; no portar el de 2.x**

- 1.19 ya trae el intérprete y la integración solo-MCP, con permiso y `tool.execute.before` por cada llamada (ver 1.4). Coste en motor: 0 líneas (`OPENCODE_EXPERIMENTAL_CODE_MODE=true`).
- No portar `codemode` 2.x (≈11 000 líneas + `codemode/tool.ts` 365 + `catalog.ts` 188 + `instructions.ts` 141): lo nuevo útil es OpenAPI y catálogo mejor, y lo peligroso es `fetch` sin permiso.
  Si alguna vez se porta, **quitar la extensión `web`** o envolver `fetch` en `permission.assert` + gancho.
- En Lazunox: tarjeta de la herramienta `execute` que muestre `metadata.toolCalls` (lista de llamadas anidadas con estado, `v119:…/code-mode.ts:216-218`), y revisar la tarjeta de permiso (el permiso es la clave MCP).

## 4. Orden recomendado y riesgos de seguridad

1. **Subagentes en segundo plano (1.19 + variable)** — primero; menor coste.
   Riesgos: (a) gasto sin control: no hay tope de subagentes simultáneos, solo profundidad 1 (`v119:…/task.ts:111`); poner límite en Lazunox. (b) el resultado del hijo entra al padre como texto
   y **despierta un turno nuevo** sin humano: es un canal de inyección de prompt; en Tareas debe pasar por la misma puerta del plan. (c) interrumpir al padre no cancela los de fondo: hace falta cancelar explícito y al cerrar la sesión.
   (d) permisos que piden sesiones hijas cuando el usuario ya no mira: el modo automático no debe aprobarlos solo (`task` ya está en `NEVER_ALONE_PERMISSIONS`, `src/main/tasks/auto-mode.ts:278-286`).
   (e) **verificar** que `lazunox-plan-gate` resuelve el plan de una sesión hija (consulta `/plan-status?session=<id>` con el id de la hija). (f) en 1.19 los trabajos viven en memoria: reiniciar el sidecar los pierde sin aviso.
2. **Code Mode (1.19 + variable)**, solo detrás de un ajuste y tras probar.
   Riesgos: sin `timeoutMs` ni `maxToolCalls` (nadie los fija): un script puede encadenar cientos de llamadas MCP; el «siempre» de un permiso MCP pedido desde Code Mode usa `always: ["*"]` (aprueba esa herramienta entera).
   A favor: cada llamada anidada pasa por `tool.execute.before` (la puerta del plan las ve) y no hay red directa. Corre dentro del proceso del motor (intérprete sin `eval`), sin aislamiento de proceso propio: el sandbox de Tareas sigue siendo la barrera real.
3. **Shell en segundo plano (Lazunox, MCP propio)** — el más caro y el más sensible.
   Riesgos: procesos huérfanos que sobreviven a la sesión/app; salida que llena disco; procesos de red de larga vida (servidores dev) fuera de la vista; secretos en el entorno (aplicar el mismo filtro que `lazunox-env.js`);
   y que el resultado vuelva al modelo como texto (inyección). Exigir sandbox, tope de tiempo y tamaño, y botón «parar todo».

Ninguna de las tres exige migrar a 2.x. Lo que sí cambiaría al migrar (además del spike): `always` persistente por proyecto, `fetch` de Code Mode y el servicio compartido por usuario.

## 5. Límites de este análisis

- No se ejecutó nada: que las variables de 1.19 funcionen de punta a punta está **sin probar**. Siguiente paso: probarlas con la app real por CDP y el modelo gratuito, en Mac y Windows.
- Leí los archivos citados, no todo el repo (2.x es grande); el detalle del buzón (`session/inbox.ts`) y del demonio PTY lo revisé solo por encima.
- Tamaños en líneas = `wc -l` de los archivos citados.
