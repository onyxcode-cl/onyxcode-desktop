#!/bin/sh
# Captura la ventana real de Lazunox en el PC de pruebas (sesion interactiva). Uso: ONYX_WIN_HOST=usuario@ip sh scripts/win/window-shot.sh
# Crea una tarea programada /IT, la ejecuta, espera, copia la captura al Mac y borra la tarea.
set -u
HOST="${ONYX_WIN_HOST:?define ONYX_WIN_HOST}"
OUT="${OUT:-/private/tmp/ventana-win.png}"
SSHO="-o BatchMode=yes -o ConnectTimeout=15"
ssh $SSHO "$HOST" 'schtasks /Create /TN lazunox-window-shot /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\onyx\wt\scripts\win\window-shot.ps1" /SC ONCE /ST 00:00 /IT /F && schtasks /Run /TN lazunox-window-shot' </dev/null
sleep 45
scp $SSHO "$HOST:C:/onyx/shots/ventana.png" "$OUT"
ssh $SSHO "$HOST" 'schtasks /Delete /TN lazunox-window-shot /F; type C:\onyx\shots\ventana.log' </dev/null
echo "captura: $OUT"
