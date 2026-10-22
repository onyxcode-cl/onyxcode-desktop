# Investigación: ¿migrar Lazunox a OpenCode 2.0?

Fecha: 2026-10-22. Solo análisis; no se tocó código, ni se instaló ni ejecutó nada descargado. Los paquetes npm se bajaron como datos (`npm pack`) a un directorio temporal y solo se leyeron sus tipos y README.

## 0. Resumen

- Hoy fijamos 1.19.0 (la última 1.x es 1.19.3, 2026-10-16). La línea 2.x existe y avanza muy rápido: **2.1.2 es del 2026-10-21**, no 2.0.28 (dato de prensa ya desactualizado).
- 2.x **cambió contratos públicos otra vez el 20-oct (2.1.0)**: todavía no está quieta.
- Lazunox depende de rutas, eventos y plugins de la API 1.x (`/session`, `/global/event`, plugins `lazunox-plan-gate`/`lazunox-env`). Casi nada de eso existe igual en 2.x. Migrar es un proyecto real, no una subida de pin.
- Recomendación (sección 4): **esperar y preparar**, no migrar ahora. Mientras, una etapa 0 barata y reversible.

## 1. Qué cambia en 2.0

### 1.1 Hechos confirmados (fuentes primarias)

Fuentes: changelog oficial https://opencode.ai/changelog, landing de v2 https://opencode.ai/v2/docs, paquetes npm publicados por la organización (`@opencode/sdk`, `@opencode/client`, `@opencode/server`, `@opencode/plugin`, todos 2.1.2, publicados por GitHub Actions desde `anomalyco/opencode`), https://opencode.ai/docs/server/ (documenta la API 1.x), https://github.com/anomalyco/opencode/releases (solo lista 1.x; la etiqueta v2.0.0 existe, sin notas).

- **Versiones**: changelog con 2.0.26 (8-oct) a 2.0.32 (16-oct), 2.1.0 (20-oct), 2.1.2 (21-oct). No hay entrada «2.0.0». El changelog dice que las notas de OpenCode 1 están en GitHub Releases.
- **Paquetes nuevos**: `@opencode/client` (cliente Promise con `fetch`, Effect y Solid, generado desde un `HttpApi` de Effect; incluye `service`: descubre y arranca el servicio local) y `@opencode/sdk` (host **en proceso**: ejecuta el router en memoria, sin puerto ni red; `OpenCode.create()`; base de datos en memoria por defecto, `database.path` para persistir). El viejo `@opencode-ai/sdk` sigue en 1.19.3 (`latest`).
- **Servicio compartido**: `@opencode/client/service` define un archivo de registro (en el directorio XDG de estado) con `url`, `pid`, `version` y `password`; el comando por defecto es `opencode serve --service`; se puede exigir versión exacta, reiniciar por `version-mismatch` y detener con manejo de PTY persistentes. Es decir: un proceso por usuario que comparten TUI, web y escritorio.
- **API nueva**: el paquete del servidor 2.1.2 expone **solo rutas `/api/*`** (`/api/session`, `/api/session/{id}/...`, `/api/event`, `/api/permission/request`, `/api/permission/saved`, `/api/credential`, `/api/integration`, `/api/provider`, `/api/model`, `/api/shell`, `/api/pty`, `/api/worktree`, `/api/vcs`, `/api/fs/*`, `/api/mcp`, `/api/plugin`, `/api/form`, `/api/pair`, `/api/websearch`, `/api/experimental/*`...). Busqué en `@opencode/server` `prompt_async`, `/global/event` y `/permission/{id}/reply` y **no aparecen**. Nota: el binario 1.19.0 que usamos ya trae 58 rutas `/api/*` junto a 130 heredadas (`api-routes.json`), o sea 1.19 es un puente.
- **Cambios de contrato en 2.1.0 (20-oct)**: renombra datos de reproducción de proveedor a `native` (mensajes, partes, `tool.native`); quita `Credential.Key.configuration` (pasa a `metadata`); compactación guarda `metadata.keepID`; **se elimina el evento `session.compacted`** (ahora `session.compaction.started/ended`). El changelog dice: «las integraciones deben adoptar los campos nuevos». Sesiones y credenciales viejas siguen legibles; sin migración de base de datos.
- **Plugins**: API nueva (`@opencode/plugin`, Promise y Effect) con ganchos `tool.execute.before/after`, `shell.create.before` (con `env`), `permission.evaluate`, `ctx.permission.assert`, hooks de sesión. Los nombres y formas difieren de los 1.x. El changelog 2.0.30 menciona que la config acepta forma V1 y V2 «durante la migración».
- **Funciones**: Code Mode con herramientas de worktree (2.0.27), permisos auto-aceptados por proyecto (2.0.28), emparejado de dispositivos y cuentas de proveedor (2.0.29), diff por turno (2.0.30), voz experimental (2.0.32), ARM64 de Windows.
- **Distribución v2**: Homebrew `anomalyco/tap/opencode-v2`, npm, binarios autónomos, Docker `ghcr.io/anomalyco/opencode:2.0.0`. **No pude confirmar** el nombre/URL/sha256 del zip por plataforma como el que usa `pin.json` (la lista de GitHub Releases solo muestra 1.x y `opencode-ai` en npm sigue en 1.19.3).

### 1.2 Lo que dice la prensa (sin confirmar en fuente primaria)

Prensa: alternativeto.net, thenewstack.io, aiidelist.com, capitalandcompute.net, aitoolsreview.co.uk, byteiota.com.

- Lanzamiento oficial hacia el 13-oct-2026, tras ~3 meses de beta; confusión sobre si era estable y quejas por falta de notas de versión (The New Stack).
- Subagentes en segundo plano, shell asíncrono, «todos los MCP en Code Mode por defecto», plugins TUI estables con recarga en caliente, `opencode upgrade --major`, «1.19.0 deja de autoinstalar actualizaciones». Los plugins 1.x incompatibles y la API rediseñada sí coinciden con los paquetes. El resto (MCP por defecto en Code Mode, ruta de actualización) queda como «según prensa».
- Sin pruebas propias: no ejecuté ningún binario v2 (regla de esta tarea). Cualquier comportamiento en tiempo de ejecución es hipótesis.

## 2. Inventario: qué usa Lazunox del motor

### 2.1 Arranque, versión y empaquetado

- `resources/opencode-bin/pin.json` (1.19.0, URL de `anomalyco/opencode`, sha256 y tamaño por plataforma: darwin-arm64, win32-x64, linux-x64 para WSL) y `scripts/fetch-opencode.mjs` (verifica tamaño y sha256). Los zips son el formato **1.x**.
- `src/main/opencode/server.ts`: lanza `opencode serve --port N --hostname 127.0.0.1 --cors ...` con Basic Auth aleatorio (`OPENCODE_SERVER_USERNAME/PASSWORD`), `OPENCODE_CONFIG_CONTENT` (config inline) y `OPENCODE_CONFIG_DIR`; vía `withDisclaim` (TCC). Resto: `binary.ts`, `pids.ts`, `data-dir.ts`, `catalog-wait.ts` (espera el catálogo de modelos), `config.ts`.
- `docs/ACTUALIZAR-OPENCODE.md`: política manual ~mensual, sin autoupdate (`OPENCODE_DISABLE_AUTOUPDATE=1`).
- `scripts/check-opencode.mjs` + `scripts/opencode-contract-lib.mjs` + `resources/opencode-bin/api-routes.json` (188 rutas; 45 «usadas» con forma de esquema) + `src/test/opencode-contract.test.ts` (compara contra el SDK fijado). El control mide `/doc` de `opencode serve`.
- `package.json` `@opencode-ai/sdk` 1.19.0.

### 2.2 Rutas HTTP usadas (45; derivadas del código)

- **Sesiones**: `POST/GET/PATCH/DELETE /session`, `/session/{id}` (+`/message`, `/message/{id}`, `/children`, `/todo`, `/abort`, `/fork`, `/revert`, `/unrevert`, `/summarize`, `/command`, `/prompt_async`), `GET /session/status`, `GET /experimental/session`.
- **Eventos**: `GET /global/event` (SSE). Lo consume el renderer (`client.global.event`, 8 sitios) y se reenvía al celular por `sub{eng}` (`src/main/remote/sse-hub.ts`); `src/main/telegram/engine-link.ts` documenta que el motor de Telegram aún no lo ve en main.
- **Permisos y preguntas**: `GET /permission`, `POST /permission/{requestID}/reply` (renderer, `auto-approver.ts` en main, scheduler de rutinas, remoto clase D), `GET /question`, `POST /question/{id}/reply|reject`. Ya hay un uso de `/api/session/{id}/permission/{requestID}/reply` y `/api/permission/saved/{id}` en la política remota.
- **Config y proveedores**: `GET /config`, `GET /config/providers`, `GET /provider`, `GET /provider/auth`, `POST /provider/{id}/oauth/callback`, `PUT/DELETE /auth/{providerID}` (claves; `auth.json` en el data dir del motor), `src/main/providers/key-probe.ts`.
- **Otros**: `GET /command`, `GET /skill`, `/mcp` (+`connect`, `disconnect`, `auth/authenticate`), `GET /file`, `/file/content`, `/file/status`, `/find/file`, `/vcs/diff/raw`, `POST /global/dispose`, `GET /global/health`.
- Superficie en código: ~77 archivos no-test importan `@opencode-ai/sdk` (tasks 18, code 12, chat 10, settings 6, lib/conversation, remote, telegram, stores...). Llamadas más frecuentes: `session.messages` (22), `session.abort` (18), `session.status` (15), `session.update/delete` (13), `promptAsync` (12), `permission.list/reply` (10/8), `global.event` (8).

### 2.3 Config, agentes, skills y plugins propios

- `resources/opencode/agents/{chat,tasks,computer}.md` y `agents-win/`; skills `docx, xlsx, pdf, pptx, ruta-rapida, soporte-remoto, _shared` (`SKILL.md`, descubiertas vía `OPENCODE_CONFIG_DIR/skills` y `GET /skill`). Se copian a `userData/opencode-config/` (`src/main/tasks/opencode-config.ts`).
- **Plugins 1.x generados**: `lazunox-env.js` (gancho `shell.env`: oculta secretos a bash/pty), `lazunox-session.js` (`tool.execute.before` inyecta `lazunox_session` en `browser_*`) y **`lazunox-plan-gate.js`** (zona intocable: sin plan aprobado no corre ninguna herramienta de acción; usa `tool.execute.before` y canal lateral con token). Escritos y verificados contra el bundle de 1.18.32.
- Config inline (`buildInlineConfig`, `inline-config.ts`, `config-merge.ts`), MCP propios (navegador integrado, computer use, `mcp-proxy.ts`, `mcp-tasks.ts`).

### 2.4 Sidecar por carpeta, sandbox y credenciales

- `src/main/tasks/sandbox.ts` + `backends/seatbelt.ts` + `sandbox-profile.ts`: un `opencode serve` **dedicado por carpeta** dentro de `sandbox-exec`; HOME/XDG propios, `models-cache.ts` copia el catálogo `models.json` y `bin/rg` porque el sandbox no tiene red libre. WSL2 en Windows (`backends/wsl*.ts`).
- `proxy.ts` (`CredentialProxy`/`EgressProxy`), `provider-egress.ts`, `sandbox-credentials.ts`: la clave real vive fuera; el servidor del sandbox usa una falsa y baseURL local.
- Control remoto: `src/main/remote/engine-proxy.ts` y `policy.ts` clasifican **cada ruta del motor** (R/M/D/X; denegar por defecto). Una ruta nueva sin clase = rechazo (hay pruebas que lo exigen).

### 2.5 Puntos de restauración, permisos, pruebas

- Restore points (`src/main/tasks/restore-points.ts`, `tasks-restore-handlers.ts`, `storage.ts`) son propios de Lazunox; además se usan `session.revert/unrevert` y `/vcs/diff/raw` del motor.
- Permisos/aprobaciones: tarjetas del renderer + `auto-approver.ts` + modo auto (`auto-mode.ts`) + `command-denylist.ts` remoto.
- **OpenCode falso**: `e2e/fake-opencode/server.mjs` (1558 líneas) y `server.test.mjs` implementan las rutas 1.x anteriores y SSE; todo el E2E depende de él. Recordatorio de la propia guía: no basta para validar el motor real.

## 3. Matriz de riesgo y qué se rompería

| Área | Riesgo | Qué se rompe |
| --- | --- | --- |
| Cliente SDK en renderer/main (77 archivos, 45 rutas) | **Alto** | Todas las rutas heredadas salvo quizá una; el paquete `@opencode-ai/sdk` no se publica para 2.x; modelo de datos de mensajes/partes cambia (`native`, sesiones, eventos). Reescritura de capa de datos, stores y tipos. |
| SSE `/global/event` y forma de los eventos | **Alto** | Hay `/api/event` y `/api/session/{id}/event` con otro esquema; `session.compacted` desaparece. Afecta UI, progreso, remoto (`sse-hub`) y Telegram. |
| Plugins `lazunox-plan-gate`, `lazunox-env`, `lazunox-session` | **Alto (seguridad)** | Plugins 1.x incompatibles. La puerta del plan es control de seguridad: se reescribe con `tool.execute.before`/`permission.evaluate` de la API nueva y se vuelve a auditar (zona intocable, decisión del dueño). |
| Sidecar por carpeta con Seatbelt | **Alto** | El modelo 2.x es **un servicio compartido** (`serve --service`, registro XDG). Hay que comprobar que se pueda seguir lanzando un servidor aislado por carpeta con HOME/XDG propios y sin reutilizar el servicio global; si no, se rompe el aislamiento. Sin probar. |
| Permisos y aprobaciones (UI, `auto-approver`, remoto, rutinas, Telegram) | **Alto** | Rutas `/permission/{id}/reply` y `/question` cambian a `/api/permission/request`, `/api/form`; permisos guardados nuevos. |
| Autenticación/credenciales (`PUT /auth`, `auth.json`, OAuth) | **Alto** | Pasan a `/api/credential` + `/api/integration`; `configuration` → `metadata`; `auth.json` puede no ser el almacén. Afecta `ProviderKeyForm`, proxy de credenciales, sandbox-credentials. |
| Control remoto y política de rutas | **Medio-alto** | Cada ruta nueva exige clase en `policy.ts`; el celular/PWA usa rutas del motor. (Está pausado, pero hay pruebas que bloquean.) |
| Fake de E2E | **Alto (esfuerzo)** | Reescribir ~1.5k líneas para la API nueva; mientras tanto, doble mantenimiento. |
| Contrato/pin/actualizador (`check-opencode`, `api-routes.json`, `fetch-opencode`, `pin.json`) | **Medio** | La herramienta de contrato asume `/doc` de OpenAPI de `serve`; origen y formato del binario v2 sin confirmar. No toca el actualizador de la app (Lazunox se actualiza a sí mismo). |
| Restore points | **Bajo-medio** | Son propios; dependen de `revert/unrevert` y de diffs del motor. |
| Agentes `.md` y skills `SKILL.md` | **Bajo-medio** | Probable compatibilidad (el changelog dice que la config acepta V1 y V2); verificar frontmatter, permisos por agente y `GET /skill` (`/api/skill`). |
| Catálogo de modelos (`models.json`, cache sembrado al sandbox) | **Medio** | `/api/model`, `/api/provider`, otro lugar de caché; el truco de sembrar `bin/rg` y el catálogo hay que rehacerlo. |
| MCP | **Medio** | `/api/mcp`; «Code Mode por defecto» (prensa) cambia cómo se ven las herramientas MCP en `tool.execute.before` y en la tarjeta de permiso. |
| Windows/WSL (rootfs con OpenCode dentro) | **Medio-alto** | Otro binario, otro rootfs, otra prueba por RDP/SSH. |

## 4. Estrategia recomendada

**No migrar ahora.** Motivos: (1) 2.x rompió contratos hace dos días; (2) no hay forma documentada de fijar y verificar un binario v2 como hacemos hoy; (3) lo que nos aporta se logra en parte con 1.19.x; (4) el costo toca todas las zonas intocables de seguridad.

Qué hacer en su lugar:

1. **Seguir en 1.19.x** (subir a 1.19.3 si hace falta, con el procedimiento actual). Es una línea que aún recibe versiones.
2. **Etapa 0 (barata, ya)**: aislar el motor detrás de una capa propia, empezando por lo que no cambia el comportamiento.
3. **Cuando 2.x pase unas semanas sin romper contratos**, hacer un spike con el motor real (sección 4.2).

### 4.1 Diseño objetivo si se migra

- **Adaptador de motor** (`EngineClient`): una interfaz mínima propia (sesiones, mensajes normalizados, eventos normalizados, permisos, credenciales, proveedores, MCP) con dos implementaciones: `v1` (SDK actual) y `v2` (`@opencode/client`). El renderer y main dejan de importar `@opencode-ai/sdk`.
- **Eventos normalizados**: traducir `/global/event` y `/api/event` a un conjunto propio (`session.status`, `message.part`, `permission.asked`...). Es lo más delicado.
- **Dos motores tras bandera** (en `feature-flags`, apagada por defecto): `engine: 'v1' | 'v2'`, elegible por carpeta/sesión nueva (no migrar sesiones en vuelo). Mantener el pin v1 y añadir `pin-v2.json`.
- **Fake en dos modos**: `fake-opencode` v1 intacto y un `fake-opencode-v2` mínimo; o grabar tráfico del motor real para generar el fake.
- **Rama larga** `feat/motor-v2` con rebase frecuente; fusionar por etapas bajo bandera, nunca todo al final.
- **Pruebas con el motor real** (por CDP, como pide la memoria del proyecto): cada etapa se valida con modelo gratuito en Mac y Windows; el fake no basta.

### 4.2 Plan por etapas y esfuerzo (estimación gruesa, 1 desarrollador + agentes)

| Etapa | Contenido | Esfuerzo |
| --- | --- | --- |
| 0 | Inventario de llamadas al SDK en una sola capa (`engine/` con tipos propios); sin cambiar el comportamiento; suites en verde | 1-2 semanas |
| 1 | Spike con el binario v2 real en un directorio temporal (Mac, HOME/XDG temporales): ¿`serve` por carpeta aislado funciona?, ¿se puede desactivar el servicio compartido?, esquema de eventos, `/api/permission`, credenciales. Documento de hallazgos | 3-5 días |
| 2 | Adaptador v2: sesiones, mensajes, SSE normalizado, permisos y preguntas | 3-4 semanas |
| 3 | Credenciales/proveedores/modelos/OAuth, catálogo, sembrado de caché en sandbox | 1-2 semanas |
| 4 | Reescritura y re-auditoría de los plugins (plan-gate, env, session) con la API nueva; pruebas de seguridad (`docs/SEGURIDAD.md`) | 2-3 semanas |
| 5 | Sidecar Seatbelt/WSL con motor v2, restore points, MCP y Code Mode | 2-3 semanas |
| 6 | Fake v2, E2E, `check-opencode` para v2, `policy.ts` remoto, Telegram | 2-3 semanas |
| 7 | Windows/WSL (rootfs), release y cohorte de prueba bajo bandera | 2 semanas |

Total: **~3-4 meses** calendario con otras cosas en paralelo (~12-18 semanas-persona). Alto riesgo de retrabajo si 2.x sigue cambiando contratos cada pocas semanas.

### 4.3 Cuándo conviene esperar

Empezar la etapa 1 cuando se cumpla **todo**: (a) hay documentación oficial de la API de servidor v2 y de migración; (b) varias versiones 2.x seguidas sin cambios de contrato público; (c) binarios por plataforma con checksum publicado (para `pin`); (d) se confirme que se puede lanzar un servidor aislado por carpeta. Señales útiles: que `opencode-ai` en npm y las GitHub Releases pasen a 2.x, o que 1.x deje de recibir versiones.

## 5. Ventajas reales para Lazunox vs costo

| Función de 2.x | ¿Nos sirve? | Comentario |
| --- | --- | --- |
| Servicio compartido en segundo plano | Poco, hasta contraproducente | Nuestra seguridad se apoya en un servidor por carpeta, con su propio entorno y sandbox. Un servicio por usuario que además atiende al TUI es lo contrario; riesgo de mezclar credenciales y sesiones. |
| Subagentes y shell en segundo plano | **Sí, valioso** | Tareas largas sin bloquear el chat y rutinas. Requiere diseñar UI de estado y permisos. |
| Code Mode (scripts que encadenan MCP/OpenAPI) | Quizá | Menos pasos y menos tokens para MCP; pero cambia cómo aprobamos herramientas (la puerta del plan debe ver cada llamada anidada). |
| `@opencode/sdk` en proceso | No para el sandbox | Sin puerto es elegante, pero rompe el modelo «proceso aparte dentro de Seatbelt». |
| Rendimiento (instantáneas más rápidas, etc.) | Incierto | Sin medición propia. |
| Modelos/proveedores nuevos (Vertex, cuentas, voz) | Algo | Ya cubrimos casi todos con 1.19; la voz y el emparejado (`pair`) duplican cosas nuestras (control remoto). |
| Permisos guardados por proyecto, diff por turno | Sí, pero | Se pueden hacer por nuestra cuenta o esperar. |

Conclusión: 2.x trae ideas buenas (segundo plano, Code Mode), pero nada que hoy bloquee a Lazunox, y el costo recae sobre las áreas más sensibles. El proyecto es sin fines de lucro y de recursos limitados: no conviene gastar ~4 meses en reescribir lo que ya funciona.

## 6. Preguntas abiertas para Ben

1. ¿Qué función concreta de 2.x te importa más (subagentes en segundo plano, Code Mode, otra)? Eso decide si se puede hacer en 1.x o si justifica migrar.
2. ¿Aceptas mantener dos motores (v1 y v2) tras bandera durante meses, con el doble de pruebas?
3. ¿Autorizas un spike de 3-5 días con el binario v2 real (en directorio temporal, sin tocar datos reales) para responder la duda del aislamiento por carpeta?
4. La puerta del plan y los plugins de seguridad son zona intocable: ¿apruebas rehacerlos y auditarlos de nuevo si se migra?
5. ¿Prioridad frente a otras líneas (Telegram 1.2, traducciones, remoto pausado)?
6. ¿Subimos mientras tanto a 1.19.3 (nota de 16-oct: variantes de razonamiento) o nos quedamos en 1.19.0 por estabilidad?
7. ¿Hay clientes con sesiones guardadas que haya que conservar? El changelog dice que las sesiones viejas siguen legibles, pero no lo comprobé.

## Límites de esta investigación

No ejecuté binarios v2 ni arranqué `serve`; las afirmaciones sobre el servidor v2 salen de tipos, README y changelog. No pude leer docs de API v2 (la landing no las enlaza). Prensa y changelog pueden estar incompletos; no se validó «Code Mode por defecto» ni `upgrade --major`.
