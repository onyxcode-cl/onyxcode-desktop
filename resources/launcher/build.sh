#!/bin/sh
# Compila y firma el lanzador "disclaim" → resources/launcher/bin/onyxcode-disclaim (ver disclaim.c).
# Uso: build.sh [--if-missing]
# COMPILAR y FIRMAR están separados: con --if-missing y un binario al día pero firmado con otro
# identificador, solo se re-firma (sin recompilar).
# DISCLAIM_ID debe coincidir con src/shared/brand.ts (lo comprueba src/test/brand-consistency.test.ts).
# TODO(alias): cambiar junto a AUTHOR_ALIAS; ver docs.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${DISCLAIM_OUT:-$DIR/bin/onyxcode-disclaim}"
DISCLAIM_ID="cl.bentec.onyxcode.disclaim"
if [ "$(uname)" != "Darwin" ]; then echo "[onyxcode-disclaim] omitido (solo macOS)"; exit 0; fi

sign() {
  codesign --force --sign - --identifier "$DISCLAIM_ID" "$OUT" >/dev/null 2>&1 || true
}

if [ "$1" = "--if-missing" ] && [ -x "$OUT" ] && [ "$OUT" -nt "$DIR/disclaim.c" ]; then
  if ! codesign -dv "$OUT" 2>&1 | grep -q "^Identifier=$DISCLAIM_ID\$"; then
    sign
    echo "[onyxcode-disclaim] re-firmado (sin recompilar): $OUT"
  fi
  exit 0
fi
if ! command -v clang >/dev/null 2>&1; then
  echo "[onyxcode-disclaim] clang no encontrado (xcode-select --install); los servidores heredarán los permisos TCC" >&2
  exit 0
fi
mkdir -p "$(dirname "$OUT")"
clang -O2 -Wall -Wextra -arch arm64 -arch x86_64 -mmacosx-version-min=12.0 "$DIR/disclaim.c" -o "$OUT"
sign
echo "[onyxcode-disclaim] compilado: $OUT"
