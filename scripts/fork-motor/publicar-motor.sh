#!/bin/bash
# Publica en GitHub la release del motor propio armada con armar-release.sh y deja resources/opencode-bin/pin.json apuntando a ella
# (con tamaño y SHA-256 ya verificados contra lo publicado). Lo corre una persona: crea una release PÚBLICA en onyxcode-cl/lazunox-motor.
# Uso: scripts/fork-motor/publicar-motor.sh <etiqueta> <carpeta-armada>
set -euo pipefail
cd "$(dirname "$0")/../.."
TAG="${1:?falta la etiqueta}"
DIR="${2:?falta la carpeta armada con armar-release.sh}"
REPO="onyxcode-cl/lazunox-motor"
[ -f "$DIR/release.json" ] || { echo "No está $DIR/release.json: corre antes armar-release.sh" >&2; exit 2; }

echo "Subiendo la release ${TAG} a ${REPO}..."
gh release create "$TAG" --repo "$REPO" --target main --title "Motor de Lazunox ${TAG#v}" \
  --notes "Base OpenCode 1.19.0 congelada, sin conexiones a servicios de OpenCode (ver LAZUNOX.md). Compilación repetible byte a byte. SHA-256 en SHA256SUMS. El binario de macOS lleva firma ad-hoc (la app lo vuelve a firmar)." \
  "$DIR/lazunox-motor-darwin-arm64.zip" "$DIR/lazunox-motor-windows-x64.zip" "$DIR/lazunox-motor-linux-x64.tar.gz" \
  "$DIR/opencode-linux-x64.tar.gz" "$DIR/SHA256SUMS"

echo "Comprobando lo publicado contra las huellas locales..."
CHK="$(mktemp -d)"
trap 'rm -rf "$CHK"' EXIT
(cd "$CHK" && gh release download "$TAG" --repo "$REPO" >/dev/null && shasum -a 256 -c SHA256SUMS)

echo "Apuntando pin.json a ${TAG}..."
node --input-type=module - "$DIR/release.json" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs'
const rel = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const pinPath = 'resources/opencode-bin/pin.json'
const pin = JSON.parse(readFileSync(pinPath, 'utf8'))
const base = `https://github.com/onyxcode-cl/lazunox-motor/releases/download/${rel.tag}`
pin.version = rel.version
pin.assets = Object.fromEntries(
  Object.entries(rel.assets).map(([k, a]) => [k, { url: `${base}/${a.file}`, sha256: a.sha256, size: a.size }])
)
writeFileSync(pinPath, JSON.stringify(pin, null, 2) + '\n')
console.log('pin.json actualizado:', Object.keys(pin.assets).join(', '))
JS
rm -f resources/opencode-bin/bin/opencode resources/opencode-bin/bin/opencode.exe
node scripts/fetch-opencode.mjs
echo
echo "Listo. Revisa: git diff resources/opencode-bin/pin.json"
