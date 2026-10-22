# Análisis: ¿fork propio de OpenCode 1.19.x?

Fecha: 2026-10-22. Solo lectura. Código leído: `github.com/anomalyco/opencode`, tag **`v1.19.0`**, commit **`733b2c627e5aec39cb33cc22373bdce33053ef2c`** (2026-10-11), clon superficial en un directorio temporal (ya borrado). No se instaló, ejecutó ni compiló nada del repo. Es el mismo tag que `resources/opencode-bin/pin.json` (versión 1.19.0). Tags 1.x existentes: v1.19.0, .1, .2, .3 (`e3c4eb24…`); además existe `v2.0.0` (`63f7ceec…`).
Rutas abajo relativas a la raíz del repo clonado (`R/`). Lo que no pude comprobar sin ejecutar se marca «estimado» o «sin verificar».

## 1. Estructura del monorepo

Monorepo Bun + Turborepo (`R/package.json:1-30`, `packageManager: bun@1.3.14`, workspaces `packages/*`). Tamaño en líneas de TS/TSX (sin `.d.ts`):

| Paquete | Líneas | Qué es |
| --- | --- | --- |
| `packages/opencode` | 81 494 en `src` (+98 768 de `test`) | El motor y la CLI: agente, sesión, herramientas, permisos, plugins, proveedores, MCP, LSP, servidor. De esas, `src/cli` = 27 168 (TUI/CLI), `src/server` = 7 682, `src/session` = 8 132, `src/tool` = 5 198, `src/provider` = 4 448, `src/plugin` = 6 094, `src/mcp` = 1 834 |
| `packages/core` | 32 983 en `src` (+34 997 test) | Servicios compartidos y «capa v2»: base de datos, modelos, credenciales, PTY, `background-job.ts`, plugins v2 |
| `packages/llm` | 9 533 | Cliente LLM nativo (experimental, `OPENCODE_EXPERIMENTAL_NATIVE_LLM`) |
| `packages/server`, `protocol`, `schema`, `client`, `sdk-next` | 1 682 / 1 582 / 3 387 / 4 643 / ~330 | API HTTP v2 (`/api/*`) y sus tipos; en 1.19 conviven con la API vieja |
| `packages/plugin` | 1 612 | Tipos de plugins (`src/index.ts`, `src/tool.ts`, `src/v2/`) |
| `packages/sdk` | ~30 000 (generado) | SDK JS viejo (`@opencode-ai/sdk`) |
| `packages/tui` | 27 376 | TUI aparte (OpenTUI/Solid) |
| `packages/app`, `ui`, `session-ui`, `desktop`, `web`, `console`, `enterprise`, `stats`, `slack`, `function`, `storybook` | ~170 k, 34 k, 21 k, 9 k, 7 k, 44 k, 1,6 k… | UI web, escritorio Electron de ellos, sitio, consola de cuentas/pago, enterprise. **Ninguno entra en la lógica del motor que usa Lazunox**; solo `app` se incrusta como web UI (ver 2.4) |

Dónde vive cada cosa (todo en `R/packages/opencode/src` salvo indicación):

- **Servidor `serve`**: comando `cli/cmd/serve.ts:7-20` (avisa si falta `OPENCODE_SERVER_PASSWORD`). `server/server.ts:73` (`listen`) levanta `NodeHttpServer` de Effect (`server.ts:3`). **Ya no es Hono para las rutas**: son `HttpApi` de Effect en `server/routes/instance/httpapi/` (grupos en `groups/*.ts`, handlers en `handlers/*.ts`, p.ej. `groups/session.ts` 462 líneas). Auth Basic con usuario por defecto `opencode` (`server/auth.ts:19`, `OPENCODE_SERVER_USERNAME`). CORS: `httpapi/server.ts:70,121-124`.
- **Rutas de sesión**: `groups/session.ts:78-96` define `SessionPaths`; `promptAsync` en `:96` y `:329`; `permissionRespond` `:395`; `fork`, `revert`, `summarize`, `shell` (comando de usuario) `:240-380`.
- **SSE**: `/global/event` (`groups/global.ts:70`, `handlers/global.ts:35-49`, latido de 10 s) y `/event` por instancia (`handlers/event.ts:63-78`, `text/event-stream`).
- **Agente / bucle**: `session/prompt.ts` (1 631 líneas) con `runLoop` en `:1081` y `loop` en `:1343`; `session/processor.ts` (732) procesa el flujo del modelo y pide permisos (`processor.ts:372`); `session/llm.ts` (404) llama al proveedor; compactación `session/compaction.ts`; revert `session/revert.ts`. Agentes: `agent/agent.ts` (480).
- **Herramientas**: `tool/registry.ts` (455): lista `builtin` en `registry.ts:231-250` (invalid, question, shell, read, glob, grep, edit, write, task, webfetch, todo, websearch, skill, apply_patch, y bajo bandera execute/lsp/plan). Una por archivo en `tool/*.ts`; el wrapper que dispara los ganchos está en `session/tools.ts:100-110,176`.
- **Permisos**: `permission/index.ts` (223): `ask` `:66-107` evalúa reglas (`deny` lanza `DeniedError`, `allow` sigue, otro caso publica `permission.asked` y espera un `Deferred`), `reply` `:109+`, `fromConfig` `:186`. Comodines y aridad de comandos en `permission/arity.ts`.
- **Plugins**: carga en `plugin/index.ts` (318): internos fijos `:67-86` (Codex, Copilot, Modal, GitLab, Poe, Cloudflare, Azure, DigitalOcean, Snowflake, xAI, Cerebras), externos de `cfg.plugin_origins` `:181`. Tipos de ganchos en `packages/plugin/src/index.ts:226-334`. Plugins v2 (Effect/Promise) en `packages/plugin/src/v2/` y `core/src/plugin/`.
- **Proveedores y modelos**: `provider/provider.ts` (2 094; carga SDKs `@ai-sdk/*`, `package.json` de opencode) y catálogo en `core/src/models-dev.ts` (266).
- **Sesiones / almacenamiento**: SQLite `opencode.db` en el directorio de datos (`core/src/database/database.ts:53`), Drizzle; esquema `core/src/database/schema.sql.ts`, 38 migraciones en `core/src/database/migration/`; adaptadores Bun/Node (`core/package.json:26-29`). Modelo de sesión `core/src/session/*`, mensajes `session/message-v2.ts`.
- **Otros**: MCP `mcp/index.ts`, LSP `lsp/` (3 311), snapshots/revert `snapshot/`, PTY `core/src/pty.ts` + `groups/pty.ts`, worktrees `worktree/`.

Observación clave: **1.19 es un puente**. Trae la API vieja (`/session`, `/global/event`…) y, en paralelo, `packages/core`/`server`/`protocol` con la API v2. Eso hace el código más grande y más cambiante que una 1.x «pura».

## 2. Cómo se compila el binario

### 2.1 Toolchain exacto
- **Bun 1.3.14** (`R/package.json:6`; `packages/script/src/index.ts:7-18` exige `^1.3.14` y falla si no). El CI usa un Bun «baseline» x64 de `oven-sh/bun` y, **en Windows, Bun 1.4.2** por un parche de peer-variants (`.github/actions/setup-bun/action.yml:21-26`). Node 24 para `node-gyp` de scripts nativos (`action.yml:12-17`).
- No hay Go, Rust ni Zig propios en el build del motor: es TypeScript compilado con **`Bun.build({ compile })`** (`packages/opencode/script/build.ts:163-202`), que produce un ejecutable autónomo (runtime de Bun + bundle minificado). Plugin de transformación Solid para la TUI (`build.ts:6,23,166`).
- Script: `bun run script/build.ts` (`packages/opencode/package.json:"build"`). Flags: `--single` (solo la plataforma actual), `--baseline`, `--skip-install`, `--skip-embed-web-ui`, `--sourcemaps` (`build.ts:19-24`).

### 2.2 Objetivos y nombres
`build.ts:53-114` lista 12 combinaciones (linux/darwin/win32 × arm64/x64, `baseline` sin AVX2, `musl`). Nombre de salida `opencode-<os>-<arch>[-baseline][-musl]`, con `win32` → `windows` (`:146-155`). Los tres de Lazunox (`pin.json`): `opencode-darwin-arm64.zip`, `opencode-windows-x64.zip`, `opencode-linux-x64.tar.gz`. Release: empaqueta tar.gz en Linux y zip en el resto y los sube con `gh` (`build.ts:241-250`). El binario (runtime de Bun incluido) pesa unos 144 MB en 1.19.0 (medido en `SPIKE-OPENCODE-2.md`).
**Se puede compilar todo desde una sola máquina Linux** (así lo hace el CI: `publish.yml:75-96`, runner Ubuntu 4 vCPU, un solo paso `build.ts`). Bun descarga el runtime de cada destino al compilar cruzado (el propio código avisa de que los baseline «pueden fallar al descargar», `build.ts:122-123`).

### 2.3 Dependencias nativas
`@lydell/node-pty` (PTY; `postinstall` raíz `fix-node-pty`, `R/package.json:"postinstall"`, `core/script/fix-node-pty.ts`), `@parcel/watcher` 2.5.1 con paquetes por plataforma (`core/package.json:52-59`), `@ff-labs/fff-bun` 0.9.4 (búsqueda de archivos; desactivado por defecto en Windows, `flag.ts:34`), `@opentui/core` (TUI) y SQLite de Bun (`bun:sqlite`) o `node:sqlite`. El build instala a mano las variantes de **todas** las plataformas (`build.ts:140-144`: `bun install --os="*" --cpu="*" …`). Hay 18 parches a dependencias en `R/patches/` (AI SDK, MCP SDK, effect, solid-js, pacote…), referenciados desde `package.json:148+`; si cambiamos versiones hay que rehacerlos.

### 2.4 Pasos del build que exigen red (y cómo evitarlos)
1. `bun install` del monorepo completo (miles de paquetes; `bunfig.toml` exige `exact` y una edad mínima de 3 días de cada versión, `R/bunfig.toml`). Con `bun.lock` queda determinista; sin red solo con caché previa.
2. `script/generate.ts:10-13` **descarga `https://models.dev/api.json`** (o `OPENCODE_MODELS_URL`) y lo incrusta como catálogo de modelos. Evitable con `MODELS_DEV_API_JSON=<archivo local>`. Para un build reproducible hay que guardar ese JSON en el repo del fork.
3. `packages/script/src/index.ts:26-48`: si no se fijan `OPENCODE_VERSION`/`OPENCODE_CHANNEL`, consulta el registro npm (`registry.npmjs.org/opencode-ai/latest`) y la rama git. Se evita fijando ambas variables.
4. `build.ts:30`: compila además la **web UI** (`packages/app`, ~170 k líneas, Vite) para incrustarla. Lazunox no la usa: `--skip-embed-web-ui` (`build.ts:24,50`) la salta y ahorra tiempo y dependencias; sin ella el servidor cae a un proxy a `app.opencode.ai` (ver 3).
5. Descarga de runtimes Bun de cada destino al compilar cruzado.

### 2.5 Tiempo y recursos (estimado, no medido)
El CI usa 4 vCPU/16 GB para todo. Estimación: instalación 3-6 min la primera vez, `Bun.build` por destino 1-3 min, memoria pico 4-8 GB (con web UI más). Un destino con `--single --skip-embed-web-ui` debería ser de pocos minutos en el Mac; **hay que medirlo en la fase 1** antes de fiarse de estas cifras.

### 2.6 Qué haría falta para reproducirlo de forma verificable
- **VPS (Docker)**: imagen fijada por digest con Bun 1.3.14 (y 1.4.2 si se quiere paridad Windows), Node 24, git, `unzip`, `zip`/`tar`. Contenedor con red solo durante `bun install` + descarga de runtimes; luego `build.ts` con `OPENCODE_VERSION`, `OPENCODE_CHANNEL`, `MODELS_DEV_API_JSON` y `--skip-embed-web-ui`. Salida: tres artefactos + `SHA256SUMS` + `pin.json` generado (misma forma que hoy: `version`, `url`, `sha256`, `size`).
- **Mac (darwin-arm64)**: Bun 1.3.14 y Xcode Command Line Tools. `build.ts:204-208` vuelve a firmar ad-hoc con `codesign` **solo si el host es macOS**, porque incrustar el bundle invalida la firma y macOS 27+ mata el proceso (SIGKILL). Un darwin compilado en Linux saldría con firma inválida: compilar darwin en el Mac (o firmar después), igual que hace el CI (`sign-cli-macos` en `macos-26`, `publish.yml:126-153`).
- **Qué significa «verificable»**: el hash del binario oficial **no** se podrá reproducir bit a bit (firmas Developer ID/Windows del CI, `publish.yml:126-300`; Bun y minificado dependen del entorno). Lo realista: (a) compilar dos veces en el mismo contenedor y comparar hashes (determinismo propio), (b) fijar entradas por hash (`bun.lock`, JSON de modelos, imagen Docker), (c) publicar `SHA256SUMS` y que `fetch-opencode.mjs` siga verificando tamaño y sha256 como hoy (`scripts/fetch-opencode.mjs`, contrato `pin.json`). Cambiar el origen de descarga es cambiar solo las URL del pin.
- Los tests del motor son `bun test` por paquete (`packages/opencode/package.json:"test"`; el raíz lo prohíbe), unos 100 k líneas de test: sirven de red de seguridad del fork, pero no los ejecuté.

## 3. Red, telemetría, cuentas y autoactualización

Lo que el binario puede contactar (todo con ruta del código):

| Qué | Dónde | Estado y qué hacer |
| --- | --- | --- |
| **Catálogo de modelos** `models.opencode.ai` (en 1.19.0 ya NO es `models.dev` directo) | `core/src/models-dev.ts:160`, refresco cada 60 min `:255-257` | Lazunox ya lo gobierna. Conservar un catálogo local: `OPENCODE_DISABLE_MODELS_FETCH` (`flag.ts:29`) + `OPENCODE_MODELS_PATH` (`flag.ts:46`). En fork: apuntar `OPENCODE_MODELS_URL` a un espejo propio o a un archivo |
| **Autoactualización** | `cli/upgrade.ts:21-30` (solo avisa, «Checking never installs anything», `:7`) y llamada solo desde el worker de la TUI (`cli/tui/worker.ts:4`); `installation/index.ts:175,199` descarga `opencode.ai/install` y `/v2/install` solo en `opencode upgrade` | `serve` **no** la ejecuta. Apagar igual con `OPENCODE_DISABLE_AUTOUPDATE` (`flag.ts:23`) y, en el fork, quitar el comando `upgrade` (`src/index.ts:91`) |
| **Web UI de reserva** | `server/shared/ui.ts:9` (`UI_UPSTREAM = https://app.opencode.ai`): sin UI incrustada, el servidor hace de proxy para rutas no API | Desactivar: `OPENCODE_DISABLE_EMBEDDED_WEB_UI` es otra cosa; en el fork borrar el proxy. Con el CORS/loopback actual de Lazunox no se usa, pero conviene eliminarlo |
| **Compartir sesiones** (`opncd.ai`, `enterprise.url`) | `share/share-next.ts:210`; `session/share` solo si `OPENCODE_AUTO_SHARE` o `share:"auto"` (`share/session.ts:43`); config `share: manual|auto|disabled` (`core/src/v1/config/config.ts:57`) | Forzar `share:"disabled"` y quitar rutas `share/unshare` (`groups/session.ts:279-291`) |
| **Cuentas / consola OpenCode** (login por dispositivo, Zen/Go) | `core/src/plugin/provider/opencode.ts:16`, `cli/cmd/account.ts:18`, `session/retry.ts:11,132` (enlaces de venta) | No hacen falta para uso sin fines de lucro con modelos gratuitos/propios. Conservar el proveedor `opencode` solo si se usan sus modelos gratis; quitar los enlaces de «upsell» |
| **Telemetría** | `core/src/observability/otlp.ts:7-9`: exportación OTLP **solo si** se define `OTEL_EXPORTER_OTLP_ENDPOINT` | No hay telemetría propia activa por defecto en lo que leí (sin verificar con tráfico real). Mantener sin esa variable |
| **Búsqueda web** | `tool/mcp-websearch.ts:5-7` (`mcp.exa.ai`, `search.parallel.ai`) | Herramienta del modelo; Lazunox ya decide su propia búsqueda. Quitar o apagar |
| **Descargas de LSP** | `lsp/server.ts:183,552,600,647,976` (GitHub) | `OPENCODE_DISABLE_LSP_DOWNLOAD` (`runtime-flags.ts:24`) |
| **Plugins npm** | `plugin/index.ts:181`, instalación en `plugin/install.ts` | Solo si hay `plugin` en la config; los internos van incluidos (`:67-86`) y se pueden apagar con `OPENCODE_DISABLE_DEFAULT_PLUGINS` (`runtime-flags.ts:23`) |
| **Cabeceras de proveedor** `HTTP-Referer: https://opencode.ai/` | `provider/provider.ts:507-950`, `core/src/plugin/provider/*.ts` | Inofensivas; en el fork cambiar a nuestro nombre |
| **mDNS** | `server/mdns.ts`, `cli/network.ts:17-67` | Apagado salvo que se active; mantener apagado |
| **GitHub app** | `cli/cmd/github.handler.ts:325,698` (`api.opencode.ai`) | Comando de CLI, irrelevante: borrar |

Conservar: nada obligatorio de OpenCode como servicio. Lo único útil que viene «de fuera» es el catálogo de modelos (conviene espejo propio). Para un fork privado: dejar el binario **sin ninguna URL de `opencode.ai`/`opncd.ai` en el camino de `serve`**, y añadir una prueba que haga grep de esas cadenas en el código que sobrevive.

## 4. Licencia

- `R/LICENSE`: **MIT**, «Copyright (c) 2025 opencode». Todos los `package.json` con licencia declaran MIT (24 de 24); los dos sin campo (`httpapi-codegen`, `storybook`) cuelgan del mismo repo.
- Carpetas con LICENSE propia: `packages/ui/LICENSE` y `packages/http-recorder/LICENSE` (también MIT, mismo titular) y **`packages/docs/LICENSE`: MIT, «Copyright (c) 2023 Mintlify»** (documentación; no entra en el binario). No hay `NOTICE` ni `THIRD_PARTY` en la raíz.
- Obligación MIT: conservar el aviso de copyright y el texto de licencia en copias sustanciales (el binario incluye muchas dependencias con sus propias licencias; habría que generar un archivo de avisos de terceros al empaquetar, hoy Lazunox ya tiene `verify:release` de licencias). Las marcas «opencode»/«OpenCode» no están cubiertas por la licencia: renombrar el binario y el producto del fork (el nombre de ejecutable, `OPENCODE_*` y rutas XDG son parte del contrato con Lazunox; cambiarlos exige plan de migración).
- Los parches de `R/patches/` modifican dependencias de terceros (cada una con su licencia); no son código de OpenCode.

## 5. Funciones que quiere Ben frente al código 1.19

| Función | Estado en 1.19.0 | Evidencia |
| --- | --- | --- |
| **Subagentes (herramienta `task`)** | Existe, síncrona | `tool/task.ts` (371 líneas), registrada `registry.ts:240` |
| **Subagentes en segundo plano** | **Existe pero experimental, apagado por defecto.** Parámetro `background:true` de `task`; falla con «requieren `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`» | `task.ts:58-60,97-102,267-318,362-366`; bandera `runtime-flags.ts:41` (también la activa `OPENCODE_EXPERIMENTAL`). El resultado se inyecta en el padre al terminar (`task.ts:227-264`) |
| Mandar contexto a un subagente que corre / pasar uno síncrono a segundo plano | Existe | `task.ts:267-282`; endpoint `POST /experimental/session/:sessionID/background` (`groups/experimental.ts:100,235-245`, `handlers/experimental.ts:159-171`) |
| Registro de trabajos en segundo plano | Existe | `background/job.ts` (37) sobre `core/src/background-job.ts` (365): `start/extend/wait/promote/cancel/list`, ligado a la instancia |
| **Shell en segundo plano** (comando largo que no bloquea al agente) | **Falta.** La herramienta `shell` solo tiene `timeout` (2 min por defecto, `OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS`) y al vencer **mata** el comando | `tool/shell.ts:347,540-564,615-640`; no hay parámetro de segundo plano. Hay piezas reutilizables: PTY persistentes (`core/src/pty.ts`, `groups/pty.ts`) y el registro de trabajos |
| Notificación al modelo cuando termina el trabajo | Existe para subagentes (`task.ts:227-264`); no para shell | — |

**Puntos de extensión concretos** (para el fork):
- **Herramienta nueva**: un archivo `tool/<nombre>.ts` con `Tool.define`/`Tool.init` como `tool/task.ts` o `tool/shell.ts`, su `.txt` de descripción, y añadirla a `builtin` en `tool/registry.ts:231-250` (instanciar el servicio cerca de `:95-115`). Sin tocar el fork también se puede con un plugin: `tool` en el plugin (`plugin/src/index.ts:226`, cargado en `registry.ts:123-202`); es lo que usa Lazunox hoy.
- **Shell en segundo plano**: parámetro `background` en `tool/shell.ts` (cerca de `:615`), `BackgroundJob.start` (como `task.ts:284`) y una herramienta «leer salida/matar» nueva; endpoint de lectura/cancelación en `groups/experimental.ts` + handler (patrón de `sessionBackground`).
- **Endpoint nuevo**: grupo en `server/routes/instance/httpapi/groups/<x>.ts`, handler en `handlers/<x>.ts`, registrarlo en `httpapi/api.ts` (97) y `public.ts`; hay que regenerar el SDK (`packages/sdk/js/script/build.ts`, ver `R/AGENTS.md`).
- **Permisos**: lógica en `permission/index.ts:66-107`. **Ojo**: el gancho de plugin `"permission.ask"` está tipado (`plugin/src/index.ts:261`) pero **no se dispara en ningún sitio** de `opencode/src` ni `core/src` (grep sin resultados). Ya lo sabíamos por `lazunox-plan-gate`; en un fork se podría cablear en `Permission.ask`.
- **Ganchos que sí se disparan**: `tool.execute.before` (`session/tools.ts:107,176`, `session/prompt.ts:308`, `tool/code-mode.ts:142`), `shell.env`, `chat.*`, `tool.definition` (`registry.ts:318`).
- **Más funciones 2.x que se podrían portar**: diff por turno, permisos auto-aceptados por proyecto, `session.compaction.*`; son cambios en `session/` y `core/src/session/`, y el estado actual del repo ya mezcla ambos mundos (`core/src/session/*`), lo que facilita copiar ideas pero no el código tal cual (modelos de datos distintos).

## 6. Veredicto

**Es viable, pero con un coste de mantenimiento alto y una condición: congelar y no seguir a upstream.** Mantener un fork de la 1.19.x significa ser dueño de ~115 k líneas de motor (81 k `opencode/src` + 33 k `core/src`) más los parches de dependencias y un runtime (Bun) con sus CVE.

**A favor**: MIT sin cargas raras; el compilador es solo Bun (sin Go/Rust); `serve`, SSE, permisos y plugins ya hacen lo que Lazunox usa; el subagente en segundo plano ya está escrito (solo hay que activar la bandera, **sin fork**); la ruta de red hacia OpenCode es pequeña y apagable; no cambia el contrato que hoy cubren `api-routes.json` y los plugins.

**En contra / riesgos**:
1. 1.19 es una versión puente a medio migrar (API vieja + v2); el upstream ya dejó de publicar 1.x salvo parches (último 1.19.3) y 2.x avanza rápido, así que **no habrá correcciones de seguridad ni de proveedores** (los `@ai-sdk/*` y los formatos de API de Anthropic/OpenAI cambian; un modelo nuevo puede exigir actualizar SDKs a mano).
2. Dependencias fijadas con 18 parches y `minimumReleaseAge`; actualizar una exige rehacer el parche.
3. Cada vez que el proveedor cambia una API, el fork tiene que portarlo; con modelos gratuitos y proveedores propios del plan (sin fines de lucro) el volumen es manejable pero no nulo.
4. Reproducibilidad: el binario no se podrá verificar contra el oficial; solo contra el nuestro (2.6).
5. Parte del valor buscado (shell en segundo plano) se logra sin fork con un plugin o con una herramienta propia en Lazunox, ver paso 1.
6. Tiempo del build y red: no medidos (2.5).

**Esfuerzo (estimado, sin medir)**: fase de reproducción del build 1-2 semanas-persona; recorte de red 1 semana; cada función nueva (shell en segundo plano con lectura de salida) 1-2 semanas con pruebas; mantenimiento de fondo ~2-4 días al mes (proveedores, avisos de seguridad de Bun y dependencias). Comparado con la migración a 2.x del spike (~9-13 semanas), el fork gana en estabilidad de contrato y pierde en obsolescencia.

### Plan de 5 pasos
1. **Antes de forkear, probar sin fork**: activar `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` en `server.ts` de Lazunox y escribir un plugin con una herramienta `shell_bg` (PTY o `spawn` + lectura por id). Decidir con datos si hace falta fork. Sin cambios de motor.
2. **Build reproducible del tag v1.19.0 sin cambios**: contenedor en el VPS (Bun 1.3.14 por digest, `MODELS_DEV_API_JSON` y `OPENCODE_VERSION` fijados, `--skip-embed-web-ui`), darwin en el Mac. Criterio: 2 compilaciones con el mismo hash y `api-routes.json` idéntico al del binario oficial. Medir tiempo y memoria.
3. **Fork privado «congelado»**: repo propio desde el commit `733b2c62…` (o v1.19.3), conservar `LICENSE` y añadir nuestro aviso; renombrar el producto; quitar `upgrade`, share, proxy `app.opencode.ai`, GitHub app, websearch/exa y enlaces de venta; prueba de grep de URLs prohibidas. Publicar el binario con el mismo contrato de `pin.json`.
4. **Funciones propias**: shell en segundo plano como herramienta nativa (`tool/shell.ts`, `background/job.ts`, endpoint en `groups/experimental.ts`), cablear `permission.ask` si Lazunox lo necesita, bandera de subagentes en segundo plano activa por defecto; cada una con pruebas `bun test` y su `CHANGELOG-FASE8` en Lazunox.
5. **Operación**: lista mensual de avisos (Bun, `@ai-sdk/*`, `hono`/`effect`, MCP SDK), política de portar parches de seguridad o proveedores desde 1.19.x/2.x «por commit», y criterio de salida: si el costo mensual supera ~1 semana o 2.x se estabiliza, retomar la migración de `SPIKE-OPENCODE-2.md`.

## Pendiente / no verificado
No ejecuté nada (por regla): tiempos y memoria de build, ausencia real de tráfico de telemetría, comportamiento de `background:true` en ejecución, ni si el binario oficial 1.19.0 coincide funcionalmente con el árbol (se asume por tag y versión de `packages/opencode/package.json:3`). Las rutas del servidor v2 (`/api/*`) no se evaluaron aquí.
