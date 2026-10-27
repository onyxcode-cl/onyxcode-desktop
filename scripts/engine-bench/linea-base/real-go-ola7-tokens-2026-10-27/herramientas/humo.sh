#!/bin/bash
# humo.sh <binario-dir> <carpeta> <tareas> : un contenedor de 2 CPU / 3 GB sobre la red interna que solo llega al proxy
B=$HOME/Documents/lzx-bench-bin; W="$HOME/Documents/App OpenCode/.claude/worktrees/ola7-banco"
OUT=$B/tokens/smoke/$2; mkdir -p "$OUT"
docker run --rm --name lzx-tok-humo --cpus=2 --memory=3g --network lzx-cmp-net --cap-drop=ALL --security-opt no-new-privileges \
  -e BENCH_EN_CONTENEDOR=1 -v "$W":/app:ro -v "$1":/motor:ro -v "$OUT":/out -v "$HOME/Documents/App OpenCode/node_modules/typescript":/ts:ro -w /app node:22-bookworm \
  node scripts/engine-bench/run.mjs --motor /motor/opencode --adaptador lazunox --proxy-url http://proxy:8080/v1 --prefijo lz --modelo opencode-go/deepseek-v4.1-flash --tareas "$3" --repeticiones 1 --typescript /ts --guardar-corridas /out/corridas --salida /out/bench.json > "$OUT/log.txt" 2>&1
