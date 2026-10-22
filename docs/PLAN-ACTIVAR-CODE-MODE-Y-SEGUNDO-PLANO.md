# Plan: activar Code Mode y subagentes en segundo plano (motor 1.19) con ajustes por modo

Fecha: 2026-10-22. Rama `feat/engine-client`. **Solo plan**: no se tocó código. Parte de `ANALISIS-OPENCODE-2-FUNCIONES.md` (§0, §3.1, §3.3, §4) y
`DISENO-SEGUNDO-PLANO.md` (§3.1, §3.3). Todo lo que sigue sale de leer el código; nada está probado de punta a punta.

Variables (solo estas dos; **nunca** `OPENCODE_EXPERIMENTAL` a secas, que enciende todas):
`OPENCODE_EXPERIMENTAL_CODE_MODE=true` y `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`.

## 0. Hallazgo que condiciona todo el diseño

- Una variable de entorno vale **por proceso**. Chat y Code comparten UN solo sidecar (`src/main/index.ts:110`, `new OpencodeServer({ chatDirectory, corsOrigins })`):
  no se puede encender en Code y apagar en Chat con solo el entorno.
- Lo que sí separa Chat de Code es el **agente**: `chat` tiene `'*': deny` (`src/main/opencode/config.ts:220-232`), así que ni `task` ni la herramienta `execute`
  de Code Mode (permiso = clave MCP) le llegan. Code usa los agentes normales de OpenCode. En Overdrive, `tasks.md:15` tiene `task: allow` y `"*": allow`
  (el sandbox es la barrera), y `computer.md:21` tiene `task: deny` (Control total con plan: los subagentes no existen para él).
- Consecuencia: «Chat» como valor propio solo tiene efecto real si además se le abre `task` en el agente `chat` (cambio en `config.ts`, que NO es zona intocable,
  pero cambia el diseño «Chat no tiene herramientas»). Propuesta: el ajuste de Chat existe en el modelo de datos pero se muestra «no aplica: Chat no usa herramientas»
  hasta que Ben decida abrirlo (pregunta abierta P1). El sidecar principal se enciende si `chat || code`.

## 1. Dónde se lanzan los motores y cómo se arma el `env`

Hay cuatro familias de proceso `opencode serve`:

| Familia | Quién lo lanza | Archivo:línea | Cómo se arma el entorno |
| --- | --- | --- | --- |
| Sidecar principal (Chat + Code, y Rutinas que no son de Overdrive: `scheduler/service.ts:879` usa `getMainConnection`) | `OpencodeServer.spawnAndWait` | `src/main/opencode/server.ts:136-181` | `childEnv = minimalEnv({...getOpencodeEnv(), ...appOpencodeConfigEnv(), OPENCODE_SERVER_*, OPENCODE_CONFIG_CONTENT})` en `:166-172`; `spawn` en `:173`. `minimalEnv` (`src/main/process/child-env.ts`, `:147`) copia solo una lista blanca del sistema (`ALLOWED`, `:14-40`) y luego aplica `extra`, que **puede añadir cualquier clave**. |
| Overdrive «Solo en tu carpeta» (Seatbelt en Mac, WSL2 en Windows) | `startTasksServer` ← `TasksManager.spawn` | `src/main/tasks/sandbox.ts:133`; `manager.ts:1015-1065` | `baseEnv` (`sandbox.ts:250-256`: `getOpencodeEnv()` + usuario/clave + `LAZUNOX_TASKS_FOLDER`) + `proxyEnv` + `extraEnv`. `extraEnv` lo arma `manager.ts:1049-1065` (`OPENCODE_CONFIG_CONTENT`, `OPENCODE_WEBSEARCH_PROVIDER`, `OPENCODE_DISABLE_EXTERNAL_SKILLS`). Se funden en `backends/seatbelt.ts:66` (`{...baseEnv, ...sandboxEnv, ...proxyEnv, ...extraEnv}`) y `backends/spawn.ts:15` (`minimalEnv`). |
| Overdrive «Control total» (sin sandbox, agente `computer`, con plan-gate) | misma ruta, `noSandbox: true` | `manager.ts:1034` + `backends/none.ts:11` (`{...baseEnv, ...extraEnv}`) | Igual; `extraEnv` añade `LAZUNOX_FULL_ACCESS` y `LAZUNOX_PLAN_GATE_URL` (`manager.ts:1052-1056`). |
| WSL en Windows (Overdrive sandbox) | `backends/wsl.ts:95` → `buildWslInit` → `resources/wsl/launcher.py` | `wsl-spec.ts:278` (`ENV_ALLOWED`: acepta `OPENCODE_[A-Z0-9_]+`), `:355-363` (filtra), `resources/wsl/launcher.py:372-396` (`env.update(init["env"])`) | Las dos variables **pasan sin cambiar el filtro** (empiezan por `OPENCODE_`, tope 32 KiB). Aun así hay que verificar que el binario Linux del pin (`opencode-linux-x64.tar.gz`, `win-provider.ts:65`) las trae (`grep -a`); hoy solo se comprobó el de macOS. |
| OpenCode falso de e2e | `e2e/lib/launch.ts:152-154` (copia `opencode` + `server.mjs`); `LAZUNOX_TEST_BUNDLED_DIR` en `server.ts:317-335` | `e2e/fake-opencode/server.mjs` | Entra por la misma ruta de arriba (el falso es el `bin`). Lee `env` en `server.mjs:112`; hoy no conoce ninguna de las dos variables. |

**Dónde añadir las dos variables (sin tocar zonas intocables):**

1. Archivo nuevo `src/main/opencode/engine-flags.ts` (puro, probado): `engineFlagsEnv(family: 'main' | 'tasks', settings): Record<string,string>`
   devuelve `{}` o `{ OPENCODE_EXPERIMENTAL_CODE_MODE: 'true', ... }` según la tabla de §2. Una sola fuente de verdad.
2. Sidecar principal: en `server.ts:166` añadir `...engineFlagsEnv('main', settingsStore.get())` dentro del objeto de `minimalEnv`. Sin riesgo de zona.
3. Overdrive: NO en `getOpencodeEnv()` (`opencode-config.ts:317`, zona intocable y compartida con el sidecar). Mejor en `manager.ts:1049`, dentro de `extraEnv`,
   un spread `...engineFlagsEnv('tasks', ...)`. **RIESGO**: `manager.ts` es parte de la zona «puerta del plan» (AGENTS.md §7); el cambio es una línea
   ajena al plan-gate, pero debe ir en commit propio y revisado por Ben. Alternativa sin tocar `manager.ts`: que `TasksManager` reciba
   una función `opts.engineEnv` inyectada desde `index.ts` (igual que `opts.corsOrigins`); aun así hay que pasar por `spawn()`.
4. WSL y Seatbelt no necesitan cambios (ya reenvían `extraEnv`). El e2e cubre que `GET /__e2e/env` del falso vea las variables (§5).
5. El sandbox **no puede cambiarse en caliente**: variables nuevas = servidor nuevo.

## 2. Persistencia de los ajustes y propuesta

Estado actual: `Settings` en `src/shared/types.ts:13-45` (+ `DEFAULT_SETTINGS`), guardado por `src/main/store.ts` (`userData/settings.json`, escritura atómica, `normalize()` en `:55-84`),
IPC `settings:get|set` (contrato `src/shared/ipc.ts:118-120`, canales `:174-176`; esquema `partial({...})` en `src/main/ipc/schemas.ts:614-626`; handler `src/main/ipc/settings.ts`),
clase para el celular en `src/main/remote/policy.ts:186-201` (`SETTINGS_FIELDS`; un campo no listado o `X` rechaza TODA la llamada), i18n `src/shared/i18n/{es,en}/settings.ts`
(y `tasksSettings.ts`), claves de la PWA en `src/renderer/remote/i18n-core-keys.json` (se regenera con `UPDATE_PWA_I18N=1 npx vitest run src/renderer/remote/i18n-core.test.ts`).
Precedente de mapa por modo: `modelsByMode` en `extras.json` (`src/main/extras/prefs.ts:12-35`, clase `M` en `policy.ts:204`).

**Propuesta**: un campo `engineExperiments` en `Settings` (no en `extras.json`: afecta al arranque del motor, igual que `opencodeBin`):

```
engineExperiments: { codeMode: ModeFlags; backgroundSubagents: ModeFlags }   // ModeFlags = { chat: boolean; code: boolean; tasks: boolean }
```

- Por defecto **todo `false`** (`DEFAULT_SETTINGS`). `normalize()` fuerza booleanos y descarta claves raras. Se enciende solo cuando la prueba de seguridad (§5 P6) esté aprobada;
  mientras tanto la sección de Ajustes puede quedar oculta tras `src/shared/feature-flags.ts` (no es la zona de Windows: añadir una bandera nueva ahí es un cambio de una línea, pero ese archivo está en la lista de zonas, así que mejor una constante local en `engine-flags.ts`).
- Esquema IPC: `engineExperiments: obj({ codeMode: modeFlags, backgroundSubagents: modeFlags })` dentro del `partial` de `schemas.ts:614`, con claves estrictas.
- Clase remota: `engineExperiments: 'X'` en `SETTINGS_FIELDS` (el celular no enciende superficies de ataque). Añadir prueba en `policy.test.ts`.
- Sidecar principal: variable de Code Mode = `codeMode.chat || codeMode.code`; igual para subagentes. Overdrive: `.tasks`. Las Rutinas de Overdrive heredan `.tasks`.
- i18n (sin nombrar productos de terceros; `visible-terms.test.ts`): `settings.engine.codeMode` «Modo código», `settings.engine.bgSubagents` «Subagentes en segundo plano»,
  más descripción, «Reinicia el motor para aplicar», «No aplica a Chat» (si P1 = no), `settings.engine.title` «Funciones experimentales». Mismas claves en `en/`. Sección nueva
  en `SettingsView.tsx` (lista de secciones, `:133` como modelo) con `Toggle` de `settings/impl/ui`; archivo nuevo `EngineExperimentsSection.tsx`.

**Qué pasa al cambiar** (`settingsStore.onChange` ya existe, `settings.ts:13`): comparar antes/después **solo** de `engineExperiments` y, si cambió,
(a) sidecar principal: aviso «hay N sesiones en curso» y, con confirmación, `server.restart()` (`server.ts:96`, expuesto como `opencode:restart`);
(b) Overdrive: `restartSandbox(folder)` (`manager.ts:395`) para cada carpeta con servidor vivo (y los de Control total), solo si la familia `tasks` cambió, y solo cuando `serverIdle()` (patrón de `manager.ts:871`).
Nunca reiniciar a la mitad de un turno sin que la persona acepte: los trabajos de fondo de 1.19 viven en memoria y se pierden (análisis §4, riesgo f). Decidirlo en el momento: reinicio inmediato con aviso o «al terminar lo que está en curso».

## 3. Interfaz: qué ya muestra subagentes y qué falta

Ya existe:
- `ToolCard.tsx:386-398` (`case 'task'`): fila «Subagente <tipo>» con descripción, prompt y salida. Usa `code.tool.subagent`.
- `conversation-work.ts:206` y `:253`: resumen «N subagentes» (`code.n.subagent`, `es/code.ts:161`) en el plegable de trabajo (`WorkFold.tsx`).
- Permisos de hijas: `PermissionCard.tsx:23` y `PermissionCardDesk.tsx:35` (`task` → `code.perm.task`, «lanzar un subagente»); `rootSessionID` (`code/impl/store.ts:1621`) agrupa los permisos de hijas bajo la raíz; Telegram usa lo mismo (`telegram/messages.ts:23`).
- Overdrive: `sessionBelongsTo`/`permissionBelongsTo` (`tasks/impl/util.ts:173-185`) y `rootTaskId` (`tasks/impl/store.ts:637`) atribuyen hijas a su tarea. `SidebarSections.tsx:222` y los demás listados filtran `!parentID` (las hijas no salen como tareas).
- Uso: `usage-source.ts:30,96` pasa `parentID`; `usage-aggregate.ts:117` solo cuenta conversaciones raíz (los tokens de hijas sí suman).
- Monitor: `tasks/monitor.ts:361-388` resuelve la raíz por `parentID`; `:784` ignora hijas en el sondeo.

Cuidado: **`parentID` no equivale a «subagente»**. La «consulta lateral» de Overdrive también es sesión hija (`tasks/impl/actions.ts:1143-1156`, `parentID: side.taskId`).
Para listar trabajos de fondo hay que distinguir por el agente de la hija (`agent`, p. ej. `explore`/`general`) o por la parte `task` del padre, no solo por `parentID`.

Falta (propuesta): **«Trabajos en segundo plano»** = un componente nuevo y compartido, `src/renderer/src/features/code/impl/BackgroundJobs.tsx`
(reutilizable desde Overdrive porque ambos modos tienen el mismo SDK de sesiones), con un selector puro `selectBackgroundJobs(sessions, status, rootId)` en un archivo propio `background-jobs.ts`:
hijas vivas de la sesión (estado por `session.status`, ya en los stores), título, tiempo, tokens y botón **Cancelar** = `client.session.abort({ sessionID: hija })`
(mismo mecanismo que `abort` en `code/impl/store.ts:1013`; en Overdrive el equivalente en `tasks/impl/store.ts`). Dónde ponerlo: una banda sobre el Composer
(`Composer.tsx`) cuando hay ≥1 viva, y una línea en `SessionList.tsx`/`SidebarSections.tsx` («N en segundo plano») sin cambiar sus filtros. «Mandar al fondo» a mano
(`POST /experimental/session/{id}/background`, ya en `api-routes.json:136`) = botón opcional en la tarjeta `task` en curso (pregunta abierta P2); requiere exponerlo por `EngineClient`
(`src/shared/engine/`), no por IPC nuevo si el renderer ya habla con el motor por el SDK.
Para Code Mode: la herramienta `execute` hoy cae en el `default` de `ToolCard.tsx:399` (JSON crudo). Añadir `case 'execute'` que pinte `metadata.toolCalls` (lista de llamadas anidadas con estado).
Textos nuevos: `code.bg.title`, `code.bg.cancel`, `code.bg.running`, `code.tool.execute`, en es y en.

## 4. Efecto en seguridad (describir; no editar sin marcar riesgo)

- **`lazunox-plan-gate` (`opencode-config.ts:117-175`, ZONA INTOCABLE)**: solo está activo con `LAZUNOX_PLAN_GATE_URL`, es decir en Control total; en el sidecar principal y en el sandbox es no-op.
  Consulta `/plan-status?session=<id>` con el id de la sesión que llama (`:144`), y el servidor (`computer/service.ts:1038-1047`, `isPlanApproved` `:655`) responde `approvedPlans.has(id)`.
  Una **hija** nunca tiene plan aprobado propio → quedaría bloqueada (fail-closed) en todo lo que no sea `PLAN_GATE_ALLOWED_TOOLS` (`:63-75`). Hoy no se ve porque `computer.md:21` pone `task: deny`.
  Si algún día Control total permite subagentes, hará falta resolver la raíz de la hija al consultar el plan. **No proponemos editarlo**: es decisión de Ben. Tampoco `execute` (Code Mode) está en `PLAN_GATE_ALLOWED_TOOLS`: con plan aprobado pasa, y cada llamada anidada vuelve a pasar por `tool.execute.before` con clave MCP (análisis §1.4), lo cual es bueno.
- **`opencode-config.ts` en general**: el plugin `lazunox-env.js` oculta variables al shell (`HIDDEN_SHELL_ENV`, `:77-83`). Las dos variables nuevas no son secretas; no hace falta añadirlas. No editar este archivo.
- **`auto-approver.ts`/`auto-mode.ts`**: `task` está en `NEVER_ALONE_PERMISSIONS` (`auto-mode.ts:278-286`): el modo automático **no** aprueba subagentes solo; el permiso de la hija se resuelve a la raíz con `resolveRoot` (`auto-approver.ts:262-290`), y la persona lo ve en la tarjeta. Con `execute`, el permiso es la clave MCP completa con `always: ["*"]`: `classifyPermission` ya separa MCP por prefijo (`auto-mode.ts:265-275`); revisar que un «siempre» desde Code Mode no escale (prueba P6). Sin cambios de código previstos.
- **`monitor.ts`**: sigue ignorando hijas en el sondeo (`:784`); el aviso «terminó» del padre puede llegar antes de que acaben los de fondo, y el aviso de fin sintético **despierta** al padre (nuevo turno sin humano). Revisar que `done` no se notifique dos veces (P5).
- **Seatbelt** (`sandbox-profile.ts`, `sandbox.ts`: INTOCABLES): los subagentes y el intérprete de Code Mode corren **dentro del mismo proceso** `opencode serve`, que ya está sandboxeado: no abren procesos nuevos fuera del perfil ni cambian puertos. Sin cambios. Riesgos propios a probar: sin tope de subagentes simultáneos (solo profundidad 1), Code Mode sin `timeoutMs`/`maxToolCalls`, salida de hijas que vuelve al padre como texto (inyección). Mitigación en Lazunox: tope visible en `BackgroundJobs` y aviso; el resto es del motor.
- **Cierre**: interrumpir al padre no cancela los de fondo (análisis §4c). Al cerrar la sesión/app hay que abortar las hijas vivas (`killTree` ya mata el grupo del sidecar `server.ts:173`; para sesiones cerradas con el sidecar vivo, abortar hijas desde `BackgroundJobs`).

## 5. Paquetes de trabajo paralelizables (archivos disjuntos)

Reglas: máx. 1-2 agentes pesados a la vez; suites completas al VPS; cerrojo de build/E2E (AGENTS.md §3); `git add` por rutas.

| Paquete | Archivos (disjuntos) | Pruebas |
| --- | --- | --- |
| **P1 Datos y IPC** | `src/shared/types.ts`, `src/main/store.ts`, `src/shared/ipc.ts` (sin canal nuevo), `src/main/ipc/schemas.ts`, `src/main/remote/policy.ts` (+ sus tests) | `npx vitest run src/main/store*.test.ts src/main/ipc/schemas*.test.ts src/main/remote/policy*.test.ts`; typecheck |
| **P2 Variables de entorno** | nuevo `src/main/opencode/engine-flags.ts` + test, `src/main/opencode/server.ts:166`, `src/main/tasks/manager.ts:1049` (**RIESGO zona plan-gate: commit aparte**, Ben revisa) | `npx vitest run src/main/opencode/engine-flags.test.ts src/main/opencode/server*.test.ts src/main/tasks/manager.*.test.ts src/main/tasks/backends/wsl*.test.ts` (que el filtro WSL deje pasar y los snapshots no cambien) |
| **P3 Reinicio al cambiar** | `src/main/ipc/settings.ts` (listener), `src/main/index.ts` (cableado), prueba nueva | vitest del listener con `OpencodeServer` y `TasksManager` simulados (reinicia solo si cambió la familia y respeta `serverIdle`) |
| **P4 Ajustes (UI + i18n)** | nuevo `EngineExperimentsSection.tsx`, `SettingsView.tsx` (una entrada), `src/shared/i18n/{es,en}/settings.ts`, `src/renderer/remote/i18n-core-keys.json` si la PWA muestra la clave | `npx vitest run src/shared/i18n src/test/i18n-coverage.test.ts src/test/visible-terms.test.ts src/renderer/remote/i18n-core.test.ts`; render del componente |
| **P5 Lista de trabajos + `execute`** | nuevos `background-jobs.ts` y `BackgroundJobs.tsx`, `ToolCard.tsx` (`case 'execute'`), `Composer.tsx` (montaje), `i18n/{es,en}/code.ts`; equivalente Overdrive en `tasks/impl/` | vitest del selector (hijas vivas, excluye consulta lateral), render con `ToolCard`/`WorkFold`; E2E específica (abajo) |
| **P6 Prueba real y seguridad** | solo lectura/QA: guion CDP y checklist en el changelog | Ver «Prueba real» |

P1 antes que P2-P4 (tipos). P2, P4 y P5 corren en paralelo tras P1. P3 al final. El fake (abajo) es previo a la E2E de P5.

**Añadir al OpenCode falso** (`e2e/fake-opencode/server.mjs`, con pruebas en `server.test.mjs`):
- `GET /__e2e/env`: devolver también `flags: { codeMode, backgroundSubagents }` (booleanos leídos de `env.OPENCODE_EXPERIMENTAL_*`; nunca valores secretos) para comprobar que cada familia (principal, sandbox, Control total) recibió lo correcto.
- Paso `child` con `background: true` (`runChild`, `:689`): si `env.OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` no está, el paso falla como el real («background no disponible»);
  si está, crea la hija, completa la parte `task` del padre **de inmediato** (`status:'completed'`, salida «DO NOT sleep, poll…» y `metadata.sessionId`), sigue ejecutando la hija sin esperar
  (`delayMs`/`steps` propios) y, al acabar, inserta en el padre un mensaje con parte de texto `synthetic: true` (`<subagent sessionID=… state=…>texto</subagent>`) y lo **despierta** (nuevo turno con guion sticky).
- Ruta `POST /experimental/session/{sessionID}/background` (marca la hija como de fondo) y que `POST /session/{id}/abort` sobre una hija en marcha la cancele y emita el aviso `cancelled`.
- Opción `maxParallel` para simular muchos subagentes (probar el tope visible).
- Herramienta `execute` (Code Mode): paso `tool {tool:'execute'}` con `metadata.toolCalls:[{tool,status,input}]`, solo si la variable está; con permiso por llamada anidada (paso `permission` con `permission: '<clave MCP>'`, `always:['*']`) para probar `ToolCard` y las tarjetas de permiso.
- Reset (`POST reset`) limpia los trabajos de fondo.

**E2E específica** (`e2e/specs/segundo-plano.e2e.ts`, userData temporal, un solo worker, sin tocar datos reales): (1) sembrar `engineExperiments` en `settings.json` de `startApp()`, comprobar por `/__e2e/env` que el sidecar principal recibe solo las variables del modo encendido; (2) guion con subagente de fondo: aparece la banda `BackgroundJobs`, el padre sigue, llega el aviso sintético y se despierta el turno; (3) Cancelar aborta la hija; (4) cambiar el ajuste desde la UI reinicia el motor y reaparecen las sesiones; (5) con todo apagado, el paso `background` falla y la UI muestra el error sin colgarse. Para Overdrive: lo mismo con `tasks:start` y la copia del falso fuera de `userData` (`e2e/lib/lotes.ts:13-22`).

**Prueba real por CDP** (modelo gratuito, Mac y luego Windows por Tailscale; app de prueba con userData temporal, nada de `/Applications` ni datos de Ben): encender las dos funciones en Code y en Overdrive y comprobar de punta a punta lo que el análisis dejó **sin probar**:
(a) `execute` aparece y cada llamada MCP anidada pide permiso; (b) subagente de fondo devuelve control, el aviso de fin llega y despierta al padre; (c) permisos de la hija llegan a la persona y el modo automático no los aprueba; (d) en Control total, qué pasa con una hija ante `lazunox-plan-gate` (esperado: `task` denegado por `computer.md`); (e) reiniciar el sidecar con trabajos vivos; (f) Cancelar y cierre de sesión no dejan hijas ni procesos (`pgrep -fl "electron|opencode"`); (g) en WSL, que el binario Linux acepta las variables. Resultado en `CHANGELOG-FASE8.md` (ID `F8-B<n>`) y, si toca seguridad, `docs/SEGURIDAD.md`. Solo entonces se cambian los valores por defecto (decisión de Ben).

## 6. Preguntas abiertas para Ben

- P1: ¿Abrimos `task` en el agente `chat` (cambia «Chat no usa herramientas») o Chat queda como «no aplica»?
- P2: ¿Hace falta «mandar al fondo» a mano o basta lista + cancelar?
- P3: ¿Reiniciar el motor al instante (con aviso) o esperar a que terminen los turnos en curso?
- P4: ¿Aceptas tocar una línea de `manager.ts` (zona plan-gate) para Overdrive, o prefieres la función inyectada por `opts`?
- P5: ¿Tope de subagentes simultáneos por sesión? (propuesta: 4, aviso al pasar de 4; el motor no lo limita).
