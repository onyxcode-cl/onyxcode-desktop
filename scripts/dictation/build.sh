#!/bin/sh
# Compila el prototipo onyx-dictate (Fase 0). NO versiona binarios.
# Uso: scripts/dictation/build.sh [carpeta-de-salida]   (por defecto /tmp/onyx-dictate-build)
# Sin swiftc: instalar con `xcode-select --install`; el codigo queda sin compilar.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/resources/dictation/onyx-dictate/main.swift"
OUTDIR="${1:-${TMPDIR:-/tmp}/onyx-dictate-build}"
if [ "$(uname)" != "Darwin" ]; then echo "[onyx-dictate] solo macOS" >&2; exit 1; fi
if ! command -v swiftc >/dev/null 2>&1; then
  echo "[onyx-dictate] swiftc NO existe en esta maquina (xcode-select --install). Codigo sin compilar. Comando exacto:" >&2
  echo "  swiftc -O -swift-version 5 $SRC -o $OUTDIR/onyx-dictate" >&2
  exit 1
fi
mkdir -p "$OUTDIR"
swiftc -O -swift-version 5 "$SRC" -o "$OUTDIR/onyx-dictate"
# Firma ad-hoc con identificador estable (TCC asocia los permisos al binario / app responsable).
codesign --force --sign - --identifier "cl.bentec.opendesk.dictate" "$OUTDIR/onyx-dictate" >/dev/null 2>&1 || true
echo "[onyx-dictate] compilado: $OUTDIR/onyx-dictate"
