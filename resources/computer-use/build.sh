#!/bin/sh
# Compila y firma el helper nativo de computer use → resources/computer-use/bin/cu-helper
# Uso: build.sh [--if-missing]
# COMPILAR y FIRMAR están separados: con --if-missing y un binario al día pero firmado con otro
# identificador, solo se re-firma (sin recompilar).
# HELPER_ID debe coincidir con src/shared/brand.ts (lo comprueba src/test/brand-consistency.test.ts).
# TODO(alias): cambiar junto a AUTHOR_ALIAS; ver docs.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${CU_HELPER_OUT:-$DIR/bin/cu-helper}"
HELPER_ID="cl.bentec.lazunox.cu-helper"
if [ "$(uname)" != "Darwin" ]; then echo "[cu-helper] omitido (solo macOS)"; exit 0; fi

# Firma ad-hoc con identificador estable (TCC asocia los permisos al binario/app responsable).
sign() {
  codesign --force --sign - --identifier "$HELPER_ID" "$OUT" >/dev/null 2>&1 || true
}


# cu-keys: teclado por teclas físicas para clientes de escritorio remoto (keys.swift). Binario APARTE de cu-helper a propósito:
# recompilar cu-helper cambia su firma y macOS olvidaría sus permisos. Solo se recompila si keys.swift es más nuevo.
KEYS_OUT="$(dirname "$OUT")/cu-keys"
KEYS_ID="cl.bentec.lazunox.cu-keys"
build_keys() {
  if [ -x "$KEYS_OUT" ] && [ "$KEYS_OUT" -nt "$DIR/keys.swift" ]; then return 0; fi
  command -v swiftc >/dev/null 2>&1 || return 0
  mkdir -p "$(dirname "$KEYS_OUT")"
  swiftc -O -target arm64-apple-macos13 "$DIR/keys.swift" -o "$KEYS_OUT.arm64" || return 0
  if swiftc -O -target x86_64-apple-macos13 "$DIR/keys.swift" -o "$KEYS_OUT.x86_64" 2>/dev/null; then
    lipo -create "$KEYS_OUT.arm64" "$KEYS_OUT.x86_64" -output "$KEYS_OUT"
    rm -f "$KEYS_OUT.arm64" "$KEYS_OUT.x86_64"
  else
    mv "$KEYS_OUT.arm64" "$KEYS_OUT"
  fi
  codesign --force --sign - --identifier "$KEYS_ID" "$KEYS_OUT" >/dev/null 2>&1 || true
  echo "[cu-keys] compilado: $KEYS_OUT"
}

build_keys

if [ "$1" = "--if-missing" ] && [ -x "$OUT" ] && [ "$OUT" -nt "$DIR/helper.swift" ]; then
  if ! codesign -dv "$OUT" 2>&1 | grep -q "^Identifier=$HELPER_ID\$"; then
    sign
    echo "[cu-helper] re-firmado (sin recompilar): $OUT"
  fi
  exit 0
fi
if ! command -v swiftc >/dev/null 2>&1; then
  echo "[cu-helper] swiftc no encontrado (xcode-select --install); computer use no estará disponible" >&2
  exit 0
fi
mkdir -p "$(dirname "$OUT")"
swiftc -O -target arm64-apple-macos13 "$DIR/helper.swift" -o "$OUT.arm64"
if swiftc -O -target x86_64-apple-macos13 "$DIR/helper.swift" -o "$OUT.x86_64" 2>/dev/null; then
  lipo -create "$OUT.arm64" "$OUT.x86_64" -output "$OUT"
  rm -f "$OUT.arm64" "$OUT.x86_64"
else
  mv "$OUT.arm64" "$OUT"
fi
sign
echo "[cu-helper] compilado: $OUT"
