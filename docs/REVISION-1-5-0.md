# Revisión de la 1.5.0: qué mirar antes de fusionar

Rama `feat/engine-client` (71+ commits sobre `main`, sin push). Esta lista es lo que conviene que una persona lea con atención ANTES de fusionar y publicar: son los cambios que tocan zonas intocables o seguridad. Para cada uno: `git show <hash>` (diff completo) y `git show --stat <hash>`.

## Commits de seguridad / zonas intocables

| Commit | Qué | Archivos |
| --- | --- | --- |
| `c62c35de` | ZONA INTOCABLE: el servidor de Tareas con sandbox recibe el canal del guardián (F8-B208) | src/main/tasks/guard-info.seatbelt.test.ts | 158 +++++++++++++++++++++++++++++;  src/main/tasks/manager.ts                  |  16 +++;  src/main/tasks/manager.winpaths.test.ts    |   9 ++;  src/main/tasks/opencode-config.ts        |
| `ccf81605` | Tareas: canal de solo lectura en main para el guardián de subagentes (F8-B208) | src/main/tasks/guard-info.test.ts | 140 +++++++++++++++++++++++++++++++++;  src/main/tasks/guard-info.ts      | 159 ++++++++++++++++++++++++++++++++++++++;  src/main/tasks/mcp-proxy.test.ts  |  74 ++++++++++++++++++;  src/main/tas |
| `c60258cb` | Guardián de subagentes: usa el canal de main si existe (Tareas con sandbox) (F8-B208) | src/main/opencode/subagent-guard.test.ts | 118 +++++++++++++++++++++++++++++++;  src/main/opencode/subagent-guard.ts      |  36 +++++++++-;  2 files changed, 151 insertions(+), 3 deletions(-) |
| `f6d2af76` | ZONA INTOCABLE: revertir la salida al puerto propio del motor en Seatbelt (revierte 53901267) | src/main/tasks/__fixtures__/seatbelt-before.json   | 10 +--;  .../__snapshots__/sandbox-profile.test.ts.snap     |  1 -;  src/main/tasks/sandbox-profile.selfport.test.ts    | 90 ----------------------;  src/main/tasks/sandbox-prof |
| `f6b09c6b` | Guardián de subagentes: motivo propio cuando el motor no responde; docs de F8-B208 | CHANGELOG-FASE8.md                       |  7 ++++++;  docs/SEGURIDAD.md                        | 41 +++++++++++++++++++++++++++++++-;  src/main/opencode/subagent-guard.test.ts | 30 ++++++++++++++++++++++-;  src/main/opencode/suba |
| `53901267` | ZONA INTOCABLE: Seatbelt de Tareas permite la salida al puerto propio del servidor (F8-B208) | src/main/tasks/__fixtures__/seatbelt-before.json   | 10 +--;  .../__snapshots__/sandbox-profile.test.ts.snap     |  1 +;  src/main/tasks/sandbox-profile.selfport.test.ts    | 90 ++++++++++++++++++++++;  src/main/tasks/sandbox-prof |
| `b6a86361` | ZONA INTOCABLE: plugin lazunox-session también inyecta la sesión en bgshell_* (aviso de fin a la sesión dueña) | scripts/engine-probe/harness.mjs      |  3 +-;  scripts/engine-probe/run.mjs          | 85 +++++++++++++++++++++++++++++++++--;  src/main/tasks/opencode-config.ts     |  7 +--;  src/main/tasks/session-plugin.test.ts | 66 +++++++++ |
| `36a2e355` | Docs: resultados de la prueba real con OpenCode Go (Code Mode, subagentes, guardián, vigilante) | docs/PRUEBA-REAL-GO.md | 25 +++++++++++++++++++++++++;  1 file changed, 25 insertions(+) |
| `2bf71dd8` | Contrato: instantánea con GET /agent (guardián de subagentes) y claves PWA al día | resources/opencode-bin/api-routes.json  |  1 +;  src/renderer/remote/i18n-core-keys.json | 10 ++++++++++;  2 files changed, 11 insertions(+) |
| `ecf0c180` | Modo automático: nunca aprueba solo una petición de una hija (ZONA INTOCABLE) | src/main/tasks/auto-approver.children.test.ts | 127 ++++++++++++++++++++++++++;  src/main/tasks/auto-approver.ts               |   5 +;  2 files changed, 132 insertions(+) |
| `739c9594` | Subagentes: guardián de task (sin escalada de permisos) y rechazos dentro de Code Mode (ZONA INTOCABLE) | resources/opencode/agents/lazunox-helper.md |  23 ++;  resources/opencode/agents/tasks.md          |   6 +-;  src/main/opencode/subagent-guard.test.ts    | 318 ++++++++++++++++++++++++++++;  src/main/opencode/subagent-guard.ts     |
| `7fc0a69a` | Puerta del plan: las hijas de task heredan la aprobación de la RAÍZ (ZONA INTOCABLE) | src/main/tasks/opencode-config.ts            |  78 +++++++--;  src/main/tasks/plan-gate.inheritance.test.ts | 234 +++++++++++++++++++++++++++;  2 files changed, 303 insertions(+), 9 deletions(-) |
| `76f29d59` | Tareas (manager.ts, zona del plan-gate): opts.extraEngineEnv mezcla solo variables OPENCODE_EXPERIMENTAL_* ya validadas en extraEnv; sin tocar plan ni permisos | src/main/tasks/manager.engine-flags.test.ts | 90 +++++++++++++++++++++++++++++;  src/main/tasks/manager.ts                   |  5 ++;  2 files changed, 95 insertions(+) |

## Preguntas de seguridad que la revisión debería responder

1. **Herencia del plan (`7fc0a69a`)**: ¿una hija solo hereda la aprobación de la RAÍZ y nunca se aprueba sola? ¿Se deniega ante sesión desconocida, ciclo, profundidad o error del motor?
2. **Guardián de `task` (`739c9594`, `c60258cb`)**: ¿falla cerrado? ¿Compara bien `deny < ask < allow` contra el permiso efectivo del padre?
3. **Modo automático (`ecf0c180`)**: ¿nunca aprueba por una hija ni con la raíz sin resolver?
4. **`manager.ts` (`76f29d59`, `c62c35de`)**: ¿solo mezcla variables validadas (`OPENCODE_EXPERIMENTAL_*`, canal del guardián)? ¿Va primero para no pisar el plan ni los proxies?
5. **Sandbox de Overdrive (`f6d2af76` revierte `53901267`)**: el puerto del motor sigue cerrado; el canal del guardián (`ccf81605`) es de solo lectura, con token, y solo expone `{id, parentID, agent, permission}`.
6. **Plugin `lazunox-session` (`b6a86361`)**: ¿la sobrescritura del argumento impide que el modelo fije la sesión? ¿Aplica también a las llamadas internas de Code Mode?
7. **Permisos de conectores en Code (`55e11440`, `6ea60099`)**: ¿cada conector no confiado queda en `ask`? ¿`gmail_send: deny` sigue ganando a un `gmail_*: allow`?
8. **`extras-handlers.ts`**: cambio de `afterMcpChange` (relanzar el motor al cambiar conectores). Por AGENTS §3 exigía build + E2E: la E2E completa pasó.
9. **Permisos de carpeta de macOS (`21305f90`)**: `tccutil reset` con servicio de lista fija, solo con clic, sin shell ni sudo.

## Lo que NO se pudo probar (hazlo tú o acéptalo)

- El permiso real de macOS: negar una carpeta, ver la tarjeta, pulsar «Volver a preguntar» y comprobar que macOS vuelve a preguntar (el agente no puede tocar ajustes de privacidad).
- Windows (WSL): guardián, `bgshell` y el canal del guardián.
- Overdrive con `bgshell` y con el aviso agrupado; `Control total` con herencia del plan en vivo.
- Un Word real y complejo.

## Validación hecha

- VPS (Linux, contenedor): 10 059 pruebas, 9 702 pasan, 0 fallan; `tsc` limpio.
- E2E completa en el Mac: sin fallos (una spec del navegador integrado falló una vez porque la persona usaba el Mac; repetida sola pasa 5/5).
- Pruebas reales con OpenCode Go (Claude Haiku 5.5): subagentes en segundo plano en Code y Overdrive, Code Mode, `bgshell` con aviso agrupado, guardián de `task`, vigilante de 60 s. Detalle en `docs/PRUEBA-REAL-GO.md`.

## Cómo seguir (cuando esté revisado)

1. Fusionar: `git checkout main && git merge --no-ff feat/engine-client`.
2. `scripts/release.sh prepare 1.5.0` y luego las fases `mac`, `win`, `draft`.
3. `publish` lo ejecuta la persona en su Terminal (exige frase de confirmación).
4. Antes de cualquier push: revisión de secretos (guardia y gancho pre-push).
