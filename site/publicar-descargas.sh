#!/bin/bash
# Actualiza las descargas directas de la página (onyxcode.cl/lazunox) con una release YA PUBLICADA en GitHub.
# Uso: site/publicar-descargas.sh 0.5.16
#
# Baja el .dmg y el .exe de la release, comprueba su SHA-256 contra el SHA256SUMS de la release y contra el digest que calcula GitHub,
# los sube al VPS (carpeta de preparación), vuelve a comprobar la huella allá, los mueve a su sitio, reescribe latest.json y SHA256SUMS
# y borra las versiones anteriores. NO purga Cloudflare (hace falta su token): al final imprime las URLs que hay que purgar.
# Acceso: llave dedicada ~/.ssh/lazunox_deploy_ed25519 (ver docs/VPS.md).
set -euo pipefail

VERSION="${1:?Uso: site/publicar-descargas.sh X.Y.Z}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Versión no válida: $VERSION" >&2; exit 2; }
REPO="onyxcode-cl/onyxcode-desktop"
HOST="root@72.60.55.136"
KEY="$HOME/.ssh/lazunox_deploy_ed25519"
BASE="/opt/lazunox-site/html/lazunox/descargas"
STAGING="/opt/lazunox-site/staging"
DMG="Lazunox-$VERSION-arm64.dmg"
EXE="Lazunox-Setup-$VERSION-x64.exe"
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 "$HOST")

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

gh release view "v$VERSION" --repo "$REPO" --json isDraft -q '.isDraft' | grep -qx false \
  || { echo "La release v$VERSION no existe o sigue en borrador: publícala primero." >&2; exit 1; }

# La release guarda el .dmg con minúscula (lazunox-…); en la página va con el nombre de siempre.
gh release download "v$VERSION" --repo "$REPO" --dir "$TMP" -p "lazunox-$VERSION-arm64.dmg" -p "$EXE" -p SHA256SUMS
mv "$TMP/lazunox-$VERSION-arm64.dmg" "$TMP/$DMG"

hash_of() { shasum -a 256 "$TMP/$1" | cut -d' ' -f1; }
size_of() { stat -f %z "$TMP/$1"; }
for f in "$DMG" "$EXE"; do
  want="$(awk -v f="$f" 'tolower($2)==tolower(f){print $1}' "$TMP/SHA256SUMS" | head -1)"
  have="$(hash_of "$f")"
  [ -n "$want" ] && [ "$want" = "$have" ] || { echo "La huella de $f no coincide con SHA256SUMS de la release." >&2; exit 1; }
  remote="$(gh api "repos/$REPO/releases/tags/v$VERSION" --jq ".assets[] | select(.name|ascii_downcase==\"$(echo "$f" | tr 'A-Z' 'a-z')\") | .digest")"
  [ "$remote" = "sha256:$have" ] || { echo "El digest de GitHub no coincide para $f." >&2; exit 1; }
  echo "OK huella $f"
done

HM="$(hash_of "$DMG")"; SM="$(size_of "$DMG")"
HW="$(hash_of "$EXE")"; SW="$(size_of "$EXE")"
cat > "$TMP/latest.json" <<EOF
{
  "version": "$VERSION",
  "files": {
    "mac": {
      "file": "$DMG",
      "size": $SM,
      "sha256": "$HM"
    },
    "win": {
      "file": "$EXE",
      "size": $SW,
      "sha256": "$HW"
    }
  }
}
EOF
printf '%s  %s\n%s  %s\n' "$HM" "$DMG" "$HW" "$EXE" > "$TMP/SHA256SUMS.site"

"${SSH[@]}" "mkdir -p $STAGING && rm -rf $STAGING/*"
scp -q -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$TMP/$DMG" "$TMP/$EXE" "$TMP/latest.json" "$HOST:$STAGING/"
scp -q -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$TMP/SHA256SUMS.site" "$HOST:$STAGING/SHA256SUMS"

# Comprobar en el VPS ANTES de publicar, y recién entonces mover (el .json va al final: la página no ve versiones a medias).
"${SSH[@]}" "set -e; cd $STAGING
  [ \"\$(sha256sum $DMG | cut -d' ' -f1)\" = '$HM' ] && [ \"\$(sha256sum $EXE | cut -d' ' -f1)\" = '$HW' ]
  mv $DMG $EXE $BASE/ && mv SHA256SUMS $BASE/SHA256SUMS && mv latest.json $BASE/latest.json
  cd $BASE && for f in Lazunox-*; do case \"\$f\" in $DMG|$EXE) ;; *) rm -f \"\$f\";; esac; done
  ls -la $BASE"

echo
echo "Listo. FALTA purgar Cloudflare para estas URLs:"
for f in "$DMG" "$EXE" latest.json SHA256SUMS; do echo "  https://www.onyxcode.cl/lazunox/descargas/$f"; done
echo "Y comprueba bajando desde el dominio y comparando el SHA-256 (sin caché)."
