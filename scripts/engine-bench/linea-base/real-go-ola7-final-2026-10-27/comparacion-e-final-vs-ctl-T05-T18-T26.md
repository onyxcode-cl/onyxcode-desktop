Antes: e2/corridas (motor 1.19.0, opencode-go/deepseek-v4.1-flash, 2026-10-27T05:43:53.556Z)
Después: e1/corridas (motor 1.19.0, opencode-go/deepseek-v4.1-flash, 2026-10-27T05:43:20.721Z)

| Tarea | Éxito antes → después | Tokens enviados: mediana [rango] antes → después | Δ tokens | Pasos: mediana [rango] antes → después | Δ pasos | Minutos Δ | Ruido |
|---|---|---|---:|---|---:|---:|---|
| T05 Leer un log de 3 MB y escribir la causa | 5/5 → 5/5 | 201.230 [129.088–417.638] → 307.689 [162.215–406.410] | +53 % | 9 [7–17] → 13 [8–17] | +44 % | +45 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 18.166 · 35.818 → 22.790 · 29.195 | +25 % | | | | |
| T18 Oficina: ordenar 30 archivos en carpetas por fecha | 5/5 → 5/5 | 59.602 [26.439–82.433] → 37.492 [36.648–56.697] | -37 % | 6 [3–7] → 4 [4–6] | -33 % | -26 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 9.939 · 11.240 → 9.368 · 10.542 | -6 % | | | | |
| T26 Editar un Latin-1 y un archivo con finales mixtos sin corromperlos | 5/5 → 5/5 | 46.177 [37.839–48.916] → 46.126 [36.642–59.300] | -0 % | 5 [4–5] → 5 [4–6] | +0 % | +12 % | dentro del ruido |
| ↳ tokens por paso (med · p90) | | 9.847 · 10.906 → 9.371 · 10.609 | -5 % | | | | |

Éxito total: 15/15 → 15/15 · tokens por éxito (med): 60.605 → 57.399 (-5 %) · p90 de minutos: 1,13 → 1,1
RUIDO: diferencia dentro del ruido (los rangos de tokens enviados se solapan) en T05, T18, T26; no cuenta como mejora ni como empeoramiento.

CRITERIO DE OLA (éxito): se cumple (no baja más de 1 tarea y ninguna cae de estable a 0).
