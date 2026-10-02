#!/bin/sh
# Sincroniza el arbol de trabajo actual al PC Windows de pruebas y ejecuta C:\onyx\run.ps1.
# Uso: [STEPS=ci,typecheck,unit,build] [MAXSEC=3600] scripts/win/sync.sh
# Devuelve el codigo de salida registrado en C:/onyx/logs/<rama>/summary.txt.
set -u
HOST="${WIN_HOST:-bentec@192.168.1.84}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2
BR="$(git branch --show-current | tr '/' '-')"
STEPS="${STEPS:-ci,typecheck,unit,build,e2e}"
MAXSEC="${MAXSEC:-3600}"
TMP="${TMPDIR:-/tmp}/onyx-sync-$$.tgz"
trap 'rm -f "$TMP"' EXIT
SSHO="-o BatchMode=yes -o ConnectTimeout=15"

# Lista de archivos (sin binarios descargados ni los que ya no existen en disco)
git ls-files -co --exclude-standard -z \
  | perl -0ne 'chomp; next if m{^resources/opencode-bin/bin/}; print "$_\0" if -e $_ || -l $_' \
  | COPYFILE_DISABLE=1 tar --null -T - -czf "$TMP" || exit 2

# El fichero va a C:/onyx/inbox (se crea si falta)
perl -e 'alarm shift; exec @ARGV' 60 ssh $SSHO "$HOST" 'powershell -NoProfile -Command "New-Item -ItemType Directory -Force C:\onyx\inbox,C:\onyx\logs | Out-Null"' || exit 2
perl -e 'alarm shift; exec @ARGV' 300 scp $SSHO -q "$TMP" "$HOST:C:/onyx/inbox/onyx.tgz" || exit 2

perl -e 'alarm shift; exec @ARGV' "$MAXSEC" ssh $SSHO "$HOST" \
  "powershell -NoProfile -ExecutionPolicy Bypass -File C:\\onyx\\run.ps1 -Branch $BR -Steps $STEPS" </dev/null
RC_SSH=$?

SUMMARY="$(perl -e 'alarm shift; exec @ARGV' 60 ssh $SSHO "$HOST" "powershell -NoProfile -Command \"Get-Content C:\\onyx\\logs\\$BR\\summary.txt\"" </dev/null)"
printf '%s\n' "$SUMMARY"
if [ "$RC_SSH" -ge 128 ] || [ "$RC_SSH" -eq 255 ]; then
  echo "sync.sh: ssh termino con $RC_SSH (limite de tiempo o conexion); el run.ps1 remoto puede seguir: limpia con Stop-Orphans" >&2
fi
CODE="$(printf '%s\n' "$SUMMARY" | sed -n 's/^EXIT=\([0-9][0-9]*\).*/\1/p' | tail -1)"
[ -n "$CODE" ] && exit "$CODE"
exit 1
