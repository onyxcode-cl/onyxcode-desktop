#!/bin/bash
# Gancho de personalización de mmdebstrap para la imagen de «Tareas en Windows». Recibe la raíz en $1 y corre como root en el
# anfitrión (no dentro de un chroot). DETERMINISTA: sin fechas, sin aleatorios, todo con el epoch de la instantánea.
# Entorno obligatorio: SOURCE_DATE_EPOCH, LAZUNOX_ROOTFS_VERSION, LAZUNOX_SNAPSHOT. Lo invoca scripts/build-wsl-rootfs.sh.
set -euo pipefail
umask 022
export LC_ALL=C TZ=UTC

ROOT="${1:?uso: customize.sh <raíz>}"
: "${SOURCE_DATE_EPOCH:?falta SOURCE_DATE_EPOCH}" "${LAZUNOX_ROOTFS_VERSION:?falta LAZUNOX_ROOTFS_VERSION}" "${LAZUNOX_SNAPSHOT:?falta LAZUNOX_SNAPSHOT}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
[ -d "$ROOT/etc" ] || { echo "customize: «$ROOT» no parece una raíz" >&2; exit 1; }
[[ "$LAZUNOX_ROOTFS_VERSION" =~ ^[0-9]{4}\.[0-9]{1,2}\.[0-9]{1,2}$ ]] || { echo "customize: versión inválida" >&2; exit 1; }
[[ "$LAZUNOX_SNAPSHOT" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo "customize: instantánea inválida" >&2; exit 1; }
[[ "$SOURCE_DATE_EPOCH" =~ ^[0-9]+$ ]] || { echo "customize: SOURCE_DATE_EPOCH inválido" >&2; exit 1; }

WSL_CONF_SRC="$REPO/resources/wsl/wsl.conf"
INSTALL_SRC="$REPO/resources/wsl/rootfs/lazunox-install"
[ -f "$WSL_CONF_SRC" ] || { echo "customize: falta $WSL_CONF_SRC" >&2; exit 1; }
[ -f "$INSTALL_SRC" ] || { echo "customize: falta $INSTALL_SRC (lo crea la tanda A3)" >&2; exit 1; }

# 1. wsl.conf byte a byte igual que WSL_CONF, DENTRO de la imagen antes del primer arranque (sin interop ni automontaje).
install -m 0644 -o 0 -g 0 "$WSL_CONF_SRC" "$ROOT/etc/wsl.conf"

# 2. Usuario y grupo lazunox (1000), sin shell; root bloqueado. Se escriben los archivos a mano: useradd mete fechas y orden variables.
DAYS=$((SOURCE_DATE_EPOCH / 86400))
grep -q '^lazunox:' "$ROOT/etc/passwd" && { echo "customize: lazunox ya existe" >&2; exit 1; }
printf 'lazunox:x:1000:1000:Lazunox:/home/lazunox:/usr/sbin/nologin\n' >>"$ROOT/etc/passwd"
printf 'lazunox:x:1000:\n' >>"$ROOT/etc/group"
printf 'lazunox:*:%s:0:99999:7:::\n' "$DAYS" >>"$ROOT/etc/shadow"
[ -f "$ROOT/etc/gshadow" ] && printf 'lazunox:*::\n' >>"$ROOT/etc/gshadow"
# Campo de último cambio de todas las cuentas = epoch; contraseña de root bloqueada (`*`).
awk -F: -v OFS=: -v d="$DAYS" '{ if ($1 == "root") $2 = "*"; $3 = d; print }' "$ROOT/etc/shadow" >"$ROOT/etc/shadow.new"
cat "$ROOT/etc/shadow.new" >"$ROOT/etc/shadow" && rm -f "$ROOT/etc/shadow.new"
install -d -m 0750 -o 1000 -g 1000 "$ROOT/home/lazunox"

# 3. Sin setuid ni setgid en ningún archivo ni carpeta (A12).
find "$ROOT" -xdev ! -type l -perm /6000 -exec chmod ug-s {} +

# 4. /opt/lazunox vacío (la carga se instala después por stdin), root:root 0755.
install -d -m 0755 -o 0 -g 0 "$ROOT/opt/lazunox"
find "$ROOT/opt/lazunox" -mindepth 1 -delete

# 5. Instalador de la carga.
install -d -m 0755 -o 0 -g 0 "$ROOT/usr/local/sbin"
install -m 0755 -o 0 -g 0 "$INSTALL_SRC" "$ROOT/usr/local/sbin/lazunox-install"

# 6. Marcador de imagen (lo lee el probe del lanzador).
printf '{"id":"lazunox-rootfs","version":"%s","snapshot":"%s","epoch":%s}\n' "$LAZUNOX_ROOTFS_VERSION" "$LAZUNOX_SNAPSHOT" "$SOURCE_DATE_EPOCH" \
  >"$ROOT/etc/lazunox-rootfs.json"
chmod 0644 "$ROOT/etc/lazunox-rootfs.json"

# 7. Limpieza de lo que varía entre construcciones.
: >"$ROOT/etc/machine-id"
printf 'lazunox\n' >"$ROOT/etc/hostname"
rm -f "$ROOT/etc/resolv.conf"  # WSL lo genera al arrancar
for d in var/lib/apt/lists var/cache var/log; do
  [ -d "$ROOT/$d" ] && find "$ROOT/$d" -mindepth 1 -delete
done
find "$ROOT" -xdev -name __pycache__ -type d -prune -exec rm -rf {} +
rm -f "$ROOT/var/lib/dpkg/"*-old "$ROOT/var/lib/dpkg/lock" "$ROOT/var/lib/dpkg/lock-frontend" 2>/dev/null || true

# Fechas: todo lo posterior al epoch (lo creado arriba) se fija al epoch.
# /proc, /sys y /dev son puntos de montaje de solo lectura dentro del chroot de mmdebstrap (touch falla); sus fechas ya las fija
# mmdebstrap al escribir el tar (mtime limitado a SOURCE_DATE_EPOCH).
find "$ROOT" -xdev -newermt "@$SOURCE_DATE_EPOCH" ! -path "$ROOT/proc" ! -path "$ROOT/sys" ! -path "$ROOT/dev" -exec touch -h -d "@$SOURCE_DATE_EPOCH" {} +
