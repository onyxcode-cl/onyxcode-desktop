Antes: f0/corridas (motor 1.19.0, opencode-go/deepseek-v4.1-flash, 2026-10-27T05:50:10.687Z)
Después: f1/corridas (motor 1.19.0, opencode-go/deepseek-v4.1-flash, 2026-10-27T05:52:21.697Z)

| Tarea | Éxito antes → después | Tokens enviados: mediana [rango] antes → después | Δ tokens | Pasos: mediana [rango] antes → después | Δ pasos | Minutos Δ | Ruido |
|---|---|---|---:|---|---:|---:|---|
| T21 Migración de 5 pasos con dependencias | 3/3 → 3/3 | 103.491 [88.141–110.481] → 147.993 [137.049–149.990] | +43 % | 9 [8–9] → 4 [4–5] | -56 % | +75 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 11.857 · 12.681 → 11.803 · 15.707 | -0 % | | | | |
| T31 Fan-out: errores en 10 paquetes | 3/3 → 3/3 | 44.257 [40.847–74.510] → 315.204 [273.946–1.639.762] | +612 % | 4 [4–7] → 3 [3–6] | -25 % | +91 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 10.546 · 11.999 → 12.231 · 13.758 | +16 % | | | | |
| T32 Migración de 5 pasos en 3 juegos independientes | 3/3 → 3/3 | 63.938 [63.852–223.687] → 347.297 [335.848–405.646] | +443 % | 5 [5–12] → 5 [3–6] | +0 % | +2 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 11.558 · 18.221 → 14.144 · 16.062 | +22 % | | | | |

Éxito total: 9/9 → 9/9 · tokens por éxito (med): 75.668 → 317.469 (+320 %) · p90 de minutos: 1,33 → 1,61

RUIDO: con menos de 5 repeticiones por lado no se puede separar mejora de ruido (T21, T31, T32); no declares mejoras con estas cifras.

CRITERIO DE OLA (éxito): se cumple (no baja más de 1 tarea y ninguna cae de estable a 0).
