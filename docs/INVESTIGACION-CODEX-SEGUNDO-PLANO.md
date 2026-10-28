# Cómo resuelve Codex (OpenAI) el trabajo en segundo plano

Investigación de solo lectura, 2026-10-22. Fuentes: docs oficiales (developers.openai.com/codex redirige con 308 a
learn.chatgpt.com/docs/...) y código en github.com/openai/codex (rama `main`, leído vía GitHub web/raw; no se clonó ni ejecutó nada).

Leyenda: **[DOC]** documentación oficial; **[CÓDIGO]** código oficial (ruta); **[ISSUE]** solo issues/terceros (no verificado en runtime);
**[?]** no se pudo confirmar. Aviso: las páginas se leyeron con un extractor automático (WebFetch con modelo pequeño), así que
cifras y nombres conviene reverificarlos en el archivo antes de copiarlos a un contrato.

## 1. Cómo se lanza algo en segundo plano

### 1.1 Shell: "unified exec" (herramientas `exec_command` + `write_stdin`)

Estable y activado por defecto en todas las plataformas (`features.unified_exec`) [DOC: learn.chatgpt.com/docs/config-file/config-reference].
Código en `codex-rs/core/src/unified_exec/` (`mod.rs`, `process_manager.rs`, `process.rs`, `async_watcher.rs`,
`head_tail_buffer.rs`, `stdin_approval.rs`) y handler `codex-rs/core/src/tools/handlers/unified_exec.rs`; specs de las
herramientas en `.../handlers/shell_spec.rs` [CÓDIGO].

No existe una herramienta "lanzar en background" aparte: **toda** llamada abre una sesión; si el comando no termina en
`yield_time_ms`, la herramienta devuelve la salida acumulada + un identificador de sesión, y el modelo decide si sigue
consultando. Es decir, "segundo plano" = "sesión que sobrevivió al plazo de espera".

Herramienta `exec_command` [CÓDIGO shell_spec.rs]:

- `cmd` (obligatorio), `workdir`, `tty` (false = pipes; true = PTY), `shell`, `login`.
- `yield_time_ms`: por defecto 10 000; rango efectivo 250–30 000 (en Windows 10 000–30 000).
- `max_output_tokens`: por defecto 10 000 tokens (la política puede recortar pedidos mayores).
- Seguridad: `sandbox_permissions` (`use_default` | `require_escalated` | `with_additional_permissions`), `justification`
  (pregunta mostrada al usuario), `prefix_rule` (prefijo reutilizable de aprobación, p. ej. `["git","pull"]`),
  `additional_permissions`; `environment_id` solo si hay varios entornos.
- Existe también `timeout_ms` opcional en el handler (`handlers/unified_exec.rs`); su uso real no se confirmó [?].

Herramienta `write_stdin` [CÓDIGO shell_spec.rs]:

- `session_id` (obligatorio), `chars` (vacío = solo consultar sin escribir), `yield_time_ms`, `max_output_tokens`.
- Escritura no vacía: espera por defecto 250 ms, tope 30 000 ms. Sondeo vacío: espera entre 5 000 y 300 000 ms.
- Sin TTY solo se acepta el carácter de interrupción (Ctrl-C, `\u{3}`); otro texto da `StdinClosed`. Con TTY se escribe y se
  espera 100 ms antes de leer. Entrada > 8 000 bytes se rechaza (`MAX_STDIN_APPROVAL_BYTES`) [CÓDIGO process_manager.rs].

Identificación: `process_id` entero (en la herramienta se ve como `session_id`), reservado en `ProcessStore`
(`HashMap<i32, ProcessEntry>`); cada salida lleva un `chunk_id` hexadecimal de 6 caracteres [CÓDIGO mod.rs].

Listar / cancelar: internamente hay `list_processes` (solo no terminados) y `terminate_all_processes` [CÓDIGO]. **No hay una
herramienta de modelo para listar ni matar** una sesión: el modelo solo puede mandar Ctrl-C por `write_stdin`. El usuario
detiene el turno con Esc/interrupción de la UI (ver 2.4 sobre qué ocurre con el proceso).

### 1.2 Subagentes / multi-agente (herramientas del modelo)

Activado por defecto (`features.multi_agent = true`, `agents.enabled = true`) [DOC config-reference]. Código en
`.../tools/handlers/multi_agents*.rs`, `multi_agents_v2.rs` y `multi_agents_v2/` [CÓDIGO]. Hay dos generaciones de API:

- v1: `spawn_agent` (`message`|`items`, `agent_type`, `fork_context`, `model`, `reasoning_effort`) → devuelve id y apodo;
  `send_input` (`target`, `message`, `interrupt`); `wait_agent` (`targets[]`, `timeout_ms`; espera estado final);
  `resume_agent` (`id`); `close_agent` (`target`; cierra también descendientes); `list_agents`.
- v2: `spawn_agent` (`task_name` obligatorio en minúsculas/dígitos/_, `message`, `agent_type`, `fork_turns` = `all`|`none`),
  `send_message` (entrega sin iniciar turno), `followup_task` (inicia turno si está inactivo; si no, en el siguiente límite de
  mensaje), `interrupt_agent`, `list_agents` (`path_prefix`), `wait_agent` (solo `timeout_ms`; "espera una actualización de
  buzón de cualquier agente vivo o entrada del usuario; no devuelve contenido") [CÓDIGO multi_agents_spec.rs].
- Agentes integrados: `default`, `worker`, `explorer`. Personalizados: TOML en `~/.codex/agents/` o `.codex/agents/`
  (`name`, `description`, `developer_instructions`, opcionales `model`, `model_reasoning_effort`...) [DOC .../agent-configuration/subagents].
- Config `[agents]`: `max_concurrent_threads_per_session` (alias `max_threads`; sin valor por defecto documentado),
  `default_subagent_model`, `default_subagent_reasoning_effort`, `interrupt_message`. La doc **no** cubre profundidad máxima
  ni tiempos límite; no se encontró `max_depth` en la parte leída de la referencia (quedó sin leer el último 36 %) [DOC/?].

### 1.3 Nube (Codex cloud)

Tareas que corren en entornos publicados desde repos de GitHub; "cada tarea tiene su propio espacio de trabajo y puede seguir
trabajando mientras tu computadora duerme". Se lanzan desde web, móvil, app de escritorio, CLI o ChatGPT en Slack; se pueden
listar chats/tareas recientes y su estado desde la CLI; se revisan archivos cambiados y pruebas, se piden cambios y se hace
commit o PR [DOC learn.chatgpt.com/docs/cloud]. Entorno = script de instalación, "start skill", variables, secretos de red,
OIDC; internet configurable por presets y dominios permitidos. La página no describe aislamiento interno, caché ni límites de uso [DOC/?].

## 2. Supervisión

### 2.1 Tiempos límite (valores de `unified_exec/mod.rs` salvo nota) [CÓDIGO]

| Constante                                       | Valor                                                        |
| ----------------------------------------------- | ------------------------------------------------------------ |
| `MIN_YIELD_TIME_MS` / `MAX_YIELD_TIME_MS`       | 250 / 30 000 ms                                              |
| `MIN_EMPTY_YIELD_TIME_MS`                       | 5 000 ms (sondeo vacío)                                      |
| `DEFAULT_MAX_BACKGROUND_TERMINAL_TIMEOUT_MS`    | 300 000 ms (config `background_terminal_max_timeout`, [DOC]) |
| `DEFAULT_MAX_OUTPUT_TOKENS`                     | 10 000                                                       |
| `UNIFIED_EXEC_OUTPUT_MAX_BYTES`                 | 1 MiB (≈262 144 tokens)                                      |
| `MAX_UNIFIED_EXEC_PROCESSES`                    | 64                                                           |
| `EARLY_EXIT_GRACE_PERIOD` (process.rs)          | 150 ms                                                       |
| `TRAILING_OUTPUT_GRACE` (async_watcher.rs)      | 100 ms                                                       |
| `POST_EXIT_CLOSE_WAIT_CAP` (process_manager.rs) | 50 ms                                                        |
| `REMOTE_OUTPUT_DRAIN_GRACE` (process.rs)        | 5 s                                                          |

- Para el proceso en sí **no hay un tiempo máximo de vida documentado**: solo el plazo de cada espera. Si un proceso "ligado
  a completarse" sigue vivo al vencer el plazo inicial, se marca `timed_out` y se termina (`terminate_confirmed`); su
  código de salida pasa a 124 (`exit_code()` en process.rs) [CÓDIGO]. Para MCP el tiempo por herramienta es 60 s
  (`mcp_servers.<id>.tool_timeout_sec`) [DOC].
- Sin salida: la llamada simplemente vuelve al vencer `yield_time_ms` con salida vacía y el `session_id`; el modelo sigue
  consultando o abandona. No hay vigilante de inactividad en lo leído [CÓDIGO; inferencia].

### 2.2 Cómo se entera el modelo de que terminó

- **Sondeo**: el modelo llama `write_stdin` (vacío) y, al terminar, recibe salida final + código de salida; `refresh_process_state`
  elimina las sesiones terminadas [CÓDIGO process_manager.rs].
- Un watcher interno (`spawn_exit_watcher`, `start_streaming_output` en async_watcher.rs) emite eventos `ExecCommandOutputDelta`
  (trozos ≤ 8 192 bytes, con presupuesto máximo por llamada) y un único `ExecCommandEnd`; esos eventos alimentan la **UI**,
  no hay en lo leído código que despierte al modelo [CÓDIGO].
- Issue #29865 pide `wake_on_output` y afirma: "Codex solo ve la salida posterior si sondea con `write_stdin`"; cerrado como
  duplicado de #22003 / "not planned" [ISSUE https://github.com/openai/codex/issues/29865]. Conclusión: **sin notificación
  push al modelo; solo polling** (confirmado por código leído + issue).
- Subagentes: v1 `wait_agent` bloquea hasta estado final; v2 usa buzón (mailbox) y `wait_agent` despierta con actualizaciones
  sin devolver contenido [CÓDIGO]. Hay eventos `SubAgentActivity` (iniciado/completado) hacia la sesión [CÓDIGO multi_agents_v2.rs].

### 2.3 Límites de salida y memoria

- `HeadTailBuffer` (head_tail_buffer.rs): tope 1 MiB; 50 % cabeza fija + 50 % cola rodante; lo del medio se descarta y se
  cuenta en `omitted_bytes`; se inserta un marcador "... N bytes omitted ..." [CÓDIGO]. Hay dos búfers: `pending` (lo que
  drena cada sondeo) y `transcript` (registro final). Canal de difusión de 64 elementos; los lagos se saltan (`Lagged`).
- Al modelo se le entrega recortado a `max_output_tokens` (10 000 por defecto).
- Concurrencia: máx. 64 procesos. Al llegar al tope se poda (`prune_processes_if_needed`): se protegen los 8 más recientes; entre
  el resto se expulsa primero un proceso ya terminado (LRU), si no, el menos usado; se salta el que tenga el candado de
  interacción [CÓDIGO process_manager.rs]. Es decir, un proceso vivo puede ser **matado silenciosamente** por poda.

### 2.4 Cierre, cancelación y huérfanos

- `impl Drop for UnifiedExecProcess` llama a `terminate()`; `terminate_all_processes` vacía el almacén al cerrar sesión. En el
  archivo leído no hay manejo explícito de grupo de procesos; la señal local se delega a `ExecCommandSession::terminate()` (no
  leído) y en exec-server la terminación se lanza sin esperar [CÓDIGO process.rs].
- Problemas reportados [ISSUE, sin verificar en runtime]:
  - #15379 procesos hijos sobreviven al salir Codex (macOS y Linux `codex exec`, árbol de Chromium reasignado a systemd);
    abierto; un colaborador analiza que la terminación no se espera (https://github.com/openai/codex/issues/15379).
  - #42717 interrumpir un turno deja vivo el proceso unified_exec (https://github.com/openai/codex/issues/42717).
  - #26382 tarea cancelada siguió consumiendo CPU (https://github.com/openai/codex/issues/26382).
  - #47798 Windows: PowerShell huérfano tras timeout creció a ~23 GB (https://github.com/openai/codex/issues/47798).
  - #4337 al vencer un timeout solo muere el `bash -lc` envoltorio, no los hijos (https://github.com/openai/codex/issues/4337).
  - #10767 caso opuesto: usuarios querían que lo lanzado en background persistiera entre turnos (https://github.com/openai/codex/issues/10767).

## 3. Seguridad [DOC https://learn.chatgpt.com/docs/agent-approvals-security]

- Modos de sandbox (`sandbox_mode`): `read-only`, `workspace-write`, `danger-full-access`. En `workspace-write` la **red está
  apagada por defecto** (`[sandbox_workspace_write] network_access = true` la abre). `.git`, `.agents`, `.codex`, `.aws` siguen
  de solo lectura aunque estén dentro de la raíz escribible.
- Aprobaciones (`approval_policy`): `on-request` (por defecto interactivo), `never`, tabla `granular`; `untrusted` está
  retirado y puede impedir arrancar. `approvals_reviewer = "auto_review"` envía solicitudes a un agente revisor primero.
- Preset "Auto" = `workspace-write` + `on-request`: lee, edita y ejecuta en el directorio; pide permiso fuera del espacio o
  para red. Carpetas con control de versiones arrancan en Auto; las demás en `read-only`. `/permissions` cambia modo,
  `/status` muestra directorios. `--yolo` desactiva sandbox y aprobaciones.
- Por plataforma: **macOS** Seatbelt (`sandbox-exec` con perfil por modo); **Linux** `bwrap` + `seccomp` por defecto (Landlock
  solo aparece como alias `codex sandbox landlock`); **Windows** sandbox propio (MXC con `prefer_mxc`, y modos legacy
  `elevated`/`unelevated`); WSL2 usa el de Linux, WSL1 sin soporte desde 0.115. En Docker puede fallar y se sugiere
  `danger-full-access` dentro de un contenedor aislado. `codex sandbox macos|linux|windows` prueba un comando bajo sandbox.
- Proxy de red opcional `[features.network_proxy]` con lista de dominios (deny gana sobre allow; loopback bloqueado por defecto).
- Variables de entorno: `shell_environment_policy` (`inherit`, `filters`...) [DOC].
- Fallback: si el sandbox deniega, el orquestador puede reintentar sin sandbox cuando la política lo permite (tras aprobación)
  [CÓDIGO mod.rs, resumen del ciclo de vida]. `exec_command` puede pedir `require_escalated` con `justification`.
- Qué ve el usuario: aprobaciones con la justificación del modelo y opción de regla por prefijo; salida en vivo por eventos
  `ExecCommandOutputDelta`; evento `TerminalInteraction` cuando se escribe a un proceso. Bug visual: #34115 un proceso vivo se
  ocultó del TUI tras aprobación Guardian; #12278 comandos unified exec ocultos si hay una celda "exploring" activa [ISSUE].

## 4. Paralelismo y aislamiento

- Subagentes: heredan sandbox y aprobaciones del turno padre (incluidos cambios por `/permissions` o `--yolo`); los agentes
  personalizados **no** pueden cambiar `sandbox_mode`, `approval_policy`, `model_provider` ni `mcp_servers`. Si una acción
  necesita aprobación y no hay forma de mostrarla, falla y el error vuelve al padre [DOC subagents].
- Hay que pedir los subagentes explícitamente (salvo AGENTS.md/skills que lo indiquen). Docs advierten: buenos para lectura
  (exploración, pruebas, triage); ediciones en paralelo pueden chocar; consumen más tokens [DOC].
- UI: app de escritorio con panel "Subagents" (Activos/Hechos, solo lectura); CLI `/subagents` para cambiar de hilo; IDE panel
  con "detener todos"; para dirigir/cerrar se le pide a Codex en lenguaje natural [DOC].
- Aislamiento: en la nube, un espacio de trabajo por tarea en entorno propio. Local: sin worktrees automáticos en lo leído; el
  aislamiento es el sandbox del SO y directorios escribibles [DOC/?]. (Worktrees de la app de Codex: no verificado.)
- `codex exec` (modo no interactivo): su página en docs dio 404 en la ruta probada; el resumen de terceros
  (mintlify.com/openai/codex/advanced/exec-mode) no se usó como fuente fiable [?].

## 5. Limitaciones y quejas conocidas (resumen)

1. Sin notificación push: el modelo debe sondear con `write_stdin` (#29865, "not planned") [ISSUE + CÓDIGO].
2. Sin herramienta para listar/matar procesos; solo Ctrl-C por stdin (y únicamente con `tty:true` se acepta más texto) [CÓDIGO].
3. Procesos huérfanos o inmortales tras timeout, interrupción o cierre (#15379, #42717, #26382, #47798, #4337) [ISSUE].
4. Poda silenciosa al llegar a 64 procesos; los 8 más recientes protegidos [CÓDIGO].
5. Truncado cabeza/cola de 1 MiB y 10 000 tokens por respuesta: se pierde el medio del log [CÓDIGO].
6. Windows: plazo mínimo de espera 10 s y reglas extra en la descripción de la herramienta [CÓDIGO]; sandbox distinto.
7. Fallos de visibilidad en el TUI (#34115, #12278) [ISSUE].
8. Subagentes: sin tiempo límite ni profundidad máxima documentados; no pueden endurecer su sandbox por separado [DOC].
9. Docker/contenedores: el sandbox puede no arrancar [DOC].

## 6. Qué conviene copiar o evitar en Lazunox (opinión, no hecho)

- Copiar: sesión con id estable, `yield` acotado + salida parcial, búfer cabeza/cola con contador de omitidos, tope de procesos,
  código de salida 124 en timeout, eventos de salida/fin para la UI separados de lo que ve el modelo.
- Mejorar: lista y cancelación explícitas para modelo y usuario; matar el **grupo** de procesos al cancelar/cerrar y esperar
  confirmación; no podar procesos vivos sin avisar; notificación al modelo al terminar (hoy Codex solo sondea).

## Fuentes

- https://learn.chatgpt.com/docs/agent-approvals-security (antes developers.openai.com/codex/agent-approvals-security)
- https://learn.chatgpt.com/docs/agent-configuration/subagents
- https://learn.chatgpt.com/docs/cloud
- https://learn.chatgpt.com/docs/config-file/config-reference
- https://github.com/openai/codex/tree/main/codex-rs/core/src/unified_exec (mod.rs, process_manager.rs, process.rs, async_watcher.rs, head_tail_buffer.rs)
- https://github.com/openai/codex/tree/main/codex-rs/core/src/tools/handlers (unified_exec.rs, shell_spec.rs, multi_agents_spec.rs, multi_agents_v2.rs)
- Issues: #29865, #15379, #42717, #26382, #47798, #4337, #10767, #34115, #12278 en https://github.com/openai/codex/issues/<n>
