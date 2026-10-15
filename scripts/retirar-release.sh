#!/bin/bash
# Retira una versión MALA y deja la anterior como vigente (GitHub + página de descargas). Uso: scripts/retirar-release.sh 0.5.24 0.5.23
# 1) pasa la release mala a borrador (el actualizador y «latest» dejan de verla); 2) vuelve a poner en la página los instaladores de la versión buena
# (site/publicar-descargas.sh) y sube el index.html con sus nombres. FALTA purgar Cloudflare (lo imprime) y avisar a quien ya la instaló.
set -euo pipefail
MALA="${1:?Uso: scripts/retirar-release.sh VERSION_MALA VERSION_BUENA}"; BUENA="${2:?Falta la versión buena}"
cd "$(dirname "$0")/.."
REPO="onyxcode-cl/onyxcode-desktop"
gh release edit "v$MALA" --repo "$REPO" --draft=true >/dev/null && echo "v$MALA pasada a borrador"
site/publicar-descargas.sh "$BUENA"
sed -i '' "s/$MALA/$BUENA/g" site/lazunox/index.html
scp -q -i ~/.ssh/lazunox_deploy_ed25519 -o IdentitiesOnly=yes site/lazunox/index.html root@72.60.55.136:/opt/lazunox-site/html/lazunox/ && echo "index.html con $BUENA subido"
echo "Ahora: purgar Cloudflare (descargas, latest.json, SHA256SUMS, index) y revisar que $BUENA sea «Latest» en GitHub."
