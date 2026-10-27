# Diagnóstico: dónde se van los tokens del primer paso

Todo se midió **sin gastar cuota**: un servidor falso (`herramientas/captura.mjs`) hace de modelo, guarda el cuerpo completo de cada petición y contesta «ok». Así se ve exactamente lo que cada motor manda. (Bytes; 1 token son unos 3,5 a 4 bytes.)

## Primer paso de T01 (arreglar un bug)

| Parte | Lazunox final2 (antes) | OpenCode 2.2.0 | Lazunox nuevo (v2) |
|---|---:|---:|---:|
| Prompt de sistema | 9.260 | 8.307 | 4.990 |
| Herramientas (suma) | 24.334 (10) | 10.800 (9) | 16.410 (10) |
| Mensajes | 155 | 155 | 155 |
| **Total de la petición** | **34.063** | **19.642** | **21.819** |
| Tokens reales del primer paso (proxy) | 8.213 | 4.671 | 5.523 |

Herramientas más pesadas, antes y después (bytes con descripción y parámetros): bash 7.076 a 3.705; task 4.400 a 3.092; todowrite 3.754 a 2.632; edit 1.958 a 1.290; read 1.734 a 1.251; grep 1.183 a 905; glob 1.114 a 878; write 1.026 a 708; skill 1.148 a 1.008. OpenCode usa 1.529 para su shell y 2.696 para su subagente, y **no manda** todowrite.

Dónde estaban los ~3,5 k tokens de diferencia: casi todo en las **herramientas** (+13,5 KB: bash, task y todowrite pesan 15 KB entre las tres; las de ellos, unos 5 KB). El prompt de sistema era parecido (+1 KB). Ya no es así: el prompt de sistema nuevo es más corto que el de OpenCode, y las herramientas siguen pesando 5,6 KB más (bash con el bloque de segundo plano, task, todowrite y los esquemas de parámetros).

## T12 (MCP con 40 herramientas)

| | Lazunox antes | OpenCode 2.2.0 | Lazunox nuevo |
|---|---:|---:|---:|
| Herramientas en la petición | 50 (72.720 B) | 9 (10.800 B) | 12 (18.856 B) |
| Total de la petición | 82.553 B | 19.706 B | 24.331 B |
| Tokens por paso (proxy, mediana) | 22.794 | 7.467 | 8.088 (n=1) |

Las ~15 k de diferencia eran las 40 definiciones MCP (unos 1,2 KB cada una) que viajaban en cada paso: la búsqueda diferida (`tool_search` + `mcp_call`) existía pero estaba **apagada por defecto en el motor** (la app solo la encendía en Chat y Code), por eso el banco no la usaba. OpenCode 2.2.0 en esa prueba no mandó las herramientas MCP en la primera petición.

## Por qué la primera petición de cada sesión leía solo 3,9 % de caché

Se corrieron dos sesiones seguidas y se compararon los cuerpos: la **descripción de `bash` llevaba la ruta temporal de cada corrida** (`/tmp/lz-bench-XXXX/tmp/opencode`). Las herramientas van ANTES del sistema en el prefijo que el proveedor cachea, así que desde la primera herramienta todo era distinto. El recorte `cache` saca esa ruta de la descripción y la pone en `<env>` (al final del sistema); con v2 las herramientas son idénticas byte a byte entre sesiones y el sistema es igual hasta el bloque de entorno. En uso real la ruta no cambia entre sesiones del mismo usuario, así que el efecto allí es menor que en el banco. **No se confirmó con el modelo real** que la primera petición ahora lea más caché (en el humo las primeras peticiones de T01 y T13 leyeron 0 %, probablemente porque el proveedor tarda en tener lista la caché escrita un minuto antes; no se investigó más).
