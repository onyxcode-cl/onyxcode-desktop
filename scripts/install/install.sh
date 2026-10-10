#!/bin/sh
# Instalador de Lazunox para macOS (solo Mac con chip Apple, arm64).
#
# Uso:  curl -fsSL <url-de-este-script> | sh
#       sh install.sh [--version X.Y.Z] [--dry-run] [--no-open] [--uninstall] [--help]
#
# QUÉ HACE (en este orden):
#   1. Comprueba que es macOS con chip Apple. Rechaza los Mac con Intel.
#   2. Descarga de la release de GitHub el SHA256SUMS y el .dmg (con curl) a una carpeta temporal.
#   3. Comprueba el SHA-256 del .dmg contra SHA256SUMS. Si no coincide, aborta sin instalar nada.
#   4. Monta el .dmg en solo lectura y copia Lazunox.app a una carpeta temporal.
#   5. Verifica con `codesign -d -r-` que la firma designada de la app contiene el hash fijado del
#      certificado «Lazunox Local Signing» (PINNED_CERT_SHA1). Si no, aborta sin instalar nada.
#   6. Copia la app a /Applications (o a ~/Applications si /Applications no es escribible).
#   7. Quita la marca de cuarentena si existe, desmonta el .dmg y borra los temporales.
#   8. Ofrece abrir la app (solo si hay una terminal para preguntarte).
#
# QUÉ NO HACE:
#   - No usa sudo y no pide contraseña de administrador.
#   - No toca tus datos (~/Library/Application Support/Lazunox), ni al instalar ni al desinstalar.
#   - No desactiva Gatekeeper ni cambia ningún ajuste de seguridad del sistema.
#   - No instala nada más (ni Homebrew, ni Rosetta, ni herramientas): solo copia Lazunox.app.
#   - No se actualiza ni deja procesos en segundo plano.
#
# La app va firmada con un certificado AUTOFIRMADO (sin Developer ID, sin notarizar). Por eso este
# script comprueba la firma contra el hash fijado en lugar de fiarse del sistema.
#
# Variables de entorno:
#   LAZUNOX_RELEASES_REPO   «dueño/repositorio» con las releases en el servidor (anula la constante de abajo).
#   LAZUNOX_RELEASES_ORIGIN servidor de releases (https://…); solo para pruebas.
#   LAZUNOX_INSTALL_DIR     carpeta destino (por defecto /Applications o ~/Applications). Útil para pruebas.

set -eu

# --- Constantes -----------------------------------------------------------------------------------
# Mientras valga PENDIENTE no hay release publicada y el script se niega a ejecutarse.
RELEASES_REPO_DEFAULT="lazunox/lazunox"
# Servidor propio de releases (misma estructura que GitHub Releases). LAZUNOX_RELEASES_ORIGIN lo anula (pruebas).
RELEASES_ORIGIN_DEFAULT="https://lazunox.onyxcode.cl"
# SHA-1 de la hoja del certificado «Lazunox Local Signing», en minúsculas.
PINNED_CERT_SHA1="8446c25f2c710d66701c262f048390d8f6edba31"
APP_NAME="Lazunox.app"
BUNDLE_ID="cl.bentec.lazunox"
DATA_DIR="$HOME/Library/Application Support/Lazunox"

REPO="${LAZUNOX_RELEASES_REPO:-$RELEASES_REPO_DEFAULT}"
ORIGIN="${LAZUNOX_RELEASES_ORIGIN:-$RELEASES_ORIGIN_DEFAULT}"
VERSION=""
DRY_RUN=0
NO_OPEN=0
UNINSTALL=0

say() { printf '%s\n' "$*"; }
err() { printf 'Error: %s\n' "$*" >&2; }
die() { err "$*"; exit 1; }

usage() {
  cat <<USAGE
Instalador de Lazunox (solo Mac con chip Apple).

Uso: install.sh [opciones]
  --version X.Y.Z   instala esa versión (por defecto, la última release)
  --dry-run         muestra cada paso sin ejecutar nada
  --no-open         no ofrece abrir la app al terminar
  --uninstall       borra Lazunox.app (tus datos NO se tocan)
  --help            muestra esta ayuda

No usa sudo, no toca tus datos, no desactiva Gatekeeper y no instala nada más.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      [ $# -ge 2 ] || die "--version necesita un valor (por ejemplo --version 0.3.0)."
      VERSION="${2#v}"
      shift 2
      ;;
    --dry-run) DRY_RUN=1; shift ;;
    --no-open) NO_OPEN=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) err "opción desconocida: $1"; usage >&2; exit 2 ;;
  esac
done

# Ejecuta un paso, o solo lo imprime con --dry-run.
run() {
  if [ "$DRY_RUN" = 1 ]; then
    say "[dry-run] $*"
  else
    "$@"
  fi
}

# --- Desinstalar (no necesita release ni red) -------------------------------------------------------
if [ "$UNINSTALL" = 1 ]; then
  found=0
  for dir in "${LAZUNOX_INSTALL_DIR:-}" /Applications "$HOME/Applications"; do
    [ -n "$dir" ] || continue
    if [ -d "$dir/$APP_NAME" ]; then
      found=1
      say "Borrando $dir/$APP_NAME"
      run rm -rf "$dir/$APP_NAME"
    fi
  done
  [ "$found" = 1 ] || say "No se encontró $APP_NAME en /Applications ni en ~/Applications."
  say "Tus datos NO se han tocado: siguen en $DATA_DIR"
  say "(Si algún día quieres borrarlos, hazlo tú a mano: este script nunca lo hace.)"
  exit 0
fi

# --- Instalar -----------------------------------------------------------------------------------------
if [ "$REPO" = "PENDIENTE" ] || [ -z "$REPO" ]; then
  err "todavía no hay una release publicada de Lazunox, así que no hay nada que instalar."
  err "Cuando exista, este script se actualizará solo con la dirección correcta."
  err "(Si ya tienes la dirección: LAZUNOX_RELEASES_REPO=dueño/repo sh install.sh)"
  exit 1
fi

if [ -n "$VERSION" ]; then
  BASE_URL="$ORIGIN/$REPO/releases/download/v$VERSION"
else
  BASE_URL="$ORIGIN/$REPO/releases/latest/download"
fi

if [ "$DRY_RUN" = 1 ]; then
  say "[dry-run] No se ejecuta nada; solo se muestran los pasos."
  say "[dry-run] comprobar: uname -s = Darwin y uname -m = arm64 (rechazar Intel)"
  say "[dry-run] crear carpeta temporal (se borra al terminar, también si falla)"
  say "[dry-run] curl -fsSL $BASE_URL/SHA256SUMS"
  say "[dry-run] curl -fsSL $BASE_URL/<archivo>-arm64.dmg (el nombre sale de SHA256SUMS)"
  say "[dry-run] comprobar el SHA-256 del .dmg contra SHA256SUMS (abortar si no coincide)"
  say "[dry-run] hdiutil attach -readonly -nobrowse (montar el .dmg)"
  say "[dry-run] ditto $APP_NAME a una carpeta temporal"
  say "[dry-run] codesign -d -r- : la firma debe contener certificate leaf = H\"$PINNED_CERT_SHA1\""
  say "[dry-run] copiar a /Applications (o ~/Applications si no es escribible); nunca sudo"
  say "[dry-run] xattr -dr com.apple.quarantine (solo si la marca existe)"
  say "[dry-run] hdiutil detach (desmontar)"
  say "[dry-run] ofrecer abrir la app (omitido con --no-open)"
  exit 0
fi

# 1. Plataforma.
[ "$(uname -s)" = "Darwin" ] || die "Lazunox solo funciona en macOS."
ARCH="$(uname -m)"
if [ "$ARCH" != "arm64" ]; then
  die "Lazunox solo está disponible para Mac con chip Apple (arm64); este Mac es $ARCH (Intel). No se instaló nada."
fi

# Temporales y limpieza: se ejecuta siempre (éxito, error o Ctrl+C) y desmonta el .dmg si quedó montado.
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazunox-install.XXXXXX")"
MNT="$TMP/mnt"
MOUNTED=0
cleanup() {
  if [ "$MOUNTED" = 1 ]; then
    hdiutil detach "$MNT" -quiet >/dev/null 2>&1 || hdiutil detach "$MNT" -force -quiet >/dev/null 2>&1 || true
    MOUNTED=0
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

# 2. Descarga.
say "Descargando la lista de sumas (SHA256SUMS)..."
curl -fsSL -o "$TMP/SHA256SUMS" "$BASE_URL/SHA256SUMS" || die "no se pudo descargar $BASE_URL/SHA256SUMS."
DMG_NAME="$(awk '{ f=$2; sub(/^\*/, "", f); if (f ~ /-arm64\.dmg$/) { print f; exit } }' "$TMP/SHA256SUMS")"
[ -n "$DMG_NAME" ] || die "SHA256SUMS no lista ningún .dmg arm64."
case "$DMG_NAME" in */*|*..*) die "nombre de archivo sospechoso en SHA256SUMS: $DMG_NAME" ;; esac
EXPECTED="$(awk -v n="$DMG_NAME" '{ f=$2; sub(/^\*/, "", f); if (f == n) { print tolower($1); exit } }' "$TMP/SHA256SUMS")"

say "Descargando $DMG_NAME..."
curl -fsSL -o "$TMP/$DMG_NAME" "$BASE_URL/$DMG_NAME" || die "no se pudo descargar $BASE_URL/$DMG_NAME."

# 3. SHA-256.
ACTUAL="$(shasum -a 256 "$TMP/$DMG_NAME" | awk '{ print tolower($1) }')"
if [ "$ACTUAL" != "$EXPECTED" ]; then
  err "el SHA-256 del .dmg NO coincide con SHA256SUMS. No se instaló nada."
  err "  esperado: $EXPECTED"
  err "  obtenido: $ACTUAL"
  exit 1
fi
say "SHA-256 correcto."

# 4. Montar (solo lectura) y copiar a un sitio temporal para verificar antes de instalar.
mkdir -p "$MNT" "$TMP/stage"
hdiutil attach -readonly -nobrowse -noverify -mountpoint "$MNT" "$TMP/$DMG_NAME" >/dev/null || die "no se pudo montar el .dmg."
MOUNTED=1
[ -d "$MNT/$APP_NAME" ] || die "el .dmg no contiene $APP_NAME."
ditto "$MNT/$APP_NAME" "$TMP/stage/$APP_NAME"

# 5. Firma: la designada debe ser la de nuestro certificado fijado.
DESIGNATED="$(codesign -d -r- "$TMP/stage/$APP_NAME" 2>&1 | tr 'A-Z' 'a-z')" || die "codesign no pudo leer la firma de la app."
case "$DESIGNATED" in
  *"identifier \"$BUNDLE_ID\""*"certificate leaf = h\"$PINNED_CERT_SHA1\""*) ;;
  *) die "la firma de la app NO corresponde al certificado esperado (Lazunox Local Signing). No se instaló nada." ;;
esac
say "Firma verificada (certificado fijado $PINNED_CERT_SHA1)."

# 6. Destino: sin sudo. /Applications si es escribible; si no, ~/Applications.
if [ -n "${LAZUNOX_INSTALL_DIR:-}" ]; then
  DEST_DIR="$LAZUNOX_INSTALL_DIR"
elif [ -w /Applications ]; then
  DEST_DIR="/Applications"
else
  DEST_DIR="$HOME/Applications"
fi
mkdir -p "$DEST_DIR"
DEST="$DEST_DIR/$APP_NAME"
say "Instalando en $DEST"
rm -rf "$DEST"
ditto "$TMP/stage/$APP_NAME" "$DEST"

# 7. Cuarentena (un archivo bajado con curl normalmente no la trae) y desmontar.
if xattr -p com.apple.quarantine "$DEST" >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "$DEST"
fi
hdiutil detach "$MNT" -quiet >/dev/null 2>&1 && MOUNTED=0 || true

say "Listo: Lazunox quedó instalado en $DEST"
say "Tus datos viven en $DATA_DIR y este script nunca los toca."

# 8. Abrir (solo si hay terminal para preguntar).
if [ "$NO_OPEN" = 0 ]; then
  ans=""
  printf '¿Abrir Lazunox ahora? [s/N] '
  { read -r ans < /dev/tty; } 2>/dev/null || ans=""
  printf '\n'
  case "$ans" in
    s|S|y|Y|si|sí|SI|Sí) open "$DEST" ;;
  esac
fi
