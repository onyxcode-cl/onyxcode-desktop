Antes: control/real-n3.json (motor 1.19.0, opencode-go/deepseek-v4.1-flash, 2026-10-27T00:22:35.999Z)
Después: candidato/real-n3.json (motor 1.19.0, opencode-go/deepseek-v4.1-flash, 2026-10-27T00:22:35.994Z)

| Tarea | Éxito antes → después | Tokens enviados: mediana [rango] antes → después | Δ tokens | Pasos: mediana [rango] antes → después | Δ pasos | Minutos Δ | Ruido |
|---|---|---|---:|---|---:|---:|---|
| T01 Arreglar un bug con prueba que falla (JS) | 3/3 → 3/3 | 45.461 [45.219–45.673] → 45.051 [44.977–45.284] | -1 % | 5 [5–5] → 5 [5–5] | +0 % | -4 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 9.413 · 9.630 → 9.293 · 9.494 | -1 % | | | | |
| T02 Añadir función + prueba (Python) | 3/3 → 3/3 | 46.344 [44.918–54.021] → 53.858 [44.883–65.493] | +16 % | 5 [5–6] → 6 [5–7] | +20 % | +14 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 9.215 · 9.587 → 9.196 · 9.553 | -0 % | | | | |
| T03 «¿Dónde se valida X?» en un repo de 60 archivos | 3/3 → 3/3 | 35.688 [35.544–35.985] → 47.188 [35.881–55.898] | +32 % | 4 [4–4] → 5 [4–6] | +25 % | +3 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 9.091 · 9.316 → 9.439 · 10.143 | +4 % | | | | |
| T04 Renombrar un símbolo en 5 archivos | 3/3 → 3/3 | 47.804 [36.162–49.365] → 47.667 [25.876–48.817] | -0 % | 5 [4–5] → 5 [3–5] | +0 % | +6 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 9.812 · 10.545 → 9.824 · 10.478 | +0 % | | | | |
| T05 Leer un log de 3 MB y escribir la causa | 3/3 → 3/3 | 166.348 [147.535–184.069] → 153.667 [124.243–332.223] | -8 % | 8 [7–10] → 10 [9–14] | +25 % | +28 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 19.124 · 26.269 → 13.823 · 23.850 | -28 % | | | | |
| T06 Refactor que obliga a releer el mismo archivo | 3/3 → 3/3 | 48.695 [47.660–56.870] → 57.720 [37.715–59.122] | +19 % | 5 [5–6] → 6 [4–6] | +20 % | +10 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 9.652 · 10.478 → 9.862 · 10.654 | +2 % | | | | |
| T07 Arreglar error de tipos (TS) | 3/3 → 3/3 | 57.160 [46.514–61.380] → 67.132 [58.466–86.230] | +17 % | 6 [5–6] → 7 [6–8] | +17 % | -9 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 9.387 · 10.979 → 9.896 · 10.989 | +5 % | | | | |
| T08 Resumir 3 módulos con 3 ayudantes en paralelo | 3/3 → 3/3 | 45.808 [42.587–49.046] → 39.460 [38.797–50.135] | -14 % | 5 [4–5] → 4 [4–5] | -20 % | -6 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 10.264 · 11.286 → 10.047 · 11.322 | -2 % | | | | |
| T09 Sesión larga: 8 pedidos encadenados | 3/3 → 3/3 | 344.665 [256.338–404.959] → 400.520 [321.024–470.303] | +16 % | 30 [24–34] → 35 [29–36] | +17 % | -8 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 11.038 · 15.015 → 11.118 · 15.133 | +1 % | | | | |
| T10 Tarea de 6 pasos con lista de tareas | 3/3 → 3/3 | 135.080 [93.806–174.210] → 151.757 [54.758–152.365] | +12 % | 14 [10–17] → 15 [6–15] | +7 % | +35 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 9.596 · 10.882 → 9.973 · 11.687 | +4 % | | | | |
| T11 Migración con verificación por paso | 3/3 → 3/3 | 106.595 [105.856–108.238] → 108.773 [105.584–155.435] | +2 % | 11 [11–11] → 11 [11–15] | +0 % | +41 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 9.861 · 10.314 → 10.093 · 10.589 | +2 % | | | | |
| T12 Usar un conector MCP de prueba con 40 herramientas | 3/3 → 3/3 | 67.955 [67.937–90.790] → 68.321 [67.974–91.346] | +1 % | 3 [3–4] → 3 [3–4] | +0 % | -11 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 22.677 · 22.790 → 22.794 · 22.912 | +1 % | | | | |
| T13 «Haz pasar las pruebas» (3 fallos) | 3/3 → 3/3 | 47.119 [35.143–47.306] → 45.726 [36.249–46.533] | -3 % | 5 [4–5] → 5 [4–5] | +0 % | -12 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 9.823 · 10.253 → 9.309 · 9.833 | -5 % | | | | |
| T14 Revisar un diff con un bug sembrado | 3/3 → 3/3 | 46.268 [36.865–58.379] → 47.346 [46.598–47.895] | +2 % | 5 [4–6] → 5 [5–5] | +0 % | -16 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 9.200 · 10.317 → 9.272 · 10.756 | +1 % | | | | |
| T15 Lote: 3 módulos independientes | 3/3 → 3/3 | 44.418 [44.414–47.233] → 44.358 [34.536–44.479] | -0 % | 5 [5–5] → 5 [4–5] | +0 % | -2 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 8.890 · 9.518 → 8.864 · 9.493 | -0 % | | | | |
| T16 Oficina: CSV de gastos → informe con totales exactos | 3/3 → 3/3 | 36.865 [36.612–37.639] → 36.965 [36.934–69.221] | +0 % | 4 [4–4] → 4 [4–7] | +0 % | +20 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 9.472 · 9.722 → 9.490 · 9.814 | +0 % | | | | |
| T17 Oficina: corregir acentos y formato de una carta | 3/3 → 3/3 | 35.949 [25.873–45.983] → 26.364 [26.277–26.372] | -27 % | 4 [3–5] → 3 [3–3] | -25 % | +3 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 8.691 · 9.669 → 8.503 · 9.600 | -2 % | | | | |
| T18 Oficina: ordenar 30 archivos en carpetas por fecha | 3/3 → 3/3 | 37.786 [36.218–46.393] → 37.857 [27.173–38.187] | +0 % | 4 [4–5] → 4 [3–4] | +0 % | -3 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 9.446 · 10.073 → 9.470 · 10.436 | +0 % | | | | |
| T19 Sesión larga: 20 pedidos con referencias a decisiones | 3/3 → 3/3 | 1.116.606 [733.914–1.614.024] → 1.361.366 [1.067.532–1.428.847] | +22 % | 68 [54–83] → 76 [71–76] | +12 % | +35 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 15.102 · 24.653 → 16.896 · 27.259 | +12 % | | | | |
| T20 Oficina: editar frases con «», “” y — | 3/3 → 3/3 | 27.203 [26.896–48.497] → 37.183 [37.071–37.275] | +37 % | 3 [3–5] → 4 [4–4] | +33 % | +38 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 8.947 · 9.883 → 9.262 · 10.215 | +4 % | | | | |
| T21 Migración de 5 pasos con dependencias | 3/3 → 3/3 | 79.949 [79.052–81.421] → 80.640 [79.733–118.359] | +1 % | 8 [8–8] → 8 [8–11] | +0 % | +9 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 10.178 · 10.787 → 10.427 · 10.998 | +2 % | | | | |
| T22 Pruebas con 20 000 líneas de salida y un fallo escondido | 3/3 → 3/3 | 57.613 [45.117–100.433] → 76.939 [44.200–123.090] | +34 % | 5 [4–5] → 5 [4–6] | +0 % | -20 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 12.443 · 12.724 → 22.859 · 23.027 | +84 % | | | | |
| T23 Un archivo cambia mientras trabajas | 3/3 → 3/3 | 55.346 [44.556–55.411] → 55.848 [47.520–65.504] | +1 % | 6 [5–6] → 6 [5–7] | +0 % | +9 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 9.229 · 10.126 → 9.361 · 10.225 | +1 % | | | | |
| T24 Leer 8 archivos pequeños y resumirlos | 3/3 → 3/3 | 36.758 [28.244–47.398] → 35.486 [35.146–37.619] | -3 % | 4 [3–5] → 4 [4–4] | +0 % | +5 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 9.866 · 10.155 → 8.902 · 9.460 | -10 % | | | | |
| T26 Editar un Latin-1 y un archivo con finales mixtos sin corromperlos | 3/3 → 3/3 | 37.642 [37.103–48.745] → 37.852 [27.484–49.337] | +1 % | 4 [4–5] → 4 [3–5] | +0 % | -8 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 9.525 · 10.329 → 9.682 · 10.228 | +2 % | | | | |
| T28 Una clave falsa aparece al hacer env | 0/3 → 0/3 | 34.107 [25.943–43.504] → 44.086 [34.315–52.952] | +29 % | 4 [3–5] → 5 [4–6] | +25 % | +16 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 8.649 · 9.008 → 8.760 · 9.405 | +1 % | | | | |
| T29 La guía AGENTS.md cambia en mitad de una sesión larga | 2/3 → 2/3 | 207.273 [187.949–220.383] → 204.005 [185.612–228.151] | -2 % | 19 [19–22] → 20 [19–21] | +5 % | +6 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 10.237 · 11.304 → 10.220 · 11.518 | -0 % | | | | |
| T30 Dos escrituras simultáneas al mismo archivo | 3/3 → 3/3 | 44.303 [43.648–62.148] → 44.101 [43.604–53.300] | -0 % | 5 [5–7] → 5 [5–6] | +0 % | +10 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 8.888 · 9.312 → 8.895 · 9.255 | +0 % | | | | |

Éxito total: 80/84 → 80/84 · tokens por éxito (med): 48.225 → 49.180 (+2 %) · p90 de minutos: 0,75 → 0,73

RUIDO: con menos de 5 repeticiones por lado no se puede separar mejora de ruido (T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11, T12, T13, T14, T15, T16, T17, T18, T19, T20, T21, T22, T23, T24, T26, T28, T29, T30); no declares mejoras con estas cifras.

CRITERIO DE OLA (éxito): se cumple (no baja más de 1 tarea y ninguna cae de estable a 0).
