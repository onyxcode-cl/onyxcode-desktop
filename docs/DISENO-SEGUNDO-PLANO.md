# Diseño unificado: subagentes y shell en segundo plano para Lazunox

Fecha: 2026-10-22. Une lo aprendido en `INVESTIGACION-CLAUDE-CODE-SEGUNDO-PLANO.md`, `INVESTIGACION-CODEX-SEGUNDO-PLANO.md`,
`ANALISIS-OPENCODE-2-FUNCIONES.md` y `ANALISIS-OPENCODE-1-BASE.md`. Es una propuesta: nada de esto está implementado ni probado de punta a punta.
Los datos de cada producto llevan en sus documentos la marca de cuán confirmados están; aquí solo se usan como referencia de diseño.

## 1. Cómo lo hace cada uno

|                        | Claude Code                                                                                            | Codex                                                                                         | OpenCode 1.19 (nuestra base)                                     | OpenCode 2.x                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Shell largo            | `run_in_background` → id + archivo de salida; se lee con la herramienta de lectura; `TaskStop` cancela | `exec_command` devuelve parcial + `session_id` tras 10 s; se consulta con `write_stdin` vacío | Solo tiene tiempo límite (2 min) y mata al vencer                | Trabajo en segundo plano con salida a archivo, sin tiempo límite, eventos `shell.*` |
| Al vencer el plazo     | Pasa a segundo plano, **no muere**                                                                     | No vence: el modelo sondea                                                                    | **Mata**                                                         | No vence                                                                            |
| Aviso de fin al modelo | Sí para subagentes (despierta al padre); para shell, solo según el texto de la herramienta             | **No**: solo sondeo (pedirlo fue «not planned»)                                               | Sin confirmar                                                    | Sí: mensaje sintético que despierta al padre                                        |
| Subagentes             | En segundo plano por defecto, contexto aislado, `agent_id`, 20 a la vez, 3 niveles                     | `spawn_agent` / `wait_agent` / `list_agents`…; heredan sandbox y aprobaciones                 | `task` con `background` experimental (variable de entorno)       | Registro de trabajos común; se reanudan tras reiniciar                              |
| Lista y cancelar       | El usuario: `/tasks`; el modelo no lista shells                                                        | Sin lista ni kill (solo Ctrl-C por stdin)                                                     | Ruta `/experimental/session/:id/background` para mandar al fondo | `Job` con lista y cancelar                                                          |
| Al cerrar              | Limpia, incluidos procesos desacoplados                                                                | Varios issues de huérfanos                                                                    | Sin confirmar                                                    | Shell queda cancelado; subagentes se reanudan                                       |
| Límites                | Salida > 5 GB mata; memoria opcional                                                                   | 64 procesos (poda LRU), búfer 1 MiB, 10 000 tokens por respuesta                              | —                                                                | Sin límite por defecto                                                              |

## 2. Lecciones (qué copiar y qué evitar)

**Copiar**

1. _Pasar al fondo en vez de matar_ al vencer el plazo (Claude Code). Es lo que pide Ben: no cortar algo que va bien.
2. _Salida a archivo y lectura incremental_ (Claude Code, OpenCode 2.x): el modelo no llena su contexto con salida larga.
3. _Aviso de fin que despierta al modelo_ (Claude Code y OpenCode 2.x) en vez de obligarlo a sondear (Codex, que lo rechazó y lo paga en tokens).
4. _Los subagentes heredan permisos y sandbox del padre_ (Codex, Claude Code).
5. _Lista y cancelar visibles para la persona_ (Claude Code `/tasks`).

**Evitar** (quejas confirmadas en issues, estado incierto)

- Que algo lanzado por un subagente muera cuando el subagente vuelve y el aviso nunca llegue (Claude Code #83627).
- Procesos huérfanos tras interrupción o cierre (Codex y Claude Code).
- Podar procesos vivos por una cuota (Codex: LRU puede matar uno en marcha).
- En 2.x: Code Mode con `fetch` sin permiso, «siempre» guardado para todo el proyecto y credenciales en SQLite sin cifrar.

## 3. Propuesta para Lazunox

### 3.1 Subagentes en segundo plano

- Encender `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` (solo esa; **no** `OPENCODE_EXPERIMENTAL` a secas) en el sidecar de Chat/Code y de Overdrive.
- Interfaz en Lazunox: lista de trabajos de la sesión (ya se muestra «N subagentes»), cancelar y, opcional, «mandar al fondo» con la ruta experimental existente.
- Comprobar en la app real: (a) que el aviso de fin llegue y despierte al padre, (b) que `lazunox-plan-gate` aplique el plan a las sesiones hijas, (c) qué pasa al reiniciar, (d) que los permisos de las hijas lleguen a la persona.

### 3.2 Shell en segundo plano supervisado (`shell_bg`, MCP propio dentro del sandbox)

Herramientas para el modelo: `start(comando)` → `id`; `status(id)`; `read(id, desde)`; `stop(id)`; `list()`.

- **Sin plazo fijo.** Mientras haya señales de vida sigue: salida nueva, CPU del proceso o de sus hijos, archivos que crecen.
- **Sin señales durante un rato** (configurable): no se mata solo; se avisa al modelo y a la persona («lleva N min sin salida ni CPU, ¿seguir o cortar?»). Un comando lento que va bien continúa; uno colgado no se queda en bucle.
- **Aviso de fin** al modelo (mensaje que despierta el turno), con código de salida y las últimas líneas.
- **Salida a archivo** con tope de tamaño (recorte cabeza/cola) y lectura incremental.
- **Se cierra siempre**: al terminar, al cerrar la sesión y al cerrar la app (grupo de procesos); al arrancar se limpian los restos.
- **Dentro del sandbox** (Seatbelt) y con los mismos permisos/aprobaciones que el shell normal; nada de red nueva.
- **Tope de concurrencia** por sesión (sin podar procesos vivos: se rechaza uno nuevo).
- Una tarea lanzada por un subagente **no muere con él**: la posee la sesión raíz.

### 3.3 Code Mode

Solo para pruebas con `OPENCODE_EXPERIMENTAL_CODE_MODE` (MCP, sin `fetch`). No portar el de 2.x.

## 4. Qué NO hacemos ahora

- Migrar a OpenCode 2.x ni mantener un fork del motor (ver `INVESTIGACION-OPENCODE-2.md`, `SPIKE-OPENCODE-2.md`, `ANALISIS-OPENCODE-1-BASE.md`).
- Tocar las zonas intocables de seguridad sin revisión: el plugin del shell y el MCP nuevo entran por la puerta del plan y los permisos existentes.

## 5. Orden de trabajo

1. Probar en la app real las variables de subagentes en segundo plano (CDP, modelo gratuito) y anotar qué se cumple de 3.1.
2. Interfaz de la lista de trabajos y cancelar.
3. `shell_bg` con sus pruebas (señales de vida, cierre, sandbox, aviso de fin), primero en Code/Chat, luego Overdrive.
4. Revisión de seguridad dirigida (plan-gate en hijas, permisos, sandbox) antes de activarlo por defecto.

## 6. Preguntas abiertas para Ben

- ¿El «mandar al fondo» a mano es necesario o basta con lista + cancelar?
- ¿Cuánto tiempo sin señales de vida antes de preguntar? (propuesta: 15 min, ajustable)
- ¿Los trabajos en segundo plano deben sobrevivir si se cierra Lazunox? (propuesta: no; se cierran y se avisa al volver)
- ¿Primero Chat/Code o Overdrive?
