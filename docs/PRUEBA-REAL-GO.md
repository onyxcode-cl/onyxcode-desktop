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
