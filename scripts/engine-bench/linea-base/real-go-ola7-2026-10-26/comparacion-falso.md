Antes: control/falso-T25-T27.json (motor 1.19.0, proveedor falso, 2026-10-27T00:22:14.674Z)
Después: candidato/falso-T25-T27.json (motor 1.19.0, proveedor falso, 2026-10-27T00:22:14.674Z)

| Tarea | Éxito antes → después | Tokens enviados: mediana [rango] antes → después | Δ tokens | Pasos: mediana [rango] antes → después | Δ pasos | Minutos Δ | Ruido |
|---|---|---|---:|---|---:|---:|---|
| T25 Respuesta cortada en mitad de un archivo grande | 3/3 → 3/3 | 55.476 [55.476–55.476] → 36.804 [36.804–36.804] | -34 % | 4 [4–4] → 4 [4–4] | +0 % | +1 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 15.598 · 15.758 → 9.374 · 9.534 | -40 % | | | | |
| T27 Argumentos de herramientas mal tipados | 0/3 → 3/3 | 53.350 [53.350–53.350] → 52.555 [52.555–52.555] | -1 % | 6 [6–6] → 6 [6–6] | +0 % | +6 % | n<5: sin veredicto |
| ↳ tokens por paso (med · p90) | | 8.910 · 9.204 → 8.763 · 8.996 | -2 % | | | | |

Éxito total: 3/6 → 6/6 · tokens por éxito (med): 60.278 → 47.177 (-22 %) · p90 de minutos: 0,03 → 0,03

RUIDO: con menos de 5 repeticiones por lado no se puede separar mejora de ruido (T25, T27); no declares mejoras con estas cifras.

CRITERIO DE OLA (éxito): se cumple (no baja más de 1 tarea y ninguna cae de estable a 0).
