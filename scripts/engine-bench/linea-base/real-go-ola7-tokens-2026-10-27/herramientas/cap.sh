#!/bin/bash
# cap.sh <lazunox|opencode2> <binario-dir> <exe> <carpeta-salida> [extra de run.mjs...]
set -u
E=$1; BIN=$2; EXE=$3; OUT=$4; shift 4
B=$HOME/Documents/lzx-bench-bin
W="$HOME/Documents/App OpenCode/.claude/worktrees/ola7-banco"
mkdir -p "$OUT"
docker run --rm --name lzx-tok-cap-$E --cpus=1 --memory=2g --network none --cap-drop=ALL --security-opt no-new-privileges \
  -e BENCH_EN_CONTENEDOR=1 -v "$W":/app:ro -v "$BIN":/motor:ro -v "$OUT":/out -v "$B/tokens/captura.mjs":/captura.mjs:ro -v "$HOME/Documents/App OpenCode/node_modules/typescript":/ts:ro -w /app node:22-bookworm \
  bash -c "node /captura.mjs /out/cap 8099 & sleep 1; node scripts/engine-bench/run.mjs --motor /motor/$EXE --adaptador $E --proxy-url http://127.0.0.1:8099/v1 --prefijo cap --modelo opencode-go/deepseek-v4.1-flash --repeticiones ${REPS:-1} --typescript /ts --guardar-corridas /out/corridas --salida /out/bench.json $*" > "$OUT/log.txt" 2>&1
