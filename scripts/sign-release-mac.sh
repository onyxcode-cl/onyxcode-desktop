#!/bin/bash
# Firma la app EMPAQUETADA (dist/mac-arm64/Lazunox.app) con el certificado local «Lazunox Local Signing» (el que fija install.sh) y
# vuelve a armar el .dmg con esa app. Se corre DESPUÉS de `npm run package` y ANTES de `scripts/publish-update.mjs` (que hace el ZIP de
# esa misma app) y de subir la release. Sin notarizar. Uso: scripts/sign-release-mac.sh ["Nombre del certificado"]
#
# Por qué no basta `LAZUNOX_SELF_SIGNED=1 npm run package`: electron-builder se salta la firma si el certificado no es «de confianza»
# en el llavero (los autofirmados no lo son) y deja el paquete a medias. Aquí se firma directamente con `codesign`.
set -euo pipefail
ID="${1:-Lazunox Local Signing}"
cd "$(dirname "$0")/.."
APP=dist/mac-arm64/Lazunox.app
[ -d "$APP" ] || { echo "ERROR: no existe $APP (corre primero npm run package)." >&2; exit 1; }
PIN=$(sed -n 's/^PINNED_CERT_SHA1="\([0-9a-f]\{40\}\)"/\1/p' scripts/install/install.sh)
[ -n "$PIN" ] || { echo "ERROR: no encuentro PINNED_CERT_SHA1 en scripts/install/install.sh." >&2; exit 1; }

echo "Firmando $APP con «$ID»…"
codesign --force --deep --sign "$ID" "$APP"
node -e "
const {readFileSync}=require('fs');const sc=require('./build/sign-common.js');
const ids=sc.idsFromBrandSource(readFileSync('src/shared/brand.ts','utf8'));
sc.resignBundle({appPath:process.argv[1],identity:process.argv[2],ids,mode:'self'})" "$APP" "$ID"

DR=$(codesign -dr - "$APP" 2>&1 | tail -1)
case "$DR" in
  *"certificate leaf = H\"$PIN\""*) echo "OK: la firma coincide con el certificado fijado ($PIN)." ;;
  *) echo "ERROR: la firma NO coincide con el certificado que exige install.sh ($PIN). Requisito: $DR" >&2; exit 1 ;;
esac

echo "Armando el .dmg con la app firmada…"
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --arm64 --prepackaged "$APP" -c.mac.identity=null
ls -la dist/*.dmg
echo "Listo. Siguiente: node scripts/publish-update.mjs (ZIP + manifiesto), firmar el manifiesto y node scripts/publish-github.mjs."
