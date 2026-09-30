#!/bin/sh
# Reemplazo de la app por la versión ya verificada. Va SELLADO dentro del .app
# (Contents/Resources/updater/swap.sh) y la app lo COPIA a userData/update/run/ (0700) antes de
# lanzarlo, para no ejecutarse desde el paquete que está sustituyendo. Lo arranca src/main/update/swap.ts
# con spawn('/bin/sh', [copia, ...args]) (nunca `sh -c` con cadenas).
#
# Uso: swap.sh PID DESTINO STAGED COPIA DIR_MARCADORES VERSION
#   PID              proceso de la app antigua (debe terminar antes de tocar nada)
#   DESTINO          ruta de la .app instalada (p.ej. /Applications/OnyxCode.app)
#   STAGED           .app nueva ya verificada (userData/update/staging/<ver>/extract/OnyxCode.app)
#   COPIA            copia de seguridad en la MISMA carpeta: <dir>/.OnyxCode.app.bak-<ver>
#   DIR_MARCADORES   userData/update (booting-<ver>, boot-ok-<ver>, result.json)
#   VERSION          versión nueva
# Escribe DIR_MARCADORES/result.json con {"version","ok","rolledBack","error"}.
#
# Modo de prueba (solo para la prueba de integración): ONYXCODE_SWAP_TEST_NO_OPEN=1 solo se acepta si
# DESTINO está bajo $TMPDIR; entonces `open -n` se sustituye por ejecutar Contents/MacOS/$ONYXCODE_SWAP_TEST_EXEC
# (por defecto «toy») sin pasar por LaunchServices, y los tiempos de espera se pueden acortar con
# ONYXCODE_SWAP_WAIT_PID / ONYXCODE_SWAP_WAIT_BOOT (segundos). Además:
#   ONYXCODE_SWAP_TEST_USERDATA=/ruta  → la app se lanza con --user-data-dir=/ruta (nunca toca el userData real)
#   ONYXCODE_SWAP_TEST_FAIL_NEW=1      → la app NUEVA se lanza con ONYXCODE_TEST_FAIL_BOOT=1 (rollback forzado; solo lo
#                                        honra un build de prueba); la antigua restaurada se lanza sin esa variable.
set -eu
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH

[ "$#" -eq 6 ] || { echo "uso: swap.sh PID DESTINO STAGED COPIA DIR VERSION" >&2; exit 64; }
PID=$1
TARGET=$2
STAGED=$3
BAK=$4
DIR=$5
VER=$6
RESULT="$DIR/result.json"

# ---- validación de argumentos (defensa en profundidad; la app ya los validó) ----
case "$PID" in '' | *[!0-9]*) echo "PID no válido" >&2; exit 64 ;; esac
case "$VER" in '' | *[!0-9A-Za-z.+-]*) echo "versión no válida" >&2; exit 64 ;; esac
for p in "$TARGET" "$STAGED" "$BAK" "$DIR"; do
  case "$p" in
    /*) ;;
    *) echo "ruta no absoluta" >&2; exit 64 ;;
  esac
  case "$p" in
    *'
'* | *'"'* | *'\'* | */../* | */.. | */./* | */. | *//*) echo "ruta no válida" >&2; exit 64 ;;
  esac
done
case "$TARGET" in */OnyxCode.app) ;; *) echo "destino no es OnyxCode.app" >&2; exit 64 ;; esac
case "$BAK" in "$(dirname "$TARGET")"/.OnyxCode.app.bak-*) ;; *) echo "copia fuera de la carpeta del destino" >&2; exit 64 ;; esac
[ -d "$STAGED" ] || { echo "no existe STAGED" >&2; exit 64; }
[ -d "$DIR" ] || { echo "no existe el directorio de marcadores" >&2; exit 64; }

TEST=0
WAIT_PID=60
WAIT_BOOT=90
TEST_EXEC=toy
TEST_UD=
TEST_FAIL_NEW=0
if [ "${ONYXCODE_SWAP_TEST_NO_OPEN:-}" = 1 ]; then
  TMP_ROOT=${TMPDIR:-/nonexistent}
  TMP_ROOT=${TMP_ROOT%/}
  case "$TARGET" in
    "$TMP_ROOT"/*) TEST=1 ;;
    *) echo "modo de prueba solo bajo \$TMPDIR" >&2; exit 64 ;;
  esac
  WAIT_PID=${ONYXCODE_SWAP_WAIT_PID:-$WAIT_PID}
  WAIT_BOOT=${ONYXCODE_SWAP_WAIT_BOOT:-$WAIT_BOOT}
  TEST_EXEC=${ONYXCODE_SWAP_TEST_EXEC:-toy}
  case "$TEST_EXEC" in '' | *[!A-Za-z0-9._-]*) echo "ejecutable de prueba no válido" >&2; exit 64 ;; esac
  TEST_UD=${ONYXCODE_SWAP_TEST_USERDATA:-}
  if [ -n "$TEST_UD" ]; then
    case "$TEST_UD" in
      /*) ;;
      *) echo "userdata de prueba no absoluto" >&2; exit 64 ;;
    esac
    case "$TEST_UD" in *'
'* | *'"'* | *'\'* | */../* | */..) echo "userdata de prueba no válido" >&2; exit 64 ;; esac
  fi
  [ "${ONYXCODE_SWAP_TEST_FAIL_NEW:-}" = 1 ] && TEST_FAIL_NEW=1
fi

FAILED="$(dirname "$TARGET")/.OnyxCode.app.failed-$VER"

write_result() { # ok rolledBack error
  printf '{"version":"%s","ok":%s,"rolledBack":%s,"error":"%s"}\n' "$VER" "$1" "$2" "$3" > "$RESULT.tmp" && mv -f "$RESULT.tmp" "$RESULT"
}

launch() { # ruta de la .app; $2 = 1 si es la app NUEVA (solo cuenta en modo de prueba)
  if [ "$TEST" = 1 ]; then
    FAIL=
    [ "${2:-0}" = 1 ] && [ "$TEST_FAIL_NEW" = 1 ] && FAIL=1
    if [ -n "$TEST_UD" ]; then
      ONYXCODE_SWAP_TEST_DIR="$DIR" ONYXCODE_TEST_FAIL_BOOT="$FAIL" "$1/Contents/MacOS/$TEST_EXEC" --user-data-dir="$TEST_UD" >/dev/null 2>&1 </dev/null &
    else
      ONYXCODE_SWAP_TEST_DIR="$DIR" ONYXCODE_TEST_FAIL_BOOT="$FAIL" "$1/Contents/MacOS/$TEST_EXEC" >/dev/null 2>&1 </dev/null &
    fi
  else
    open -n "$1"
  fi
}

# 1. Esperar a que la app antigua termine (nunca tocar nada con ella viva).
i=0
while kill -0 "$PID" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt $((WAIT_PID * 4)) ]; then
    write_result false false "pid-timeout"
    exit 1
  fi
  sleep 0.25
done

# 2. Apartar la app actual (rename atómico en la misma carpeta; ditto solo si falla).
rm -rf "$BAK"
if ! mv "$TARGET" "$BAK" 2>/dev/null; then
  if ditto "$TARGET" "$BAK" 2>/dev/null; then
    rm -rf "$TARGET" 2>/dev/null || true
  else
    rm -rf "$BAK"
    write_result false false "backup-failed"
    exit 1
  fi
fi

restore_old() {
  rm -rf "$TARGET" 2>/dev/null || true
  mv "$BAK" "$TARGET" 2>/dev/null || ditto "$BAK" "$TARGET" 2>/dev/null || true
}

# 3. Poner la nueva (si falla, se restaura la antigua).
if ! mv "$STAGED" "$TARGET" 2>/dev/null; then
  rm -rf "$TARGET" 2>/dev/null || true
  if ! ditto "$STAGED" "$TARGET" 2>/dev/null; then
    restore_old
    launch "$TARGET" || true
    write_result false true "replace-failed"
    exit 1
  fi
fi

# 4. Abrir la nueva y esperar su confirmación de arranque.
rm -f "$DIR/booting-$VER" "$DIR/boot-ok-$VER"
if ! launch "$TARGET" 1; then
  WAIT_BOOT=0
fi
i=0
OK=0
while [ "$i" -lt $((WAIT_BOOT * 4)) ]; do
  if [ -f "$DIR/boot-ok-$VER" ]; then
    OK=1
    break
  fi
  # Si la nueva escribió su PID y ya no vive, no hace falta esperar más.
  if [ -f "$DIR/booting-$VER" ]; then
    NP=$(head -n 1 "$DIR/booting-$VER" 2>/dev/null || true)
    case "$NP" in
      '' | *[!0-9]*) ;;
      *) kill -0 "$NP" 2>/dev/null || { sleep 1; [ -f "$DIR/boot-ok-$VER" ] && OK=1; break; } ;;
    esac
  fi
  i=$((i + 1))
  sleep 0.25
done

if [ "$OK" = 1 ]; then
  write_result true false ""
  exit 0
fi

# 5. Rollback: parar la nueva (solo si el PID es de un proceso de la .app nueva), apartarla y restaurar.
if [ -f "$DIR/booting-$VER" ]; then
  NP=$(head -n 1 "$DIR/booting-$VER" 2>/dev/null || true)
  case "$NP" in
    '' | *[!0-9]*) ;;
    *)
      CMD=$(ps -p "$NP" -o command= 2>/dev/null || true)
      case "$CMD" in
        *"$TARGET/Contents/"*)
          kill "$NP" 2>/dev/null || true
          sleep 2
          kill -9 "$NP" 2>/dev/null || true
          ;;
      esac
      ;;
  esac
fi
rm -rf "$FAILED"
mv "$TARGET" "$FAILED" 2>/dev/null || rm -rf "$TARGET" 2>/dev/null || true
restore_old
launch "$TARGET" || true
write_result false true "boot-timeout"
exit 1
