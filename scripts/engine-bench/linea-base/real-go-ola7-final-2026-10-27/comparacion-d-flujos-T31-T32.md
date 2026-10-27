Antes: dA/corridas (motor 1.19.0, opencode-go/deepseek-v4.1-flash, 2026-10-27T05:34:07.697Z)
Después: dB/corridas (motor 1.19.0, opencode-go/deepseek-v4.1-flash, 2026-10-27T05:34:21.028Z)

| Tarea | Éxito antes → después | Tokens enviados: mediana [rango] antes → después | Δ tokens | Pasos: mediana [rango] antes → después | Δ pasos | Minutos Δ | Ruido |
|---|---|---|---:|---|---:|---:|---|
| T31 Fan-out: errores en 10 paquetes | 3/3 → 3/3 | 67.985 [62.830–72.435] → 74.700 [64.545–77.942] | +10 % | 7 [6–7] → 7 [6–7] | +0 % | -3 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 10.294 · 11.644 → 10.701 · 11.550 | +4 % | | | | |
| T32 Migración de 5 pasos en 3 juegos independientes | 3/3 → 3/3 | 121.229 [115.128–215.248] → 100.184 [80.945–101.657] | -17 % | 9 [9–15] → 7 [6–7] | -22 % | +24 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 15.020 · 15.972 → 14.868 · 18.043 | -1 % | | | | |

Éxito total: 6/6 → 6/6 · tokens por éxito (med): 95.044 → 80.339 (-15 %) · p90 de minutos: 1 → 1,01

RUIDO: con menos de 5 repeticiones por lado no se puede separar mejora de ruido (T31, T32); no declares mejoras con estas cifras.

CRITERIO DE OLA (éxito): se cumple (no baja más de 1 tarea y ninguna cae de estable a 0).
