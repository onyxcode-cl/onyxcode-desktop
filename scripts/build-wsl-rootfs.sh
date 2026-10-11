#!/bin/bash
# Construye la imagen base («rootfs») de «Tareas en Windows»: Debian 13 trixie minbase, reproducible bit a bit (mmdebstrap sobre
# snapshot.debian.org con fecha fija, SOURCE_DATE_EPOCH y `gzip -n`). SOLO se ejecuta en Linux x64 (CI) o dentro de un contenedor
# amd64 (Mac con Docker/colima); nunca en la app ni en las pruebas.
#
# Desde la Mac (o cualquier anfitrión con Docker), con límite de tiempo y UNA sola construcción a la vez:
#   perl -e 'alarm 3600; exec @ARGV' docker run --rm --privileged --platform linux/amd64 -v "$PWD:/w" \
#     debian:trixie@sha256:<digest> /w/scripts/build-wsl-rootfs.sh --inside [--check]
#
# Uso:  scripts/build-wsl-rootfs.sh --inside [--check] [--version V] [--snapshot YYYYMMDDTHHMMSSZ] [--out DIR]
#   --inside    obligatorio: confirma que estás en el contenedor/CI Linux x64 (instala mmdebstrap con apt y monta en /dev, /proc).
#   --check     construye DOS veces y exige el mismo sha256.
#   --version   versión de la imagen (YYYY.M.D). Por defecto la de este script.
#   --snapshot  fecha de snapshot.debian.org. Por defecto la de este script.
#   --out       carpeta de salida (por defecto ./out).
# Salida: lazunox-rootfs-<ver>-x64.tar.gz, rootfs-packages-<ver>.txt (dpkg-query, para el SBOM y THIRD_PARTY) y rootfs-build.json.
set -euo pipefail
export LC_ALL=C TZ=UTC

ROOTFS_VERSION="${LAZUNOX_ROOTFS_VERSION:-2026.10.10}"
SNAPSHOT="${LAZUNOX_SNAPSHOT:-20261001T000000Z}"
SUITE=trixie
ARCH=amd64
UNPACKED_MAX=943718400
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
OUT="$PWD/out"
INSIDE=0
CHECK=0

while [ $# -gt 0 ]; do
  case "$1" in
    --inside) INSIDE=1 ;;
    --check) CHECK=1 ;;
    --version) ROOTFS_VERSION="${2:?falta valor}"; shift ;;
    --snapshot) SNAPSHOT="${2:?falta valor}"; shift ;;
    --out) OUT="${2:?falta valor}"; shift ;;
    -h|--help) sed -n '2,17p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "argumento desconocido: $1" >&2; exit 2 ;;
  esac
  shift
done

[ "$INSIDE" = 1 ] || { echo "Falta --inside: este script solo se ejecuta en Linux x64 (CI o contenedor amd64). Ver la cabecera." >&2; exit 2; }
[ "$(uname -s)" = Linux ] || { echo "No es Linux: usa el contenedor (ver la cabecera)." >&2; exit 2; }
[ "$(dpkg --print-architecture 2>/dev/null || true)" = "$ARCH" ] || { echo "Se necesita Linux amd64 (en la Mac: --platform linux/amd64)." >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "Se necesita root (mmdebstrap --mode=root)." >&2; exit 2; }
[[ "$ROOTFS_VERSION" =~ ^[0-9]{4}\.[0-9]{1,2}\.[0-9]{1,2}$ ]] || { echo "versión inválida: $ROOTFS_VERSION" >&2; exit 2; }
[[ "$SNAPSHOT" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo "instantánea inválida: $SNAPSHOT" >&2; exit 2; }

# Fecha de la instantánea = SOURCE_DATE_EPOCH (todas las marcas de tiempo salen de aquí).
SNAP_ISO="${SNAPSHOT:0:4}-${SNAPSHOT:4:2}-${SNAPSHOT:6:2}T${SNAPSHOT:9:2}:${SNAPSHOT:11:2}:${SNAPSHOT:13:2}Z"
SOURCE_DATE_EPOCH="$(date -u -d "$SNAP_ISO" +%s)"
export SOURCE_DATE_EPOCH LAZUNOX_ROOTFS_VERSION="$ROOTFS_VERSION" LAZUNOX_SNAPSHOT="$SNAPSHOT"
BUILT_AT="$(date -u -d "@$SOURCE_DATE_EPOCH" +%F)"

for f in "$REPO/resources/wsl/wsl.conf" "$REPO/resources/wsl/rootfs/lazunox-install" "$HERE/wsl-rootfs/packages.txt" "$HERE/wsl-rootfs/customize.sh" "$HERE/wsl-rootfs/pip-requirements.txt"; do
  [ -f "$f" ] || { echo "falta $f" >&2; exit 1; }
done

if ! command -v mmdebstrap >/dev/null; then
  # Dentro del contenedor fijado por digest; mmdebstrap sale del propio Debian trixie del contenedor.
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends mmdebstrap ca-certificates perl
fi
if ! python3 -m pip --version >/dev/null 2>&1; then
  # pip lo usa customize.sh (en el anfitrión) para instalar en la imagen las librerías de Python que Debian 13 no trae.
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends python3 python3-pip ca-certificates
fi

PACKAGES="$(grep -v '^[[:space:]]*#' "$HERE/wsl-rootfs/packages.txt" | grep -v '^[[:space:]]*$' | paste -sd, -)"
mkdir -p "$OUT"
NAME="lazunox-rootfs-$ROOTFS_VERSION-x64"

# Check-Valid-Until=false: las instantáneas de snapshot.debian.org llevan un «Valid-Until» de ~7 días en InRelease y caducan
# aunque su contenido está fijado por fecha y por las sumas de los índices (si no, no se puede reconstruir pasada una semana).
build_once() { # $1 = prefijo de salida (sin extensión)
  local tarball="$1.tar"
  rm -f "$tarball" "$tarball.gz"
  mmdebstrap --variant=minbase --architectures="$ARCH" --mode=root --format=tar \
    --include="$PACKAGES" \
    --aptopt='Acquire::Check-Valid-Until "false"' \
    --dpkgopt='path-exclude=/usr/share/doc/*' --dpkgopt='path-include=/usr/share/doc/*/copyright' \
    --dpkgopt='path-exclude=/usr/share/man/*' --dpkgopt='path-exclude=/usr/share/info/*' \
    --dpkgopt='path-exclude=/usr/share/locale/*' --dpkgopt='path-include=/usr/share/locale/locale.alias' \
    --customize-hook="$HERE/wsl-rootfs/customize.sh \"\$1\"" \
    "$SUITE" "$tarball" \
    "deb http://snapshot.debian.org/archive/debian/$SNAPSHOT/ $SUITE main" \
    "deb http://snapshot.debian.org/archive/debian-security/$SNAPSHOT/ $SUITE-security main"
  gzip -n -9 "$tarball"
}

sha() { sha256sum "$1" | cut -d' ' -f1; }

build_once "$OUT/$NAME"
TGZ="$OUT/$NAME.tar.gz"
SHA="$(sha "$TGZ")"

if [ "$CHECK" = 1 ]; then
  build_once "$OUT/$NAME.check"
  SHA2="$(sha "$OUT/$NAME.check.tar.gz")"
  rm -f "$OUT/$NAME.check.tar.gz"
  if [ "$SHA" != "$SHA2" ]; then
    echo "NO reproducible: $SHA ≠ $SHA2" >&2
    exit 1
  fi
  echo "reproducible: dos construcciones dan $SHA"
fi

SIZE="$(stat -c %s "$TGZ")"
UNPACKED="$(gzip -dc "$TGZ" | wc -c)"
[ "$UNPACKED" -le "$UNPACKED_MAX" ] || { echo "la imagen descomprimida ($UNPACKED) pasa del tope ($UNPACKED_MAX)" >&2; exit 1; }

# SBOM: paquetes y versiones de la imagen (anexo de la release y de THIRD_PARTY_NOTICES).
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
tar -xzf "$TGZ" -C "$TMP" ./var/lib/dpkg/status 2>/dev/null || tar -xzf "$TGZ" -C "$TMP" var/lib/dpkg/status
dpkg-query --admindir="$TMP/var/lib/dpkg" -W -f='${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n' | sort >"$OUT/rootfs-packages-$ROOTFS_VERSION.txt"

cat >"$OUT/rootfs-build.json" <<JSON
{
  "id": "lazunox-rootfs",
  "version": "$ROOTFS_VERSION",
  "arch": "x64",
  "suite": "$SUITE",
  "snapshot": "$SNAPSHOT",
  "epoch": $SOURCE_DATE_EPOCH,
  "builtAt": "$BUILT_AT",
  "file": "$NAME.tar.gz",
  "sha256": "$SHA",
  "size": $SIZE,
  "unpackedSize": $UNPACKED,
  "checked": $([ "$CHECK" = 1 ] && echo true || echo false)
}
JSON
echo "listo: $TGZ ($SIZE bytes, sha256 $SHA)"
