#!/bin/sh
# Compila lazunox-keybox de forma REPRODUCIBLE y deja el binario en resources/keybox/lazunox-keybox (se SUBE a git a propósito).
#
# Por qué el binario va en git y no se compila en cada release: su `cdhash` es la identidad que el Llavero de macOS recuerda. Si un
# release lo recompilara con otro compilador, la identidad cambiaría y todos los usuarios verían la pregunta del Llavero otra vez.
# Las banderas (-gnone, sin firma automática) hacen que el mismo código dé siempre el mismo `cdhash`. Una prueba exige que
# keybox.swift coincida con SOURCE.sha256: si cambias el código, recompila con este script y actualiza ese archivo.
#
# KEYBOX_ID debe coincidir con `keyboxId` de build/sign-common.js (lo vuelve a firmar con ese identificador al empaquetar).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
KEYBOX_ID="cl.bentec.lazunox.keybox"
if [ "$(uname)" != "Darwin" ]; then echo "[keybox] omitido (solo macOS)"; exit 0; fi
command -v swiftc >/dev/null 2>&1 || { echo "[keybox] falta swiftc (Xcode Command Line Tools)"; exit 1; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$DIR/keybox.swift" "$TMP/keybox.swift"
(cd "$TMP" && swiftc -O -gnone -target arm64-apple-macos13 -Xlinker -no_adhoc_codesign keybox.swift -o lazunox-keybox)
codesign --force --sign - --identifier "$KEYBOX_ID" "$TMP/lazunox-keybox"
cp "$TMP/lazunox-keybox" "$DIR/lazunox-keybox"
shasum -a 256 "$DIR/keybox.swift" | awk '{print $1}' > "$DIR/SOURCE.sha256"
echo "[keybox] compilado: $DIR/lazunox-keybox"
codesign -dvvv "$DIR/lazunox-keybox" 2>&1 | grep -E "^(Identifier|CDHash)"
