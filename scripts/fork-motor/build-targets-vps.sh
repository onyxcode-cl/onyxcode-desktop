#!/bin/bash
# Paso 3 del fork propio: compila el motor de Lazunox (/w/src) para cada plataforma, DOS veces, y compara. Se ejecuta DENTRO de un contenedor
# `oven/bun:1.3.14` con /opt/lzx-fork montado en /w. Uso: build-targets-vps.sh darwin-arm64 darwin-x64 win32-x64 linux-x64 ...
set -u
L=/w/log-targets.txt
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a $L; }
T0=$(date +%s)
apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq git unzip curl ca-certificates zip time python3 build-essential >/dev/null 2>&1
export MODELS_DEV_API_JSON=/w/models.json OPENCODE_VERSION=1.19.0 OPENCODE_CHANNEL=latest
cd /w/src/packages/opencode
for T in "$@"; do
  OS=${T%%-*}; ARCH=${T#*-}
  cp script/build.ts script/build-t.ts
  sed -i "s/item.os !== process.platform || item.arch !== process.arch/item.os !== \"$OS\" || item.arch !== \"$ARCH\"/" script/build-t.ts
  case $OS in win32) DN=windows;; *) DN=$OS;; esac
  for n in 1 2; do
    rm -rf dist
    say "build $T #$n"
    /usr/bin/time -v bun run script/build-t.ts --single --skip-embed-web-ui > /w/bt-$T-$n.log 2>&1; rc=$?
    say "build $T #$n salida=$rc | $(grep -E 'Elapsed|Maximum resident' /w/bt-$T-$n.log | tr '\n' ' ' | sed 's/\t/ /g')"
    B=$(find dist -type f \( -name opencode -o -name opencode.exe \) -path "*$DN-$ARCH*" | head -1)
    if [ -n "$B" ]; then cp "$B" /w/out-$T-$n; say "binario $T #$n: $(sha256sum /w/out-$T-$n | cut -c1-16) $(stat -c %s /w/out-$T-$n) bytes"; else say "NO binario $T #$n"; ls dist 2>/dev/null | tee -a $L; fi
  done
  cmp -s /w/out-$T-1 /w/out-$T-2 && say "REPRODUCIBLE $T" || say "NO reproducible $T"
done
say "TOTAL: $(( $(date +%s) - T0 )) s"
touch /w/DONE-TARGETS
