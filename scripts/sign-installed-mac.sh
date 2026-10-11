#!/bin/bash
# Firma /Applications/Lazunox.app con un certificado de firma de código local para que macOS conserve los permisos (TCC) entre builds.
# Uso: scripts/sign-installed-mac.sh ["Nombre del certificado"]   (por defecto «OnyxCode Local Signing»). La app debe estar cerrada.
set -euo pipefail
ID="${1:-OnyxCode Local Signing}"
APP=/Applications/Lazunox.app
cd "$(dirname "$0")/.."
pkill -f "$APP/Contents/MacOS" 2>/dev/null || true
codesign --force --deep --sign "$ID" "$APP"
node -e "
const {readFileSync}=require('fs');const sc=require('./build/sign-common.js');
const ids=sc.idsFromBrandSource(readFileSync('src/shared/brand.ts','utf8'));
sc.resignBundle({appPath:'$APP',identity:process.argv[1],ids,mode:'self'})" "$ID"
codesign -dr - "$APP" 2>&1 | tail -1
