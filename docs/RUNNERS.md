# Runners reales: OpenCode y Codex

Implementados y probados SOLO con binarios simulados (`test/runners-real/fake-opencode.ts`, `fake-codex.ts`). Ningún modelo real ni proveedor se ha tocado. Todo lo marcado **NV** (no verificado) debe confirmarse con una sonda real barata (tanda T5, con aprobación del dueño) y luego corregir `extract.ts`/`config.ts`/`sqlite.ts`.

## Normalización común (`src/telemetry`)
- `normalizeTelemetry(draft, capabilities, runnerSpecific)`: completa con `null`, valida con `TelemetrySchema`, aplica `maskTelemetry` (lo no declarado = null) y guarda `runnerSpecific` + `capabilities` en `extra`.
- Semántica de tokens común: `inputTokens` = prompt total (incluye caché), `outputTokens` = salida (incluye razonamiento), `cachedTokens` = lectura de caché, `reasoningTokens` = subconjunto informativo. OpenCode: input = input + cache.read + cache.write; output = output + reasoning. Codex ya lo entrega así.
- `detect.ts`: `isRateLimitText` (token rate limit, 429, too many requests, usage limit...) e `InactivityWatch` (180 s por defecto vía `Limits.inactivitySec`).
- `orphans.ts`: barrido por cwd bajo `runRoot` (lsof) para huérfanos reparentados a init que el árbol de `proc.ts` ya no ve.

## OpenCodeRunner (`src/runners/opencode`)
Flujo: `opencode serve --port 0 --hostname 127.0.0.1` (cwd = workspace; URL de la línea "listening on") con usuario/clave aleatorios por run (Basic auth) → abrir SSE `/event` antes de enviar → `POST /session` → `POST /session/:id/prompt_async` → esperar `session.idle` → `GET /session/:id/message` y `/diff` → `POST /abort` si no terminó sola → matar árbol del servidor. Entorno desde cero (whitelist PATH/LANG/TERM): `HOME` y `XDG_*` bajo el run, `OPENCODE_CONFIG_DIR`, `OPENCODE_CONFIG_CONTENT`, `OPENCODE_DISABLE_*`. Credenciales solo por `OPENCODE_AUTH_CONTENT` (tomado de `ctx.env`, jamás de disco ni de artefactos; los artefactos se redactan).
Permisos: `"*":allow`; `external_directory`, `question`, `doom_loop`, `webfetch`, `websearch` = deny; `agent.<agente|build>.steps` = tope de pasos (además el runner aborta al contar `maxSteps` step-finish: `stopReason: max_steps`, outcome `completed`).
Telemetría: sqlite propia del run (`$XDG_DATA_HOME/opencode/opencode*.db`, solo lectura) con tablas session/message/part; sesiones hijas (`parent_id`) = subagentes, incluidas en totales y desglosadas en `extra.subagents`. Si no hay sqlite se usan los mensajes HTTP (sin subagentes, `extra.dataSource="http"`). `extra.tokenCrosscheck` compara tokens de mensajes vs step-finish.
Rate limit: `session.status` tipo `retry` con mensaje de rate limit (aborta al N-ésimo, def 1, `rateLimitRetriesBeforeAbort`), `session.error` o `message.updated` con error de rate limit -> `rate_limited`. Sin eventos 180 s -> `hung`.

### Campos NV de OpenCode (confirmar con sonda real)
1. Nombres/forma de eventos SSE: `server.connected`, `session.status {status:{type:busy|idle|retry,attempt,message,next}}`, `session.idle`, `session.error {error:{name,data.message}}` (y `MessageAbortedError`), `message.part.updated {part}`, `message.updated {info}`.
2. `step-finish` y `info.tokens`: `{input,output,reasoning,cache:{read,write}}` y `cost` (y si `input` excluye o incluye caché; si `info.tokens` es acumulado o por llamada). Define también `llmCalls` (hoy = nº de step-finish).
3. `retry`: forma exacta del mensaje y del campo `attempt`; si el proveedor «OpenCode Go» reporta `token rate limit` por esta vía o como error final.
4. Esquema sqlite: tablas `session(id,parent_id)`, `message(id,session_id,data)`, `part(id,message_id,session_id,data)`, orden por `time_created`; se descubren columnas con PRAGMA y se avisa en `extra.unverified`.
5. `GET /session/:id/diff`: campos `file/additions/deletions/status` (`added|modified|deleted`); sin `status`, `filesCreated/Deleted` quedan null.
6. Herramientas: nombres `read/glob/grep/list`, `write/edit/multiedit/patch`, `bash`, `task` (subagente) y `state.input.filePath|path`, `state.time.{start,end}`.
7. Cabecera `x-opencode-directory`, línea "listening on", `prompt_async` (204) con `model:{providerID,modelID}` y `agent`.
8. Config: claves `permission`, `agent.<n>.steps`, `autoupdate`, `share`; lista exacta de `OPENCODE_DISABLE_*` aceptadas por 1.18.x; si `cost` viene null para proveedores sin precios.

## CodexRunner (`src/runners/codex`)
`codex exec --json -m <modelo> -s workspace-write -C <ws> --skip-git-repo-check --ignore-user-config [-c model_reasoning_effort="x"] -` con el prompt por stdin. `CODEX_HOME` por run (`<runRoot>/codex-home`), `HOME` aislado, `CODEX_API_KEY` solo desde `ctx.env` (redactada en artefactos).
Eventos: `thread.started`, `turn.started`, `item.completed` (`command_execution`, `file_change`, `mcp_tool_call`, `web_search`...; deduplicado por `item.id`), `turn.completed.usage`, `turn.failed`, `error`. Rollout (`CODEX_HOME/sessions/**/rollout-*.jsonl`): `token_count` deduplicado por `total_token_usage` -> `llmCalls` y `peakContext` (max `last_token_usage.input_tokens`).
**Nulls declarados** (`extra.declaredNulls`): `costUsd`, `cacheWriteTokens`, `toolDurationMs`, `filesRead`, `steps`; y `llmCalls`/`peakContext` si no hay rollout. Sin API de abortar: la cancelación mata el árbol (SIGTERM, 3 s, SIGKILL).

### Campos NV de Codex
1. Flags `--ignore-user-config`, `-C`, `--skip-git-repo-check`, lectura del prompt con `-` en la versión instalada (no hay codex en esta máquina).
2. Tipos de item de subagentes (`collab_tool_call`) y de herramientas MCP.
3. Ruta y forma del rollout (`event_msg/token_count/info.{total,last}_token_usage`) y si `last.input_tokens` es buen proxy de contexto.
4. Autenticación con solo `CODEX_API_KEY` bajo `--ignore-user-config` (alternativa: `auth.json` en `CODEX_HOME`).
5. Mensajes de rate limit (`Reconnecting... n/5`, `token rate limit`) y si aparecen en stderr o como evento `error`.

## Huérfanos y límites
`supervise` (proc.ts) mata el árbol; además `sweepRunRoot` elimina procesos con cwd bajo el run; `cleanup()` re-verifica y devuelve `{orphans}`. Cancelación < 10 s verificada en tests (fakes). Tope de tiempo = `Limits.timeoutSec`; inactividad = `Limits.inactivitySec`.

## Aislamiento real (Seatbelt)
`OpenCodeRunner` y `CodexRunner` lanzan su proceso con `sandboxWrap` (`src/isolation/seatbelt.ts`): `sandbox-exec -p <perfil> <cmd> <args>` pasado a `supervise()` (sandbox-exec hace `exec`, el pid supervisado es el del agente). Opción `sandbox` (def `true`; `false` solo para tests del propio runner) y propiedad `runner.isolation` (`"seatbelt"|"none"`), que el motor copia a `environment.isolation`.
- Perfil: `deny default`; lectura en lista blanca (sistema, node, `runRoot`, binario real del agente con symlinks resueltos y su directorio, y args que sean rutas absolutas, p. ej. el script simulado; más `extraReadPaths`); escritura SOLO `runRoot` (+ `/dev/null`, tty).
- Lectura denegada explícitamente (`deny file-read*`, luego se re-permite solo lo anterior): `~/.ssh`, `~/.config`, `~/Library/Application Support`, `~/.aws`, `~/.gnupg` y el HOME real completo. Para opencode real basta `~/.opencode/bin` (verificado: `--version` y `--help` arrancan dentro del perfil, sin red ni modelo).
- Red: `network: "all" | "loopback" | "none"` (`settings.network` de la configuración; def `all` porque el modelo es remoto; `loopback` para simulados/modelos locales). MEJORA PENDIENTE: egress por proxy local con allowlist de hosts del proveedor (hoy `all` permite cualquier destino).
- Motor (`src/engine/cycle.ts`): registra `environment.isolation = "seatbelt"` si el runner lo declara y `sandbox-exec` existe; todo runner cuyo id no sea `fake*` y no tenga Seatbelt operativo se REHÚSA (`infra_error`, el runner no se prepara ni se ejecuta). Limitación: es un chequeo por run; un preflight global en `engine.ts` queda fuera de este alcance.
- Caso de contrato (aislamiento): `test/runners-real/sandbox.test.ts` ejecuta fake-opencode/fake-codex (escenario `probe`) dentro del perfil con un canario fuera del run, `~/.ssh|.aws|.config|.gnupg|Application Support` reales y destinos de escritura fuera: ninguna lectura, listado ni escritura debe prosperar (incluye listar el HOME real) y `cleanup()` devuelve 0 huérfanos. Complementa los 7 puntos de `src/runners/base/contract.ts` (no modificado; añadir allí el punto 8 queda a quien lo posea).
