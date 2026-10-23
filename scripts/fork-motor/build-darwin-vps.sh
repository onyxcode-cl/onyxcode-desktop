#!/bin/bash
# Paso 2 del plan de fork propio (docs/FORK-MOTOR-PASO-2.md). Se ejecuta DENTRO de un contenedor `oven/bun:1.3.14` con el directorio de trabajo montado en /w
# (ver la receta en el documento). No toca la app ni el motor fijado: solo compila y mide.
set -u
L=/w/log-darwin.txt
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a $L; }
T0=$(date +%s)
apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq git unzip curl ca-certificates zip time python3 build-essential >/dev/null 2>&1
export MODELS_DEV_API_JSON=/w/models.json OPENCODE_VERSION=1.19.0 OPENCODE_CHANNEL=latest
cd /w/src/packages/opencode
cp script/build.ts script/build-darwin.ts
sed -i 's/item.os !== process.platform || item.arch !== process.arch/item.os !== "darwin" || item.arch !== "arm64"/' script/build-darwin.ts
grep -c 'item.os !== "darwin"' script/build-darwin.ts | sed 's/^/filtro darwin aplicado: /' | tee -a $L
for n in 1 2; do
  rm -rf dist
  say "build darwin-arm64 #$n"
  /usr/bin/time -v bun run script/build-darwin.ts --single --skip-embed-web-ui > /w/bd$n.log 2>&1; rc=$?
  say "build #$n salida=$rc | $(grep -E 'Elapsed|Maximum resident' /w/bd$n.log | tr '\n' ' ' | sed 's/\t/ /g')"
  B=$(find dist -type f -name opencode -path '*darwin-arm64*' | head -1)
  if [ -n "$B" ]; then cp "$B" /w/darwin$n; say "binario darwin #$n: $(sha256sum /w/darwin$n | cut -c1-16) $(stat -c %s /w/darwin$n) bytes"; else say "NO binario #$n"; ls dist 2>/dev/null | tee -a $L; tail -5 /w/bd$n.log | tee -a $L; fi
done
[ -f /w/darwin1 ] && [ -f /w/darwin2 ] && { cmp -s /w/darwin1 /w/darwin2 && say "REPRODUCIBLE darwin: idénticos byte a byte" || say "darwin: NO idénticos entre dos compilaciones"; }
say "TOTAL darwin: $(( $(date +%s) - T0 )) s"
touch /w/DONE-DARWIN
