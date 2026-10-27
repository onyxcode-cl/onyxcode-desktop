# Banco real (OpenCode Go) — motor de control vs candidato Ola 7 — 2026-10-26

Modelo: `opencode-go/deepseek-v4.1-flash` (mismos flags que `real-go-duro-lazunox12-2026-10-26`: 60 pasos, 400 000 tokens por tarea, 15 min, sin config global).
Binarios linux-arm64 (ambos se anuncian como 1.19.0; se distinguen por huella), compilados dos veces en un contenedor `oven/bun:1.3.14` (idénticos byte a byte):
- control (fork `b3ccb17`): sha256 `cfaa9ab1f4e8ace72629c8084822345fda66f3a2cd945511695c72426cecdd78`, 149 858 448 bytes
- candidato (`feat/ola7-a` `b5f7c6d`): sha256 `5c963a819f43ec0f005f98395afa45cc7937a132085842cb3ef9687d12b110ba`, 149 923 984 bytes

Tandas: T01-T24, T26, T28-T30 con modelo real, n=3 por motor y por lado (84 corridas c/u), control y candidato EN PARALELO (un contenedor de 2 CPU / 3 GB cada uno), por lo que los minutos de reloj NO son comparables con corridas anteriores. T25 y T27 con `--proveedor-falso` (n=3, sin modelo).
Con n=3 el comparador dice «sin veredicto» en todo: no hay mejora demostrable en tokens ni pasos con el modelo real.

| | control | candidato |
|---|---:|---:|
| Éxito (modelo real, 28 tareas × 3) | 80/84 | 80/84 |
| Fallos | T28 0/3, T29 2/3 | T28 0/3, T29 2/3 |
| Tokens enviados totales | 9 449 934 | 10 307 170 |
| Tokens de salida totales | 98 313 | 106 084 |
| Pasos totales | 767 | 815 |
| Minutos de modelo sumados | 32,9 | 36,0 |
| T25 (falso) | 3/3, 55 476 tok enviados | 3/3, 36 804 (-34 %, determinista) |
| T27 (falso) | 0/3 | 3/3 |

Detalle por tarea: `comparacion-real.md` y `comparacion-falso.md`. Resultados: `control/` y `candidato/` (`real-n3.json`, `falso-T25-T27.json`, `corridas/` un JSON por tarea y repetición).
