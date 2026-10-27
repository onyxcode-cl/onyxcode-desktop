# Banco real (OpenCode Go): motor final de la Ola 7 (`feat/ola7-final`) contra el control — 2026-10-27

Modelo `opencode-go/deepseek-v4.1-flash`, flags de siempre (60 pasos, 400 000 tokens, 15 min), contenedores `node:22-bookworm` de 2 CPU / 3 GB (hasta 3 a la vez).

## Binario
- Fork `lazunox-motor`, rama `feat/ola7-final`, commit `b5559704d5aefc3aedd53fb0c3a86fbb8ec93809` ("Ola 7: integra tanda B (7.5, 7.6, 7.20, 7.7) con A, C y D").
- Receta idéntica a la del par anterior (`receta-build.sh`, copia exacta): `oven/bun:1.3.14`, 4 CPU / 8 GB en el VPS, carpeta temporal `/opt/lzx-ola7-final-build` (ya borrada), `git archive`, `.github/TEAM_MEMBERS` vacío, `models.json` fijado
  (sha256 `504bea88124353c10040064ca7bc13dd41da7a4419c7710beb84a41a0914bd4c`), `OPENCODE_VERSION=1.19.0`, destino linux/arm64. Compilado UNA vez.
- sha256 del binario: `3871940fdc72889dcfed42b6994c947e72071d9cb23c8a14a9c6e19cfc30b100` (149 923 984 B); `--version` = 1.19.0. Guardado fuera del repo en `~/Documents/lzx-bench-bin/final/opencode`.
- Control: el de `../real-go-ola7-par2-2026-10-27/` (b3ccb17, sha256 `482a7605…9294479`), n=5, mismas condiciones.

## Cambios al banco (`scripts/engine-bench`)
- Tareas nuevas T31 (fan-out con orden escondida) y T32 (T21 en tres juegos), copiadas del fork (`test/lazunox/banco-flujos`), con su autoprueba en verde.
- `run.mjs`: cada corrida guarda ahora `tokens_ayudantes` (sesiones hijas = tokens del `informe` del motor menos los `step_finish` de la sesión principal; antes el banco NO los veía). Con `--sumar-ayudantes` esos tokens se suman a `tokens`. En el banco completo (a) NO se usó la opción para comparar igual que el control; en el bloque de flujos (d) sí.

## Comandos (todos con `--modelo opencode-go/deepseek-v4.1-flash --auth-archivo … --guardar-corridas`)
- a (a1, a2, a3): T01–T30 n=3, sin variables, en tres contenedores. T25 y T27 son del proveedor falso y no corren con modelo real. Después a3 se amplió a n=5 solo para T29.
- b1: T28 n=5 con `--env LAZUNOX_SANITIZAR_MODELO=1`. b2: T01,T05,T13 n=3 con esa variable. b3: T05 n=3 sin variables (con `--conservar`). b4: T28 n=3 con la variable (con `--conservar`).
- dA / dB: T31,T32 n=3. A: `--env OPENCODE_EXPERIMENTAL_CODE_MODE=1 --env OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=1 --sumar-ayudantes`. B: lo mismo + `--env LAZUNOX_FLUJOS=1` y `BENCH_PEDIDO_FLUJOS=1` en el ejecutor.
- Comparaciones: `node scripts/engine-bench/run.mjs --comparar <control/corridas> <carpeta>` → `comparacion-*.md`. `a-todo/` junta las corridas de a1–a3 (+ T29 r04/r05).
- Gasto total estimado: unos 14,1 M de tokens enviados (tope 14 M, pasado por ~0,1 M en el último bloque). Por eso NO se midió T21 con flujos ni se pasó de n=3 en T31/T32.
- La clave de OpenCode Go se usó desde una copia temporal de solo lectura (ya borrada); no está en ningún archivo de esta carpeta.

## Fase 2 (carpetas e1, e2, e3, f0, f1 y T19 más en a2)
- e1/e2: T05,T18,T26 n=5 con `--conservar`, final y control (`MOTOR=ctl`). e3: T28 n=5 con `LAZUNOX_SANITIZAR_MODELO=1` y `--conservar`. f0/f1: T21,T32,T31 n=3 con `--sumar-ayudantes`, ambas con `--env OPENCODE_EXPERIMENTAL_CODE_MODE=1 --env OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=1`; f1 añade `--env LAZUNOX_FLUJOS=1`. En el entorno del ejecutor, `BENCH_PEDIDO_EXTRA` (nuevo en `run.mjs`: texto que se añade al primer pedido de cada tarea) = «Importante: resuélvelo con una sola llamada a la herramienta execute usando tools.flujos.en_paralelo (un ayudante por unidad de trabajo independiente) y devuelve solo el resultado.»
- T19: `--repeticiones 6` sobre la carpeta a2 (reutiliza r01–r03); se cortó tras r04 por el tope de gasto.
- Las carpetas conservadas (con la base de sesiones) quedaron fuera del repo, en `~/Documents/lzx-bench-bin/tr/`; los hallazgos de T05, T28 y flujos se leyeron de ahí y están resumidos en DIAGNOSTICO.md.

## Verificador de T05 corregido (2026-10-27)
Todas las medidas de T05 de esta carpeta, de `real-go-ola7-par2-2026-10-27/` y anteriores usaron el verificador VIEJO (`agotad|exhaust|lleno|sin conexiones`), que rechazaba respuestas correctas como «agotamiento del pool…». Ahora también acepta `agotamiento` y `sin disponibilidad`. Re-verificación sin gastar tokens de las 16 carpetas conservadas (b2 ×3, b3 ×3, e1 ×5, e2 ×5): las 16 pasan con el verificador nuevo (las 2 que fallaban en b2 y b3 pasan; ninguna correcta deja de pasar). Las 2 fallas de T05 de a1 no se guardaron y no se pueden re-verificar: el «1/3» de T05 en `comparacion-a-banco-completo.md` y el 3/6 de DIAGNOSTICO.md usan el verificador viejo; el conteo no se reescribió.

## Binario `final2` (fork `feat/ola7-final` @ `87ff0190580a5c6941a4790b0cae4028fd5876ea`, «el nivel del modelo cubre read y grep»)
Misma receta (`receta-build.sh`, VPS, carpeta temporal ya borrada, `models.json` fijado `504bea88…bd4c`). sha256 `8333ba0760321193ed530e4c33038476168dfdcf92ba2b679656c71753e972a0` (149 923 984 B). Guardado en `~/Documents/lzx-bench-bin/final2/opencode`. Medidas g1 (T28 n=5) y g2 (T01,T13 n=3), todas con `--env LAZUNOX_SANITIZAR_MODELO=1`, sin otras variables. Gasto: ~0,5 M tokens enviados.
