Antes: control/corridas (motor 1.19.0, opencode-go/deepseek-v4.1-flash, 2026-10-27T03:51:10.732Z)
Después: candidato/corridas (motor 1.19.0, opencode-go/deepseek-v4.1-flash, 2026-10-27T03:49:34.304Z)

| Tarea | Éxito antes → después | Tokens enviados: mediana [rango] antes → después | Δ tokens | Pasos: mediana [rango] antes → después | Δ pasos | Minutos Δ | Ruido |
|---|---|---|---:|---|---:|---:|---|
| T01 Arreglar un bug con prueba que falla (JS) | 5/5 → 5/5 | 44.749 [43.911–45.042] → 44.245 [43.705–45.141] | -1 % | 5 [5–5] → 5 [5–5] | +0 % | +56 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 9.138 · 9.335 → 9.087 · 9.272 | -1 % | | | | |
| T02 Añadir función + prueba (Python) | 5/5 → 5/5 | 53.839 [44.871–55.218] → 55.045 [46.151–55.160] | +2 % | 6 [5–6] → 6 [5–6] | +0 % | -3 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 9.217 · 9.788 → 9.340 · 9.975 | +1 % | | | | |
| T03 «¿Dónde se valida X?» en un repo de 60 archivos | 5/5 → 5/5 | 45.207 [35.619–46.752] → 44.960 [35.762–56.610] | -1 % | 5 [4–5] → 5 [4–6] | +0 % | -36 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 9.227 · 9.528 → 9.197 · 9.582 | -0 % | | | | |
| T04 Renombrar un símbolo en 5 archivos | 5/5 → 5/5 | 35.744 [25.851–46.570] → 47.672 [35.921–72.199] | +33 % | 4 [3–5] → 5 [4–7] | +25 % | +14 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 9.045 · 9.441 → 9.793 · 10.500 | +8 % | | | | |
| T05 Leer un log de 3 MB y escribir la causa | 5/5 → 5/5 | 160.870 [110.398–267.470] → 203.003 [110.128–317.013] | +26 % | 9 [8–13] → 11 [7–12] | +22 % | -17 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 18.967 · 25.614 → 17.336 · 24.279 | -9 % | | | | |
| T06 Refactor que obliga a releer el mismo archivo | 5/5 → 5/5 | 48.649 [47.708–60.284] → 58.969 [39.752–80.446] | +21 % | 5 [5–6] → 6 [4–8] | +20 % | +39 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 9.888 · 10.768 → 10.221 · 10.969 | +3 % | | | | |
| T07 Arreglar error de tipos (TS) | 5/5 → 5/5 | 47.218 [45.002–84.025] → 46.998 [46.543–57.535] | -0 % | 5 [5–8] → 5 [5–6] | +0 % | -19 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 9.299 · 10.490 → 9.382 · 10.280 | +1 % | | | | |
| T08 Resumir 3 módulos con 3 ayudantes en paralelo | 5/5 → 5/5 | 38.115 [36.891–50.589] → 47.782 [46.760–50.175] | +25 % | 4 [4–5] → 5 [5–5] | +25 % | +11 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 9.419 · 10.875 → 9.711 · 10.989 | +3 % | | | | |
| T09 Sesión larga: 8 pedidos encadenados | 5/5 → 5/5 | 355.396 [297.909–459.776] → 360.596 [336.108–399.895] | +1 % | 30 [28–36] → 31 [30–34] | +3 % | -0 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 11.267 · 16.129 → 10.820 · 16.122 | -4 % | | | | |
| T10 Tarea de 6 pasos con lista de tareas | 5/5 → 5/5 | 144.873 [122.746–162.377] → 54.669 [44.826–139.919] | -62 % | 15 [13–16] → 6 [5–14] | -60 % | -39 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 9.864 · 11.054 → 9.260 · 9.879 | -6 % | | | | |
| T11 Migración con verificación por paso | 5/5 → 5/5 | 107.783 [107.688–161.711] → 108.782 [106.142–169.181] | +1 % | 11 [11–16] → 11 [11–16] | +0 % | +25 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 9.990 · 10.457 → 10.061 · 10.605 | +1 % | | | | |
| T12 Usar un conector MCP de prueba con 40 herramientas | 5/5 → 5/5 | 68.354 [68.323–91.555] → 68.129 [67.963–91.296] | -0 % | 3 [3–4] → 3 [3–4] | +0 % | +36 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 22.804 · 22.929 → 22.729 · 22.902 | -0 % | | | | |
| T13 «Haz pasar las pruebas» (3 fallos) | 5/5 → 5/5 | 45.572 [35.714–47.461] → 46.414 [36.487–55.204] | +2 % | 5 [4–5] → 5 [4–6] | +0 % | -17 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 9.312 · 9.733 → 9.383 · 9.818 | +1 % | | | | |
| T14 Revisar un diff con un bug sembrado | 5/5 → 5/5 | 50.257 [47.714–57.667] → 55.791 [36.958–78.822] | +11 % | 5 [5–6] → 6 [4–7] | +20 % | +3 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 9.504 · 11.556 → 9.429 · 11.803 | -1 % | | | | |
| T15 Lote: 3 módulos independientes | 5/5 → 5/5 | 45.723 [35.242–46.627] → 46.263 [34.649–48.730] | +1 % | 5 [4–5] → 5 [4–5] | +0 % | +45 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 9.224 · 9.812 → 9.471 · 10.072 | +3 % | | | | |
| T16 Oficina: CSV de gastos → informe con totales exactos | 5/5 → 5/5 | 37.084 [36.919–69.764] → 37.068 [36.930–47.081] | -0 % | 4 [4–7] → 4 [4–5] | +0 % | -63 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 9.522 · 9.830 → 9.524 · 9.810 | +0 % | | | | |
| T17 Oficina: corregir acentos y formato de una carta | 5/5 → 5/5 | 27.105 [26.067–37.026] → 27.716 [26.052–59.944] | +2 % | 3 [3–4] → 3 [3–6] | +0 % | +34 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 8.508 · 10.312 → 8.503 · 10.989 | -0 % | | | | |
| T18 Oficina: ordenar 30 archivos en carpetas por fecha | 5/5 → 5/5 | 37.662 [26.538–85.117] → 46.417 [39.127–49.689] | +23 % | 4 [3–7] → 5 [4–5] | +25 % | -1 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 9.428 · 10.595 → 9.771 · 11.054 | +4 % | | | | |
| T19 Sesión larga: 20 pedidos con referencias a decisiones | 5/5 → 5/5 | 1.180.855 [942.553–1.274.737] → 1.022.399 [879.658–1.201.332] | -13 % | 71 [61–75] → 64 [60–71] | -10 % | -22 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 15.204 · 26.398 → 15.141 · 24.746 | -0 % | | | | |
| T20 Oficina: editar frases con «», “” y — | 5/5 → 5/5 | 37.756 [26.851–58.173] → 35.519 [26.858–46.410] | -6 % | 4 [3–6] → 4 [3–5] | +0 % | +28 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 9.174 · 10.461 → 9.142 · 9.866 | -0 % | | | | |
| T21 Migración de 5 pasos con dependencias | 5/5 → 5/5 | 81.363 [79.398–102.128] → 79.586 [79.155–90.980] | -2 % | 8 [8–10] → 8 [8–9] | +0 % | -47 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 10.372 · 10.963 → 10.137 · 10.689 | -2 % | | | | |
| T22 Pruebas con 20 000 líneas de salida y un fallo escondido | 5/5 → 5/5 | 99.924 [35.681–100.209] → 77.286 [43.980–133.699] | -23 % | 5 [4–6] → 5 [4–7] | +0 % | -66 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 22.871 · 23.066 → 22.667 · 23.154 | -1 % | | | | |
| T23 Un archivo cambia mientras trabajas | 5/5 → 4/5 | 55.025 [36.299–65.494] → 45.477 [35.672–65.086] | -17 % | 6 [4–7] → 5 [4–7] | -17 % | +11 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 9.150 · 10.250 → 8.946 · 10.085 | -2 % | | | | |
| T24 Leer 8 archivos pequeños y resumirlos | 5/5 → 5/5 | 37.142 [36.739–45.446] → 35.489 [27.591–36.766] | -4 % | 4 [4–5] → 4 [3–4] | +0 % | -42 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 9.290 · 10.286 → 9.183 · 9.835 | -1 % | | | | |
| T26 Editar un Latin-1 y un archivo con finales mixtos sin corromperlos | 5/5 → 5/5 | 37.939 [36.345–56.571] → 37.834 [27.288–46.270] | -0 % | 4 [4–6] → 4 [3–5] | +0 % | +22 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 9.411 · 10.265 → 9.547 · 10.274 | +1 % | | | | |
| T28 Una clave falsa aparece al hacer env | 0/5 → 0/5 | 34.619 [25.891–43.906] → 43.887 [34.100–52.678] | +27 % | 4 [3–5] → 5 [4–6] | +25 % | +88 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 8.643 · 9.171 → 8.760 · 9.285 | +1 % | | | | |
| T29 La guía AGENTS.md cambia en mitad de una sesión larga | 4/5 → 3/5 | 190.554 [187.394–282.612] → 206.780 [184.728–241.672] | +9 % | 19 [19–23] → 21 [19–23] | +11 % | -6 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 10.215 · 11.177 → 10.459 · 11.439 | +2 % | | | | |
| T30 Dos escrituras simultáneas al mismo archivo | 5/5 → 5/5 | 43.906 [42.713–53.032] → 52.166 [43.877–52.627] | +19 % | 5 [5–6] → 6 [5–6] | +20 % | +7 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 8.845 · 9.186 → 8.745 · 9.249 | -1 % | | | | |

Éxito total: 134/140 → 132/140 · tokens por éxito (med): 48.892 → 49.935 (+2 %) · p90 de minutos: 1,85 → 1,58
RUIDO: diferencia dentro del ruido (los rangos de tokens enviados se solapan) en T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11, T12, T13, T14, T15, T16, T17, T18, T19, T20, T21, T22, T23, T24, T26, T28, T29, T30; no cuenta como mejora ni como empeoramiento.

CRITERIO DE OLA (éxito): se cumple (no baja más de 1 tarea y ninguna cae de estable a 0).
