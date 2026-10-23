#!/bin/bash
# Release de Lazunox en un solo comando, por fases. Encadena los scripts que ya existen y se detiene al primer fallo.
#
#   scripts/release.sh [--dry-run] [--force] prepare X.Y.Z   comprobaciones previas (solo lectura)
#   scripts/release.sh [--dry-run] [--force] mac     X.Y.Z   package -> firmar -> publish-update -> verify-update -> verify:bundled -> smoke-boot
#   scripts/release.sh [--dry-run] [--force] win     X.Y.Z   PC Windows: package, traer win-unpacked + instalador, publish-update win, verify, pack-check
#   scripts/release.sh [--dry-run] [--force] draft   X.Y.Z   carpeta dist/github + BORRADOR en GitHub + comparación del digest de cada asset
#   scripts/release.sh [--dry-run]           publish X.Y.Z   SOLO con confirmación escrita por una persona: publica, sube la página, imprime lo que falta
#
# --dry-run : solo imprime lo que haría (las comprobaciones de solo lectura de `prepare` sí se evalúan, para que se vea el estado real).
# --force   : repite pasos ya hechos (por defecto cada paso exitoso deja una marca en dist/release-state/X.Y.Z/ y se salta si el commit no cambió).
#
# Variables de entorno (valores por defecto entre paréntesis):
#   ONYX_WIN_HOST (Bentec@100.64.0.6)   usuario@host del PC Windows de pruebas (se alcanza por Tailscale)
#   ONYX_WIN_ROOT (C:/onyx)             carpeta de trabajo en ese PC (la de scripts/win/run.ps1)
#   LAZUNOX_UPDATE_KEY_FILE (~/.lazunox-keys/update.pem)  clave de firma del actualizador; solo se pasa por entorno a publish-update, NUNCA se lee ni se imprime
#   RELEASE_ALLOW_BRANCH=1              permite `prepare` fuera de `main` (solo para probar el script)
#
# Diseño: no publica nada por sí solo salvo `publish`, que además de la frase exige entrada interactiva (stdin y stdout son un terminal).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 2

export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
WIN_HOST="${ONYX_WIN_HOST:-Bentec@100.64.0.6}"
WIN_ROOT="${ONYX_WIN_ROOT:-C:/onyx}"
KEY_FILE="${LAZUNOX_UPDATE_KEY_FILE:-$HOME/.lazunox-keys/update.pem}"
DEPLOY_KEY="$HOME/.ssh/lazunox_deploy_ed25519"
VPS_HOST="root@72.60.55.136"
VPS_HTML="/opt/lazunox-site/html/lazunox"
SITE_URL="https://www.onyxcode.cl/lazunox"
SSHO=(-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=20)

DRY=0
FORCE=0
ARGS=()
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --*) echo "Opción desconocida: $a" >&2; exit 2 ;;
    *) ARGS+=("$a") ;;
  esac
done
PHASE="${ARGS[0]:-}"
VERSION="${ARGS[1]:-}"
[ "${#ARGS[@]}" -le 2 ] || { echo "Sobran argumentos. Uso: scripts/release.sh [--dry-run] <prepare|mac|win|draft|publish> X.Y.Z" >&2; exit 2; }
case "$PHASE" in prepare|mac|win|draft|publish) ;; *) echo "Uso: scripts/release.sh [--dry-run] [--force] <prepare|mac|win|draft|publish> X.Y.Z" >&2; exit 2 ;; esac
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Versión no válida: «${VERSION}» (se espera X.Y.Z)." >&2; exit 2; }

TAG="v$VERSION"
REPO="$(sed -n "s/^export const RELEASES_REPO = '\([^']*\)'.*/\1/p" src/shared/brand.ts)"
[ -n "$REPO" ] || { echo "ERROR: no encuentro RELEASES_REPO en src/shared/brand.ts." >&2; exit 1; }
DMG="dist/lazunox-$VERSION-arm64.dmg"
EXE="dist/Lazunox-Setup-$VERSION-x64.exe"
STATE="dist/release-state/$VERSION"
BRANCH_SAFE="$(git branch --show-current | tr '/' '-')"

say()  { printf '\n== %s\n' "$*"; }
info() { printf '   %s\n' "$*"; }
die()  { printf 'ERROR: %s\n' "$*" >&2; printf 'La fase «%s» se detuvo. Arregla lo anterior y vuelve a correrla (los pasos ya hechos se saltan).\n' "$PHASE" >&2; exit 1; }

# run: imprime el comando; en --dry-run no lo ejecuta. Un fallo detiene la fase.
run() {
  printf '   $ %s\n' "$*"
  [ "$DRY" -eq 1 ] && return 0
  "$@" || die "falló: $*"
}
# run_to: igual que run pero con límite de tiempo (macOS no trae `timeout`).
run_to() {
  local secs="$1"; shift
  printf '   $ (límite %ss) %s\n' "$secs" "$*"
  [ "$DRY" -eq 1 ] && return 0
  perl -e 'alarm shift; exec @ARGV' "$secs" "$@" || die "falló o superó ${secs}s: $*"
}

# Marcas de paso (idempotencia): válidas mientras HEAD no cambie.
HEAD_NOW="$(git rev-parse HEAD)"
step_done() { [ "$FORCE" -eq 0 ] && [ -f "$STATE/$1.ok" ] && [ "$(cat "$STATE/$1.ok")" = "$HEAD_NOW" ]; }
step_mark() { [ "$DRY" -eq 1 ] && return 0; mkdir -p "$STATE"; printf '%s' "$HEAD_NOW" > "$STATE/$1.ok"; }
# step NOMBRE DESCRIPCIÓN función...
step() {
  local name="$1" desc="$2"; shift 2
  say "$desc"
  if step_done "$name"; then info "ya hecho para este commit (usa --force para repetir): se salta."; return 0; fi
  "$@"
  step_mark "$name"
}

need_file() { [ "$DRY" -eq 1 ] || [ -e "$1" ] || die "falta $1"; }
need_cmd()  { command -v "$1" >/dev/null 2>&1 || die "no encuentro el comando «$1»."; }

jsonver() { node -e "const j=require('./$1');process.stdout.write(String($2))"; }

# ---------------------------------------------------------------- prepare
phase_prepare() {
  say "Comprobaciones previas de $TAG (solo lectura)"
  local fails=0
  bad() { printf '   FALLA: %s\n' "$*"; fails=$((fails + 1)); }
  ok()  { printf '   ok: %s\n' "$*"; }

  local br; br="$(git branch --show-current)"
  if [ "$br" = "main" ] || [ "${RELEASE_ALLOW_BRANCH:-0}" = "1" ]; then ok "rama «${br}»"; else bad "estás en «${br}»; la release sale de «main» (RELEASE_ALLOW_BRANCH=1 solo para probar el script)."; fi

  if [ -z "$(git status --porcelain)" ]; then ok "árbol limpio"; else bad "hay cambios sin confirmar (git status)."; fi

  if git fetch --quiet origin main 2>/dev/null; then
    local loc rem; loc="$(git rev-parse HEAD)"; rem="$(git rev-parse origin/main)"
    if [ "$br" = "main" ]; then
      [ "$loc" = "$rem" ] && ok "main al día con origin/main" || bad "main local ($loc) distinto de origin/main ($rem): haz pull/push antes (el borrador usa --target main)."
    else
      git merge-base --is-ancestor origin/main HEAD && ok "contiene origin/main" || bad "no contiene origin/main."
    fi
  else
    bad "no pude hacer git fetch origin main (¿sin red?): no puedo asegurar que main esté al día."
  fi

  need_cmd node
  local pv lv lv2
  pv="$(jsonver package.json 'j.version')" || pv=""
  lv="$(jsonver package-lock.json 'j.version')" || lv=""
  lv2="$(jsonver package-lock.json 'j.packages[""].version')" || lv2=""
  [ "$pv" = "$VERSION" ] && ok "package.json = $VERSION" || bad "package.json dice «${pv}», no $VERSION."
  [ "$lv" = "$VERSION" ] && [ "$lv2" = "$VERSION" ] && ok "package-lock.json = $VERSION" || bad "package-lock.json dice «${lv}» / «${lv2}», no $VERSION."
  if node scripts/release-notes.mjs "$VERSION" --no-install >/dev/null 2>&1; then ok "CHANGELOG.md tiene la sección [$VERSION] con contenido"; else bad "CHANGELOG.md no tiene la sección [$VERSION] (o está vacía)."; fi

  if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then bad "el tag $TAG ya existe en git."; fi
  if command -v gh >/dev/null 2>&1; then
    if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then info "aviso: ya existe una release $TAG en GitHub (borrador o publicada); \`draft\` lo tratará."; fi
  else
    bad "no está instalado «gh» (hace falta para draft y publish)."
  fi

  if [ -d node_modules ]; then
    local out; out="$(npm ls --omit=dev --all 2>&1 || true)"
    if printf '%s' "$out" | grep -Eqi 'extraneous|missing|invalid|ERR!'; then
      bad "npm ls --omit=dev --all reporta problemas (incidente 0.5.24):"
      printf '%s\n' "$out" | grep -Ei 'extraneous|missing|invalid|ERR!' | head -10 | sed 's/^/        /'
    else
      ok "npm ls --omit=dev --all sin extraneous/missing"
    fi
  else
    bad "no hay node_modules: corre npm ci y vuelve a probar (npm ls --omit=dev --all es una puerta obligatoria)."
  fi

  if [ "$fails" -gt 0 ]; then die "$fails comprobación(es) fallaron."; fi
  say "prepare: todo en orden para $TAG."
}

# ---------------------------------------------------------------- mac
mac_package()   { run_to 2400 npm run package; }
mac_sign()      { run scripts/sign-release-mac.sh; }
mac_publish() {
  [ "$DRY" -eq 1 ] || [ -f "$KEY_FILE" ] || die "no encuentro la clave de firma ($KEY_FILE). Defínela con LAZUNOX_UPDATE_KEY_FILE. (No se lee ni se imprime su contenido.)"
  printf '   $ LAZUNOX_UPDATE_KEY_FILE=<clave> node scripts/publish-update.mjs --out dist/update\n'
  [ "$DRY" -eq 1 ] && return 0
  rm -rf dist/update
  LAZUNOX_UPDATE_KEY_FILE="$KEY_FILE" node scripts/publish-update.mjs --out dist/update || die "falló publish-update (Mac)."
}
mac_verify()    { run node scripts/verify-update.mjs --dir dist/update; }
mac_bundled()   { run npm run verify:bundled; }
mac_smoke() {
  run_to 300 scripts/smoke-boot-mac.sh dist/mac-arm64/Lazunox.app
  # Misma prueba sobre el ZIP de la release, que es lo que reciben quienes se actualizan.
  local tmp="dist/release-state/$VERSION/zip-smoke"
  printf '   $ rm -rf %s && ditto -x -k dist/update/Lazunox-%s-arm64.zip %s\n' "$tmp" "$VERSION" "$tmp"
  if [ "$DRY" -eq 0 ]; then
    rm -rf "$tmp"; mkdir -p "$tmp"
    ditto -x -k "dist/update/Lazunox-$VERSION-arm64.zip" "$tmp" || die "no pude abrir el ZIP de la release."
  fi
  run_to 300 scripts/smoke-boot-mac.sh "$tmp/Lazunox.app"
  [ "$DRY" -eq 1 ] || rm -rf "$tmp"
}

phase_mac() {
  need_cmd node; need_cmd ditto
  [ "$(uname)" = "Darwin" ] || [ "$DRY" -eq 1 ] || die "la fase mac solo corre en macOS."
  [ "$DRY" -eq 1 ] || [ "$(jsonver package.json 'j.version')" = "$VERSION" ] || die "package.json no está en $VERSION: corre prepare."
  step mac-package  "Mac 1/6: empaquetar (npm run package)" mac_package
  step mac-sign     "Mac 2/6: firmar con «Lazunox Local Signing»" mac_sign
  step mac-publish  "Mac 3/6: ZIP + manifiesto firmado (publish-update)" mac_publish
  step mac-verify   "Mac 4/6: reproducir la verificación del cliente (verify-update)" mac_verify
  # verify:bundled va DESPUÉS de publish-update: abre la app y rompe su firma si se corre antes.
  step mac-bundled  "Mac 5/6: dependencias dentro del app.asar (verify:bundled)" mac_bundled
  step mac-smoke    "Mac 6/6: prueba de arranque sobre la .app y sobre el ZIP (smoke-boot)" mac_smoke
  need_file "$DMG"
  say "mac: listo. Artefactos en dist/update/ y $DMG"
}

# ---------------------------------------------------------------- win
# Todo lo que corre en el PC Windows pasa por ssh con BatchMode; el PC se alcanza por Tailscale (reconéctalo si está parado).
win_ssh() { local secs="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$secs" ssh "${SSHO[@]}" "$WIN_HOST" "$@" </dev/null; }

win_reach() {
  printf '   $ ssh %s "echo ok"\n' "$WIN_HOST"
  [ "$DRY" -eq 1 ] && return 0
  win_ssh 30 'echo ok' >/dev/null 2>&1 || die "no llego al PC Windows ($WIN_HOST). ¿Tailscale parado? Define ONYX_WIN_HOST si cambió."
}
win_package() {
  printf '   $ STEPS=ci,package ONYX_WIN_HOST=%s scripts/win/sync.sh\n' "$WIN_HOST"
  [ "$DRY" -eq 1 ] && return 0
  STEPS=ci,package MAXSEC=3300 ONYX_WIN_HOST="$WIN_HOST" scripts/win/sync.sh || die "falló el empaquetado en Windows (mira C:\\onyx\\logs\\$BRANCH_SAFE)."
}
win_fetch() {
  local remote_tar="$WIN_ROOT/inbox/win-unpacked-$VERSION.tar"
  printf '   $ ssh %s tar -cf %s -C %s/wt/dist win-unpacked\n' "$WIN_HOST" "$remote_tar" "$WIN_ROOT"
  printf '   $ scp %s:%s -> dist/win-unpacked.tar ; tar -xf (en dist/win-unpacked-pc)\n' "$WIN_HOST" "$remote_tar"
  printf '   $ scp %s:%s/wt/dist/Lazunox-Setup-%s-x64.exe %s\n' "$WIN_HOST" "$WIN_ROOT" "$VERSION" "$EXE"
  [ "$DRY" -eq 1 ] && return 0
  mkdir -p dist
  win_ssh 600 "tar.exe -cf $remote_tar -C $WIN_ROOT/wt/dist win-unpacked" || die "no pude armar el tar de win-unpacked en el PC."
  perl -e 'alarm shift; exec @ARGV' 900 scp "${SSHO[@]}" -q "$WIN_HOST:$remote_tar" dist/win-unpacked.tar || die "no pude traer win-unpacked."
  rm -rf dist/win-unpacked-pc && mkdir -p dist/win-unpacked-pc
  COPYFILE_DISABLE=1 tar -xf dist/win-unpacked.tar -C dist/win-unpacked-pc || die "no pude extraer win-unpacked."
  perl -e 'alarm shift; exec @ARGV' 900 scp "${SSHO[@]}" -q "$WIN_HOST:$WIN_ROOT/wt/dist/Lazunox-Setup-$VERSION-x64.exe" "$EXE" || die "no pude traer el instalador (¿la versión del PC es $VERSION?)."
  win_ssh 60 "del $remote_tar" >/dev/null 2>&1 || true
  rm -f dist/win-unpacked.tar
}
win_publish() {
  [ "$DRY" -eq 1 ] || [ -f "$KEY_FILE" ] || die "no encuentro la clave de firma ($KEY_FILE)."
  printf '   $ LAZUNOX_UPDATE_KEY_FILE=<clave> node scripts/publish-update.mjs --platform win32-x64 --app dist/win-unpacked-pc/win-unpacked --out dist/update-win\n'
  [ "$DRY" -eq 1 ] && return 0
  rm -rf dist/update-win
  LAZUNOX_UPDATE_KEY_FILE="$KEY_FILE" node scripts/publish-update.mjs --platform win32-x64 --app dist/win-unpacked-pc/win-unpacked --out dist/update-win || die "falló publish-update (Windows)."
}
win_verify()    { run node scripts/verify-update.mjs --platform win32-x64 --dir dist/update-win; }
win_packcheck() {
  printf '   $ ssh %s powershell -File %s/wt/scripts/win/pack-check.ps1 -Branch %s\n' "$WIN_HOST" "$WIN_ROOT" "$BRANCH_SAFE"
  [ "$DRY" -eq 1 ] && return 0
  win_ssh 1500 "powershell -NoProfile -ExecutionPolicy Bypass -File $WIN_ROOT/wt/scripts/win/pack-check.ps1 -Branch $BRANCH_SAFE" || die "pack-check.ps1 falló (log en $WIN_ROOT/logs/$BRANCH_SAFE/pack-check.txt)."
}

phase_win() {
  need_cmd ssh; need_cmd scp; need_cmd node
  [ "$DRY" -eq 1 ] || [ "$(jsonver package.json 'j.version')" = "$VERSION" ] || die "package.json no está en $VERSION: corre prepare."
  say "Windows 0/6: alcanzar el PC de pruebas ($WIN_HOST)"
  win_reach
  step win-package   "Windows 1/6: sincronizar y empaquetar en el PC (sync.sh, STEPS=ci,package)" win_package
  step win-fetch     "Windows 2/6: traer win-unpacked y el instalador" win_fetch
  step win-publish   "Windows 3/6: ZIP + manifiesto firmado (publish-update --platform win32-x64)" win_publish
  step win-verify    "Windows 4/6: verificación del cliente (verify-update win32-x64)" win_verify
  step win-packcheck "Windows 5/6: pack-check.ps1 en el PC" win_packcheck
  need_file "$EXE"
  say "win: listo. Artefactos en dist/update-win/ y $EXE"
}

# ---------------------------------------------------------------- draft
draft_files() {
  DRAFT_FILES=(
    "dist/update/update.json" "dist/update/update.json.sig" "dist/update/Lazunox-$VERSION-arm64.zip"
    "dist/update-win/update-win32-x64.json" "dist/update-win/update-win32-x64.json.sig" "dist/update-win/Lazunox-$VERSION-win32-x64.zip"
    "$DMG" "$EXE"
  )
}
draft_stage() {
  local f; for f in "${DRAFT_FILES[@]}"; do need_file "$f"; done
  run node scripts/publish-github.mjs --tag "$TAG" --out dist/github "${DRAFT_FILES[@]}"
}
draft_notes() {
  printf '   $ node scripts/release-notes.mjs %s --out dist/notas-%s.md  (y se cambia X.Y.Z por %s)\n' "$VERSION" "$VERSION" "$VERSION"
  [ "$DRY" -eq 1 ] && return 0
  node scripts/release-notes.mjs "$VERSION" --out "dist/notas-$VERSION.md" >/dev/null || die "no pude extraer las notas del CHANGELOG."
  sed -i '' "s/X\.Y\.Z/$VERSION/g" "dist/notas-$VERSION.md"
}
draft_create() {
  local state
  state="$(gh release view "$TAG" --repo "$REPO" --json isDraft -q '.isDraft' 2>/dev/null || echo none)"
  if [ "$state" = "false" ]; then die "$TAG ya está PUBLICADA: draft no la toca."; fi
  if [ "$state" = "true" ]; then info "el borrador $TAG ya existe: no se vuelve a crear (se comparan sus assets abajo)."; return 0; fi
  local assets=() n
  if [ "$DRY" -eq 0 ]; then
    for n in dist/github/*; do assets+=("$n"); done
  else
    assets=("dist/github/*")
  fi
  run gh release create "$TAG" "${assets[@]}" --repo "$REPO" --draft --target main --title "Lazunox $VERSION" --notes-file "dist/notas-$VERSION.md"
}
# Compara el digest SHA-256 que calcula GitHub para CADA asset con el archivo local de dist/github. Falla si falta, sobra o difiere.
compare_digests() {
  say "Comparar el digest de CADA asset con el archivo local"
  printf '   $ gh release view %s --repo %s --json assets  (contra shasum -a 256 de dist/github/*)\n' "$TAG" "$REPO"
  [ "$DRY" -eq 1 ] && return 0
  [ -d dist/github ] || die "no existe dist/github: corre draft primero."
  local remote bad=0 n want have seen=0
  remote="$(gh release view "$TAG" --repo "$REPO" --json assets -q '.assets[] | [.name, .digest] | @tsv')" || die "no pude leer la release $TAG."
  for n in dist/github/*; do
    local base; base="$(basename "$n")"
    want="$(printf '%s\n' "$remote" | awk -F'\t' -v f="$base" 'tolower($1)==tolower(f){print $2}' | head -1)"
    have="sha256:$(shasum -a 256 "$n" | cut -d' ' -f1)"
    seen=$((seen + 1))
    if [ "$want" = "$have" ]; then info "ok  $base"; else info "NO COINCIDE  $base (GitHub: ${want:-sin digest} / local: $have)"; bad=$((bad + 1)); fi
  done
  local nremote; nremote="$(printf '%s\n' "$remote" | grep -c .)"
  [ "$nremote" -eq "$seen" ] || { info "la release tiene $nremote assets y el local $seen"; bad=$((bad + 1)); }
  [ "$bad" -eq 0 ] || die "$bad asset(s) no coinciden: NO se publica. Borra el borrador (gh release delete $TAG --repo $REPO) y repite."
  info "los $seen assets coinciden."
}

phase_draft() {
  need_cmd gh; need_cmd node; need_cmd shasum
  draft_files
  step draft-stage "Borrador 1/3: carpeta dist/github con SHA256SUMS" draft_stage
  step draft-notes "Borrador 2/3: notas de release (release-notes.mjs)" draft_notes
  say "Borrador 3/3: crear el BORRADOR en GitHub (--draft --target main)"
  draft_create
  compare_digests
  say "draft: listo. Revisa el borrador en GitHub; la publicación es la fase «publish»."
}

# ---------------------------------------------------------------- publish
phase_publish() {
  need_cmd gh; need_cmd shasum
  draft_files
  say "Publicar $TAG (IRREVERSIBLE para quien actualice: las apps empiezan a ofrecer la versión)"
  local state
  if [ "$DRY" -eq 1 ]; then state="(no se consulta en --dry-run)"; else
    state="$(gh release view "$TAG" --repo "$REPO" --json isDraft -q '.isDraft' 2>/dev/null || echo none)"
    [ "$state" = "true" ] || die "no hay un BORRADOR $TAG en GitHub (estado: $state). Corre draft primero."
  fi
  compare_digests

  local phrase="publicar $TAG"
  if [ "$DRY" -eq 1 ]; then
    info "(--dry-run) pediría escribir exactamente «${phrase}» en un terminal interactivo; sin eso no se avanza."
  else
    [ -t 0 ] && [ -t 1 ] || die "publish exige un terminal interactivo: una persona debe escribir la confirmación (no se acepta entrada por tubería ni en automático)."
    printf '\nVa a publicar %s en %s y a subir la página de descargas al VPS.\nPara continuar escribe exactamente:  %s\n> ' "$TAG" "$REPO" "$phrase"
    local reply=""; IFS= read -r reply || reply=""
    [ "$reply" = "$phrase" ] || die "confirmación no recibida: no se publicó nada."
  fi

  say "Publicar $TAG en GitHub (--draft=false --latest)"
  run gh release edit "$TAG" --repo "$REPO" --draft=false --latest

  say "Página de descargas (VPS)"
  run site/publicar-descargas.sh "$VERSION"

  say "Versión en site/lazunox/index.html y subida"
  local old; old="$(grep -o 'Lazunox-[0-9]*\.[0-9]*\.[0-9]*-arm64\.dmg' site/lazunox/index.html | head -1 | sed 's/^Lazunox-\(.*\)-arm64\.dmg$/\1/')"
  [ -n "$old" ] || die "no encuentro la versión actual en site/lazunox/index.html."
  if [ "$old" = "$VERSION" ]; then
    info "index.html ya dice $VERSION: no se cambia."
  else
    printf '   $ sed -i "" Lazunox-%s-arm64.dmg -> %s ; Lazunox-Setup-%s-x64.exe -> %s  (site/lazunox/index.html)\n' "$old" "$VERSION" "$old" "$VERSION"
    [ "$DRY" -eq 1 ] || sed -i '' -e "s/Lazunox-$old-arm64\.dmg/Lazunox-$VERSION-arm64.dmg/g" -e "s/Lazunox-Setup-$old-x64\.exe/Lazunox-Setup-$VERSION-x64.exe/g" site/lazunox/index.html
  fi
  printf '   $ scp -i <llave de despliegue> site/lazunox/index.html %s:%s/\n' "$VPS_HOST" "$VPS_HTML"
  if [ "$DRY" -eq 0 ]; then
    scp -q -i "$DEPLOY_KEY" -o IdentitiesOnly=yes -o BatchMode=yes site/lazunox/index.html "$VPS_HOST:$VPS_HTML/" || die "no pude subir index.html."
  fi

  say "Lo que FALTA hacer a mano"
  cat <<EOF
   1. Purgar Cloudflare (el token está en un MCP, no en este script) para:
        $SITE_URL/
        $SITE_URL/index.html
        $SITE_URL/descargas/Lazunox-$VERSION-arm64.dmg
        $SITE_URL/descargas/Lazunox-Setup-$VERSION-x64.exe
        $SITE_URL/descargas/latest.json
        $SITE_URL/descargas/SHA256SUMS
   2. Comprobar desde el dominio, sin caché, que lo servido es lo publicado (debe imprimir OK dos veces):
        for f in Lazunox-$VERSION-arm64.dmg Lazunox-Setup-$VERSION-x64.exe; do
          curl -fsSL -H 'Cache-Control: no-cache' "$SITE_URL/descargas/\$f?v=\$(date +%s)" | shasum -a 256 | cut -d' ' -f1 > /tmp/lzx-got
          grep -q "\$(cat /tmp/lzx-got)  \$f" <(curl -fsSL "$SITE_URL/descargas/SHA256SUMS?v=\$(date +%s)") && echo "OK \$f" || echo "NO COINCIDE \$f"
        done
   3. Confirmar en GitHub que $TAG figura como «Latest», y confirmar el cambio de site/lazunox/index.html en git (git add site/lazunox/index.html).
   4. Si algo sale mal: scripts/retirar-release.sh $VERSION <versión buena anterior>.
EOF
}

case "$PHASE" in
  prepare) phase_prepare ;;
  mac) phase_mac ;;
  win) phase_win ;;
  draft) phase_draft ;;
  publish) phase_publish ;;
esac
