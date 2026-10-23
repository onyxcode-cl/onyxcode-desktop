#!/bin/bash
# Paso 3.3 del plan del motor propio (docs/PLAN-MOTOR-PROPIO.md): apunta resources/opencode-bin/pin.json a la release
# v1.19.0-lazunox.1 de onyxcode-cl/lazunox-motor, comprueba contra GitHub que tamaño y SHA-256 coinciden y deja el binario
# nuevo descargado en resources/opencode-bin/bin. No hace commit ni push. Uso: scripts/fork-motor/aplicar-pin.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
PIN=resources/opencode-bin/pin.json
TAG=v1.19.0-lazunox.1
BASE="https://github.com/onyxcode-cl/lazunox-motor/releases/download/$TAG"

node --input-type=module - "$PIN" "$BASE" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs'
const [, , pinPath, base] = process.argv
const pin = JSON.parse(readFileSync(pinPath, 'utf8'))
pin.assets = {
  'darwin-arm64': { url: `${base}/lazunox-motor-darwin-arm64.zip`, sha256: 'd8fdaea1c963613d193376db1e537a69e2ef75d26e008d567fadf47087d6cad8', size: 35157564 },
  'win32-x64': { url: `${base}/lazunox-motor-windows-x64.zip`, sha256: 'f136e56acb449c1aee6013694b55567db3f833d67b2773b2eacbcb2a01a63169', size: 50249600 },
  'linux-x64': { url: `${base}/lazunox-motor-linux-x64.tar.gz`, sha256: 'f00e8b9f698cc663c6ee1d25ca161197ee0242345de357cf644fc8538eb8b774', size: 50344153 }
}
writeFileSync(pinPath, JSON.stringify(pin, null, 2) + '\n')
console.log('pin.json actualizado: version', pin.version, '->', Object.keys(pin.assets).join(', '))
JS

echo "Descargando y verificando el motor de esta plataforma (tamaño y SHA-256)…"
rm -f resources/opencode-bin/bin/opencode resources/opencode-bin/bin/opencode.exe
node scripts/fetch-opencode.mjs
echo
echo "Listo. Revisa el cambio con: git diff resources/opencode-bin/pin.json"
echo "Siguiente paso (lo hago yo cuando me avises): contrato, 27 comprobaciones y prueba del .exe en Windows."
