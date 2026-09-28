#!/bin/sh
# Compila el helper nativo de computer use → resources/computer-use/bin/cu-helper
# Uso: build.sh [--if-missing]
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/bin/cu-helper"
if [ "$(uname)" != "Darwin" ]; then echo "[cu-helper] omitido (solo macOS)"; exit 0; fi
if [ "$1" = "--if-missing" ] && [ -x "$OUT" ] && [ "$OUT" -nt "$DIR/helper.swift" ]; then exit 0; fi
if ! command -v swiftc >/dev/null 2>&1; then
  echo "[cu-helper] swiftc no encontrado (xcode-select --install); computer use no estará disponible" >&2
  exit 0
fi
mkdir -p "$DIR/bin"
swiftc -O -target arm64-apple-macos13 "$DIR/helper.swift" -o "$OUT.arm64"
if swiftc -O -target x86_64-apple-macos13 "$DIR/helper.swift" -o "$OUT.x86_64" 2>/dev/null; then
  lipo -create "$OUT.arm64" "$OUT.x86_64" -output "$OUT"
  rm -f "$OUT.arm64" "$OUT.x86_64"
else
  mv "$OUT.arm64" "$OUT"
fi
# Firma ad-hoc con identificador estable (TCC asocia los permisos al binario/app responsable).
codesign --force --sign - --identifier cl.bentec.opendesk.cu-helper "$OUT" >/dev/null 2>&1 || true
echo "[cu-helper] compilado: $OUT"
