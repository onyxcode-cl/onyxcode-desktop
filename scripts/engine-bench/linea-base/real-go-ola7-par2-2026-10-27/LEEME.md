# Banco real (OpenCode Go), segundo par de binarios: control vs candidato Ola 7, n=5 — 2026-10-27

**IMPORTANTE: este par de binarios NO es el de `../real-go-ola7-2026-10-26/` (n=3).** No se pudo reproducir aquel par (sus huellas dependían de un catálogo `models.json` y de una ruta de compilación no registrados). Los resultados de las dos carpetas NO se mezclan: aquí todo (28 tareas × 5 repeticiones por motor) se midió de nuevo con este par.

Modelo `opencode-go/deepseek-v4.1-flash`, mismos flags de siempre (60 pasos, 400 000 tokens, 15 min). Contenedores `node:22-bookworm` de 2 CPU / 3 GB, control y candidato en paralelo (2 lotes por motor).

## Receta de los binarios (idéntica para ambos; ver `receta-build.sh`)
- Contenedor `oven/bun:1.3.14`, `--cpus=4 --memory=8g`, en el VPS; código con `git archive` (solo versionado): control = fork `b3ccb17`, candidato = rama `feat/ola7-a` `b5f7c6d`, descomprimido en `/w/src-ctl` y `/w/src-cand`.
- `.github/TEAM_MEMBERS` creado vacío (git archive no lo trae y el build falla sin él).
- `bun install --frozen-lockfile`; `MODELS_DEV_API_JSON` = el catálogo fijado del VPS (`/opt/lzx-fork/models.json`, 5 879 402 bytes, sha256 `504bea88124353c10040064ca7bc13dd41da7a4419c7710beb84a41a0914bd4c`), `OPENCODE_VERSION=1.19.0`, `OPENCODE_CHANNEL=latest`.
- `script/build.ts` con el filtro cambiado a `linux/arm64` y `bun run script/build-t.ts --single --skip-embed-web-ui`.
- Huellas sha256: control `482a76054aa77ff8781f355056f0e26049ec781a724cf0c069fd3c53b9294479` (149 792 912 B); candidato `b8d211fcd139a68cde11847841b81dbccbaa31decfd62ab916bbaad2f302d738` (149 858 448 B). Cada uno se compiló UNA vez (no se comprobó la reproducibilidad de este par). Ambos corren (`--version` = 1.19.0) en un contenedor linux.
- Variantes de diagnóstico (no usadas): con ruta `/w/src` el control da `50245974…`; con un catálogo recién bajado, `7bb321a1…`.

## Resultado (comparacion-real.md y comparacion-falso.md)
Ver el informe en `DIAGNOSTICO.md`.
