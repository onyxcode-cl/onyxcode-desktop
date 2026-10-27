Antes: a-todo (motor 1.19.0, opencode-go/deepseek-v4.1-flash, 2026-10-27T05:29:05.974Z)
Después: san-t01-05-13 (motor 1.19.0, opencode-go/deepseek-v4.1-flash, 2026-10-27T05:26:59.235Z)

| Tarea | Éxito antes → después | Tokens enviados: mediana [rango] antes → después | Δ tokens | Pasos: mediana [rango] antes → después | Δ pasos | Minutos Δ | Ruido |
|---|---|---|---:|---|---:|---:|---|
| T01 Arreglar un bug con prueba que falla (JS) | 3/3 → 3/3 | 45.123 [45.102–45.135] → 44.477 [44.215–44.568] | -1 % | 5 [5–5] → 5 [5–5] | +0 % | +4 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 9.307 · 9.510 → 9.139 · 9.336 | -2 % | | | | |
| T02 | solo en antes | | | | | | |
| T03 | solo en antes | | | | | | |
| T04 | solo en antes | | | | | | |
| T05 Leer un log de 3 MB y escribir la causa | 1/3 → 2/3 | 193.531 [167.525–275.432] → 129.353 [96.651–166.653] | -33 % | 10 [9–14] → 8 [7–8] | -20 % | -29 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 21.094 · 26.715 → 15.608 · 24.767 | -26 % | | | | |
| T06 | solo en antes | | | | | | |
| T07 | solo en antes | | | | | | |
| T08 | solo en antes | | | | | | |
| T09 | solo en antes | | | | | | |
| T10 | solo en antes | | | | | | |
| T11 | solo en antes | | | | | | |
| T12 | solo en antes | | | | | | |
| T13 «Haz pasar las pruebas» (3 fallos) | 3/3 → 3/3 | 46.605 [36.706–47.355] → 47.178 [46.610–47.942] | +1 % | 5 [4–5] → 5 [5–5] | +0 % | +14 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 9.566 · 10.113 → 9.830 · 10.269 | +3 % | | | | |
| T14 | solo en antes | | | | | | |
| T15 | solo en antes | | | | | | |
| T16 | solo en antes | | | | | | |
| T17 | solo en antes | | | | | | |
| T18 | solo en antes | | | | | | |
| T19 | solo en antes | | | | | | |
| T20 | solo en antes | | | | | | |
| T21 | solo en antes | | | | | | |
| T22 | solo en antes | | | | | | |
| T23 | solo en antes | | | | | | |
| T24 | solo en antes | | | | | | |
| T26 | solo en antes | | | | | | |
| T28 | solo en antes | | | | | | |
| T29 | solo en antes | | | | | | |
| T30 | solo en antes | | | | | | |

Éxito total: 81/86 → 8/9 · tokens por éxito (med): 51.116 → 47.560 (-7 %) · p90 de minutos: 0,91 → 0,57

RUIDO: con menos de 5 repeticiones por lado no se puede separar mejora de ruido (T01, T05, T13); no declares mejoras con estas cifras.

CRITERIO DE OLA (éxito): se cumple (no baja más de 1 tarea y ninguna cae de estable a 0).
