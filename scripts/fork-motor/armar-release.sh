#!/bin/bash
# Arma los archivos de una release del motor propio (onyxcode-cl/lazunox-motor) a partir de los binarios compilados en el VPS
# (scripts/fork-motor/build-targets-vps.sh). No publica nada: deja una carpeta con los .zip/.tar.gz, SHA256SUMS y release.json
# (huellas y tamaños) que usa publicar-motor.sh.
# Uso: scripts/fork-motor/armar-release.sh <etiqueta> <carpeta-de-salida>      p. ej. v1.19.0-lazunox.2 /tmp/motor-2
set -euo pipefail
TAG="${1:?falta la etiqueta (p. ej. v1.19.0-lazunox.2)}"
OUT="${2:?falta la carpeta de salida}"
K="$HOME/.ssh/lazunox_deploy_ed25519"
VPS="root@72.60.55.136"
SSH_O=(-i "$K" -o IdentitiesOnly=yes -o BatchMode=yes)
mkdir -p "$OUT/d" "$OUT/w" "$OUT/l"
# Reproducibilidad: antes de empaquetar se exige que las dos compilaciones de cada plataforma (-1 y -2) sean idénticas.
for t in darwin-arm64 win32-x64 linux-x64; do
  ssh "${SSH_O[@]}" "$VPS" "cmp -s /opt/lzx-fork/out-$t-1 /opt/lzx-fork/out-$t-2" || { echo "ERROR: las dos compilaciones de $t NO son idénticas; no se empaqueta" >&2; exit 3; }
done
scp "${SSH_O[@]}" -q "$VPS:/opt/lzx-fork/out-darwin-arm64-1" "$OUT/d/opencode"
scp "${SSH_O[@]}" -q "$VPS:/opt/lzx-fork/out-win32-x64-1" "$OUT/w/opencode.exe"
scp "${SSH_O[@]}" -q "$VPS:/opt/lzx-fork/out-linux-x64-1" "$OUT/l/opencode"
chmod +x "$OUT/d/opencode" "$OUT/l/opencode"
# La compilación cruzada de macOS sale sin firma válida: firma ad-hoc (la app la vuelve a firmar con su certificado).
codesign --force --sign - "$OUT/d/opencode" >/dev/null 2>&1
(cd "$OUT/d" && rm -f ../lazunox-motor-darwin-arm64.zip && zip -q ../lazunox-motor-darwin-arm64.zip opencode)
(cd "$OUT/w" && rm -f ../lazunox-motor-windows-x64.zip && zip -q ../lazunox-motor-windows-x64.zip opencode.exe)
(cd "$OUT/l" && COPYFILE_DISABLE=1 tar -czf ../lazunox-motor-linux-x64.tar.gz opencode)
# La app espera ese nombre para el motor de WSL (el renombrado completo es otra etapa).
cp "$OUT/lazunox-motor-linux-x64.tar.gz" "$OUT/opencode-linux-x64.tar.gz"
(cd "$OUT" && shasum -a 256 lazunox-motor-darwin-arm64.zip lazunox-motor-windows-x64.zip lazunox-motor-linux-x64.tar.gz opencode-linux-x64.tar.gz > SHA256SUMS)
node --input-type=module - "$OUT" "$TAG" <<'JS'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
const [, , out, tag] = process.argv
const info = (f) => ({ file: f, sha256: createHash('sha256').update(readFileSync(join(out, f))).digest('hex'), size: statSync(join(out, f)).size })
const rel = {
  tag,
  version: '1.19.0',
  assets: {
    'darwin-arm64': info('lazunox-motor-darwin-arm64.zip'),
    'win32-x64': info('lazunox-motor-windows-x64.zip'),
    'linux-x64': info('opencode-linux-x64.tar.gz')
  }
}
writeFileSync(join(out, 'release.json'), JSON.stringify(rel, null, 2) + '\n')
console.log(JSON.stringify(rel, null, 2))
JS
echo
echo "Listo en $OUT. Siguiente: scripts/fork-motor/publicar-motor.sh $TAG $OUT   (publica en GitHub; lo corre una persona)"
