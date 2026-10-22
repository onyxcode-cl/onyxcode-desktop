# Spike: OpenCode 2.x ejecutado de verdad (aislado)

Fecha: 2026-10-22. Autorizado por Ben en el chat. Complementa `docs/INVESTIGACION-OPENCODE-2.md` (que no ejecutó nada). Todo se hizo en un directorio temporal
con `env -i`, HOME/XDG_* propios, 127.0.0.1 y puertos altos; sin tocar datos reales, sin claves propias. Las únicas llamadas de red fueron la bajada de npm y UNA
llamada de prueba (prompt de una línea) al modelo gratuito `opencode/deepseek-v4.1-flash-free` con la clave pública que trae el propio catálogo.

## 0. Qué se bajó (fuente oficial: npm)

| Paquete | Versión | Tamaño | Integridad |
| --- | --- | --- | --- |
| `@opencode/cli` (lanzador; instala el comando `opencode` y `opencode2`; `postinstall` copia el binario de la plataforma) | 2.1.3 | 2 939 B (tgz) | `sha512-9gS4ZV4w/DtUFwbYs9AK7P293+AoCx7ED/Sq5A8Mu1xRVYSXMRljXPdF3+Ikl60UyxjFf0JS/UkDZe4BhivKYw==` (coincide con el registro) |
| `@opencode/cli-darwin-arm64` (el binario) | **2.1.2** (la 2.1.3 de la plataforma aún no estaba publicada; el lanzador 2.1.3 la pide) | tgz 85 928 686 B; binario 188 895 056 B | `sha512-H8Nx7ksbHpd5u0Q9BQMj2Mt5vs+dC/t3AslxrmJDY5TZbPyHt6OKJ5TMJc6nQZAFKPrVFGOA+TdzQ9tU5qt6Sg==` (coincide); sha256 del tgz `88e5fa8d8e29354308350c5ed7842e23f63c0b4e4594cd8f91b0ca006b7da224` |
| `@opencode/plugin` (solo tipos, leído) | 2.1.2 | | |

URL: `https://registry.npmjs.org/@opencode/cli-darwin-arm64/-/cli-darwin-arm64-2.1.2.tgz`. Paquetes por plataforma: darwin-arm64/x64(+baseline), linux x64/arm64 (+musl, +baseline), windows x64/arm64(+baseline).
**No hay binarios en GitHub Releases de v2** (solo 1.x; `v2.1.2`/`v2.0.0` sin release) y el tap Homebrew `anomalyco/tap/opencode-v2` no se pudo leer. Para fijar un pin hay que usar los tarballs de npm (integridad sha512 publicada), no zips de GitHub como hoy.

## a) Servidor por carpeta, puerto, auth, CORS, servicio compartido

- `opencode serve --port N --hostname 127.0.0.1 [--cors ORIGEN]... [--service] [--stdio]`. Sin `--service` es un servidor normal de un proceso: **no usa ni escribe el registro del servicio compartido** (`opencode service status` siguió en `stopped`; no apareció ningún archivo de registro en XDG_STATE/HOME).
- Dos servidores con distinto cwd, HOME y XDG, en puertos distintos, **conviven aislados**: cada uno con su `opencode.db`, sus sesiones y su contraseña (la contraseña del A da 401 en el B).
- Los flags `--standalone`/`--server URL` son de la CLI/TUI (`run`, `api`, `reload`...) para NO usar el servicio de fondo. `opencode service set/get/unset` configura el servicio (el cliente respeta `disabled`). Para Lazunox basta con no pasar `--service`.
- Auth: HTTP Basic, **usuario fijo `opencode`**, contraseña `OPENCODE_PASSWORD` u `OPENCODE_SERVER_PASSWORD`. **`OPENCODE_SERVER_USERNAME` se ignora** (con `lzx` daba 401). Sin credenciales: `/api/*` responde 401 JSON; cualquier ruta fuera de `/api` (`/`, `/doc`, `/health`, `/global/health`) devuelve el HTML de la app web (sin datos) con 200 y sin auth.
- CORS: `--cors` funciona (preflight 204 con `access-control-allow-origin` solo del origen permitido; origen ajeno sin cabeceras).
- El directorio de trabajo ya no va en `?directory=`: es `?location=...` (59 rutas lo aceptan) o el cwd del proceso; `POST /api/session` acepta `location:{directory}`, `agent`, `model:{id,providerID}` y `permissions:[{action,resource,effect}]` por sesión. Un solo servidor sirve varias carpetas, pero para el aislamiento de Tareas se sigue lanzando un proceso por carpeta.

## b) OpenAPI y rutas

- `GET /openapi.json` (con auth) -> OpenAPI 3.1, "opencode HttpApi", 281 KB, **144 operaciones, todas `/api/*` salvo `GET /auth/connect/{code}`**. `/doc` y `/api/doc` ya no existen (`/doc` devuelve HTML). `scripts/check-opencode.mjs` que mide `/doc` hay que cambiarlo.
- Comparación con `resources/opencode-bin/api-routes.json` (188 rutas 1.x): **solo 46 coinciden exactamente (todas ya existían en 1.19 como `/api/*`)**; ninguna de las 45 rutas heredadas que usa Lazunox existe en 2.x (`/session`, `/global/event`, `/global/health`, `/permission`, `/question`, `/config/providers`, `/auth/{id}`, `/file*`, `/find/file`, `/vcs/diff/raw`, `/mcp`, `/global/dispose`, `/experimental/session`...).
- Equivalencias por nombre (las marcadas OK se probaron; el resto se infiere del OpenAPI y NO se probó):
  - sesiones: `POST/GET/PATCH/DELETE /api/session[/{id}]` OK (lista paginada con cursor `{data,cursor}`); `prompt_async` -> `POST /api/session/{id}/prompt` (responde 200 con el mensaje de usuario y sigue en segundo plano; `delivery`: steer/...) OK; `abort` -> `POST .../interrupt`; `fork` -> `.../fork`; `summarize` -> `.../compact`; `revert/unrevert` -> `.../revert/stage`, `.../revert/commit`, `DELETE .../revert`; `/session/status` -> `GET /api/session/active`; `/message` -> `GET .../message` (OK, otro modelo: lista de ítems tipados `user|assistant|shell|idle`, con `content[]` de `text|reasoning|tool`, `finish`, `tokens`); `todo`/`children` no tienen ruta propia (hijos por `?parentID=` en la lista); `command` -> `.../command`; `shell` -> `.../shell` (nuevo).
  - eventos: `/global/event` -> `GET /api/event` (SSE) OK.
  - permisos: `GET /permission` -> `GET /api/permission/request` OK; `POST /permission/{id}/reply` -> `POST /api/session/{sid}/permission/{rid}/reply` con `{decision:"once"|"always"|"reject", message?}` OK (**ahora hace falta el sessionID**; antes `once|always|reject` en otra forma); guardados: `/api/permission/saved`; preguntas (`/question`) -> formularios `GET /api/form`, `POST /api/session/{sid}/form/{formID}/reply`.
  - config/proveedores: `/config` -> `GET /api/config` devuelve las FUENTES de config (lista de `directory`/`document`), no la config efectiva; `/provider` -> `GET /api/provider` y `/api/model` (+`/api/model/default`); `/auth/{id}` PUT -> `POST /api/integration/{id}/connect/key {key}` OK (204) y `GET/PATCH/DELETE /api/credential`; OAuth -> `/api/integration/{id}/connect/oauth[...]`.
  - otros: `/agent` -> `/api/agent` OK; `/skill` -> `/api/skill` OK; `/command` -> `/api/command` OK; `/mcp` -> `GET /api/mcp` OK y `PUT/POST /api/experimental/mcp/{server}[/connect|disconnect]`; archivos -> `/api/fs/list|read/*|find`, `POST /api/experimental/fs/write`; git -> `/api/vcs/*`; `/global/dispose` -> `POST /api/location/reload` (204, recarga plugins/config en caliente; OK); salud/versión -> `GET /api/info` `{version,pid,urls,paths,capabilities}` OK.
- Hay un `GET /api/session/{id}/diff` y `GET /api/vcs/diff`; no se comparó con `/vcs/diff/raw`.

## c) Eventos y permisos

SSE `GET /api/event`: cada mensaje `data: {id,created,type,location:{directory},data,durable?}`; primero `server.connected`; latido `: heartbeat`. Tipos vistos en una sesión real con una herramienta: `session.created`, `project.updated`, `session.inbox.enqueued|delivered`, `session.execution.started|succeeded`, `session.step.started|streamed|ended`, `session.reasoning.started|delta|ended`, `session.text.started|delta|ended`, `session.tool.input.started|input.ended|called|progress|success`, `session.usage.updated`, `session.instructions.updated`, `shell.created|exited`, `session.shell.started|ended`, `permission.asked`, `permission.replied`; en el servidor también `provider.updated`, `model.updated`, `agent.updated`, `command.updated`. (Según el changelog `session.compacted` desaparece; no se provocó.) No hay `message.part.updated` ni `session.status`/`session.idle` de 1.x: el estado sale de `session.execution.*` y del mensaje `idle`.
Permiso: `permission.asked` -> `{id:"per_...",sessionID,action:"shell",resources:["echo spike-ok"],save:["echo *"],source:{type:"tool",messageID,id:callID}}`; se responde por la ruta de arriba y llega `permission.replied`. **Cambian los nombres de acción: `bash` -> `shell`, `task` -> `subagent`** (visto en `/api/agent/tasks`: la `permission:` de nuestros agentes se tradujo a reglas `[{action,resource,effect}]`; `bash`->`shell`, `task`->`subagent`, y apareció una regla `browser: deny`). La herramienta del modelo se llama `shell` (no `bash`).

## d) Agentes, skills, plugins

- `resources/opencode/agents/{chat,tasks,computer}.md` **cargan tal cual** con `OPENCODE_CONFIG_DIR` (aparecen como agentes `chat`, `tasks`, `computer`, con el prompt completo, `temperature` y `permission:` traducido). Los de `agents-win/` no se probaron.
- Skills `docx, pdf, pptx, xlsx, ruta-rapida, soporte-remoto` (con `SKILL.md`) **cargan tal cual** desde `OPENCODE_CONFIG_DIR/skills` (`GET /api/skill`; se añaden dos skills internas `opencode` y `report`). `_shared` (sin SKILL.md) no aparece, como en 1.x.
- Plugins: el formato 1.x `export default { id, server: async () => ({ 'shell.env', 'tool.execute.before' }) }` (así son `lazunox-env`, `lazunox-session`, `lazunox-plan-gate`) **se descubre en `plugins/*.js` pero FALLA al cargar**: `Plugin must export a default definition with an id and an effect or setup function`. El servidor arranca igual y solo deja el plugin en `state:"failed"` en `GET /api/plugin` y un WARN en el log -> **la puerta del plan (`lazunox-plan-gate`) quedaría sin cargar en silencio (fail-open)** si se migra el pin sin reescribirla. Hay que comprobar `GET /api/plugin` y negarse a arrancar si no está `active`.
- Plugin v2 (`export default { id, setup(ctx) {...} }`) **carga y funciona**: `ctx.tool.hook('execute.before', fn)` se dispara con `{tool:"shell",sessionID,agent}` (la entrada es mutable; bloquear lanzando error NO se probó), `ctx.shell.hook('create.before', fn)` recibe `{command,cwd,timeout,shell,env}` (`env` editable; el proceso del plugin ve el `process.env` del servidor, incluida `OPENCODE_SERVER_PASSWORD`), `ctx.permission.hook('evaluate', fn)` recibe `{sessionID,agent,action,resources,effect}` (con `effect` modificable: sitio natural para la puerta del plan) y `ctx.permission.assert`. Recarga en caliente con `POST /api/location/reload`. El gancho `tool.execute.before` NO se dispara para `POST /api/session/{id}/shell` (ejecución directa del usuario, no es herramienta).

## e) Sandbox Seatbelt (solo lectura del perfil, no se ejecutó)

`src/main/tasks/sandbox-profile.ts` es `(allow default)` + denegaciones; escritura permitida en la carpeta, `userData/tasks-sandbox/<hash>` (XDG_* y TMPDIR) y `/private/tmp`, `/private/var/folders`; red solo a puertos permitidos. v2 con HOME y XDG propios no escribió nada fuera de ellos (HOME quedó vacío); lo único externo es `/private/tmp/opencode` (`paths.tmp` de `/api/info`, ya permitido y que ya existía). La base de datos pasa a `$XDG_DATA_HOME/opencode/opencode.db` (SQLite) y **las credenciales ya no están en `auth.json`** sino en esa base (`/api/credential`): la denegación de lectura de `~/.local/share/opencode` sigue cubriendo la del usuario. Cambios necesarios: (1) `OPENCODE_AUTH_CONTENT` **no existe en v2** (no aparece en el binario): la clave centinela hay que sembrarla con `POST /api/integration/{id}/connect/key` tras arrancar (o con `providers.<id>.settings.apiKey` en la config, que SÍ se aceptó junto a `baseURL`: el proveedor `anthropic` apareció con `apiKey:"sentinel"` y `baseURL` local); (2) catálogo de modelos: sigue `OPENCODE_MODELS_PATH`/`OPENCODE_DISABLE_MODELS_FETCH`; no se verificó el sembrado de `bin/rg` (en v2 el caché `bin/` quedó vacío); (3) ningún permiso TCC nuevo observado.

## f) Variables de entorno

Presentes en el binario v2 y respetadas: `XDG_*` (confirmado con `opencode debug paths`), `OPENCODE_CONFIG_DIR` (confirmado), `OPENCODE_CONFIG_CONTENT` (confirmado), `OPENCODE_CONFIG`, `OPENCODE_PASSWORD` / `OPENCODE_SERVER_PASSWORD` (confirmado), `OPENCODE_DISABLE_AUTOUPDATE`, `OPENCODE_DISABLE_MODELS_FETCH`, `OPENCODE_MODELS_PATH`, `OPENCODE_DISABLE_PROJECT_CONFIG`, `OPENCODE_DISABLE_CLAUDE_CODE(_SKILLS)`. **Ausentes/ignoradas**: `OPENCODE_SERVER_USERNAME` (usuario fijo `opencode`), `OPENCODE_AUTH_CONTENT`, `OPENCODE_DISABLE_EXTERNAL_SKILLS`. El motor limpia `OPENCODE_PASSWORD`/`OPENCODE_SERVER_PASSWORD` del entorno de ciertos hijos (función `zD` en el bundle), pero el hook `shell.create.before` los vio visibles en el shell: mantener el scrub propio.

## g) Config (`opencode.json`)

La config 1.x inline por `OPENCODE_CONFIG_CONTENT` **se acepta y se normaliza a la forma v2** (visto en `GET /api/config`): `autoupdate:false`->`update:"disable"`, `permission.bash`->`permissions[{action:"shell",...}]`, `agent`->`agents`, `provider.X.options.{baseURL,apiKey}`->`providers.X.settings`, `mcp.X`->`mcp.servers.X` (`enabled:false`->`disabled:true`). Compatible lo que Lazunox genera en `buildInlineConfig`; faltaría probar el resto (MCP locales con `environment`, `instructions`, etc.).

## h) Tamaño y arranque

Binario darwin-arm64 188,9 MB (1.19.0: 144,4 MB, +31 %); paquete de descarga 85,9 MB (el zip 1.x era 45,6 MB). Arranque en frío (HOME/XDG vacíos, 53 migraciones SQLite): `serve` responde `/api/info` en ~0,14 s (primer `--version` ~2,6 s por verificación de macOS); RSS ~196 MB tras arrancar y ~295 MB tras unas llamadas. No se comparó con 1.19 en la misma máquina.

## Veredicto: VIABLE CON CAMBIOS (no es un bloqueador técnico)

Lo bueno: servidor por proceso aislable sin el servicio compartido, agentes y skills cargan tal cual, config 1.x se acepta, permisos y SSE son más simples, existe API de plugins con ganchos suficientes.
Cambios obligatorios: (1) capa de datos completa (rutas, paginación, modelo de mensajes y eventos); (2) reescribir y re-auditar los tres plugins con `setup(ctx)`, y verificar `/api/plugin` al arrancar (fallo silencioso hoy); (3) credenciales sin `AUTH_CONTENT` ni usuario configurable (cambia `server.ts`, `sandbox.ts`, `engine-registry`, `policy.ts` remoto, `key-probe`); (4) nombres de permisos/herramientas (`bash`->`shell`, `task`->`subagent`, plan-gate y listas del remoto); (5) pin desde npm (tarball por plataforma, y la 2.1.3 del lanzador sin su paquete de plataforma); (6) `check-opencode` sobre `/openapi.json`; (7) fake de E2E nuevo. Riesgo: v2 sigue cambiando contratos (2.1.0 el 20-oct).
Estimación revisada: de 12-18 a **~9-13 semanas-persona** (ya no hay duda sobre aislamiento, agentes/skills ni config), con la reescritura de seguridad (plugins, remoto, credenciales) como parte más cara. Sigue siendo razonable esperar a que 2.x estabilice contratos antes de empezar la etapa 2.

## Pendiente / no probado

Bloquear una herramienta lanzando desde `execute.before`; que `permission.evaluate` con `effect:"deny"` bloquee; agentes de Windows; MCP reales; `session.compaction.*`; revert/fork/compact; rendimiento comparado; migración de sesiones 1.x (`GET /api/experimental/migration/v1` existe, sin probar); WSL/Windows; la clave pública del modelo gratuito se usó solo para una llamada de prueba.
