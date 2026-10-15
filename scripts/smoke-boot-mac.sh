#!/bin/bash
# Prueba de ARRANQUE de la app empaquetada de Mac: copia el .app a una carpeta temporal (no ensucia el original ni su firma), lo abre con datos
# temporales y llavero de mentira, y exige que cargue la ventana principal (se ve por el puerto de depuración) y siga viva unos segundos.
# Falla si la app se cae al abrir (p. ej. «Cannot find module»). Uso: scripts/smoke-boot-mac.sh [ruta/Lazunox.app]
# Pensado como PUERTA antes de publicar: si falla, NO se publica.
set -uo pipefail
APP="${1:-dist/mac-arm64/Lazunox.app}"
[ -d "$APP" ] || { echo "No existe $APP" >&2; exit 2; }
T="$(mktemp -d /tmp/lzx-smoke.XXXXXX)"
PORT=$((20000 + RANDOM % 20000))
cleanup() { [ -f "$T/pid" ] && kill "$(cat "$T/pid")" 2>/dev/null; sleep 1; pkill -f "user-data-dir=$T" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT
ditto "$APP" "$T/Lazunox.app"
EXE="$(ls "$T/Lazunox.app/Contents/MacOS" | head -1)"
( "$T/Lazunox.app/Contents/MacOS/$EXE" --user-data-dir="$T/ud" --use-mock-keychain --remote-debugging-port=$PORT >"$T/out.log" 2>&1 & echo $! >"$T/pid" )
OK=0
for _ in $(seq 1 60); do
  sleep 1
  kill -0 "$(cat "$T/pid")" 2>/dev/null || { echo "FALLA: la app se cerró al arrancar"; break; }
  if curl -s "http://127.0.0.1:$PORT/json" | grep -q '"type": "page"'; then OK=1; break; fi
done
if [ "$OK" = 1 ]; then
  sleep 6
  kill -0 "$(cat "$T/pid")" 2>/dev/null || { echo "FALLA: la app se cayó poco después de abrir"; OK=0; }
fi
if grep -qiE "Uncaught Exception|Cannot find module" "$T/out.log" 2>/dev/null; then echo "FALLA: error en el arranque:"; grep -iE -m3 "Uncaught|Cannot find module" "$T/out.log"; OK=0; fi
[ "$OK" = 1 ] && { echo "OK: la app abre y se mantiene viva ($APP)"; exit 0; }
[ -z "$(grep -l FALLA /dev/null)" ] && echo "FALLA: la ventana principal no cargó (la app no abrió bien)"
tail -5 "$T/out.log" 2>/dev/null; exit 1
