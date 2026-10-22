# Prueba real con OpenCode Go: Code Mode y subagentes en segundo plano

Fecha: 2026-10-22. App de desarrollo (rama `feat/engine-client`) con una COPIA mínima del perfil de Ben (sin tokens de Telegram ni del remoto),
llavero falso, motor 1.19.0 incluido y las dos funciones encendidas solo en esa copia. Modelo: Claude Haiku 5.5 de OpenCode Go. Todo en un proyecto
temporal con 4 archivos. La copia y su perfil se borraron al terminar. Los conectores externos de Ben (CRM, Gmail) aparecieron conectados porque el motor lee
`~/.config/opencode`; no se usaron ni se aprobó ninguna llamada a ellos.

| Prueba | Resultado |
| --- | --- |
| Interruptores de «Funciones experimentales» | Funcionan; se guardan en `settings.json` y reinician el motor |
| Subagentes en segundo plano (`task` con `background`) | FUNCIONA: dos `lazunox-helper` lanzados, cada uno pidió permiso con su nombre, terminaron en 2 s, el padre recibió los avisos y resumió; la banda «Trabajos en segundo plano» los mostró |
| Guardián de `task` con un modelo real | FUNCIONA: `general` bloqueado («tendria mas libertad que quien lo lanza (build): bash, edit, write, webfetch, websearch») y no se creó el archivo |
| Code Mode (`execute`) llamando a 3 herramientas MCP (`lz_shell_bg_*`) | FUNCIONA (con una cara: el resultado de MCP llega como texto JSON, no como objeto) |
| Vigilante: `while(true){}` en `execute` | FUNCIONA: corta al minuto; PERO el mensaje dice «Detenido por el usuario» |
| `shell_bg` real como conector local | FUNCIONA: iniciar, listar, estado, salida |

## Hallazgos
1. **En Code los conectores MCP se ejecutan SIN pedir permiso**, en «Preguntar siempre», con o sin Code Mode (comprobado apagando Code Mode: la llamada directa a
   `lz_shell_bg_start` tampoco preguntó). Con Code Mode encendido las herramientas MCP solo son alcanzables vía `execute`. Consecuencias: (a) `shell_bg` esquivaría
   el permiso de `bash` → hay que darle regla `ask` y puerta del plan antes de conectarlo; (b) el texto de Ajustes «cada herramienta sigue pidiendo permiso» no es cierto
   para MCP en Code; (c) Gmail/CRM conectados serían alcanzables sin aprobación. Es comportamiento previo de la app; falta decisión de producto.
2. **`shell_bg` no despierta al modelo al terminar**: el modelo dijo «me avisarán» pero no hay nada cableado (los avisos van a un archivo JSONL). Hace falta inyectar un
   mensaje en la sesión (necesita saber la sesión dueña).
3. Mensaje del vigilante: «Detenido por el usuario» → debe decir que fue el límite de seguridad.
4. No se probó Overdrive (con llavero falso su motor no arranca) ni Chat (el agente `chat` no tiene `task`).

## Estado tras la integración (2026-10-22, rama `feat/engine-client`)

Comprobado con el motor 1.19 real, aislado y sin modelo (proveedor falso local, `scripts/engine-probe/run.mjs`, 27 comprobaciones), y con
pruebas unitarias. Falta repetir esta prueba en la app real con OpenCode Go.

| Hallazgo | Estado |
| --- | --- |
| 1. Conectores MCP sin permiso en Code | CORREGIDO (F8-B203): preguntan salvo los internos y los marcados «Sin preguntar en Code», directos y desde `execute`; las herramientas bloqueadas siguen bloqueadas aunque se confíe en el conector. El texto de Ajustes ya es cierto. Ver `docs/SEGURIDAD.md` §3 sexagies bis |
| 1a. `shell_bg` esquivaría el permiso de `bash` | CORREGIDO (F8-B204): ahora es `bgshell` (`bgshell_start`, …) y `bgshell_start` pregunta como `bash` en cada modo; no se abre marcándolo de confianza |
| 1c. Gmail/CRM externos (`~/.config/opencode`) alcanzables sin aprobación | CORREGIDO para los de la config global (se leen antes de arrancar) y para los que el motor reporte (relanzamiento sin turnos en curso). Queda una ventana para los que solo declara la config de un proyecto |
| 2. `shell_bg` no despierta al modelo | CABLEADO (F8-B204/F8-B205): el plugin `lazunox-session` inyecta la sesión en `bgshell_*` (también desde `execute`), el aviso `exit` la lleva y `ShellBgWake` despierta a la sesión raíz. Comprobado hasta el JSONL con el `bgshell` real; el turno nuevo con un modelo real, sin probar |
| 3. «Detenido por el usuario» del vigilante | Corregido antes (commit 78b7c2a1) |
| 4. Chat sin `task` | CORREGIDO (F8-B206): con los subagentes encendidos para el Chat puede lanzar SOLO `lazunox-chat-helper` (web, sin archivos ni terminal). Modo código en el Chat no aplica (sin conectores) y Ajustes lo dice |

Qué mirar en la próxima prueba real: que un conector externo pida permiso en Code y deje de pedirlo al marcarlo; que una herramienta
bloqueada de un conector local no se ofrezca; `bgshell_start` con una orden larga y el aviso de fin que retoma la conversación; el Chat
lanzando el ayudante en segundo plano y cómo lo muestra la interfaz; el aviso «Cambios de conectores aplicados» y la espera si hay un
turno en curso.

## Medición de tokens y tiempo (2026-10-22, Claude Haiku 5.5 de OpenCode Go, «Todo sin preguntar», proyecto temporal con 6 notas de 200 líneas)

Una sola corrida por caso (no es un estudio estadístico). «Total procesado» = entrada + salida + razonamiento + caché leída + caché escrita (de los mensajes del asistente
en la base del motor, sumando las sesiones hijas).

| Caso | Pared | Sesiones | Mensajes | Total procesado |
| --- | --- | --- | --- | --- |
| R1: 6 trabajos `bgshell`, llamadas directas (sin Code Mode) | 23 s | 1 | 3 | 158 785 |
| R2: la misma tarea con Code Mode | 17 s | 1 | 3 | 73 013 (−54 %) |
| R3: leer la línea 3 de 6 archivos con `read`, sin subagentes | 14 s | 1 | 2 | 46 382 |
| R4: la misma tarea con 6 subagentes en segundo plano | 21 s | 7 | 17 | 239 417 (5,2× R3) |

Lectura: Code Mode redujo a la mitad los tokens en una tarea con muchas llamadas a conectores. Seis subagentes para una tarea trivial costaron 5 veces más y no fueron más
rápidos: los subagentes valen la pena para trabajo grande e independiente, no para tareas pequeñas.

## Hallazgos de esta segunda ronda
1. El aviso de fin que despierta al modelo FUNCIONA (se vio en la conversación), pero cada trabajo que termina genera un turno nuevo y un mensaje largo y visible: con 6 trabajos, 6 despertares.
   Mejora pendiente: agrupar avisos que lleguen en una ventana corta en un solo despertar y mostrarlos compactos.
2. En «Preguntar siempre», seis `bgshell_start` lanzados a la vez generan seis tarjetas de permiso; si la sesión no está a la vista, quedan esperando sin que la persona lo note (el escudo en
   la lista de sesiones lo indica).
3. `npm run dev`/`build` generan el `.cjs` de `bgshell`; un `electron-vite build` suelto no, y entonces `bgshell` simplemente no aparece (degrada sin error).
