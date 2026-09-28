#!/bin/sh
# Compila el lanzador "disclaim" → resources/launcher/bin/lapis-disclaim (ver disclaim.c).
# Uso: build.sh [--if-missing]
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/bin/lapis-disclaim"
if [ "$(uname)" != "Darwin" ]; then echo "[lapis-disclaim] omitido (solo macOS)"; exit 0; fi
if [ "$1" = "--if-missing" ] && [ -x "$OUT" ] && [ "$OUT" -nt "$DIR/disclaim.c" ]; then exit 0; fi
if ! command -v clang >/dev/null 2>&1; then
  echo "[lapis-disclaim] clang no encontrado (xcode-select --install); los servidores heredarán los permisos TCC" >&2
  exit 0
fi
mkdir -p "$DIR/bin"
clang -O2 -Wall -Wextra -arch arm64 -arch x86_64 -mmacosx-version-min=12.0 "$DIR/disclaim.c" -o "$OUT"
codesign --force --sign - --identifier cl.bentec.lapis.disclaim "$OUT" >/dev/null 2>&1 || true
echo "[lapis-disclaim] compilado: $OUT"
