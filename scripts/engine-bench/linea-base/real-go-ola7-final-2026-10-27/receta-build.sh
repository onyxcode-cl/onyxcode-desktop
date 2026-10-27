#!/bin/bash
# dentro de oven/bun:1.3.14 con /w montado. Uso: build.sh ctl|cand
set -u
N=$1; L=/w/log-$N.txt
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a $L; }
apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq git unzip curl ca-certificates zip time python3 build-essential >/dev/null 2>&1
export MODELS_DEV_API_JSON=/w/models.json OPENCODE_VERSION=1.19.0 OPENCODE_CHANNEL=latest
rm -rf /w/src-$N; mkdir /w/src-$N; tar xzf /w/$N.tgz -C /w/src-$N
mkdir -p /w/src-$N/.github; : > /w/src-$N/.github/TEAM_MEMBERS
cd /w/src-$N; say "bun install"; bun install --frozen-lockfile > /w/install-$N.log 2>&1; say "install=$?"
cd packages/opencode
OS=linux; ARCH=arm64
cp script/build.ts script/build-t.ts
sed -i "s/item.os !== process.platform || item.arch !== process.arch/item.os !== \"$OS\" || item.arch !== \"$ARCH\"/" script/build-t.ts
rm -rf dist
bun run script/build-t.ts --single --skip-embed-web-ui > /w/bt-$N.log 2>&1; say "build=$?"
B=$(find dist -type f -name opencode -path "*linux-arm64*" | head -1)
cp "$B" /w/out-$N; say "$(sha256sum /w/out-$N) $(stat -c %s /w/out-$N)"
touch /w/DONE-$N
