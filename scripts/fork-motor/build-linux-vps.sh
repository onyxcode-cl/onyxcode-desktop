#!/bin/bash
# Paso 2 del plan de fork propio (docs/FORK-MOTOR-PASO-2.md). Se ejecuta DENTRO de un contenedor `oven/bun:1.3.14` con el directorio de trabajo montado en /w
# (ver la receta en el documento). No toca la app ni el motor fijado: solo compila y mide.
# Compilación de OpenCode v1.19.0 (commit 733b2c62) desde el código fuente: prueba de reproducibilidad y medición. Todo dentro del contenedor.
set -u
L=/w/log.txt
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a $L; }
T0=$(date +%s)
say "INICIO: instalando herramientas"
apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq git unzip curl ca-certificates zip time python3 build-essential >/dev/null 2>&1
say "bun $(bun --version) | git $(git --version | cut -d' ' -f3)"
mkdir -p /w/src && cd /w/src && git init -q . && git remote add origin https://github.com/anomalyco/opencode.git
say "descargando el código del tag v1.19.0"
git fetch --depth 1 -q origin 733b2c627e5aec39cb33cc22373bdce33053ef2c && git checkout -q FETCH_HEAD && say "commit: $(git rev-parse HEAD)"
curl -sS -m 180 -o /w/models.json https://models.dev/api.json && say "models.dev: $(wc -c < /w/models.json) bytes"
export MODELS_DEV_API_JSON=/w/models.json OPENCODE_VERSION=1.19.0 OPENCODE_CHANNEL=latest
say "bun install --frozen-lockfile"
/usr/bin/time -v bun install --frozen-lockfile > /w/install.log 2>&1; say "install salida=$? | $(grep -E 'Elapsed|Maximum resident' /w/install.log | tr '\n' ' ' | sed 's/\t/ /g')"
cd /w/src/packages/opencode
for n in 1 2; do
  rm -rf dist
  say "build #$n (--single --skip-embed-web-ui)"
  /usr/bin/time -v bun run script/build.ts --single --skip-embed-web-ui > /w/build$n.log 2>&1; rc=$?
  say "build #$n salida=$rc | $(grep -E 'Elapsed|Maximum resident' /w/build$n.log | tr '\n' ' ' | sed 's/\t/ /g')"
  B=$(find dist -type f -name opencode -perm -u+x | head -1)
  if [ -n "$B" ]; then cp "$B" /w/out$n; say "binario #$n: $(sha256sum /w/out$n | cut -c1-16) $(stat -c %s /w/out$n) bytes"; else say "NO se encontró el binario #$n"; ls -R dist 2>/dev/null | head -20 | tee -a $L; fi
done
if [ -f /w/out1 ] && [ -f /w/out2 ]; then cmp -s /w/out1 /w/out2 && say "REPRODUCIBLE: los dos binarios son idénticos byte a byte" || say "NO idénticos entre dos compilaciones iguales (hash distinto)"; fi
[ -f /w/out1 ] && say "version: $(/w/out1 --version 2>&1 | head -1)"
say "TOTAL: $(( $(date +%s) - T0 )) s"
touch /w/DONE
